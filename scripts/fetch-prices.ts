/**
 * Busca preços/câmbio OFICIAIS (server-side, sem CORS) e faz UPSERT na tabela
 * `prices_latest` do Supabase. Rodado pela GitHub Action (dias úteis).
 *
 * Lê a lista de ativos a precificar direto do banco (tabela `assets`) e escreve
 * o snapshot usando a SERVICE ROLE KEY (ignora RLS) — por isso "preços sempre
 * oficiais": nenhum usuário comum consegue escrever em prices_latest.
 *
 * Env necessárias (secrets da Action):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Fontes (todas SEM chave de API):
 *  - Ações (B3, NYSE, NASDAQ): Yahoo Finance (B3 usa sufixo ".SA")
 *  - Câmbio USD/BRL:           AwesomeAPI (cotação real momentânea)
 *  - Tesouro Direto:           API oficial do Tesouro Direto (PU de resgate)
 */
import { createClient } from "@supabase/supabase-js";

interface AtivoLite {
  ticker: string;
  tipo: string;
  bolsa: string;
  moeda: string;
  /** símbolo resolvido pela Edge Function (ex.: "PETR4.SA"); evita adivinhar. */
  yahoo_symbol?: string | null;
  bond?: { isTesouro?: boolean; tesouroNome?: string } | null;
}

interface Snapshot {
  atualizado_em: string;
  fonte: string;
  cambio: Record<string, number>;
  acoes: Record<string, number>;
  tesouro: Record<string, number>;
  /** fechamento do pregão anterior — base da variação do dia na interface. */
  fechamento_anterior: Record<string, number>;
}

async function main() {
  const url = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: ativos, error } = await db.from("assets").select("ticker,tipo,bolsa,moeda,bond,yahoo_symbol");
  if (error) throw new Error(`Falha ao ler assets: ${error.message}`);
  const lista = (ativos ?? []) as AtivoLite[];

  const snap: Snapshot = {
    atualizado_em: new Date().toISOString(),
    fonte: "yahoo finance + awesomeapi + tesouro direto",
    cambio: { BRL: 1 },
    acoes: {},
    tesouro: {},
    fechamento_anterior: {},
  };

  // --- Câmbio USD/BRL ---
  try {
    snap.cambio.USD = await cotacaoDolar();
    console.log(`USD/BRL = ${snap.cambio.USD}`);
  } catch (e) {
    console.warn("Falha no câmbio USD/BRL:", msg(e));
  }
  try {
    const usd = await precoYahoo("USDBRL=X");
    if (usd.fechamentoAnterior != null) snap.fechamento_anterior.USD = usd.fechamentoAnterior;
    if (snap.cambio.USD == null) snap.cambio.USD = usd.preco;
  } catch (e) {
    console.warn("Falha no fechamento anterior do dólar:", msg(e));
  }

  // --- Ações (Yahoo Finance, sem chave; B3 usa sufixo .SA) ---
  const acoes = lista.filter((a) => ehAcao(a.tipo));
  for (const a of acoes) {
    const ehBR = a.bolsa === "B3" || a.moeda === "BRL";
    const symbol = a.yahoo_symbol || (ehBR ? `${a.ticker}.SA` : a.ticker);
    try {
      const { preco, fechamentoAnterior } = await precoYahoo(symbol);
      snap.acoes[a.ticker] = preco;
      if (fechamentoAnterior != null) snap.fechamento_anterior[a.ticker] = fechamentoAnterior;
      console.log(`${a.ticker} (${symbol}) = ${preco}`);
    } catch (e) {
      console.warn(`Falha ${a.ticker} (${symbol}):`, msg(e));
    }
  }

  // --- Tesouro Direto (PU oficial de resgate) ---
  const querTesouro = lista.some((a) => a.bond?.isTesouro);
  if (querTesouro) {
    try {
      const pus = await tesouroDireto();
      const nomes = new Set(
        lista.filter((a) => a.bond?.isTesouro && a.bond.tesouroNome).map((a) => a.bond!.tesouroNome!),
      );
      for (const [nome, pu] of Object.entries(pus)) {
        if (nomes.size === 0 || nomes.has(nome)) snap.tesouro[nome] = pu;
      }
      console.log(`Tesouro: ${Object.keys(snap.tesouro).length} títulos`);
    } catch (e) {
      console.warn("Falha Tesouro Direto:", msg(e));
    }
  }

  const { error: upErr } = await db.from("prices_latest").upsert({ id: 1, ...snap }, { onConflict: "id" });
  if (upErr) throw new Error(`Falha ao gravar prices_latest: ${upErr.message}`);
  console.log("Snapshot gravado em prices_latest (id=1).");
}

function requireEnv(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

function ehAcao(tipo: string): boolean {
  return tipo === "acao" || tipo === "etf" || tipo === "fii";
}

async function cotacaoDolar(): Promise<number> {
  const r = await fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL");
  const j = (await r.json()) as { USDBRL?: { bid?: string } };
  const v = Number(j.USDBRL?.bid);
  if (!isFinite(v) || v <= 0) throw new Error("cotação inválida");
  return v;
}

/**
 * Yahoo Finance (endpoint chart, sem chave). B3 usa sufixo ".SA" (ex.: PETR4.SA).
 * Devolve também o fechamento anterior, que alimenta a variação do dia na UI.
 */
async function precoYahoo(symbol: string): Promise<{ preco: number; fechamentoAnterior: number | null }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (CarteiraFinance)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as {
    chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; chartPreviousClose?: number } }> };
  };
  const meta = j.chart?.result?.[0]?.meta;
  const p = meta?.regularMarketPrice;
  if (typeof p !== "number" || p <= 0) throw new Error("sem cotação");
  const anterior = meta?.chartPreviousClose;
  return { preco: p, fechamentoAnterior: typeof anterior === "number" && anterior > 0 ? anterior : null };
}

/** API oficial do Tesouro Direto: nome -> PU de resgate (marcação a mercado). */
async function tesouroDireto(): Promise<Record<string, number>> {
  const r = await fetch("https://www.tesourodireto.com.br/json/br/com/b3/tesourodireto/service/api/treasurybondsinfo.json");
  const j = (await r.json()) as {
    response?: { TrsrBdTradgList?: Array<{ TrsrBd?: { nm?: string; untrRedVal?: number } }> };
  };
  const out: Record<string, number> = {};
  for (const item of j.response?.TrsrBdTradgList ?? []) {
    const nome = item.TrsrBd?.nm;
    const pu = item.TrsrBd?.untrRedVal;
    if (nome && typeof pu === "number" && pu > 0) out[nome] = pu;
  }
  if (Object.keys(out).length === 0) throw new Error("sem PUs do Tesouro");
  return out;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
