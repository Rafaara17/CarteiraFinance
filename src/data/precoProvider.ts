// Cotações para o navegador (momento da operação). Sem chaves de API:
//  - Dólar (USD/BRL): AwesomeAPI — pública, CORS-ok, cotação real momentânea.
//  - Ações da B3: brapi.dev — pública, CORS-ok.
//  - Ações US (NYSE/NASDAQ): o Yahoo é bloqueado por CORS no navegador, então o
//    preço vem do SNAPSHOT oficial (data/prices/latest.json) gerado pela Action.
//
// A avaliação contínua da carteira sempre usa o snapshot (ver scripts/fetch-prices.ts).

import type { Bolsa, ClasseAtivo, Moeda, PrecosSnapshot } from "../engine/types";
import { classificarPorTicker, inferirTipoB3 } from "../engine/classificacao";

/** Cotação real e momentânea do Dólar (USD/BRL). */
export async function cotacaoDolar(): Promise<number> {
  const r = await fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL", { cache: "no-store" });
  if (!r.ok) throw new Error(`Falha ao obter câmbio USD/BRL (HTTP ${r.status})`);
  const j = (await r.json()) as { USDBRL?: { bid?: string } };
  const bid = Number(j.USDBRL?.bid);
  if (!isFinite(bid) || bid <= 0) throw new Error("Cotação do Dólar inválida");
  return bid;
}

/** Cotação ao vivo de ação/ETF/FII da B3 via brapi.dev. */
export async function precoAcaoBR(ticker: string): Promise<number> {
  const r = await fetch(`https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?range=1d&interval=1d`, {
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Falha ao cotar ${ticker} na B3 (HTTP ${r.status})`);
  const j = (await r.json()) as { results?: Array<{ regularMarketPrice?: number }> };
  const p = j.results?.[0]?.regularMarketPrice;
  if (typeof p !== "number" || p <= 0) throw new Error(`Sem cotação para ${ticker}`);
  return p;
}

/** Resultado da classificação automática de um ativo de renda variável. */
export interface AtivoClassificado {
  tipo: ClasseAtivo;
  moeda: Moeda;
  bolsa: Bolsa;
  /** Preço de mercado atual, só como referência para o usuário (na moeda do ativo). */
  precoRef: number | null;
  /** Nome longo do ativo, quando a fonte fornece. */
  nome?: string;
}

/**
 * Descobre automaticamente moeda/bolsa/tipo (e um preço de referência) a partir
 * SÓ do ticker — o usuário não escolhe mais bolsa nem classe.
 *
 * Estratégia: se a brapi conhece o ticker, é B3 (BRL) e usamos o nome do ativo
 * para desambiguar ação/ETF/FII; caso contrário, assume-se ativo estrangeiro em
 * USD (preço de referência vindo do snapshot da Action, se houver). Nunca lança:
 * em qualquer falha, cai no fallback heurístico `classificarPorTicker`.
 */
export async function classificarAtivo(ticker: string, precos: PrecosSnapshot): Promise<AtivoClassificado> {
  const tk = ticker.trim().toUpperCase();
  const fallback = classificarPorTicker(tk);

  try {
    const r = await fetch(`https://brapi.dev/api/quote/${encodeURIComponent(tk)}?range=1d&interval=1d`, {
      cache: "no-store",
    });
    if (r.ok) {
      const j = (await r.json()) as {
        results?: Array<{ regularMarketPrice?: number; longName?: string; shortName?: string }>;
      };
      const res = j.results?.[0];
      const preco = typeof res?.regularMarketPrice === "number" && res.regularMarketPrice > 0 ? res.regularMarketPrice : null;
      if (res) {
        const nome = res.longName || res.shortName || undefined;
        return { tipo: inferirTipoB3(tk, nome), moeda: "BRL", bolsa: "B3", precoRef: preco, nome };
      }
    }
  } catch {
    // rede indisponível — segue no fallback abaixo
  }

  // Não achou na B3: assume estrangeiro (USD). Preço de referência vem do snapshot, se existir.
  const s = precos.acoes[tk];
  const precoRef = typeof s === "number" && s > 0 ? s : null;
  return { ...fallback, precoRef };
}
