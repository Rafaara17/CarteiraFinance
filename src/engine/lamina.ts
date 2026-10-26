// Motor da LÂMINA (factsheet de uma página). Puro e testável.
//
// Parte da evolução "desde o início" (engine/evolucao.ts) e devolve os números
// que uma gestora publica na lâmina mensal:
//  - rentabilidade por janela (mês, ano, 12 meses, desde o início) vs. CDI e
//    IBOV, com o "% do CDI";
//  - a grade de retornos mês a mês por ano;
//  - indicadores de risco/retorno sobre retornos DIÁRIOS: volatilidade, Sharpe e
//    Sortino (excesso sobre o CDI), drawdown máximo, beta/correlação/tracking
//    error/information ratio contra o IBOV e VaR 95% histórico.
//
// Como o capital da liga é fixo (sem aportes nem resgates), a variação do
// patrimônio já é a rentabilidade por cota — não é preciso cotizar.

import { retornosPorChave, type Evolucao } from "./evolucao";
import type { HistoricoPrecos } from "./types";

export type JanelaLamina = "mes" | "ano" | "12m" | "inicio";

export const ROTULO_JANELA: Record<JanelaLamina, string> = {
  mes: "No mês",
  ano: "No ano",
  "12m": "12 meses",
  inicio: "Desde o início",
};

/** Bench usado na lâmina: CDI é o "benchmark" (Sharpe, % do CDI), IBOV a referência de mercado. */
export type BenchLamina = "CDI" | "IBOV";

export interface RentabilidadeJanela {
  janela: JanelaLamina;
  carteira: number | null;
  CDI: number | null;
  IBOV: number | null;
  /** rentabilidade da carteira em % do CDI (só com carteira e CDI positivos). */
  pctCDI: number | null;
}

export interface AnoGrade {
  ano: string;
  /** 12 posições (jan..dez); null onde não houve dado. */
  carteira: Array<number | null>;
  CDI: Array<number | null>;
  totalCarteira: number | null;
  totalCDI: number | null;
  /** acumulado da carteira do início até o fim deste ano. */
  acumulado: number | null;
}

export interface Indicadores {
  /** pregões com retorno usados nas estatísticas. */
  dias: number;
  retornoAnualizado: number | null;
  volAnual: number | null;
  sharpe: number | null;
  sortino: number | null;
  drawdownMax: number;
  drawdownPico: string | null;
  drawdownFundo: string | null;
  beta: number | null;
  correlacao: number | null;
  trackingError: number | null;
  informationRatio: number | null;
  /** VaR histórico 95% de 1 dia, em % do patrimônio (positivo = perda). */
  var95: number | null;
  /** meses com retorno na grade (inclui os de retorno zero). */
  meses: number;
  mesesPositivos: number;
  mesesNegativos: number;
  mesesAcimaCDI: number;
  melhorMes: { mes: string; pct: number } | null;
  piorMes: { mes: string; pct: number } | null;
}

export interface PontoLamina {
  data: string;
  carteira: number;
  CDI?: number;
  IBOV?: number;
}

export interface Lamina {
  temDados: boolean;
  inicio: string;
  dataBase: string;
  rentabilidades: RentabilidadeJanela[];
  grade: AnoGrade[];
  indicadores: Indicadores;
  /** rentabilidade acumulada (%) desde o início, para o gráfico. */
  serie: PontoLamina[];
}

/** Mínimo de retornos diários para uma estatística fazer sentido. */
const MIN_RETORNOS = 20;
const PREGOES_ANO = 252;

interface Nivel {
  data: string;
  carteira: number;
  CDI: number | null;
  IBOV: number | null;
  /** o IBOV deste dia é cotação real (não forward-fill). */
  ibovNoDia: boolean;
}

/**
 * Converte a rentabilidade rebaseada em NÍVEIS (1 = início) com forward-fill
 * dos índices: o ponto de hoje não tem nível de índice (ver `comPontoDeHoje`).
 */
function niveis(ev: Evolucao): Nivel[] {
  let cdi: number | null = null;
  let ibov: number | null = null;
  return ev.serieRentabilidade.map((p) => {
    if (typeof p.CDI === "number") cdi = 1 + p.CDI / 100;
    if (typeof p.IBOV === "number") ibov = 1 + p.IBOV / 100;
    return { data: p.data, carteira: 1 + p.carteira / 100, CDI: cdi, IBOV: ibov, ibovNoDia: typeof p.IBOV === "number" };
  });
}

/**
 * Dias de pregão da série: qualquer dia com IBOV, CDI ou cotação de ação. Não
 * depende só do IBOV — uma falha no backfill dele não pode fundir vários dias
 * da carteira num único "retorno diário".
 */
export function pregoesDoHistorico(historico: HistoricoPrecos): Set<string> {
  return new Set(
    historico
      .filter(
        (p) =>
          typeof p.indices.IBOV === "number" ||
          typeof p.indices.CDI === "number" ||
          Object.keys(p.acoes).length > 0,
      )
      .map((p) => p.data),
  );
}

/** Primeiro dia de cada janela, relativo à data-base. */
function inicioJanela(janela: JanelaLamina, dataBase: string, inicio: string): string {
  if (janela === "mes") return `${dataBase.slice(0, 7)}-01`;
  if (janela === "ano") return `${dataBase.slice(0, 4)}-01-01`;
  if (janela === "12m") {
    const d = new Date(`${dataBase}T12:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
  }
  return inicio;
}

function retornoJanela(ns: Nivel[], de: string, chave: "carteira" | BenchLamina, exigeHistoricoCompleto: boolean): number | null {
  const fim = ns[ns.length - 1][chave];
  // Base = fechamento do último dia ANTES da janela. Se a carteira começou dentro
  // da janela, o início dela é a base — exceto em "12 meses", que não se mostra
  // com menos de um ano de história (é o que as lâminas fazem).
  let base: number | null = null;
  for (const n of ns) {
    if (n.data >= de) break;
    base = n[chave];
  }
  if (base == null) {
    if (exigeHistoricoCompleto) return null;
    base = ns[0][chave];
  }
  if (base == null || fim == null || base <= 0) return null;
  return (fim / base - 1) * 100;
}

/** % do CDI só com os dois positivos: "−639% do CDI" não diz nada a ninguém. */
export function pctDoCDI(carteira: number | null, cdi: number | null): number | null {
  if (carteira == null || cdi == null || cdi <= 0 || carteira < 0) return null;
  return (carteira / cdi) * 100;
}

function media(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function desvio(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = media(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function covariancia(a: number[], b: number[]): number {
  if (a.length < 2) return 0;
  const ma = media(a);
  const mb = media(b);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (a.length - 1);
}

function quantil(xs: number[], q: number): number {
  const o = [...xs].sort((a, b) => a - b);
  const pos = (o.length - 1) * q;
  const i = Math.floor(pos);
  return o[i] + (o[Math.min(i + 1, o.length - 1)] - o[i]) * (pos - i);
}

/** Retorno mês a mês de uma chave de nível ("AAAA-MM" -> %). */
function mensais(ns: Nivel[], chave: "carteira" | BenchLamina): Map<string, number> {
  const serie = ns
    .filter((n) => n[chave] != null)
    .map((n) => ({ data: n.data, patrimonioBRL: n[chave] as number }));
  return new Map(retornosPorChave(serie, (d) => d.slice(0, 7)).map((r) => [r.chave, r.retornoPct]));
}

function composto(pcts: Array<number | null>): number | null {
  const v = pcts.filter((p): p is number => p != null);
  if (v.length === 0) return null;
  return (v.reduce((acc, p) => acc * (1 + p / 100), 1) - 1) * 100;
}

function grade(ns: Nivel[]): AnoGrade[] {
  const mc = mensais(ns, "carteira");
  const mcdi = mensais(ns, "CDI");
  const anos = [...new Set([...mc.keys()].map((k) => k.slice(0, 4)))].sort();
  return anos.map((ano) => {
    const carteira = Array.from({ length: 12 }, (_, i) => mc.get(`${ano}-${String(i + 1).padStart(2, "0")}`) ?? null);
    const CDI = Array.from({ length: 12 }, (_, i) => mcdi.get(`${ano}-${String(i + 1).padStart(2, "0")}`) ?? null);
    const ultimo = [...ns].reverse().find((n) => n.data.slice(0, 4) === ano);
    return {
      ano,
      carteira,
      CDI,
      totalCarteira: composto(carteira),
      totalCDI: composto(CDI),
      acumulado: ultimo ? (ultimo.carteira - 1) * 100 : null,
    };
  });
}

function indicadores(ns: Nivel[], pregoes: Set<string> | undefined): Indicadores {
  // Estatísticas diárias só em dias de pregão: um sábado repetindo o valor de
  // sexta viraria um "retorno zero" e achataria a volatilidade.
  const dias = pregoes ? ns.filter((n, i) => pregoes.has(n.data) || i === ns.length - 1) : ns;
  const rc: number[] = [];
  const rcdi: number[] = [];
  // Pares carteira × IBOV só onde os dois dias têm IBOV de verdade: com lacuna
  // no índice, o retorno dele cobriria vários dias contra um da carteira.
  const rcPar: number[] = [];
  const ribov: number[] = [];
  for (let i = 1; i < dias.length; i++) {
    const a = dias[i - 1];
    const b = dias[i];
    const r = b.carteira / a.carteira - 1;
    rc.push(r);
    rcdi.push(a.CDI && b.CDI ? b.CDI / a.CDI - 1 : 0);
    if (a.ibovNoDia && b.ibovNoDia && a.IBOV && b.IBOV) {
      rcPar.push(r);
      ribov.push(b.IBOV / a.IBOV - 1);
    }
  }
  const n = rc.length;
  const suficiente = n >= MIN_RETORNOS;
  const suficienteIbov = ribov.length >= MIN_RETORNOS;
  const temRiscoPar = desvio(rcPar) > 1e-9;
  // Carteira parada (só caixa) não tem risco: índices de risco/retorno sobre
  // volatilidade zero explodem e não significam nada.
  const temRisco = desvio(rc) > 1e-9;

  const excesso = rc.map((r, i) => r - rcdi[i]);
  const vol = desvio(rc);
  const sdExc = desvio(excesso);
  const baixa = Math.sqrt(media(excesso.map((e) => Math.min(e, 0) ** 2)));
  const varIbov = covariancia(ribov, ribov);
  const volPar = desvio(rcPar);
  const ativo = rcPar.map((r, i) => r - ribov[i]);
  const te = desvio(ativo);

  // Drawdown máximo sobre a curva inteira (inclui fins de semana: não muda o pico).
  let pico = -Infinity;
  let dataPico: string | null = null;
  let dd = 0;
  let ddPico: string | null = null;
  let ddFundo: string | null = null;
  for (const p of ns) {
    if (p.carteira > pico) {
      pico = p.carteira;
      dataPico = p.data;
    }
    const q = p.carteira / pico - 1;
    if (q < dd) {
      dd = q;
      ddPico = dataPico;
      ddFundo = p.data;
    }
  }

  // Retorno anualizado só com mais de um ano de história: anualizar três meses
  // promete um número que ninguém viveu.
  const inicio = ns[0].data;
  const fim = ns[ns.length - 1].data;
  const corridos = (Date.parse(fim) - Date.parse(inicio)) / 86_400_000;
  const total = ns[ns.length - 1].carteira;
  const anualizado = corridos >= 365 && total > 0 ? (Math.pow(total, 365 / corridos) - 1) * 100 : null;

  const mc = [...mensais(ns, "carteira")];
  const mcdi = mensais(ns, "CDI");
  const ordenados = [...mc].sort((a, b) => a[1] - b[1]);

  return {
    dias: n,
    retornoAnualizado: anualizado,
    volAnual: suficiente ? vol * Math.sqrt(PREGOES_ANO) * 100 : null,
    sharpe: suficiente && temRisco && sdExc > 0 ? (media(excesso) / sdExc) * Math.sqrt(PREGOES_ANO) : null,
    sortino: suficiente && temRisco && baixa > 0 ? (media(excesso) / baixa) * Math.sqrt(PREGOES_ANO) : null,
    drawdownMax: dd * 100,
    drawdownPico: ddPico,
    drawdownFundo: ddFundo,
    beta: suficienteIbov && temRiscoPar && varIbov > 0 ? covariancia(rcPar, ribov) / varIbov : null,
    correlacao:
      suficienteIbov && temRiscoPar && varIbov > 0 ? covariancia(rcPar, ribov) / (volPar * Math.sqrt(varIbov)) : null,
    trackingError: suficienteIbov && te > 0 ? te * Math.sqrt(PREGOES_ANO) * 100 : null,
    informationRatio: suficienteIbov && temRiscoPar && te > 0 ? (media(ativo) / te) * Math.sqrt(PREGOES_ANO) : null,
    var95: suficiente ? Math.max(0, -quantil(rc, 0.05)) * 100 : null,
    meses: mc.length,
    mesesPositivos: mc.filter(([, v]) => v > 0).length,
    mesesNegativos: mc.filter(([, v]) => v < 0).length,
    mesesAcimaCDI: mc.filter(([k, v]) => mcdi.has(k) && v > (mcdi.get(k) as number)).length,
    melhorMes: ordenados.length ? { mes: ordenados[ordenados.length - 1][0], pct: ordenados[ordenados.length - 1][1] } : null,
    piorMes: ordenados.length ? { mes: ordenados[0][0], pct: ordenados[0][1] } : null,
  };
}

const INDICADORES_VAZIOS: Indicadores = {
  dias: 0,
  retornoAnualizado: null,
  volAnual: null,
  sharpe: null,
  sortino: null,
  drawdownMax: 0,
  drawdownPico: null,
  drawdownFundo: null,
  beta: null,
  correlacao: null,
  trackingError: null,
  informationRatio: null,
  var95: null,
  meses: 0,
  mesesPositivos: 0,
  mesesNegativos: 0,
  mesesAcimaCDI: 0,
  melhorMes: null,
  piorMes: null,
};

/**
 * Monta a lâmina a partir da evolução DESDE O INÍCIO (intervalo começando em
 * `config.dataInicio`). `pregoes` são as datas com mercado aberto, para as
 * estatísticas diárias; sem ele, todos os pontos da série contam.
 */
export function computarLamina(ev: Evolucao, pregoes?: Set<string>): Lamina {
  if (!ev.temDados || ev.serieRentabilidade.length === 0) {
    return {
      temDados: false,
      inicio: ev.intervalo.de,
      dataBase: ev.intervalo.ate,
      rentabilidades: [],
      grade: [],
      indicadores: INDICADORES_VAZIOS,
      serie: [],
    };
  }
  const ns = niveis(ev);
  const inicio = ns[0].data;
  const dataBase = ns[ns.length - 1].data;

  const janelas: JanelaLamina[] = ["mes", "ano", "12m", "inicio"];
  const rentabilidades = janelas.map((j): RentabilidadeJanela => {
    const de = inicioJanela(j, dataBase, inicio);
    const exige = j === "12m";
    const carteira = retornoJanela(ns, de, "carteira", exige);
    const CDI = retornoJanela(ns, de, "CDI", exige);
    return { janela: j, carteira, CDI, IBOV: retornoJanela(ns, de, "IBOV", exige), pctCDI: pctDoCDI(carteira, CDI) };
  });

  const serie: PontoLamina[] = ns.map((n) => ({
    data: n.data,
    carteira: (n.carteira - 1) * 100,
    ...(n.CDI != null ? { CDI: (n.CDI - 1) * 100 } : {}),
    ...(n.IBOV != null ? { IBOV: (n.IBOV - 1) * 100 } : {}),
  }));

  return {
    temDados: true,
    inicio,
    dataBase,
    rentabilidades,
    grade: grade(ns),
    indicadores: indicadores(ns, pregoes),
    serie,
  };
}
