/**
 * Credita PROVENTOS (dividendos/rendimentos) automaticamente no caixa.
 *
 * Roda server-side na GitHub Action (sem CORS) com a SERVICE ROLE KEY (ignora
 * RLS). Para cada posição de renda variável (ação/ETF/FII), busca os dividendos
 * no Yahoo Finance e, para cada evento em que o usuário tinha o ativo na data-com,
 * insere uma transação `provento` — que o motor (ledger.replay) credita no caixa.
 *
 * Regras (alinhadas com o usuário):
 *  - Fonte gratuita (Yahoo): traz o valor por cota e a DATA-EX. O Yahoo não expõe
 *    a data de pagamento oficial, então creditamos na data-ex (aproximação).
 *  - Elegibilidade pela data-com: só recebe quem tinha o ativo no fechamento do
 *    dia anterior à data-ex (quem comprou "ex" não recebe).
 *  - "Só daqui pra frente": processa apenas eventos com data-ex >= PROVENTOS_DESDE.
 *  - Idempotente: id determinístico por (user, ticker, data-ex) + upsert
 *    ignoreDuplicates — rodar de hora em hora nunca duplica.
 *
 * Env necessárias (secrets da Action):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PROVENTOS_DESDE (ISO "AAAA-MM-DD")
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { qtdNaData } from "../src/engine/ledger";
import type { Transacao } from "../src/engine/types";

interface AtivoLite {
  ticker: string;
  tipo: string;
  bolsa: string;
  moeda: string;
}

interface LinhaTx {
  id: string;
  ts: string;
  tipo: string;
  membro: string;
  ticker: string;
  qtd: string | number | null;
  preco: string | number | null;
  moeda: string;
  fx: string | number | null;
  valor: string | number | null;
  user_id: string;
}

interface EventoDividendo {
  exYMD: string; // data-ex "AAAA-MM-DD"
  valorPorCota: number;
}

async function main() {
  const url = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const desde = requireEnv("PROVENTOS_DESDE"); // "AAAA-MM-DD" — corte de ativação
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const hojeYMD = new Date().toISOString().slice(0, 10);
  const period1 = Math.floor(Date.parse(`${desde}T00:00:00Z`) / 1000);
  const period2 = Math.floor(Date.now() / 1000);

  // --- Ativos de renda variável ---
  const { data: ativos, error: eAt } = await db.from("assets").select("ticker,tipo,bolsa,moeda");
  if (eAt) throw new Error(`Falha ao ler assets: ${eAt.message}`);
  const equities = (ativos ?? []).filter((a: AtivoLite) => ehAcao(a.tipo)) as AtivoLite[];
  const porTicker = new Map(equities.map((a) => [a.ticker, a]));

  // --- Transações (todas; service role ignora RLS) ---
  const { data: txsRaw, error: eTx } = await db
    .from("transactions")
    .select("id,ts,tipo,membro,ticker,qtd,preco,moeda,fx,valor,user_id")
    .order("ts", { ascending: true });
  if (eTx) throw new Error(`Falha ao ler transactions: ${eTx.message}`);
  const linhas = (txsRaw ?? []) as LinhaTx[];

  // Agrupa por usuário → transações tipadas (para qtdNaData e atribuição).
  const porUsuario = new Map<string, LinhaTx[]>();
  for (const l of linhas) {
    const arr = porUsuario.get(l.user_id) ?? [];
    arr.push(l);
    porUsuario.set(l.user_id, arr);
  }

  // Câmbio USD/BRL do snapshot (para ativos em USD).
  const { data: prc } = await db.from("prices_latest").select("cambio").eq("id", 1).maybeSingle();
  const usd = num((prc?.cambio as Record<string, number> | null)?.USD) || 1;

  // --- Busca dividendos por ticker (uma vez) e monta as inserções ---
  const inserts: Record<string, unknown>[] = [];
  for (const [ticker, ativo] of porTicker) {
    const ehBR = ativo.bolsa === "B3" || ativo.moeda === "BRL";
    const symbol = ehBR ? `${ticker}.SA` : ticker;

    let eventos: EventoDividendo[];
    try {
      eventos = await dividendosYahoo(symbol, period1, period2);
    } catch (e) {
      console.warn(`Falha dividendos ${ticker} (${symbol}):`, msg(e));
      continue;
    }
    const noPeriodo = eventos.filter((ev) => ev.exYMD >= desde && ev.exYMD <= hojeYMD);
    if (noPeriodo.length === 0) continue;

    const fx = ativo.moeda === "BRL" ? 1 : usd;

    for (const [userId, txsUsuario] of porUsuario) {
      const tipadas = txsUsuario.map(mapTx);
      const proventosExistentes = chavesProventos(txsUsuario);

      for (const ev of noPeriodo) {
        // Limite = último instante do dia anterior à data-ex (fechamento da data-com).
        const limiteISO = new Date(Date.parse(`${ev.exYMD}T00:00:00.000Z`) - 1).toISOString();
        const qtd = qtdNaData(tipadas, ticker, limiteISO);
        if (qtd <= 0) continue;

        const chave = `${ticker}|${ev.exYMD}`;
        if (proventosExistentes.has(chave)) continue; // já creditado

        const valor = ev.valorPorCota * qtd;
        if (!(valor > 0)) continue;

        inserts.push({
          id: uuidDeterministico(`${userId}|${ticker}|${ev.exYMD}`),
          ts: `${ev.exYMD}T12:00:00.000Z`,
          tipo: "provento",
          membro: membroDoTicker(txsUsuario, ticker),
          ticker,
          moeda: ativo.moeda,
          fx,
          valor,
          user_id: userId,
        });
      }
    }
  }

  if (inserts.length === 0) {
    console.log("Nenhum provento novo a creditar.");
    return;
  }

  const { error: eIns } = await db
    .from("transactions")
    .upsert(inserts, { onConflict: "id", ignoreDuplicates: true });
  if (eIns) throw new Error(`Falha ao inserir proventos: ${eIns.message}`);
  console.log(`Proventos processados: ${inserts.length} lançamento(s) (duplicados são ignorados).`);
}

/** Dividendos do Yahoo (endpoint chart, sem chave). Retorna data-ex + valor por cota. */
async function dividendosYahoo(symbol: string, period1: number, period2: number): Promise<EventoDividendo[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d&events=div`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (CarteiraFinance)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as {
    chart?: { result?: Array<{ events?: { dividends?: Record<string, { amount?: number; date?: number }> } }> };
  };
  const divs = j.chart?.result?.[0]?.events?.dividends;
  if (!divs) return [];
  const out: EventoDividendo[] = [];
  for (const k of Object.keys(divs)) {
    const d = divs[k];
    const amount = Number(d?.amount);
    const ts = Number(d?.date);
    if (!isFinite(amount) || amount <= 0 || !isFinite(ts)) continue;
    out.push({ exYMD: new Date(ts * 1000).toISOString().slice(0, 10), valorPorCota: amount });
  }
  return out;
}

/** Membro da compra mais recente do ticker (atribuição do provento); "sistema" se não houver. */
function membroDoTicker(txs: LinhaTx[], ticker: string): string {
  let membro = "sistema";
  for (const t of txs) {
    if (t.ticker === ticker && t.tipo === "compra") membro = t.membro; // ordenado por ts asc
  }
  return membro;
}

/** Conjunto de chaves `ticker|dataEx` dos proventos já existentes (para dedupe em memória). */
function chavesProventos(txs: LinhaTx[]): Set<string> {
  const s = new Set<string>();
  for (const t of txs) {
    if (t.tipo === "provento") s.add(`${t.ticker}|${t.ts.slice(0, 10)}`);
  }
  return s;
}

function mapTx(l: LinhaTx): Transacao {
  const base = { id: l.id, ts: l.ts, membro: l.membro, ticker: l.ticker, moeda: l.moeda, fx: num(l.fx) };
  if (l.tipo === "compra" || l.tipo === "venda") {
    return { ...base, tipo: l.tipo, qtd: num(l.qtd), preco: num(l.preco) };
  }
  return { ...base, tipo: l.tipo as "provento" | "cupom", valor: num(l.valor) };
}

/** UUID determinístico (v5-like via SHA-1) para tornar o lançamento idempotente. */
function uuidDeterministico(chave: string): string {
  const h = createHash("sha1").update(chave).digest("hex").slice(0, 32).split("");
  h[12] = "5"; // versão
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16); // variante
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

function ehAcao(tipo: string): boolean {
  return tipo === "acao" || tipo === "etf" || tipo === "fii";
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && isFinite(n) ? n : 0;
}

function requireEnv(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
