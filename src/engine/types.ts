// Tipos centrais do simulador de carteira da liga.
// O engine é TypeScript puro (sem dependência de DOM/React) para ser testável.

export type Moeda = string; // "BRL", "USD", ...
export type ClasseAtivo = "acao" | "etf" | "fii" | "tesouro" | "bond" | "futuro" | "cripto";
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
  /**
   * Slug do título no catálogo oficial (ex.: "tesouro-ipca-2035-15052035").
   * Chave PREFERIDA para achar o PU: ao contrário do nome, não muda se o Tesouro
   * reescrever o rótulo do produto. Ausente nos ativos cadastrados antes do
   * catálogo existir — daí `marcarBond` ainda aceitar o nome como alternativa.
   */
  tesouroSlug?: string;
}

/**
 * Metadados de um contrato futuro da B3. A especificação de cada mercadoria
 * (tamanho, margem, regra de vencimento) mora em engine/derivativos.ts; aqui
 * fica só o que identifica ESTE contrato.
 */
export interface DerivativoMeta {
  tipo: "futuro";
  /** Código da mercadoria (WDO, DOL, WIN, BGI...). */
  mercadoria?: string;
  /** Ativo-objeto: "USD" no dólar, "IBOV" no índice, o código da mercadoria nas commodities. */
  subjacente: string;
  /** Data ISO (AAAA-MM-DD) do vencimento. */
  vencimento: string;
  /** Quanto 1 ponto de preço vale por contrato (ex.: WDO = 10, pois cota R$ por US$ 1.000 e o contrato é de US$ 10 mil). */
  multiplicador: number;
  moedaCotacao: Moeda;
}

/** Ativo registrado (ações/ETF/FII/tesouro/bond/derivativos). Vive em data/assets.json. */
export interface Ativo {
  id: string; // normalmente o ticker em maiúsculas, ou o id do título
  tipo: ClasseAtivo;
  ticker: string;
  bolsa: Bolsa;
  moeda: Moeda;
  nome: string;
  bond?: BondMeta;
  derivativo?: DerivativoMeta;
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
  preco: number; // na moeda do ativo: preço PAGO informado na compra (ou PU, na renda fixa)
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

/** Snapshot de preços/câmbio oficiais, gerado pela Edge Function e pela Action. */
export interface PrecosSnapshot {
  atualizadoEm: string | null;
  fonte?: string;
  /** câmbio moeda->BRL. Ex.: { USD: 5.43 }. BRL é sempre 1. */
  cambio: Record<string, number>;
  /** último preço por ticker, na moeda do ativo. */
  acoes: Record<string, number>;
  /** PU oficial por nome de título do Tesouro. */
  tesouro: Record<string, number>;
  /** fechamento anterior por ticker (e por moeda) — base da variação do dia. */
  fechamentoAnterior?: Record<string, number>;
  /** Taxas de juros anuais em decimal: CDI (Brasil) e USD (T-bill 13 semanas). */
  taxas?: Record<string, number>;
  /** Último ajuste oficial da B3 por código de futuro (ex.: "WDOZ26"). */
  ajustes?: Record<string, AjusteB3>;
}

/** Preço de ajuste de um futuro num pregão (tabela b3_ajustes). */
export interface AjusteB3 {
  ajuste: number;
  /** pregão a que o ajuste se refere (AAAA-MM-DD). */
  data: string;
  /** spot do ativo-objeto no fechamento daquele pregão — move o ajuste no intradiário. */
  spotRef?: number;
}

/**
 * Um dia da SÉRIE HISTÓRICA (tabela prices_history), usado para reconstruir a
 * evolução do patrimônio e a rentabilidade por período nos relatórios.
 */
export interface PontoHistorico {
  data: string; // "AAAA-MM-DD"
  /** preço de fechamento por ticker, na moeda do ativo. */
  acoes: Record<string, number>;
  /** câmbio moeda->BRL no dia (ex.: { USD: 5.43 }). */
  cambio: Record<string, number>;
  /** nível acumulado de índices de mercado/juros (IBOV, SP500, CDI, IPCA). */
  indices: Record<string, number>;
}

/** Série histórica completa, ordenada por data (ascendente). */
export type HistoricoPrecos = PontoHistorico[];

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
  /** fechamento anterior, na moeda do ativo (null se a fonte não informou). */
  precoAnterior: number | null;
  /** variação do dia (%) do preço do ativo, na moeda dele. */
  variacaoDiaPct: number | null;
  /** variação do dia (BRL) da posição inteira. */
  variacaoDiaBRL: number | null;
  /**
   * Origem do valor:
   *  - "mercado": preço oficial de mercado;
   *  - "linear":  renda fixa sem MtM, crescendo do PU de compra ao vencimento;
   *  - "custo":   sem cotação ainda — avaliado pelo custo, para que o dinheiro
   *               NÃO suma do patrimônio (ver computarPortfolio).
   */
  marcacao?: "mercado" | "linear" | "custo" | "b3" | "ajuste" | "teorico";
  /** Só nos futuros: lado, preço médio, exposição e margem. */
  derivativo?: InfoDerivativo;
}

/** Detalhes de uma posição em futuro (qtd da Posicao vem COM SINAL: < 0 = vendido). */
export interface InfoDerivativo {
  meta: DerivativoMeta;
  lado: "comprado" | "vendido";
  /** preço médio de entrada, na moeda de cotação do contrato. */
  precoMedio: number;
  /** valor nocional com sinal, em BRL (contratos × preço × multiplicador × câmbio). */
  nocionalBRL: number;
  /** margem de garantia exigida pela posição, em BRL. */
  margemBRL: number;
  /** true quando o vencimento já passou: aguardando liquidação. */
  vencido: boolean;
}

export interface AlocacaoItem {
  chave: string;
  valorBRL: number;
  pesoPct: number;
}

export interface PortfolioSnapshot {
  caixaBRL: number;
  posicoes: Posicao[];
  valorInvestidoBRL: number; // soma dos valorBRL das posições
  patrimonioBRL: number; // caixa + investido
  capitalInicial: number;
  plRealizadoBRL: number;
  /** P&L não realizado somado (valor de mercado - custo) das posições abertas. */
  plNaoRealizadoBRL: number;
  retornoTotalPct: number; // (patrimonio - capital) / capital
  /** variação do dia (BRL) somada das posições com fechamento anterior conhecido. */
  variacaoDiaBRL: number;
  /** variação do dia (%) sobre o patrimônio de ontem. */
  variacaoDiaPct: number | null;
  /** quantas posições estão avaliadas pelo custo por falta de cotação. */
  posicoesSemPreco: number;
  cambioUSD: number | null;
  alocacaoPorClasse: AlocacaoItem[];
  alocacaoPorBolsa: AlocacaoItem[];
  alocacaoPorMoeda: AlocacaoItem[];
  /** margem de garantia somada das posições em derivativos (BRL). */
  margemRequeridaBRL: number;
  /** caixa que sobra para operar depois de reservar a margem. */
  caixaLivreBRL: number;
}
