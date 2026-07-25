// deno-lint-ignore-file no-explicit-any
/**
 * Edge Function `cotacoes` — o GATEWAY DE PREÇOS do CarteiraFinance.
 *
 * Por que ela existe: o Yahoo Finance entrega tudo de que precisamos (cotação,
 * fechamento anterior, histórico diário, índices e câmbio) de graça e sem token,
 * mas NÃO manda header CORS — o navegador bloqueia a chamada direta. Rodando
 * aqui, server-side, o problema desaparece e ainda ganhamos duas coisas:
 *
 *  1. A carteira deixa de depender do cron de hora em hora. Antes, sem
 *     `prices_latest` preenchido, as posições ficavam sem preço e sumiam do
 *     patrimônio — sobrava só o caixa. Agora o app cota na hora, ao abrir.
 *  2. A integridade continua de pé: o preço vem do Yahoo e é gravado com a
 *     SERVICE ROLE. Nenhum usuário consegue influenciar o valor gravado.
 *
 * ARQUIVO AUTOCONTIDO de propósito: dá para colar inteiro no painel do Supabase
 * (Edge Functions -> Deploy a new function) sem precisar do CLI. Por isso as
 * heurísticas de classificação abaixo duplicam `src/engine/classificacao.ts` —
 * se mexer em uma, mexa na outra.
 *
 * Modos (via querystring ou corpo JSON):
 *   { tickers: ["PETR4","AAPL"] }  -> cotação + fechamento anterior + câmbio, e
 *                                     faz merge em `prices_latest`.
 *   { buscar: "PETR" }             -> resolve ticker: símbolo, bolsa, moeda, tipo.
 *   { historico: true }            -> (só admin) semeia `prices_history` com ~2
 *                                     anos de Yahoo + BCB, para os gráficos de
 *                                     evolução funcionarem sem depender do GitHub.
 *
 * Env injetadas pelo Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const YAHOO = "https://query1.finance.yahoo.com";
const UA = "Mozilla/5.0 (CarteiraFinance)";
const RANGE_HISTORICO = "2y";
const DIAS_CAMBIO = 400;
const PARALELISMO = 6;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// ---------------------------------------------------------------------------
// Classificação de ativos (espelha src/engine/classificacao.ts)
// ---------------------------------------------------------------------------

const RE_TICKER_B3 = /^[A-Z]{4}\d{1,2}[A-Z]?$/;
const RE_BDR = /(3[2359]|34)$/;
const RE_NOME_FII = /(FII|FDO\.?\s*INV\.?\s*IMOB|FUNDO.*IMOB|IMOB)/i;
const RE_NOME_ETF = /(ETF|ISHARES|IT\s*NOW|INDEX|[IÍ]NDICE|TRUST)/i;
const RE_NOME_UNIT = /(UNT|UNIT)/i;

function ehTickerB3(ticker: string): boolean {
  return RE_TICKER_B3.test(ticker.trim().toUpperCase());
}

/**
 * Ação / ETF / FII a partir do ticker da B3. O Yahoo devolve `quoteType:
 * "EQUITY"` até para ETF e FII, então o nome longo é a única pista real — daí
 * a heurística (ISHARES -> ETF, FUNDO ... IMOB -> FII, UNT -> ação).
 *
 * Fundos sempre se anunciam no nome; um "11" cujo nome não tem marca de fundo é
 * Unit, logo ação (ex.: SANB11 = "Banco Santander (Brasil) S.A.").
 */
function inferirTipoB3(ticker: string, nome?: string): string {
  const tk = ticker.trim().toUpperCase();
  if (RE_BDR.test(tk)) return "acao";
  if (/11B?$/.test(tk)) {
    if (nome) {
      if (RE_NOME_UNIT.test(nome)) return "acao";
      if (RE_NOME_ETF.test(nome)) return "etf";
      if (RE_NOME_FII.test(nome)) return "fii";
      return "acao";
    }
    return "fii";
  }
  return "acao";
}

/** Ticker -> símbolo do Yahoo. B3 leva sufixo ".SA"; o resto vai como está. */
function simboloYahoo(ticker: string, bolsa?: string | null, moeda?: string | null): string {
  const tk = ticker.trim().toUpperCase();
  if (tk.startsWith("^") || tk.includes("=") || tk.includes(".")) return tk;
  const ehBR = bolsa === "B3" || moeda === "BRL" || (bolsa == null && moeda == null && ehTickerB3(tk));
  return ehBR ? `${tk}.SA` : tk;
}

/** Nome da bolsa do Yahoo -> nossa nomenclatura. */
function bolsaDe(exchange: string | undefined, simbolo: string): string {
  if (simbolo.endsWith(".SA") || exchange === "SAO") return "B3";
  if (exchange === "NMS" || exchange === "NasdaqGS" || /nasdaq/i.test(exchange ?? "")) return "NASDAQ";
  if (exchange === "NYQ" || /nyse/i.test(exchange ?? "")) return "NYSE";
  return "OUTRA";
}

// ---------------------------------------------------------------------------
// Yahoo Finance
// ---------------------------------------------------------------------------

interface Cotacao {
  preco: number;
  fechamentoAnterior: number | null;
  moeda: string;
  bolsa: string;
  nome: string;
  simbolo: string;
}

async function yahooJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

/** Cotação atual + fechamento anterior (para a variação do dia). */
async function cotar(simbolo: string): Promise<Cotacao> {
  const j = await yahooJson(
    `${YAHOO}/v8/finance/chart/${encodeURIComponent(simbolo)}?range=1d&interval=1d`,
  );
  const meta = j?.chart?.result?.[0]?.meta;
  const preco = Number(meta?.regularMarketPrice);
  if (!isFinite(preco) || preco <= 0) throw new Error("sem cotação");
  const anterior = Number(meta?.chartPreviousClose ?? meta?.previousClose);
  return {
    preco,
    fechamentoAnterior: isFinite(anterior) && anterior > 0 ? anterior : null,
    moeda: String(meta?.currency ?? "BRL").toUpperCase(),
    bolsa: bolsaDe(meta?.exchangeName, simbolo),
    nome: String(meta?.longName ?? meta?.shortName ?? simbolo),
    simbolo,
  };
}

/** Série histórica diária de fechamentos: data (AAAA-MM-DD) -> close. */
async function historicoDiario(simbolo: string): Promise<Map<string, number>> {
  const j = await yahooJson(
    `${YAHOO}/v8/finance/chart/${encodeURIComponent(simbolo)}?range=${RANGE_HISTORICO}&interval=1d`,
  );
  const res = j?.chart?.result?.[0];
  const ts: number[] = res?.timestamp ?? [];
  const closes: (number | null)[] = res?.indicators?.quote?.[0]?.close ?? [];
  const out = new Map<string, number>();
  for (let i = 0; i < ts.length; i++) {
    const c = Number(closes[i]);
    if (!isFinite(c) || c <= 0) continue;
    out.set(ymd(ts[i] * 1000), c);
  }
  if (out.size === 0) throw new Error("sem histórico");
  return out;
}

/** Roda `fn` sobre `itens` com paralelismo limitado (não afoga o Yahoo). */
async function emLotes<T, R>(itens: T[], fn: (x: T) => Promise<R>): Promise<Array<R | null>> {
  const out: Array<R | null> = new Array(itens.length).fill(null);
  let i = 0;
  const trabalhador = async () => {
    while (i < itens.length) {
      const idx = i++;
      try {
        out[idx] = await fn(itens[idx]);
      } catch {
        out[idx] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALELISMO, itens.length) }, trabalhador));
  return out;
}

// ---------------------------------------------------------------------------
// Modo 1: cotações
// ---------------------------------------------------------------------------

async function modoCotacoes(admin: SupabaseClient, tickers: string[]) {
  const limpos = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];

  // O símbolo do Yahoo fica cacheado em assets.yahoo_symbol: uma vez resolvido,
  // nunca mais precisamos adivinhar (evita errar bolsa/moeda de ticker exótico).
  const { data: linhas } = await admin
    .from("assets")
    .select("ticker,bolsa,moeda,yahoo_symbol")
    .in("ticker", limpos.length > 0 ? limpos : ["__nenhum__"]);
  const registro = new Map<string, any>((linhas ?? []).map((a: any) => [a.ticker, a]));

  const alvos = limpos.map((tk) => {
    const a = registro.get(tk);
    return { ticker: tk, simbolo: a?.yahoo_symbol || simboloYahoo(tk, a?.bolsa, a?.moeda) };
  });

  const [resultados, usd] = await Promise.all([
    emLotes(alvos, async (a) => ({ ticker: a.ticker, cot: await cotar(a.simbolo) })),
    cotar("USDBRL=X").catch(() => null),
  ]);

  const acoes: Record<string, number> = {};
  const fechamentoAnterior: Record<string, number> = {};
  const meta: Record<string, unknown> = {};
  const falhas: string[] = [];

  for (let i = 0; i < resultados.length; i++) {
    const r = resultados[i];
    if (!r) {
      falhas.push(alvos[i].ticker);
      continue;
    }
    acoes[r.ticker] = r.cot.preco;
    if (r.cot.fechamentoAnterior != null) fechamentoAnterior[r.ticker] = r.cot.fechamentoAnterior;
    meta[r.ticker] = {
      nome: r.cot.nome,
      moeda: r.cot.moeda,
      bolsa: r.cot.bolsa,
      simbolo: r.cot.simbolo,
      tipo: r.cot.bolsa === "B3" ? inferirTipoB3(r.ticker, r.cot.nome) : "acao",
    };
  }

  const cambio: Record<string, number> = { BRL: 1 };
  if (usd) {
    cambio.USD = usd.preco;
    if (usd.fechamentoAnterior != null) fechamentoAnterior.USD = usd.fechamentoAnterior;
  }

  // Merge atômico via RPC (`jsonb ||`): duas chamadas simultâneas não se
  // atropelam, e o snapshot do cron (tesouro) fica intacto.
  if (Object.keys(acoes).length > 0 || usd) {
    await admin.rpc("merge_prices_latest", {
      p_acoes: acoes,
      p_cambio: cambio,
      p_fechamento: fechamentoAnterior,
      p_fonte: "yahoo finance (ao vivo)",
    });
  }

  // Guarda o símbolo resolvido para as próximas consultas.
  for (let i = 0; i < resultados.length; i++) {
    const r = resultados[i];
    const a = registro.get(alvos[i].ticker);
    if (r && a && a.yahoo_symbol !== r.cot.simbolo) {
      await admin.from("assets").update({ yahoo_symbol: r.cot.simbolo }).eq("ticker", r.ticker);
    }
  }

  return {
    atualizadoEm: new Date().toISOString(),
    fonte: "yahoo finance (ao vivo)",
    cambio,
    acoes,
    fechamentoAnterior,
    meta,
    falhas,
  };
}

// ---------------------------------------------------------------------------
// Modo 2: busca de ticker (alimenta o formulário de compra)
// ---------------------------------------------------------------------------

async function modoBuscar(termo: string) {
  const tk = termo.trim().toUpperCase();

  // Primeiro tenta o palpite direto — é o caminho de quem já sabe o ticker e
  // devolve o preço junto, sem uma segunda ida à rede.
  try {
    const cot = await cotar(simboloYahoo(tk));
    return {
      achou: true,
      ticker: tk,
      simbolo: cot.simbolo,
      nome: cot.nome,
      moeda: cot.moeda,
      bolsa: cot.bolsa,
      tipo: cot.bolsa === "B3" ? inferirTipoB3(tk, cot.nome) : "acao",
      preco: cot.preco,
      fechamentoAnterior: cot.fechamentoAnterior,
    };
  } catch {
    // segue para a busca por nome
  }

  const j = await yahooJson(
    `${YAHOO}/v1/finance/search?q=${encodeURIComponent(termo)}&quotesCount=6&newsCount=0`,
  );
  const candidatos = (j?.quotes ?? [])
    .filter((q: any) => q?.symbol)
    .map((q: any) => {
      const simbolo = String(q.symbol).toUpperCase();
      const ticker = simbolo.replace(/\.SA$/, "");
      const nome = String(q.longname ?? q.shortname ?? ticker);
      const bolsa = bolsaDe(q.exchange, simbolo);
      return {
        ticker,
        simbolo,
        nome,
        bolsa,
        moeda: bolsa === "B3" ? "BRL" : "USD",
        tipo: bolsa === "B3" ? inferirTipoB3(ticker, nome) : "acao",
      };
    });

  return { achou: false, candidatos };
}

// ---------------------------------------------------------------------------
// Modo 3: semear a série histórica (só admin)
// ---------------------------------------------------------------------------

async function modoHistorico(admin: SupabaseClient) {
  const { data: ativos } = await admin.from("assets").select("ticker,tipo,bolsa,moeda,yahoo_symbol");
  const equities = ((ativos ?? []) as any[]).filter((a) =>
    ["acao", "etf", "fii"].includes(a.tipo)
  );

  const porData = new Map<string, { data: string; acoes: any; cambio: any; indices: any }>();
  const linha = (d: string) => {
    let l = porData.get(d);
    if (!l) {
      l = { data: d, acoes: {}, cambio: {}, indices: {} };
      porData.set(d, l);
    }
    return l;
  };

  // Ações da carteira
  const series = await emLotes(equities, async (a: any) => ({
    ticker: a.ticker,
    serie: await historicoDiario(a.yahoo_symbol || simboloYahoo(a.ticker, a.bolsa, a.moeda)),
  }));
  for (const s of series) {
    if (!s) continue;
    for (const [d, close] of s.serie) linha(d).acoes[s.ticker] = close;
  }

  // Câmbio USD/BRL diário
  try {
    const j = await (
      await fetch(`https://economia.awesomeapi.com.br/json/daily/USD-BRL/${DIAS_CAMBIO}`)
    ).json();
    for (const p of j as any[]) {
      const bid = Number(p.bid);
      const ts = Number(p.timestamp);
      if (!isFinite(bid) || bid <= 0 || !isFinite(ts)) continue;
      linha(ymd(ts * 1000)).cambio.USD = bid;
    }
  } catch { /* segue sem câmbio histórico */ }

  // Índices de mercado (Yahoo) — a âncora do CDI/IPCA é o dia mais antigo que
  // temos, para o nível acumulado ser reproduzível entre execuções.
  const datas = [...porData.keys()].sort();
  const ancora = datas[0] ?? ymd(Date.now() - 730 * 86400_000);

  for (const [chave, simbolo] of [["IBOV", "^BVSP"], ["SP500", "^GSPC"]]) {
    try {
      for (const [d, v] of await historicoDiario(simbolo)) linha(d).indices[chave] = v;
    } catch { /* índice indisponível */ }
  }

  // CDI (SGS 12, % ao dia) e IPCA (SGS 433, % ao mês) acumulados em base 100.
  for (const [chave, serie] of [["CDI", 12], ["IPCA", 433]] as Array<[string, number]>) {
    try {
      let idx = 100;
      for (const p of await serieSGS(serie, ancora)) {
        idx *= 1 + p.valor / 100;
        linha(p.data).indices[chave] = idx;
      }
    } catch { /* BCB indisponível */ }
  }

  const linhas = [...porData.values()].sort((a, b) => a.data.localeCompare(b.data));
  if (linhas.length === 0) return { dias: 0 };

  // Upsert nunca apaga: a série cresce para sempre.
  const { error } = await admin.from("prices_history").upsert(linhas, { onConflict: "data" });
  if (error) throw new Error(`prices_history: ${error.message}`);

  return { dias: linhas.length, de: linhas[0].data, ate: linhas[linhas.length - 1].data };
}

/** Série do Banco Central (SGS) a partir de `desde` (AAAA-MM-DD). */
async function serieSGS(serie: number, desde: string): Promise<Array<{ data: string; valor: number }>> {
  const [ano, mes, dia] = desde.split("-");
  const url =
    `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados?formato=json&dataInicial=${dia}/${mes}/${ano}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const out: Array<{ data: string; valor: number }> = [];
  for (const p of (await r.json()) as any[]) {
    const valor = Number(p.valor);
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(p.data ?? "");
    if (!m || !isFinite(valor)) continue;
    out.push({ data: `${m[3]}-${m[2]}-${m[1]}`, valor });
  }
  return out;
}

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Só membro logado usa o gateway.
    const authHeader = req.headers.get("Authorization") ?? "";
    const comoUsuario = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: sessao } = await comoUsuario.auth.getUser();
    if (!sessao?.user) return json({ erro: "não autenticado" }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Aceita tanto querystring (curl/teste) quanto corpo JSON (functions.invoke).
    const params = new URL(req.url).searchParams;
    let corpo: any = {};
    if (req.method === "POST") corpo = await req.json().catch(() => ({}));

    const tickersRaw = corpo.tickers ?? params.get("tickers");
    const buscar = corpo.buscar ?? params.get("buscar");
    const historico = corpo.historico ?? params.get("historico");

    if (historico) {
      const { data: membro } = await admin
        .from("membros")
        .select("papel")
        .eq("user_id", sessao.user.id)
        .maybeSingle();
      if (membro?.papel !== "admin") return json({ erro: "só admin pode semear o histórico" }, 403);
      return json(await modoHistorico(admin));
    }

    if (buscar) return json(await modoBuscar(String(buscar)));

    if (tickersRaw) {
      const lista = Array.isArray(tickersRaw) ? tickersRaw : String(tickersRaw).split(",");
      return json(await modoCotacoes(admin, lista));
    }

    return json({ erro: "informe `tickers`, `buscar` ou `historico`" }, 400);
  } catch (e) {
    return json({ erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
