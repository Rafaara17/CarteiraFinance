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
 *   BRAPI_TOKEN — OPCIONAL, só para o Tesouro Direto. Sem ele o script roda
 *   igual e apenas não atualiza o catálogo/PU do Tesouro.
 *
 * Fontes:
 *  - Ações (B3, NYSE, NASDAQ): Yahoo Finance (B3 usa sufixo ".SA"), sem chave
 *  - Câmbio USD/BRL:           AwesomeAPI (cotação real momentânea), sem chave
 *  - Tesouro Direto:           brapi /api/v2/treasury (espelho do Tesouro
 *                              Transparente), com token
 *
 * Por que o Tesouro não vem mais da API da B3: aquele endpoint
 * (tesourodireto.com.br/.../treasurybondsinfo.json) está atrás de Cloudflare com
 * proteção anti-bot e devolve 403 para IP de datacenter — ou seja, sempre falhava
 * justamente aqui, no runner da Action. Ver o cabeçalho de src/engine/tesouro.ts.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mapaPUs, mapearTitulos, puDeMarcacao, type TituloTesouro } from "../src/engine/tesouro";

interface AtivoLite {
  ticker: string;
  tipo: string;
  bolsa: string;
  moeda: string;
  /** símbolo resolvido pela Edge Function (ex.: "PETR4.SA"); evita adivinhar. */
  yahoo_symbol?: string | null;
}

interface Snapshot {
  atualizado_em: string;
  fonte: string;
  cambio: Record<string, number>;
  acoes: Record<string, number>;
  /**
   * PU oficial por título do Tesouro (chaveado por slug E por nome).
   *
   * OPCIONAL de propósito: o upsert do PostgREST só mexe nas colunas que recebe.
   * Deixar a chave de fora quando a busca falha PRESERVA o snapshot anterior —
   * antes, um `tesouro: {}` sobrescrevia e zerava os PUs do dia, jogando toda a
   * renda fixa de volta para o crescimento linear.
   */
  tesouro?: Record<string, number>;
  /** fechamento do pregão anterior — base da variação do dia na interface. */
  fechamento_anterior: Record<string, number>;
}

async function main() {
  const url = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: ativos, error } = await db.from("assets").select("ticker,tipo,bolsa,moeda,yahoo_symbol");
  if (error) throw new Error(`Falha ao ler assets: ${error.message}`);
  const lista = (ativos ?? []) as AtivoLite[];

  const snap: Snapshot = {
    atualizado_em: new Date().toISOString(),
    fonte: "yahoo finance + awesomeapi + tesouro direto",
    cambio: { BRL: 1 },
    acoes: {},
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

  // --- Tesouro Direto: catálogo oficial + PU de resgate ---
  //
  // Busca SEMPRE a lista inteira, mesmo que a carteira não tenha nenhum título.
  // Antes, só buscava se já existisse um título cadastrado — e como a lista de
  // títulos do formulário de compra vinha justamente daqui, ninguém conseguia
  // cadastrar o primeiro. O catálogo tem de existir antes da primeira compra.
  const brapiToken = process.env.BRAPI_TOKEN;
  if (!brapiToken) {
    console.warn("BRAPI_TOKEN ausente: catálogo e PU do Tesouro Direto não serão atualizados.");
  } else {
    try {
      const titulos = await tesouroDireto(brapiToken);
      snap.tesouro = mapaPUs(titulos);
      await gravarCatalogo(db, titulos);
      const comPU = titulos.filter((t) => puDeMarcacao(t) != null).length;
      console.log(`Tesouro: ${titulos.length} títulos no catálogo, ${comPU} com PU oficial.`);
    } catch (e) {
      // Não zera `snap.tesouro`: a chave fica ausente e o PU de ontem sobrevive.
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

const BRAPI_TESOURO = "https://brapi.dev/api/v2/treasury";

/**
 * Catálogo do Tesouro Direto pela brapi (espelho do Tesouro Transparente).
 *
 * O parsing fica em `mapearTitulos` (src/engine/tesouro.ts), que é puro,
 * testado e tolerante ao nome exato dos campos.
 */
async function tesouroDireto(token: string): Promise<TituloTesouro[]> {
  const r = await fetch(BRAPI_TESOURO, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "CarteiraFinance" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const bruto: unknown = await r.json();
  const titulos = mapearTitulos(bruto);
  if (titulos.length === 0) {
    // Contrato diferente do esperado (ou token sem acesso ao endpoint). Mostra a
    // resposta crua no log da Action: é o único jeito de descobrir o formato novo
    // sem ficar adivinhando nomes de campo.
    throw new Error(`nenhum título reconhecido. Resposta crua: ${amostra(bruto)}`);
  }
  return titulos;
}

/** Espelha o catálogo em `tesouro_titulos`. Upsert por slug: nada é apagado. */
async function gravarCatalogo(db: SupabaseClient, titulos: TituloTesouro[]): Promise<void> {
  const agora = new Date().toISOString();
  const linhas = titulos.map((t) => ({
    slug: t.slug,
    nome: t.nome,
    indexador: t.indexador,
    vencimento: t.vencimento,
    pu_compra: t.puCompra,
    pu_venda: t.puVenda,
    taxa_compra: t.taxaCompra,
    taxa_venda: t.taxaVenda,
    investimento_minimo: t.investimentoMinimo,
    negociavel: t.negociavel,
    atualizado_em: agora,
  }));
  const { error } = await db.from("tesouro_titulos").upsert(linhas, { onConflict: "slug" });
  if (error) throw new Error(`tesouro_titulos: ${error.message}`);
}

/** Trecho da resposta crua — o bastante para reconhecer o formato no log. */
function amostra(bruto: unknown): string {
  try {
    return JSON.stringify(bruto).slice(0, 600);
  } catch {
    return String(bruto);
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
