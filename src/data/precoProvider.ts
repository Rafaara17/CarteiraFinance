// Cotações OFICIAIS ao vivo para o momento da operação (o usuário nunca digita
// o preço). CORS-friendly: brapi (B3) e AwesomeAPI (câmbio) são públicos;
// ações US usam Finnhub com chave opcional do usuário.
//
// Para a AVALIAÇÃO contínua da carteira, a fonte principal é o snapshot
// data/prices/latest.json gerado pela GitHub Action (ver scripts/fetch-prices.ts).

export interface CotacaoResultado {
  preco: number;
  moeda: string;
}

/** Cotação real e momentânea do Dólar (USD/BRL). */
export async function cotacaoDolar(): Promise<number> {
  const r = await fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL", { cache: "no-store" });
  if (!r.ok) throw new Error(`Falha ao obter câmbio USD/BRL (HTTP ${r.status})`);
  const j = (await r.json()) as { USDBRL?: { bid?: string } };
  const bid = Number(j.USDBRL?.bid);
  if (!isFinite(bid) || bid <= 0) throw new Error("Cotação do Dólar inválida");
  return bid;
}

/** Cotação de ação/ETF/FII da B3 via brapi.dev. */
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

/** Cotação de ação US (NYSE/NASDAQ) via Finnhub (requer chave). */
export async function precoAcaoUS(ticker: string, finnhubKey: string): Promise<number> {
  if (!finnhubKey) throw new Error("Configure a chave do Finnhub para cotar ativos em USD ao vivo.");
  const r = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(finnhubKey)}`,
    { cache: "no-store" },
  );
  if (!r.ok) throw new Error(`Falha ao cotar ${ticker} (HTTP ${r.status})`);
  const j = (await r.json()) as { c?: number };
  if (typeof j.c !== "number" || j.c <= 0) throw new Error(`Sem cotação para ${ticker}`);
  return j.c;
}

/**
 * Resolve a cotação oficial conforme a bolsa/moeda do ativo.
 * Retorna preço na moeda do ativo — a conversão para BRL usa `cotacaoDolar`.
 */
export async function cotarAtivo(
  ticker: string,
  bolsa: string,
  moeda: string,
  finnhubKey?: string,
): Promise<CotacaoResultado> {
  if (bolsa === "B3" || moeda === "BRL") {
    return { preco: await precoAcaoBR(ticker), moeda: "BRL" };
  }
  return { preco: await precoAcaoUS(ticker, finnhubKey ?? ""), moeda };
}
