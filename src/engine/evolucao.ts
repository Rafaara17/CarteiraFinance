// Reconstrói a EVOLUÇÃO da carteira ao longo do tempo a partir da série
// histórica de preços (prices_history) + o ledger de transações. Motor puro
// (sem DOM/React), testável, reaproveitando `replay` (ledger), `marcarBond`
// (bonds) e o câmbio por moeda.
//
// Ideia: para cada dia da série no período, reconstrói caixa + posições pelo
// replay do ledger até aquele dia e marca a mercado com o preço/câmbio daquele
// dia (forward-fill do último valor conhecido). A soma é o patrimônio do dia.

import { marcarBond } from "./bonds";
import { replay } from "./ledger";
import type {
  Ativo,
  Config,
  HistoricoPrecos,
  PrecosSnapshot,
  Transacao,
} from "./types";

export type Benchmark = "IBOV" | "SP500" | "CDI" | "IPCA";

export const BENCHMARKS: Benchmark[] = ["IBOV", "SP500", "CDI", "IPCA"];

export const ROTULO_BENCHMARK: Record<Benchmark, string> = {
  IBOV: "IBOV",
  SP500: "S&P 500",
  CDI: "CDI",
  IPCA: "IPCA",
};

export type PresetPeriodo = "mes" | "3m" | "12m" | "tudo" | "custom";

export interface Intervalo {
  de: string; // "AAAA-MM-DD" (inclusive)
  ate: string; // "AAAA-MM-DD" (inclusive)
}

export interface PontoSerie {
  data: string;
  patrimonioBRL: number;
}

/** Ponto de rentabilidade (% desde o início do período; carteira vs. benchmarks). */
export interface PontoRentabilidade {
  data: string;
  carteira: number;
  IBOV?: number;
  SP500?: number;
  CDI?: number;
  IPCA?: number;
}

export interface RetornoMensal {
  mes: string; // "AAAA-MM"
  retornoPct: number;
}

export interface Evolucao {
  temDados: boolean;
  intervalo: Intervalo;
  /** curva de patrimônio (R$) no período. */
  serie: PontoSerie[];
  /** rentabilidade acumulada (%) da carteira e dos benchmarks disponíveis. */
  serieRentabilidade: PontoRentabilidade[];
  /** retorno mês a mês (%) do patrimônio. */
  retornosMensais: RetornoMensal[];
  patrimonioInicio: number;
  patrimonioFim: number;
  valorizacaoBRL: number;
  valorizacaoPct: number;
  /** rentabilidade (%) de cada benchmark no período (só os disponíveis). */
  benchmarks: Partial<Record<Benchmark, number>>;
}

const RENDA_FIXA = new Set(["tesouro", "bond"]);

/** Intervalo {de, ate} de um preset, relativo a `hoje` e ao início da liga. */
export function intervaloDoPreset(preset: PresetPeriodo, hoje: Date, dataInicio: string): Intervalo {
  const ate = ymd(hoje);
  if (preset === "tudo") return { de: dataInicio.slice(0, 10), ate };
  if (preset === "mes") return { de: `${ate.slice(0, 7)}-01`, ate };
  const d = new Date(hoje.getTime());
  if (preset === "3m") d.setUTCMonth(d.getUTCMonth() - 3);
  else if (preset === "12m") d.setUTCMonth(d.getUTCMonth() - 12);
  return { de: ymd(d), ate };
}

/**
 * Calcula a evolução da carteira no intervalo pedido. Retorna `temDados=false`
 * quando não há nenhum ponto histórico dentro do período (ex.: a Action de
 * histórico ainda não rodou).
 */
export function computarEvolucao(
  config: Config,
  transacoes: Transacao[],
  ativos: Ativo[],
  historico: HistoricoPrecos,
  intervalo: Intervalo,
): Evolucao {
  const { de, ate } = intervalo;
  const mapaAtivos = new Map(ativos.map((a) => [a.ticker, a]));
  const hist = [...historico].sort((a, b) => a.data.localeCompare(b.data));

  // Forward-fill: mantém o último valor conhecido de cada preço/câmbio/índice.
  const ultAcoes: Record<string, number> = {};
  const ultCambio: Record<string, number> = { BRL: 1 };
  const ultIndice: Partial<Record<Benchmark, number>> = {};

  // Ponto intermediário por dia do período (patrimônio + níveis de índice).
  const pontos: Array<{ data: string; patrimonio: number; niveis: Partial<Record<Benchmark, number>> }> = [];

  for (const pt of hist) {
    Object.assign(ultAcoes, pt.acoes);
    Object.assign(ultCambio, pt.cambio);
    for (const b of BENCHMARKS) {
      const v = pt.indices[b];
      if (typeof v === "number" && isFinite(v)) ultIndice[b] = v;
    }

    if (pt.data < de || pt.data > ate) continue; // fora do período (mas já atualizou o fill)

    const estado = estadoNaData(config, transacoes, pt.data);
    const patrimonio = estado.caixaBRL + valorPosicoesBRL(estado.posicoes, mapaAtivos, ultAcoes, ultCambio, pt.data);
    pontos.push({ data: pt.data, patrimonio, niveis: { ...ultIndice } });
  }

  if (pontos.length === 0) {
    return {
      temDados: false,
      intervalo,
      serie: [],
      serieRentabilidade: [],
      retornosMensais: [],
      patrimonioInicio: 0,
      patrimonioFim: 0,
      valorizacaoBRL: 0,
      valorizacaoPct: 0,
      benchmarks: {},
    };
  }

  const patrimonioInicio = pontos[0].patrimonio;
  const patrimonioFim = pontos[pontos.length - 1].patrimonio;
  const valorizacaoBRL = patrimonioFim - patrimonioInicio;
  const valorizacaoPct = patrimonioInicio > 0 ? (patrimonioFim / patrimonioInicio - 1) * 100 : 0;

  // Base de cada benchmark = primeiro nível disponível no período.
  const baseBench: Partial<Record<Benchmark, number>> = {};
  for (const b of BENCHMARKS) {
    for (const p of pontos) {
      if (typeof p.niveis[b] === "number") {
        baseBench[b] = p.niveis[b];
        break;
      }
    }
  }

  const serie: PontoSerie[] = pontos.map((p) => ({ data: p.data, patrimonioBRL: p.patrimonio }));

  const serieRentabilidade: PontoRentabilidade[] = pontos.map((p) => {
    const ponto: PontoRentabilidade = {
      data: p.data,
      carteira: patrimonioInicio > 0 ? (p.patrimonio / patrimonioInicio - 1) * 100 : 0,
    };
    for (const b of BENCHMARKS) {
      const base = baseBench[b];
      const nivel = p.niveis[b];
      if (typeof base === "number" && base > 0 && typeof nivel === "number") {
        ponto[b] = (nivel / base - 1) * 100;
      }
    }
    return ponto;
  });

  // Rentabilidade de cada benchmark no período: último nível / base - 1.
  const benchmarks: Partial<Record<Benchmark, number>> = {};
  for (const b of BENCHMARKS) {
    const base = baseBench[b];
    if (typeof base !== "number" || base <= 0) continue;
    let ultimo: number | undefined;
    for (const p of pontos) if (typeof p.niveis[b] === "number") ultimo = p.niveis[b];
    if (typeof ultimo === "number") benchmarks[b] = (ultimo / base - 1) * 100;
  }

  return {
    temDados: true,
    intervalo,
    serie,
    serieRentabilidade,
    retornosMensais: retornosMensais(serie),
    patrimonioInicio,
    patrimonioFim,
    valorizacaoBRL,
    valorizacaoPct,
    benchmarks,
  };
}

/** Estado (caixa + posições) do ledger considerando só transações até o fim do dia `dataYMD`. */
function estadoNaData(config: Config, transacoes: Transacao[], dataYMD: string) {
  const limite = Date.parse(`${dataYMD}T23:59:59.999Z`);
  const ate = transacoes.filter((t) => Date.parse(t.ts) <= limite);
  return replay(config, ate);
}

/** Valor de mercado (BRL) das posições num dia, com preços/câmbio forward-filled. */
function valorPosicoesBRL(
  posicoes: Map<string, { ticker: string; qtd: number; custoTotalBRL: number }>,
  mapaAtivos: Map<string, Ativo>,
  ultAcoes: Record<string, number>,
  ultCambio: Record<string, number>,
  dataYMD: string,
): number {
  const dataDate = new Date(`${dataYMD}T12:00:00.000Z`);
  let total = 0;

  for (const base of posicoes.values()) {
    if (base.qtd <= 0) continue;
    const ativo = mapaAtivos.get(base.ticker);
    const classe = ativo?.tipo ?? "acao";
    const moeda = ativo?.moeda ?? "BRL";

    if (ativo && RENDA_FIXA.has(classe) && ativo.bond) {
      // Sem série histórica de PU: usa o crescimento linear naquela data.
      const { puAtual } = marcarBond(ativo, precosVazios(ultCambio), dataDate);
      const fx = moeda === "BRL" ? 1 : ultCambio[moeda] ?? 1;
      total += base.qtd * puAtual * fx;
      continue;
    }

    const preco = ultAcoes[base.ticker];
    const fx = moeda === "BRL" ? 1 : ultCambio[moeda];
    if (typeof preco === "number" && preco > 0 && typeof fx === "number" && fx > 0) {
      total += base.qtd * preco * fx;
    } else {
      // Sem preço histórico disponível ainda: neutraliza usando o custo.
      total += base.custoTotalBRL;
    }
  }
  return total;
}

/** PrecosSnapshot mínimo para `marcarBond` (sem PU de tesouro => crescimento linear). */
function precosVazios(cambio: Record<string, number>): PrecosSnapshot {
  return { atualizadoEm: null, cambio, acoes: {}, tesouro: {} };
}

/** Retorno mês a mês (%) do patrimônio: fecha cada mês e compara com o anterior. */
function retornosMensais(serie: PontoSerie[]): RetornoMensal[] {
  if (serie.length === 0) return [];
  // Último patrimônio de cada mês, na ordem em que os meses aparecem.
  const fimDoMes = new Map<string, number>();
  for (const p of serie) fimDoMes.set(p.data.slice(0, 7), p.patrimonioBRL);
  const meses = [...fimDoMes.keys()];

  const out: RetornoMensal[] = [];
  let base = serie[0].patrimonioBRL; // abertura do período
  for (const mes of meses) {
    const fim = fimDoMes.get(mes)!;
    out.push({ mes, retornoPct: base > 0 ? (fim / base - 1) * 100 : 0 });
    base = fim;
  }
  return out;
}

/** Date -> "AAAA-MM-DD" (UTC). */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
