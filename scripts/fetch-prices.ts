/**
 * Busca preços/câmbio OFICIAIS (server-side, sem CORS) e grava
 * data/prices/latest.json. Rodado pela GitHub Action (dias úteis).
 *
 * Fontes:
 *  - B3 (ação/ETF/FII): brapi.dev   (token opcional em BRAPI_TOKEN)
 *  - US (NYSE/NASDAQ):   Finnhub     (chave em FINNHUB_KEY)
 *  - Câmbio USD/BRL:     AwesomeAPI  (cotação real momentânea)
 *  - Tesouro Direto:     API oficial do Tesouro Direto (PU de resgate)
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

const BRAPI_TOKEN = process.env.BRAPI_TOKEN ?? "";
const FINNHUB_KEY = process.env.FINNHUB_KEY ?? "";

async function main() {
  const ativos: AtivoLite[] = JSON.parse(readFileSync(ASSETS, "utf8"));
  const snap: Snapshot = {
    atualizadoEm: new Date().toISOString(),
    fonte: "brapi + finnhub + awesomeapi + tesouro direto",
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

  // --- Ações ---
  const b3 = ativos.filter((a) => (a.bolsa === "B3" || a.moeda === "BRL") && ehAcao(a.tipo));
  const us = ativos.filter((a) => a.moeda === "USD" && ehAcao(a.tipo));

  for (const a of b3) {
    try {
      snap.acoes[a.ticker] = await precoBrapi(a.ticker);
      console.log(`B3 ${a.ticker} = ${snap.acoes[a.ticker]}`);
    } catch (e) {
      console.warn(`Falha B3 ${a.ticker}:`, msg(e));
    }
  }
  for (const a of us) {
    try {
      snap.acoes[a.ticker] = await precoFinnhub(a.ticker);
      console.log(`US ${a.ticker} = ${snap.acoes[a.ticker]}`);
    } catch (e) {
      console.warn(`Falha US ${a.ticker}:`, msg(e));
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

async function precoBrapi(ticker: string): Promise<number> {
  const url = `https://brapi.dev/api/quote/${encodeURIComponent(ticker)}${BRAPI_TOKEN ? `?token=${BRAPI_TOKEN}` : ""}`;
  const r = await fetch(url);
  const j = (await r.json()) as { results?: Array<{ regularMarketPrice?: number }> };
  const p = j.results?.[0]?.regularMarketPrice;
  if (typeof p !== "number" || p <= 0) throw new Error("sem cotação");
  return p;
}

async function precoFinnhub(ticker: string): Promise<number> {
  if (!FINNHUB_KEY) throw new Error("FINNHUB_KEY não configurada");
  const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`);
  const j = (await r.json()) as { c?: number };
  if (typeof j.c !== "number" || j.c <= 0) throw new Error("sem cotação");
  return j.c;
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
