import { useMemo } from "react";
import type { Membro, Wallet } from "../data/supabaseClient";
import { computarRankingSemanal, type EntradaCarteira, type RankingSemanal } from "../engine/semanal";
import type { Ativo, Config, PrecosSnapshot, Transacao } from "../engine/types";
import { useHistorico } from "./useHistorico";

interface Args {
  config: Config;
  ativos: Ativo[];
  precos: PrecosSnapshot;
  wallets: Wallet[];
  membros: Membro[];
  transacoesPorCarteira: Map<string, Transacao[]>;
  minhaCarteiraId: string | null;
}

export interface EstadoRankingSemanal {
  ranking: RankingSemanal | null;
  carregando: boolean;
  erro: string | null;
}

const SEM_TX: Transacao[] = [];

/**
 * Ranking semanal de todas as carteiras. Monta as entradas a partir dos dados já
 * carregados e memoiza o cálculo — que percorre a série histórica inteira de
 * cada carteira, então só a aba Comparar deve montar este hook.
 */
export function useRankingSemanal(args: Args): EstadoRankingSemanal {
  const { config, ativos, precos, wallets, membros, transacoesPorCarteira, minhaCarteiraId } = args;
  const { historico, carregando, erro } = useHistorico();
  const hoje = useMemo(() => new Date(), []);

  const ranking = useMemo(() => {
    if (!historico) return null;
    const entradas: EntradaCarteira[] = wallets.map((w) => ({
      info: { id: w.id, tipo: w.tipo, dono: w.dono, nome: nomeDe(w, membros) },
      criadaEm: w.criadaEm,
      transacoes: transacoesPorCarteira.get(w.id) ?? SEM_TX,
    }));
    return computarRankingSemanal(config, ativos, precos, historico, entradas, minhaCarteiraId, hoje);
  }, [historico, config, ativos, precos, wallets, membros, transacoesPorCarteira, minhaCarteiraId, hoje]);

  return { ranking, carregando, erro };
}

/** O cadastro do membro manda sobre o nome gravado na criação da carteira. */
function nomeDe(w: Wallet, membros: Membro[]): string {
  if (w.tipo === "liga") return w.nome;
  return membros.find((m) => m.userId === w.dono)?.nome ?? w.nome;
}
