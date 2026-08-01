// Comparação entre carteiras (motor puro, testável): compara a carteira pessoal
// de um membro com a carteira central da liga e monta o RANKING de todas as
// carteiras pessoais + a liga. Reaproveita `computarPortfolio` — cada carteira é
// só um conjunto de transações replayado sobre o mesmo capital inicial fixo, o
// que torna os retornos diretamente comparáveis.
//
// Aqui o ranking é ACUMULADO (desde o início). O ranking que vale para a disputa
// da liga é o por período (dia/semana/mês), em engine/disputa.ts, que consome
// estes mesmos números para a coluna de acumulado.

import { computarPortfolio } from "./portfolio";
import type { Ativo, Config, PortfolioSnapshot, PrecosSnapshot, Transacao } from "./types";

/** Metadado mínimo de uma carteira (compatível com `Wallet` da camada de dados). */
export interface CarteiraInfo {
  id: string;
  tipo: "liga" | "pessoal";
  dono: string | null;
  nome: string;
}

/** Uma linha do ranking (uma carteira e seus indicadores-chave). */
export interface ItemRanking {
  carteiraId: string;
  nome: string;
  dono: string | null;
  ehLiga: boolean;
  ehMinha: boolean;
  patrimonioBRL: number;
  retornoTotalPct: number;
  /**
   * Snapshot completo (posições, caixa, alocação) da carteira. Já foi calculado
   * aqui para tirar o patrimônio, então carregá-lo junto é de graça — é o que
   * permite abrir a carteira de outro membro sem recomputar nada.
   */
  snapshot: PortfolioSnapshot;
}

/** Diferença de desempenho entre a minha carteira e a da liga. */
export interface DiffCarteiras {
  retornoMinhaPct: number;
  retornoLigaPct: number;
  /** minha − liga (em pontos percentuais). Positivo = ganhando da liga. */
  deltaPct: number;
  patrimonioMinhaBRL: number;
  patrimonioLigaBRL: number;
  deltaPatrimonioBRL: number;
}

/**
 * Ranking de todas as carteiras (a da liga + as pessoais), ordenado por retorno
 * total decrescente. `minhaCarteiraId` marca qual linha é a do próprio usuário.
 */
export function computarRanking(
  config: Config,
  ativos: Ativo[],
  precos: PrecosSnapshot,
  carteiras: CarteiraInfo[],
  transacoesPorCarteira: Map<string, Transacao[]>,
  minhaCarteiraId: string | null,
  hoje: Date = new Date(),
): ItemRanking[] {
  const itens: ItemRanking[] = carteiras.map((c) => {
    const txs = transacoesPorCarteira.get(c.id) ?? [];
    const snap = computarPortfolio(config, txs, ativos, precos, hoje);
    return {
      carteiraId: c.id,
      nome: c.nome,
      dono: c.dono,
      ehLiga: c.tipo === "liga",
      ehMinha: c.id === minhaCarteiraId,
      patrimonioBRL: snap.patrimonioBRL,
      retornoTotalPct: snap.retornoTotalPct,
      snapshot: snap,
    };
  });
  itens.sort((a, b) => b.retornoTotalPct - a.retornoTotalPct);
  return itens;
}

/** Diferença de desempenho entre dois snapshots (minha vs. liga). */
export function diffCarteiras(minha: PortfolioSnapshot, liga: PortfolioSnapshot): DiffCarteiras {
  return {
    retornoMinhaPct: minha.retornoTotalPct,
    retornoLigaPct: liga.retornoTotalPct,
    deltaPct: minha.retornoTotalPct - liga.retornoTotalPct,
    patrimonioMinhaBRL: minha.patrimonioBRL,
    patrimonioLigaBRL: liga.patrimonioBRL,
    deltaPatrimonioBRL: minha.patrimonioBRL - liga.patrimonioBRL,
  };
}
