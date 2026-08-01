import { useMemo } from "react";
import type { Membro, Wallet } from "../data/supabaseClient";
import {
  computarRankingPeriodo,
  computarSeriesCarteiras,
  type EntradaCarteira,
  type PeriodoRanking,
  type RankingPeriodo,
} from "../engine/disputa";
import type { PontoSerie } from "../engine/evolucao";
import type { Ativo, Config, PortfolioSnapshot, PrecosSnapshot, Transacao } from "../engine/types";
import { useHistorico } from "./useHistorico";

interface Args {
  config: Config;
  ativos: Ativo[];
  precos: PrecosSnapshot;
  wallets: Wallet[];
  membros: Membro[];
  transacoesPorCarteira: Map<string, Transacao[]>;
  minhaCarteiraId: string | null;
  periodo: PeriodoRanking;
}

export interface EstadoRanking {
  ranking: RankingPeriodo | null;
  /** carteiraId -> série diária de patrimônio, para o gráfico de comparação. */
  series: Map<string, PontoSerie[]>;
  /** carteiraId -> snapshot completo (posições, caixa, alocação). */
  snapshots: Map<string, PortfolioSnapshot>;
  /** carteiraId -> nome exibido. Disponível mesmo antes do histórico chegar. */
  nomes: Map<string, string>;
  carregando: boolean;
  erro: string | null;
}

const SEM_TX: Transacao[] = [];
const SEM_SERIES = new Map<string, PontoSerie[]>();

/**
 * Ranking de todas as carteiras no período escolhido.
 *
 * São dois memos de propósito: o primeiro percorre a série histórica de cada
 * carteira replayando o ledger dia a dia (caro) e NÃO depende do período; o
 * segundo só reagrupa o resultado. Assim trocar Dia/Semana/Mês na tela é
 * instantâneo. Mesmo assim, só a aba Comparar deve montar este hook.
 */
export function useRankingCarteiras(args: Args): EstadoRanking {
  const { config, ativos, precos, wallets, membros, transacoesPorCarteira } = args;
  const { minhaCarteiraId, periodo } = args;
  const { historico, carregando, erro } = useHistorico();
  const hoje = useMemo(() => new Date(), []);

  const nomes = useMemo(
    () => new Map(wallets.map((w) => [w.id, nomeDe(w, membros)])),
    [wallets, membros],
  );

  const base = useMemo(() => {
    if (!historico) return null;
    const entradas: EntradaCarteira[] = wallets.map((w) => ({
      info: { id: w.id, tipo: w.tipo, dono: w.dono, nome: nomes.get(w.id) ?? w.nome },
      criadaEm: w.criadaEm,
      transacoes: transacoesPorCarteira.get(w.id) ?? SEM_TX,
    }));
    return computarSeriesCarteiras(config, ativos, precos, historico, entradas, minhaCarteiraId, hoje);
  }, [historico, config, ativos, precos, wallets, nomes, transacoesPorCarteira, minhaCarteiraId, hoje]);

  const ranking = useMemo(
    () => (base ? computarRankingPeriodo(base, periodo, hoje) : null),
    [base, periodo, hoje],
  );

  const snapshots = useMemo(
    () => new Map((base?.acumulado ?? []).map((a) => [a.carteiraId, a.snapshot])),
    [base],
  );

  return {
    ranking,
    series: base?.series ?? SEM_SERIES,
    snapshots,
    nomes,
    carregando,
    erro,
  };
}

/** O cadastro do membro manda sobre o nome gravado na criação da carteira. */
function nomeDe(w: Wallet, membros: Membro[]): string {
  if (w.tipo === "liga") return w.nome;
  return membros.find((m) => m.userId === w.dono)?.nome ?? w.nome;
}
