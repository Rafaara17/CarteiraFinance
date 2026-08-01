// Disputa entre as carteiras da liga (motor puro, testável). É o ranking que
// vale: a cada período fechado há uma vencedora.
//
// O período é escolhido na tela — DIA, SEMANA ou MÊS —, e o que muda entre eles
// é só o agrupamento da série diária de patrimônio. Por isso o cálculo está
// partido em dois:
//
//   computarSeriesCarteiras  CARO   — reconstrói a série de cada carteira a
//                                     partir de prices_history + replay do
//                                     ledger. Não depende do período.
//   computarRankingPeriodo   BARATO — reagrupa as séries já prontas.
//
// Trocar o período na tela passa só pelo segundo.
//
// O acumulado vem de `computarRanking` (engine/comparacao.ts), que mede desde o
// capital inicial fixo — a base da evolução é o primeiro ponto do histórico, não
// o capital, e por isso NÃO serve para a coluna de acumulado.
//
// Datas em UTC do começo ao fim, como em engine/evolucao.ts: misturar getDay()
// local com as chaves UTC da série deslocaria o período inteiro.

import { computarRanking, type CarteiraInfo, type ItemRanking } from "./comparacao";
import {
  comPontoDeHoje,
  computarEvolucao,
  retornosPorChave,
  ymd,
  type PontoSerie,
  type RetornoPeriodo,
} from "./evolucao";
import type { Ativo, Config, HistoricoPrecos, PrecosSnapshot, Transacao } from "./types";

/** Janela pela qual as carteiras são comparadas no ranking. */
export type PeriodoRanking = "dia" | "semana" | "mes";

export const PERIODOS: PeriodoRanking[] = ["dia", "semana", "mes"];

/** Rótulo curto — cabe no cabeçalho da coluna medida. */
export const ROTULO_PERIODO: Record<PeriodoRanking, string> = {
  dia: "Dia",
  semana: "Semana",
  mes: "Mês",
};

/** "Disputa {da semana}", "ordenado pelo retorno {da semana}". */
export const ROTULO_PERIODO_DE: Record<PeriodoRanking, string> = {
  dia: "do dia",
  semana: "da semana",
  mes: "do mês",
};

/** "Campeões por {semana}", "uma vencedora a cada {semana}". */
export const ROTULO_PERIODO_POR: Record<PeriodoRanking, string> = {
  dia: "dia",
  semana: "semana",
  mes: "mês",
};

/** "{semanas} vencidas por carteira" — "mês" não pluraliza com um "s". */
export const ROTULO_PERIODO_PLURAL: Record<PeriodoRanking, string> = {
  dia: "dias",
  semana: "semanas",
  mes: "meses",
};

/** Uma carteira na disputa, com a data em que passou a existir. */
export interface EntradaCarteira {
  info: CarteiraInfo;
  /** ISO. Delimita a partir de quando a carteira pode ganhar um período. */
  criadaEm: string;
  transacoes: Transacao[];
}

export interface LinhaRanking {
  carteiraId: string;
  nome: string;
  ehLiga: boolean;
  ehMinha: boolean;
  retornoPeriodoPct: number;
  retornoAcumuladoPct: number;
  patrimonioBRL: number;
}

export interface Campeao {
  /** chave do período ("AAAA-MM-DD" para dia/semana, "AAAA-MM" para mês). */
  chave: string;
  carteiraId: string;
  nome: string;
  retornoPct: number;
}

export interface Titulo {
  carteiraId: string;
  nome: string;
  titulos: number;
}

/**
 * O resultado caro: a série diária de patrimônio de cada carteira e o ranking
 * acumulado. Independe do período — memoize isto nos dados, não na escolha do
 * usuário.
 */
export interface SeriesCarteiras {
  /** ranking acumulado desde o capital inicial; carrega o snapshot de cada carteira. */
  acumulado: ItemRanking[];
  /** carteiraId -> série diária de patrimônio, já com o ponto ao vivo de hoje. */
  series: Map<string, PontoSerie[]>;
  entradas: EntradaCarteira[];
  /** false quando a série histórica ainda não cobre nenhum dia. */
  temHistorico: boolean;
}

export interface RankingPeriodo {
  periodo: PeriodoRanking;
  /** chave do período corrente. */
  periodoAtual: string;
  /** primeiro dia do período corrente ("AAAA-MM-DD"). */
  inicioPeriodoAtual: string;
  /** último dia do período corrente ("AAAA-MM-DD"). */
  fimPeriodoAtual: string;
  /**
   * true enquanto o período corrente não fechou — o placar ainda pode virar.
   * Um período que termina HOJE ainda está aberto: ele fecha no fim do dia.
   */
  parcial: boolean;
  /** ordenado pelo retorno do período (decrescente) — é o que vale. */
  linhas: LinhaRanking[];
  /** períodos já fechados, do mais recente para o mais antigo. */
  campeoes: Campeao[];
  /** contagem de títulos, do maior para o menor. */
  titulos: Titulo[];
  temHistorico: boolean;
}

const DIA_MS = 86_400_000;

/**
 * Domingo em que a semana daquela data fecha. `prices_history` só tem dias de
 * pregão (nunca domingo), então a sexta e o domingo caem no mesmo balde — é o
 * que faz o agrupamento semanal funcionar sem inventar pontos.
 */
export function domingoDaSemana(dataYMD: string): string {
  const d = new Date(`${dataYMD}T12:00:00.000Z`);
  const diasAteDomingo = (7 - d.getUTCDay()) % 7; // getUTCDay: 0 = domingo
  return ymd(new Date(d.getTime() + diasAteDomingo * DIA_MS));
}

/** Segunda-feira que abre a semana fechada naquele domingo. */
export function segundaDaSemana(domingoYMD: string): string {
  return ymd(new Date(new Date(`${domingoYMD}T12:00:00.000Z`).getTime() - 6 * DIA_MS));
}

/** Dia de pregão pelo calendário (seg–sex). Feriados não são conhecidos aqui. */
export function ehDiaDePregao(d: Date): boolean {
  const dia = d.getUTCDay();
  return dia >= 1 && dia <= 5;
}

/** Chave do balde a que uma data pertence — alimenta `retornosPorChave`. */
export function chaveDoPeriodo(periodo: PeriodoRanking): (dataYMD: string) => string {
  if (periodo === "dia") return (d) => d;
  if (periodo === "semana") return domingoDaSemana;
  return (d) => d.slice(0, 7);
}

/** Primeiro dia do período ("AAAA-MM-DD"). */
export function aberturaDe(periodo: PeriodoRanking, chave: string): string {
  if (periodo === "dia") return chave;
  if (periodo === "semana") return segundaDaSemana(chave);
  return `${chave}-01`;
}

/** Último dia do período ("AAAA-MM-DD"). */
export function fechamentoDe(periodo: PeriodoRanking, chave: string): string {
  if (periodo !== "mes") return chave; // dia é o próprio dia; semana já é o domingo
  const [ano, mes] = chave.split("-").map(Number);
  // Date.UTC(ano, mes, 0) com `mes` 1-based cai no último dia do próprio mês.
  return ymd(new Date(Date.UTC(ano, mes, 0)));
}

/** Retorno período a período do patrimônio, encadeando do fechamento anterior. */
export function retornosDoPeriodo(serie: PontoSerie[], periodo: PeriodoRanking): RetornoPeriodo[] {
  return retornosPorChave(serie, chaveDoPeriodo(periodo));
}

/**
 * Parte CARA: a série diária de patrimônio de cada carteira + o ranking
 * acumulado. Percorre a série histórica inteira replayando o ledger dia a dia,
 * então deve ser memoizada nos dados — nunca no período escolhido.
 */
export function computarSeriesCarteiras(
  config: Config,
  ativos: Ativo[],
  precos: PrecosSnapshot,
  historico: HistoricoPrecos,
  entradas: EntradaCarteira[],
  minhaCarteiraId: string | null,
  hoje: Date = new Date(),
): SeriesCarteiras {
  // Acumulado + patrimônio de hoje: o motor de comparação já mede desde o
  // capital inicial fixo, que é o que torna as carteiras comparáveis.
  const porCarteira = new Map(entradas.map((e) => [e.info.id, e.transacoes]));
  const acumulado = computarRanking(
    config,
    ativos,
    precos,
    entradas.map((e) => e.info),
    porCarteira,
    minhaCarteiraId,
    hoje,
  );
  const patrimonioAtual = new Map(acumulado.map((a) => [a.carteiraId, a.patrimonioBRL]));

  const intervalo = { de: config.dataInicio.slice(0, 10), ate: ymd(hoje) };
  const series = new Map<string, PontoSerie[]>();
  let temHistorico = false;

  for (const e of entradas) {
    const ev = computarEvolucao(config, e.transacoes, ativos, historico, intervalo);
    if (!ev.temDados) continue;
    temHistorico = true;
    // O ponto de hoje (ao vivo) é o que deixa o período corrente acompanhável
    // antes do fechamento.
    series.set(e.info.id, comPontoDeHoje(ev, patrimonioAtual.get(e.info.id) ?? 0, hoje).serie);
  }

  return { acumulado, series, entradas, temHistorico };
}

/**
 * Parte BARATA: monta o ranking do período corrente (parcial, ao vivo) e o mural
 * de campeões dos períodos já fechados, reagrupando as séries prontas.
 */
export function computarRankingPeriodo(
  base: SeriesCarteiras,
  periodo: PeriodoRanking,
  hoje: Date = new Date(),
): RankingPeriodo {
  const hojeYMD = ymd(hoje);
  const listas = new Map<string, RetornoPeriodo[]>();

  for (const [carteiraId, serie] of base.series) {
    listas.set(carteiraId, aparar(retornosDoPeriodo(serie, periodo), periodo, hoje));
  }

  const periodoAtual = chaveAtual(listas, periodo, hojeYMD);
  const fimPeriodoAtual = fechamentoDe(periodo, periodoAtual);
  const campeoes = base.temHistorico
    ? campeoesDe(base.entradas, listas, periodo, periodoAtual)
    : [];

  return {
    periodo,
    periodoAtual,
    inicioPeriodoAtual: aberturaDe(periodo, periodoAtual),
    fimPeriodoAtual,
    parcial: fimPeriodoAtual >= hojeYMD,
    linhas: linhasDe(base.acumulado, listas, periodoAtual),
    campeoes,
    titulos: titulosDe(campeoes),
    temHistorico: base.temHistorico,
  };
}

/**
 * Descarta o balde diário de um dia sem pregão.
 *
 * `comPontoDeHoje` acrescenta o patrimônio ao vivo de hoje à série. Num sábado
 * isso criaria um "dia" cujo retorno contra a sexta é ~0% para todo mundo, e o
 * ranking diário morreria no fim de semana — então o dia corrente passa a ser o
 * último pregão. Semana e mês não precisam disso: para eles o ponto de hoje é
 * justamente o que torna o período corrente acompanhável.
 */
function aparar(lista: RetornoPeriodo[], periodo: PeriodoRanking, hoje: Date): RetornoPeriodo[] {
  if (periodo !== "dia" || ehDiaDePregao(hoje) || lista.length < 2) return lista;
  return lista[lista.length - 1].chave === ymd(hoje) ? lista.slice(0, -1) : lista;
}

/**
 * Período corrente: o último balde das séries. Todas as carteiras compartilham
 * as mesmas datas (prices_history + o mesmo `hoje`), então o último balde é o
 * mesmo para todas — o max é só uma salvaguarda. Sem séries, cai no calendário.
 */
function chaveAtual(
  listas: Map<string, RetornoPeriodo[]>,
  periodo: PeriodoRanking,
  hojeYMD: string,
): string {
  let atual = "";
  for (const lista of listas.values()) {
    const ultima = lista[lista.length - 1]?.chave;
    if (ultima && ultima > atual) atual = ultima;
  }
  return atual || chaveDoPeriodo(periodo)(hojeYMD);
}

function linhasDe(
  acumulado: ItemRanking[],
  listas: Map<string, RetornoPeriodo[]>,
  periodoAtual: string,
): LinhaRanking[] {
  return acumulado
    .map((a) => {
      const doPeriodo = listas.get(a.carteiraId)?.find((r) => r.chave === periodoAtual);
      return {
        carteiraId: a.carteiraId,
        nome: a.nome,
        ehLiga: a.ehLiga,
        ehMinha: a.ehMinha,
        retornoPeriodoPct: doPeriodo?.retornoPct ?? 0,
        retornoAcumuladoPct: a.retornoTotalPct,
        patrimonioBRL: a.patrimonioBRL,
      };
    })
    .sort((x, y) => y.retornoPeriodoPct - x.retornoPeriodoPct);
}

/**
 * Vencedora de cada período já fechado.
 *
 * Só concorre quem já existia na abertura do período: uma carteira criada como
 * cópia da liga herda o ledger antigo, então a série dela retroage e sem esse
 * filtro ela apareceria ganhando períodos em que nem existia.
 */
function campeoesDe(
  entradas: EntradaCarteira[],
  listas: Map<string, RetornoPeriodo[]>,
  periodo: PeriodoRanking,
  periodoAtual: string,
): Campeao[] {
  const nomes = new Map(entradas.map((e) => [e.info.id, e.info.nome]));
  const criadaEm = new Map(entradas.map((e) => [e.info.id, e.criadaEm]));

  const chaves = new Set<string>();
  for (const lista of listas.values()) {
    for (const r of lista) if (r.chave < periodoAtual) chaves.add(r.chave);
  }

  const out: Campeao[] = [];
  for (const chave of [...chaves].sort().reverse()) {
    const abertura = `${aberturaDe(periodo, chave)}T00:00:00.000Z`;
    let melhor: Campeao | null = null;

    for (const [carteiraId, lista] of listas) {
      if ((criadaEm.get(carteiraId) ?? "") > abertura) continue;
      const r = lista.find((x) => x.chave === chave);
      if (!r) continue;
      if (!melhor || r.retornoPct > melhor.retornoPct) {
        melhor = { chave, carteiraId, nome: nomes.get(carteiraId) ?? "—", retornoPct: r.retornoPct };
      }
    }
    if (melhor) out.push(melhor);
  }
  return out;
}

function titulosDe(campeoes: Campeao[]): Titulo[] {
  const contagem = new Map<string, Titulo>();
  for (const c of campeoes) {
    const atual = contagem.get(c.carteiraId);
    if (atual) atual.titulos += 1;
    else contagem.set(c.carteiraId, { carteiraId: c.carteiraId, nome: c.nome, titulos: 1 });
  }
  return [...contagem.values()].sort(
    (a, b) => b.titulos - a.titulos || a.nome.localeCompare(b.nome),
  );
}
