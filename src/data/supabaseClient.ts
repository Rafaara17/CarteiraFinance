// Camada de dados sobre o Supabase (substitui o antigo githubClient).
// Lê config/assets/transactions/prices no banco na nuvem e mapeia para os TIPOS
// DO MOTOR (src/engine/types). Escreve transações/ativos/relatórios e assina
// mudanças em tempo real para sincronizar entre máquinas.
//
// Atenção: o PostgREST devolve colunas `numeric` como STRING (preserva precisão),
// então todo campo numérico é normalizado com num()/numOpt() ao mapear.
import type {
  Ativo,
  Config,
  HistoricoPrecos,
  PontoHistorico,
  PrecosSnapshot,
  Transacao,
  TxProvento,
  TxTrade,
} from "../engine/types";
import { supabase } from "./supabase";

/** Resumo da última alteração — para o indicador de frescor na Visão geral. */
export interface UltimaAtualizacao {
  autor: string;
  data: string; // ISO
  mensagem: string;
}

export interface DadosCarregados {
  config: Config;
  ativos: Ativo[];
  transacoes: Transacao[];
  precos: PrecosSnapshot;
  ultimaAtualizacao: UltimaAtualizacao | null;
}

const CONFIG_PADRAO: Config = {
  nomeLiga: "Carteira da Liga",
  capitalInicial: 1_000_000,
  moedaBase: "BRL",
  dataInicio: "2026-01-01",
};

const PRECOS_PADRAO: PrecosSnapshot = { atualizadoEm: null, cambio: { USD: 1 }, acoes: {}, tesouro: {} };

/** Carrega tudo em paralelo e devolve já convertido para os tipos do motor. */
export async function carregarDados(): Promise<DadosCarregados> {
  const [cfg, ats, txs, prc] = await Promise.all([
    supabase.from("config").select("*").eq("id", 1).maybeSingle(),
    supabase.from("assets").select("*"),
    supabase.from("transactions").select("*").order("ts", { ascending: true }),
    supabase.from("prices_latest").select("*").eq("id", 1).maybeSingle(),
  ]);

  if (cfg.error) throw new Error(`config: ${cfg.error.message}`);
  if (ats.error) throw new Error(`assets: ${ats.error.message}`);
  if (txs.error) throw new Error(`transactions: ${txs.error.message}`);
  if (prc.error) throw new Error(`prices: ${prc.error.message}`);

  const config = cfg.data ? mapConfig(cfg.data) : CONFIG_PADRAO;
  const ativos = (ats.data ?? []).map(mapAtivo);
  const transacoes = (txs.data ?? []).map(mapTransacao);
  const precos = prc.data ? mapPrecos(prc.data) : PRECOS_PADRAO;

  return { config, ativos, transacoes, precos, ultimaAtualizacao: ultimaDe(transacoes) };
}

/** Insere uma transação no ledger (append-only). O user_id é preenchido no banco. */
export async function registrarTransacao(tx: Transacao): Promise<void> {
  const { error } = await supabase.from("transactions").insert(linhaDeTransacao(tx));
  if (error) throw new Error(`Falha ao registrar transação: ${error.message}`);
}

/** Insere/atualiza um ativo no registro (upsert por ticker). */
export async function upsertAtivo(ativo: Ativo): Promise<void> {
  const linha = {
    ticker: ativo.ticker,
    tipo: ativo.tipo,
    bolsa: ativo.bolsa,
    moeda: ativo.moeda,
    nome: ativo.nome,
    bond: ativo.bond ?? null,
  };
  const { error } = await supabase.from("assets").upsert(linha, { onConflict: "ticker" });
  if (error) throw new Error(`Falha ao registrar ativo: ${error.message}`);
}

/**
 * Carrega a série histórica diária (tabela prices_history) para reconstruir a
 * evolução do patrimônio nos relatórios. Ordenada por data (ascendente).
 * Carregada sob demanda (ao abrir a aba Relatório), não no load inicial.
 */
export async function carregarHistorico(): Promise<HistoricoPrecos> {
  const { data, error } = await supabase
    .from("prices_history")
    .select("data,acoes,cambio,indices")
    .order("data", { ascending: true });
  if (error) throw new Error(`prices_history: ${error.message}`);
  return (data ?? []).map(mapHistorico);
}

/** Salva um snapshot do relatório (HTML) no banco. */
export async function salvarRelatorio(html: string, membro: string): Promise<void> {
  const { error } = await supabase.from("reports").insert({ html, membro });
  if (error) throw new Error(`Falha ao salvar relatório: ${error.message}`);
}

/**
 * Assina mudanças (Realtime) em transactions/assets/prices_latest e chama
 * `onChange` a cada alteração. Retorna a função para cancelar a assinatura.
 */
export function assinarRealtime(onChange: () => void): () => void {
  const canal = supabase
    .channel("carteira-db")
    .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "assets" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "prices_latest" }, onChange)
    .subscribe();
  return () => {
    void supabase.removeChannel(canal);
  };
}

// --- mapeamento banco -> tipos do motor -------------------------------------

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && isFinite(n) ? n : 0;
}

function numOpt(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && isFinite(n) ? n : undefined;
}

interface LinhaConfig {
  nome_liga: string;
  capital_inicial: unknown;
  moeda_base: string;
  data_inicio: string;
  benchmarks?: Record<string, string> | null;
}
function mapConfig(r: LinhaConfig): Config {
  return {
    nomeLiga: r.nome_liga,
    capitalInicial: num(r.capital_inicial),
    moedaBase: r.moeda_base,
    dataInicio: r.data_inicio,
    benchmarks: r.benchmarks ?? undefined,
  };
}

interface LinhaAtivo {
  ticker: string;
  tipo: string;
  bolsa: string;
  moeda: string;
  nome: string;
  bond?: Ativo["bond"] | null;
}
function mapAtivo(r: LinhaAtivo): Ativo {
  return {
    id: r.ticker,
    tipo: r.tipo as Ativo["tipo"],
    ticker: r.ticker,
    bolsa: r.bolsa,
    moeda: r.moeda,
    nome: r.nome,
    bond: r.bond ?? undefined,
  };
}

interface LinhaTransacao {
  id: string;
  ts: string;
  tipo: string;
  membro: string;
  ticker: string;
  qtd: unknown;
  preco: unknown;
  moeda: string;
  fx: unknown;
  taxa: unknown;
  valor: unknown;
}
function mapTransacao(r: LinhaTransacao): Transacao {
  const base = { id: r.id, ts: r.ts, membro: r.membro, ticker: r.ticker, moeda: r.moeda, fx: num(r.fx) };
  if (r.tipo === "compra" || r.tipo === "venda") {
    const tx: TxTrade = { ...base, tipo: r.tipo, qtd: num(r.qtd), preco: num(r.preco), taxa: numOpt(r.taxa) };
    return tx;
  }
  const tx: TxProvento = { ...base, tipo: r.tipo as "provento" | "cupom", valor: num(r.valor) };
  return tx;
}

function linhaDeTransacao(tx: Transacao): Record<string, unknown> {
  const base = { id: tx.id, ts: tx.ts, tipo: tx.tipo, membro: tx.membro, ticker: tx.ticker, moeda: tx.moeda, fx: tx.fx };
  if (tx.tipo === "compra" || tx.tipo === "venda") {
    return { ...base, qtd: tx.qtd, preco: tx.preco, taxa: tx.taxa ?? null };
  }
  const prov = tx as TxProvento;
  return { ...base, valor: prov.valor };
}

interface LinhaPrecos {
  atualizado_em: string | null;
  fonte?: string | null;
  cambio: Record<string, number> | null;
  acoes: Record<string, number> | null;
  tesouro: Record<string, number> | null;
}
function mapPrecos(r: LinhaPrecos): PrecosSnapshot {
  return {
    atualizadoEm: r.atualizado_em,
    fonte: r.fonte ?? undefined,
    cambio: r.cambio ?? { BRL: 1 },
    acoes: r.acoes ?? {},
    tesouro: r.tesouro ?? {},
  };
}

interface LinhaHistorico {
  data: string;
  acoes: Record<string, number> | null;
  cambio: Record<string, number> | null;
  indices: Record<string, number> | null;
}
function mapHistorico(r: LinhaHistorico): PontoHistorico {
  // Colunas jsonb: números vêm como números (o Postgres preserva o tipo JSON).
  return {
    data: r.data,
    acoes: r.acoes ?? {},
    cambio: r.cambio ?? {},
    indices: r.indices ?? {},
  };
}

function ultimaDe(transacoes: Transacao[]): UltimaAtualizacao | null {
  if (transacoes.length === 0) return null;
  const t = transacoes[transacoes.length - 1]; // já vem ordenado por ts asc
  return { autor: t.membro, data: t.ts, mensagem: `${t.tipo} ${t.ticker}` };
}
