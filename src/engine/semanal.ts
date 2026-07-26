// Disputa SEMANAL entre as carteiras (motor puro, testável). É o ranking que
// vale para a liga: a cada semana há um vencedor, e o placar fecha no domingo.
//
// Como funciona: para cada carteira, `computarEvolucao` reconstrói a série diária
// de patrimônio a partir de prices_history + replay do ledger; a série é agrupada
// por semana e o retorno de cada semana sai do fechamento anterior. O acumulado
// vem de `computarRanking` (engine/comparacao.ts), que mede desde o capital
// inicial — a base da evolução é o primeiro ponto do histórico, não o capital, e
// por isso NÃO serve para a coluna de acumulado.
//
// Datas em UTC do começo ao fim, como em engine/evolucao.ts: misturar getDay()
// local com as chaves UTC da série deslocaria a semana inteira.

import { computarRanking, type CarteiraInfo } from "./comparacao";
import { comPontoDeHoje, computarEvolucao, retornosPorChave, ymd, type PontoSerie } from "./evolucao";
import type { Ativo, Config, HistoricoPrecos, PrecosSnapshot, Transacao } from "./types";

/** Uma carteira na disputa, com a data em que passou a existir. */
export interface EntradaCarteira {
  info: CarteiraInfo;
  /** ISO. Delimita a partir de quando a carteira pode ganhar uma semana. */
  criadaEm: string;
  transacoes: Transacao[];
}

export interface RetornoSemanal {
  /** domingo em que a semana fecha ("AAAA-MM-DD"). */
  semana: string;
  retornoPct: number;
  patrimonioFim: number;
}

export interface LinhaSemanal {
  carteiraId: string;
  nome: string;
  ehLiga: boolean;
  ehMinha: boolean;
  retornoSemanaPct: number;
  retornoAcumuladoPct: number;
  patrimonioBRL: number;
}

export interface Campeao {
  semana: string; // domingo de fechamento
  carteiraId: string;
  nome: string;
  retornoPct: number;
}

export interface Titulo {
  carteiraId: string;
  nome: string;
  titulos: number;
}

export interface RankingSemanal {
  /** domingo em que a semana corrente fecha. */
  semanaAtual: string;
  /** segunda-feira que abriu a semana corrente. */
  inicioSemanaAtual: string;
  /** ordenado pelo retorno da semana (decrescente) — é o que vale. */
  linhas: LinhaSemanal[];
  /** semanas já fechadas, da mais recente para a mais antiga. */
  campeoes: Campeao[];
  /** contagem de títulos, do maior para o menor. */
  titulos: Titulo[];
  /** false quando a série histórica ainda não cobre nenhuma semana. */
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

/** Retorno semana a semana do patrimônio, cada uma fechando no domingo. */
export function retornosSemanais(serie: PontoSerie[]): RetornoSemanal[] {
  return retornosPorChave(serie, domingoDaSemana).map((r) => ({
    semana: r.chave,
    retornoPct: r.retornoPct,
    patrimonioFim: r.patrimonioFim,
  }));
}

/**
 * Monta o ranking da semana corrente (parcial, ao vivo) e o mural de campeões
 * das semanas já fechadas.
 */
export function computarRankingSemanal(
  config: Config,
  ativos: Ativo[],
  precos: PrecosSnapshot,
  historico: HistoricoPrecos,
  entradas: EntradaCarteira[],
  minhaCarteiraId: string | null,
  hoje: Date = new Date(),
): RankingSemanal {
  const semanaAtual = domingoDaSemana(ymd(hoje));
  const vazio: RankingSemanal = {
    semanaAtual,
    inicioSemanaAtual: segundaDaSemana(semanaAtual),
    linhas: [],
    campeoes: [],
    titulos: [],
    temHistorico: false,
  };
  if (entradas.length === 0) return vazio;

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
  const semanais = new Map<string, RetornoSemanal[]>();
  let temHistorico = false;

  for (const e of entradas) {
    const ev = computarEvolucao(config, e.transacoes, ativos, historico, intervalo);
    if (!ev.temDados) continue;
    temHistorico = true;
    // O ponto de hoje (ao vivo) é o que deixa a semana corrente acompanhável
    // antes do fechamento de domingo.
    const comHoje = comPontoDeHoje(ev, patrimonioAtual.get(e.info.id) ?? 0, hoje);
    semanais.set(e.info.id, retornosSemanais(comHoje.serie));
  }

  const campeoes = temHistorico ? campeoesDe(entradas, semanais, semanaAtual) : [];

  return {
    semanaAtual,
    inicioSemanaAtual: segundaDaSemana(semanaAtual),
    linhas: linhasDe(acumulado, semanais, semanaAtual),
    campeoes,
    titulos: titulosDe(campeoes),
    temHistorico,
  };
}

function linhasDe(
  acumulado: ReturnType<typeof computarRanking>,
  semanais: Map<string, RetornoSemanal[]>,
  semanaAtual: string,
): LinhaSemanal[] {
  return acumulado
    .map((a) => {
      const daSemana = semanais.get(a.carteiraId)?.find((s) => s.semana === semanaAtual);
      return {
        carteiraId: a.carteiraId,
        nome: a.nome,
        ehLiga: a.ehLiga,
        ehMinha: a.ehMinha,
        retornoSemanaPct: daSemana?.retornoPct ?? 0,
        retornoAcumuladoPct: a.retornoTotalPct,
        patrimonioBRL: a.patrimonioBRL,
      };
    })
    .sort((x, y) => y.retornoSemanaPct - x.retornoSemanaPct);
}

/**
 * Vencedor de cada semana já fechada.
 *
 * Só concorre quem já existia na abertura da semana: uma carteira criada como
 * cópia da liga herda o ledger antigo, então a série dela retroage e sem esse
 * filtro ela apareceria ganhando semanas em que nem existia.
 */
function campeoesDe(
  entradas: EntradaCarteira[],
  semanais: Map<string, RetornoSemanal[]>,
  semanaAtual: string,
): Campeao[] {
  const nomes = new Map(entradas.map((e) => [e.info.id, e.info.nome]));
  const criadaEm = new Map(entradas.map((e) => [e.info.id, e.criadaEm]));

  const semanas = new Set<string>();
  for (const lista of semanais.values()) {
    for (const s of lista) if (s.semana < semanaAtual) semanas.add(s.semana);
  }

  const out: Campeao[] = [];
  for (const semana of [...semanas].sort().reverse()) {
    const abertura = `${segundaDaSemana(semana)}T00:00:00.000Z`;
    let melhor: Campeao | null = null;

    for (const [carteiraId, lista] of semanais) {
      if ((criadaEm.get(carteiraId) ?? "") > abertura) continue;
      const s = lista.find((x) => x.semana === semana);
      if (!s) continue;
      if (!melhor || s.retornoPct > melhor.retornoPct) {
        melhor = {
          semana,
          carteiraId,
          nome: nomes.get(carteiraId) ?? "—",
          retornoPct: s.retornoPct,
        };
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
