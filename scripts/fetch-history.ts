/**
 * Busca a SÉRIE HISTÓRICA (≈1 ano, diária) de preços, câmbio e índices e faz
 * UPSERT na tabela `prices_history` do Supabase. Rodado pela GitHub Action.
 *
 * É o que alimenta a EVOLUÇÃO do patrimônio e a rentabilidade por período nos
 * relatórios: o frontend só LÊ esta tabela e reconstrói a curva da carteira
 * (replay do ledger × preços históricos). Escreve com a SERVICE ROLE KEY
 * (ignora RLS), então nenhum usuário comum grava histórico — "dados oficiais".
 *
 * Env necessárias (secrets da Action):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   BRAPI_TOKEN — OPCIONAL (ver abaixo)
 *
 * Fontes:
 *  - Ações e índices (IBOV/S&P): Yahoo Finance (endpoint chart, sem chave) como
 *    fonte PRIMÁRIA. Se `BRAPI_TOKEN` estiver definido, a brapi PRO é tentada
 *    antes para os papéis da B3 (dados de fechamento um pouco mais fiéis).
 *    O token é opcional de propósito: antes ele era obrigatório e, sem o secret,
 *    o script morria na primeira linha — nenhuma série era gravada e os gráficos
 *    de evolução ficavam vazios em todo o app.
 *  - Câmbio USD/BRL diário: AwesomeAPI (série diária).
 *  - CDI (BCB SGS 12, % a.d.) e IPCA (BCB SGS 433, % a.m.): acumulados em índice.
 *
 * Estratégia: roda 1x por dia (após o fechamento, via GitHub Action). A cada
 * execução reescreve os últimos ~1 ano por upsert (`data`) — idempotente e
 * auto-corretivo — e NUNCA apaga: os dias mais antigos, semeados na 1ª execução,
 * permanecem, então a série cresce para sempre e o filtro "Tudo"/desde o início
 * continua correto anos depois. Os índices ACUMULADOS (CDI/IPCA) usam âncora
 * fixa (a data mais antiga já gravada), então o nível absoluto é reproduzível
 * entre execuções e não há degrau na fronteira de 1 ano quando a série passa
 * disso.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const RANGE = "2y"; // janela buscada no yahoo/brapi (ações e índices de mercado)
const DIAS_JANELA = 400; // nº de pontos diários buscados no câmbio (margem de segurança)
const DIAS_ESCRITA = 731; // janela (dias) reescrita por execução: ~2 anos (casa com RANGE)

interface AtivoLite {
  ticker: string;
  tipo: string;
  bolsa: string;
  moeda: string;
}

/** data (AAAA-MM-DD) -> valor. */
type Serie = Map<string, number>;

interface LinhaHistorico {
  data: string;
  acoes: Record<string, number>;
  cambio: Record<string, number>;
  indices: Record<string, number>;
}

async function main() {
  const url = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  // Opcional: sem ele o script roda igual, só pelo Yahoo.
  const brapiToken = process.env.BRAPI_TOKEN?.trim() || null;
  if (!brapiToken) console.log("BRAPI_TOKEN ausente — usando só o Yahoo Finance.");
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: ativos, error } = await db.from("assets").select("ticker,tipo,bolsa,moeda");
  if (error) throw new Error(`Falha ao ler assets: ${error.message}`);
  const equities = ((ativos ?? []) as AtivoLite[]).filter((a) => ehAcao(a.tipo));

  // Janela que ESCREVEMOS: os últimos ~1 ano. Dias mais antigos já gravados não
  // são reescritos nem apagados (o upsert nunca deleta) => a série cresce sempre.
  const writeStart = ymd(Date.now() - DIAS_ESCRITA * 24 * 60 * 60 * 1000);
  // Âncora fixa dos índices acumulados (CDI/IPCA): a menor data já gravada (na 1ª
  // execução = a própria writeStart). Acumular sempre a partir dela mantém o
  // nível absoluto estável entre execuções, sem degrau ao passar de 1 ano.
  const anchorData = (await menorDataHistorico(db)) ?? writeStart;

  // Acumula tudo em mapas data -> {ticker/moeda/indice -> valor}. `linha` só
  // materializa datas dentro da janela de escrita (retorna null fora dela), para
  // não criar linhas parciais em dias antigos (que apagariam ações/câmbio deles).
  const porData = new Map<string, LinhaHistorico>();
  const linha = (d: string): LinhaHistorico | null => {
    if (d < writeStart) return null;
    let l = porData.get(d);
    if (!l) {
      l = { data: d, acoes: {}, cambio: {}, indices: {} };
      porData.set(d, l);
    }
    return l;
  };

  // --- Ações (brapi PRO; fallback Yahoo) ---
  for (const a of equities) {
    const ehBR = a.bolsa === "B3" || a.moeda === "BRL";
    try {
      const serie = await historicoAcao(a.ticker, ehBR, brapiToken);
      for (const [d, close] of serie) {
        const l = linha(d);
        if (l) l.acoes[a.ticker] = close;
      }
      console.log(`${a.ticker}: ${serie.size} pontos`);
    } catch (e) {
      console.warn(`Falha histórico ${a.ticker}:`, msg(e));
    }
  }

  // --- Câmbio USD/BRL diário (AwesomeAPI) ---
  try {
    const serie = await cambioDiarioUSD();
    for (const [d, v] of serie) {
      const l = linha(d);
      if (l) l.cambio.USD = v;
    }
    console.log(`USD/BRL: ${serie.size} pontos`);
  } catch (e) {
    console.warn("Falha câmbio diário USD/BRL:", msg(e));
  }

  // --- Índices de mercado + juros/inflação (nível acumulado por data) ---
  const indices: Array<{ chave: string; buscar: () => Promise<Serie> }> = [
    { chave: "IBOV", buscar: () => historicoIndice("^BVSP", brapiToken) }, // brapi PRO / Yahoo
    { chave: "SP500", buscar: () => historicoIndice("^GSPC", brapiToken) }, // brapi PRO / Yahoo
    { chave: "CDI", buscar: () => indiceAcumulado(12, anchorData) }, // BCB SGS 12 (% ao dia)
    { chave: "IPCA", buscar: () => indiceAcumulado(433, anchorData) }, // BCB SGS 433 (% ao mês)
  ];
  for (const { chave, buscar } of indices) {
    try {
      const serie = await buscar();
      for (const [d, v] of serie) {
        const l = linha(d);
        if (l) l.indices[chave] = v;
      }
      console.log(`${chave}: ${serie.size} pontos`);
    } catch (e) {
      console.warn(`Falha índice ${chave}:`, msg(e));
    }
  }

  const linhas = [...porData.values()].sort((x, y) => x.data.localeCompare(y.data));
  if (linhas.length === 0) {
    console.log("Nenhum ponto histórico obtido — nada a gravar.");
    return;
  }

  const { error: upErr } = await db.from("prices_history").upsert(linhas, { onConflict: "data" });
  if (upErr) throw new Error(`Falha ao gravar prices_history: ${upErr.message}`);
  console.log(`prices_history: ${linhas.length} dias gravados (${linhas[0].data} → ${linhas[linhas.length - 1].data}).`);
}

/**
 * Preço histórico de fechamento de uma ação.
 *
 * Yahoo é a fonte primária (grátis, sem token, cobre B3 e bolsas americanas).
 * Com `BRAPI_TOKEN` definido, a brapi PRO é tentada antes para papéis da B3.
 */
async function historicoAcao(ticker: string, ehBR: boolean, token: string | null): Promise<Serie> {
  const simboloYahoo = ehBR ? `${ticker}.SA` : ticker;
  if (token && ehBR) {
    try {
      return await historicoBrapi(ticker, token);
    } catch (e) {
      console.warn(`  brapi ${ticker} falhou (${msg(e)}); usando Yahoo`);
    }
  }
  return await historicoYahoo(simboloYahoo);
}

/** Índice de mercado (Yahoo primário; brapi PRO antes, se houver token). */
async function historicoIndice(symbol: string, token: string | null): Promise<Serie> {
  if (token) {
    try {
      return await historicoBrapi(symbol, token);
    } catch (e) {
      console.warn(`  brapi ${symbol} falhou (${msg(e)}); usando Yahoo`);
    }
  }
  return await historicoYahoo(symbol);
}

/** brapi.dev — histórico diário. B3 sem sufixo; índices como ^BVSP/^GSPC. */
async function historicoBrapi(symbol: string, token: string): Promise<Serie> {
  const u = `https://brapi.dev/api/quote/${encodeURIComponent(symbol)}?range=${RANGE}&interval=1d&token=${encodeURIComponent(token)}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as {
    results?: Array<{ historicalDataPrice?: Array<{ date?: number; close?: number }> }>;
  };
  const hist = j.results?.[0]?.historicalDataPrice ?? [];
  const out: Serie = new Map();
  for (const p of hist) {
    const close = Number(p.close);
    const ts = Number(p.date);
    if (!isFinite(close) || close <= 0 || !isFinite(ts)) continue;
    out.set(ymd(ts * 1000), close);
  }
  if (out.size === 0) throw new Error("sem histórico");
  return out;
}

/** Yahoo Finance (endpoint chart, sem chave). B3 usa sufixo ".SA". */
async function historicoYahoo(symbol: string): Promise<Serie> {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${RANGE}&interval=1d`;
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (CarteiraFinance)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as {
    chart?: {
      result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }>;
    };
  };
  const res = j.chart?.result?.[0];
  const ts = res?.timestamp ?? [];
  const closes = res?.indicators?.quote?.[0]?.close ?? [];
  const out: Serie = new Map();
  for (let i = 0; i < ts.length; i++) {
    const close = Number(closes[i]);
    if (!isFinite(close) || close <= 0) continue;
    out.set(ymd(ts[i] * 1000), close);
  }
  if (out.size === 0) throw new Error("sem histórico");
  return out;
}

/** Câmbio USD/BRL diário (AwesomeAPI). Retorna data -> bid. */
async function cambioDiarioUSD(): Promise<Serie> {
  const r = await fetch(`https://economia.awesomeapi.com.br/json/daily/USD-BRL/${DIAS_JANELA}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as Array<{ timestamp?: string; bid?: string }>;
  const out: Serie = new Map();
  for (const p of j) {
    const bid = Number(p.bid);
    const ts = Number(p.timestamp);
    if (!isFinite(bid) || bid <= 0 || !isFinite(ts)) continue;
    out.set(ymd(ts * 1000), bid);
  }
  if (out.size === 0) throw new Error("sem série de câmbio");
  return out;
}

/**
 * Índice acumulado (base 100) a partir de uma série de % do BCB (SGS), começando
 * em `desde` (AAAA-MM-DD). Funciona tanto para série diária (CDI, % ao dia)
 * quanto mensal (IPCA, % ao mês): a cada ponto multiplica por (1 + valor/100).
 * Para o IPCA o nível fica no 1º dia do mês e o frontend faz o forward-fill dos
 * dias intermediários. Como `desde` é FIXO (a menor data já gravada), o nível
 * absoluto é reproduzível entre execuções — não há degrau ao passar de 1 ano.
 */
async function indiceAcumulado(serieBCB: number, desde: string): Promise<Serie> {
  const pontos = await serieSGS(serieBCB, desde);
  const out: Serie = new Map();
  let idx = 100;
  for (const { data, valor } of pontos) {
    idx *= 1 + valor / 100;
    out.set(data, idx);
  }
  if (out.size === 0) throw new Error("sem série BCB");
  return out;
}

/**
 * API do Banco Central (SGS), a partir de `desde` (AAAA-MM-DD). Retorna pontos
 * {data AAAA-MM-DD, valor number}.
 */
async function serieSGS(serie: number, desde: string): Promise<Array<{ data: string; valor: number }>> {
  const [ano, mes, dia] = desde.split("-");
  const dataInicial = `${dia}/${mes}/${ano}`;
  const u = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados?formato=json&dataInicial=${dataInicial}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as Array<{ data?: string; valor?: string }>;
  const out: Array<{ data: string; valor: number }> = [];
  for (const p of j) {
    const valor = Number(p.valor);
    const d = brDataParaYMD(p.data);
    if (!d || !isFinite(valor)) continue;
    out.push({ data: d, valor });
  }
  return out;
}

// --- utilitários ------------------------------------------------------------

/** ms -> "AAAA-MM-DD" (UTC). */
function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** "DD/MM/AAAA" (formato do BCB) -> "AAAA-MM-DD". */
function brDataParaYMD(s: string | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function ehAcao(tipo: string): boolean {
  return tipo === "acao" || tipo === "etf" || tipo === "fii";
}

function requireEnv(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Menor `data` (AAAA-MM-DD) já gravada em prices_history, ou null se vazia. */
async function menorDataHistorico(db: SupabaseClient): Promise<string | null> {
  const { data, error } = await db
    .from("prices_history")
    .select("data")
    .order("data", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Falha ao ler prices_history: ${error.message}`);
  return (data?.[0] as { data?: string } | undefined)?.data ?? null;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
