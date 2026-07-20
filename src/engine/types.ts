// Tipos centrais do simulador de carteira da liga.
// O engine é TypeScript puro (sem dependência de DOM/React) para ser testável.

export type Moeda = string; // "BRL", "USD", ...
export type ClasseAtivo = "acao" | "etf" | "fii" | "tesouro" | "bond";
export type Bolsa = "B3" | "NYSE" | "NASDAQ" | "TESOURO" | "OUTRA" | string;

/** Metadados de renda fixa (Tesouro Direto ou título genérico). */
export interface BondMeta {
  emissor?: string;
  indexador?: "PREFIXADO" | "IPCA" | "SELIC" | "CDI" | string;
  /** Taxa contratada a.a. em decimal (ex.: 0.12 = 12% a.a.). Informativo. */
  taxaContratada?: number;
  /** Data ISO da compra (referência para o crescimento linear). */
  dataCompra: string;
  /** Data ISO de vencimento. */
  vencimento: string;
  /** Preço unitário pago na compra (PU de compra), na moeda do título. */
  puCompra: number;
  /** Valor unitário no vencimento (usado no crescimento linear quando não há MtM). */
  valorVencimento: number;
  /** Se true, é Tesouro Direto: MtM usa o PU oficial dos snapshots. */
  isTesouro: boolean;
  /** Chave para casar com a série oficial de PU (ex.: "Tesouro IPCA+ 2035"). */
  tesouroNome?: string;
}

/** Ativo registrado (ações/ETF/FII/tesouro/bond). Vive em data/assets.json. */
export interface Ativo {
  id: string; // normalmente o ticker em maiúsculas, ou o id do título
  tipo: ClasseAtivo;
  ticker: string;
  bolsa: Bolsa;
  moeda: Moeda;
  nome: string;
  bond?: BondMeta;
}

export type TipoTransacao = "compra" | "venda" | "provento" | "cupom";

export interface TransacaoBase {
  id: string;
  ts: string; // ISO timestamp
  tipo: TipoTransacao;
  membro: string;
}

/** Compra ou venda de um ativo. Para renda fixa, `preco` é o PU e qtd o nº de títulos. */
export interface TxTrade extends TransacaoBase {
  tipo: "compra" | "venda";
  ticker: string;
  qtd: number;
  preco: number; // na moeda do ativo (preço OFICIAL no momento — não editável na UI)
  moeda: Moeda;
  fx: number; // câmbio moeda->BRL no momento da operação (1 para BRL)
  taxa?: number; // custo/corretagem em BRL (opcional)
}

/** Provento (dividendo/JCP) ou cupom/juros recebido. */
export interface TxProvento extends TransacaoBase {
  tipo: "provento" | "cupom";
  ticker: string;
  valor: number; // valor por operação na moeda do ativo (total, não por ação)
  moeda: Moeda;
  fx: number;
}

export type Transacao = TxTrade | TxProvento;

export interface Config {
  nomeLiga: string;
  capitalInicial: number; // BRL, IMUTÁVEL
  moedaBase: Moeda; // "BRL"
  dataInicio: string;
  benchmarks?: Record<string, string>;
}

/** Snapshot de preços/câmbio oficiais (data/prices/latest.json), gerado pela Action. */
export interface PrecosSnapshot {
  atualizadoEm: string | null;
  fonte?: string;
  /** câmbio moeda->BRL. Ex.: { USD: 5.43 }. BRL é sempre 1. */
  cambio: Record<string, number>;
  /** último preço por ticker, na moeda do ativo. */
  acoes: Record<string, number>;
  /** PU oficial por nome de título do Tesouro. */
  tesouro: Record<string, number>;
}

/** Posição calculada (após replay + marcação). */
export interface Posicao {
  ticker: string;
  nome: string;
  classe: ClasseAtivo;
  bolsa: Bolsa;
  moeda: Moeda;
  qtd: number;
  custoMedioBRL: number; // por unidade
  custoTotalBRL: number;
  precoAtual: number | null; // na moeda do ativo (ou PU para renda fixa)
  fxAtual: number; // câmbio moeda->BRL usado na avaliação
  valorBRL: number | null; // valor de mercado em BRL
  plNaoRealizadoBRL: number | null;
  plNaoRealizadoPct: number | null;
  pesoPct: number | null; // % do patrimônio total
  /** origem da marcação: "mercado" | "linear" | "sem-preco" */
  marcacao?: "mercado" | "linear" | "sem-preco";
}

export interface AlocacaoItem {
  chave: string;
  valorBRL: number;
  pesoPct: number;
}

export interface PortfolioSnapshot {
  caixaBRL: number;
  posicoes: Posicao[];
  valorInvestidoBRL: number; // soma dos valorBRL das posições marcáveis
  patrimonioBRL: number; // caixa + investido
  capitalInicial: number;
  plRealizadoBRL: number;
  retornoTotalPct: number; // (patrimonio - capital) / capital
  cambioUSD: number | null;
  alocacaoPorClasse: AlocacaoItem[];
  alocacaoPorBolsa: AlocacaoItem[];
  alocacaoPorMoeda: AlocacaoItem[];
}
