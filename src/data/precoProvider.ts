// Cotações para o navegador (momento da operação). Sem chaves de API:
//  - Dólar (USD/BRL): AwesomeAPI — pública, CORS-ok, cotação real momentânea.
//  - Ações da B3: brapi.dev — pública, CORS-ok.
//  - Ações US (NYSE/NASDAQ): o Yahoo é bloqueado por CORS no navegador, então o
//    preço vem do SNAPSHOT oficial (data/prices/latest.json) gerado pela Action.
//
// A avaliação contínua da carteira sempre usa o snapshot (ver scripts/fetch-prices.ts).

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
