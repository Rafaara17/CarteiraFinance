// Camada de dados sobre o Supabase (substitui o antigo githubClient).
// Lê config/assets/transactions/prices/wallets/membros no banco na nuvem e mapeia
// para os TIPOS DO MOTOR (src/engine/types). Escreve transações/ativos/relatórios,
// gerencia papéis e carteiras (fork), e assina mudanças em tempo real.
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

/** Id FIXO da carteira central da liga (semeado em supabase/schema.sql). */
export const LIGA_WALLET_ID = "00000000-0000-0000-0000-000000000001";

export type Papel = "admin" | "gestor" | "membro";

/** Uma carteira: a central da liga ('liga') ou a pessoal de um membro ('pessoal'). */
export interface Wallet {
  id: string;
  tipo: "liga" | "pessoal";
  dono: string | null; // user_id do dono (só nas pessoais)
  nome: string;
}

/** Papel de um usuário no sistema de privilégios. */
export interface Membro {
  userId: string;
  nome: string;
  papel: Papel;
}

/** Resumo da última alteração — para o indicador de frescor na Visão geral. */
export interface UltimaAtualizacao {
  autor: string;
  data: string; // ISO
  mensagem: string;
}

export interface DadosCarregados {
  config: Config;
  ativos: Ativo[];
  precos: PrecosSnapshot;
  wallets: Wallet[];
  membros: Membro[];
  /** Ledger agrupado por carteira_id (liga + pessoais). */
  transacoesPorCarteira: Map<string, Transacao[]>;
}

const CONFIG_PADRAO: Config = {
  nomeLiga: "Carteira da Liga",
  capitalInicial: 1_000_000,
  moedaBase: "BRL",
  dataInicio: "2026-01-01",
};

const PRECOS_PADRAO: PrecosSnapshot = {
  atualizadoEm: null,
  cambio: { BRL: 1 },
  acoes: {},
  tesouro: {},
  fechamentoAnterior: {},
};

/** Carrega tudo em paralelo e devolve já convertido para os tipos do motor. */
export async function carregarDados(): Promise<DadosCarregados> {
  const [cfg, ats, txs, prc, wls, mbs] = await Promise.all([
    supabase.from("config").select("*").eq("id", 1).maybeSingle(),
    supabase.from("assets").select("*"),
    supabase.from("transactions").select("*").order("ts", { ascending: true }),
    supabase.from("prices_latest").select("*").eq("id", 1).maybeSingle(),
    supabase.from("wallets").select("*"),
    supabase.from("membros").select("*"),
  ]);

  if (cfg.error) throw new Error(`config: ${cfg.error.message}`);
  if (ats.error) throw new Error(`assets: ${ats.error.message}`);
  if (txs.error) throw new Error(`transactions: ${txs.error.message}`);
  if (prc.error) throw new Error(`prices: ${prc.error.message}`);
  if (wls.error) throw new Error(`wallets: ${wls.error.message}`);
  if (mbs.error) throw new Error(`membros: ${mbs.error.message}`);

  const config = cfg.data ? mapConfig(cfg.data) : CONFIG_PADRAO;
  const ativos = (ats.data ?? []).map(mapAtivo);
  const precos = prc.data ? mapPrecos(prc.data) : PRECOS_PADRAO;
  const wallets = (wls.data ?? []).map(mapWallet);
  const membros = (mbs.data ?? []).map(mapMembro);
  const transacoesPorCarteira = agruparTransacoes((txs.data ?? []) as LinhaTransacao[]);

  return { config, ativos, precos, wallets, membros, transacoesPorCarteira };
}

/**
 * Insere uma transação no ledger (append-only) de uma carteira específica.
 * O user_id é preenchido no banco; a RLS garante a permissão (só gestor/admin na
 * liga; só o dono na carteira pessoal).
 */
export async function registrarTransacao(tx: Transacao, carteiraId: string): Promise<void> {
  const { error } = await supabase.from("transactions").insert(linhaDeTransacao(tx, carteiraId));
  if (error) throw new Error(`Falha ao registrar transação: ${error.message}`);
}

/** Insere/atualiza um ativo no registro (upsert por ticker). Registro é global. */
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
 * Garante que o usuário logado tem uma linha em `membros` (papel 'membro' por
 * padrão). Idempotente: não mexe em quem já existe (não rebaixa admin/gestor).
 */
export async function garantirMembro(userId: string, nome: string): Promise<void> {
  const { error } = await supabase
    .from("membros")
    .upsert({ user_id: userId, nome, papel: "membro" }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) throw new Error(`Falha ao registrar membro: ${error.message}`);
}

/**
 * Cria (ou recupera) a carteira pessoal do usuário logado como CÓPIA (fork) da
 * carteira da liga no momento da ativação. Idempotente. Devolve o id da carteira.
 *
 * DORMENTE: a carteira pessoal saiu da interface (o app é só a carteira da liga),
 * mas o banco continua suportando o modelo multi-carteira — tabelas `wallets`,
 * `transactions.carteira_id`, a RPC e as policies seguem no schema. Reativar é
 * voltar a UI; não há migração envolvida. Ver também engine/comparacao.ts.
 */
export async function forkCarteiraPessoal(): Promise<string> {
  const { data, error } = await supabase.rpc("fork_carteira_pessoal");
  if (error) throw new Error(`Falha ao criar carteira pessoal: ${error.message}`);
  return data as string;
}

/** Promove/rebaixa um membro. A RLS só deixa efetivar se quem chama for admin. */
export async function atualizarPapel(userId: string, papel: Papel): Promise<void> {
  const { error } = await supabase.from("membros").update({ papel }).eq("user_id", userId);
  if (error) throw new Error(`Falha ao atualizar papel: ${error.message}`);
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
 * Assina mudanças (Realtime) e chama `onChange` a cada alteração. Cobre o ledger,
 * ativos, preços e também carteiras/papéis (para o ranking e o Admin ao vivo).
 * Retorna a função para cancelar a assinatura.
 */
export function assinarRealtime(onChange: () => void): () => void {
  const canal = supabase
    .channel("carteira-db")
    .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "assets" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "prices_latest" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "wallets" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "membros" }, onChange)
    .subscribe();
  return () => {
    void supabase.removeChannel(canal);
  };
}

/** Última alteração de um conjunto de transações (já ordenado por ts asc). */
export function ultimaAtualizacaoDe(transacoes: Transacao[]): UltimaAtualizacao | null {
  if (transacoes.length === 0) return null;
  const t = transacoes[transacoes.length - 1];
  return { autor: t.membro, data: t.ts, mensagem: `${t.tipo} ${t.ticker}` };
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

interface LinhaWallet {
  id: string;
  tipo: string;
  dono: string | null;
  nome: string;
}
function mapWallet(r: LinhaWallet): Wallet {
  return { id: r.id, tipo: r.tipo as Wallet["tipo"], dono: r.dono ?? null, nome: r.nome };
}

interface LinhaMembro {
  user_id: string;
  nome: string;
  papel: string;
}
function mapMembro(r: LinhaMembro): Membro {
  return { userId: r.user_id, nome: r.nome, papel: r.papel as Papel };
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
  carteira_id?: string | null;
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

/** Agrupa as linhas de transação por carteira_id (default = liga). */
function agruparTransacoes(linhas: LinhaTransacao[]): Map<string, Transacao[]> {
  const m = new Map<string, Transacao[]>();
  for (const linha of linhas) {
    const cid = linha.carteira_id ?? LIGA_WALLET_ID;
    const arr = m.get(cid);
    if (arr) arr.push(mapTransacao(linha));
    else m.set(cid, [mapTransacao(linha)]);
  }
  return m;
}

function linhaDeTransacao(tx: Transacao, carteiraId: string): Record<string, unknown> {
  const base = {
    id: tx.id,
    ts: tx.ts,
    tipo: tx.tipo,
    membro: tx.membro,
    ticker: tx.ticker,
    moeda: tx.moeda,
    fx: tx.fx,
    carteira_id: carteiraId,
  };
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
  fechamento_anterior?: Record<string, number> | null;
}
function mapPrecos(r: LinhaPrecos): PrecosSnapshot {
  return {
    atualizadoEm: r.atualizado_em,
    fonte: r.fonte ?? undefined,
    cambio: r.cambio ?? { BRL: 1 },
    acoes: r.acoes ?? {},
    tesouro: r.tesouro ?? {},
    fechamentoAnterior: r.fechamento_anterior ?? {},
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
