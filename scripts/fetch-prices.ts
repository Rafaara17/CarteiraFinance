/**
 * Busca preços/câmbio OFICIAIS (server-side, sem CORS) e grava
 * data/prices/latest.json. Rodado pela GitHub Action (dias úteis).
 *
 * Fontes (todas SEM chave de API):
 *  - Ações (B3, NYSE, NASDAQ): Yahoo Finance (B3 usa sufixo ".SA")
 *  - Câmbio USD/BRL:           AwesomeAPI (cotação real momentânea)
 *  - Tesouro Direto:           API oficial do Tesouro Direto (PU de resgate)
 *
 * Cada fonte é isolada em try/catch: uma falha não derruba as demais.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface AtivoLite {
  ticker: string;
  tipo: string;
  bolsa: string;
  moeda: string;
  bond?: { isTesouro?: boolean; tesouroNome?: string };
}

interface Snapshot {
  atualizadoEm: string;
  fonte: string;
  cambio: Record<string, number>;
  acoes: Record<string, number>;
  tesouro: Record<string, number>;
}

const RAIZ = resolve(process.cwd());
const ASSETS = resolve(RAIZ, "data/assets.json");
const SAIDA = resolve(RAIZ, "data/prices/latest.json");

async function main() {
  const ativos: AtivoLite[] = JSON.parse(readFileSync(ASSETS, "utf8"));
  const snap: Snapshot = {
    atualizadoEm: new Date().toISOString(),
    fonte: "yahoo finance + awesomeapi + tesouro direto",
    cambio: { BRL: 1 },
    acoes: {},
    tesouro: {},
  };

  // --- Câmbio USD/BRL ---
  try {
    snap.cambio.USD = await cotacaoDolar();
    console.log(`USD/BRL = ${snap.cambio.USD}`);
  } catch (e) {
    console.warn("Falha no câmbio USD/BRL:", msg(e));
  }

  // --- Ações (Yahoo Finance, sem chave; B3 usa sufixo .SA) ---
  const acoes = ativos.filter((a) => ehAcao(a.tipo));
  for (const a of acoes) {
    const ehBR = a.bolsa === "B3" || a.moeda === "BRL";
    const symbol = ehBR ? `${a.ticker}.SA` : a.ticker;
    try {
      snap.acoes[a.ticker] = await precoYahoo(symbol);
      console.log(`${a.ticker} (${symbol}) = ${snap.acoes[a.ticker]}`);
    } catch (e) {
      console.warn(`Falha ${a.ticker} (${symbol}):`, msg(e));
    }
  }

  // --- Tesouro Direto (PU oficial de resgate) ---
  const querTesouro = ativos.some((a) => a.bond?.isTesouro);
  if (querTesouro) {
    try {
      const pus = await tesouroDireto();
      const nomes = new Set(ativos.filter((a) => a.bond?.isTesouro && a.bond.tesouroNome).map((a) => a.bond!.tesouroNome!));
      for (const [nome, pu] of Object.entries(pus)) {
        if (nomes.size === 0 || nomes.has(nome)) snap.tesouro[nome] = pu;
      }
      console.log(`Tesouro: ${Object.keys(snap.tesouro).length} títulos`);
    } catch (e) {
      console.warn("Falha Tesouro Direto:", msg(e));
    }
  }

  writeFileSync(SAIDA, JSON.stringify(snap, null, 2) + "\n");
  console.log(`Snapshot gravado em ${SAIDA}`);
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

/** Yahoo Finance (endpoint chart, sem chave). B3 usa sufixo ".SA" (ex.: PETR4.SA). */
async function precoYahoo(symbol: string): Promise<number> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (CarteiraFinance)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as {
    chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
  };
  const p = j.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof p !== "number" || p <= 0) throw new Error("sem cotação");
  return p;
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
