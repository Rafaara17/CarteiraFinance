// Motor de DERIVATIVOS (futuros da B3): especificação dos contratos, vencimentos,
// preço (último negócio, ajuste oficial ou teórico), margem e liquidação.
//
// Tudo aqui é função pura sobre o PrecosSnapshot; o preço final é recalculado
// igual em qualquer navegador.
//
// Simplificações didáticas (documentadas na aba Proteção):
//  - calendário só pula fins de semana (sem feriados da B3) — só usado quando a
//    B3 não informa o vencimento oficial;
//  - futuro não lança ajuste diário no caixa: o P&L acumula na posição e vira caixa
//    ao zerar — o patrimônio é o mesmo do ajuste diário, só a conta é outra.

import type { Ativo, DerivativoMeta, PrecosSnapshot } from "./types";

// ---------------------------------------------------------------------------
// Especificação dos futuros
// ---------------------------------------------------------------------------

export type CodigoMercadoria = "WDO" | "DOL" | "WIN" | "IND" | "BGI" | "CCM" | "ICF" | "SJC";

export interface SpecFuturo {
  codigo: CodigoMercadoria;
  nome: string;
  /** o que o contrato representa, em linguagem de gente. */
  tamanho: string;
  /** unidade de cotação exibida ao lado do preço. */
  unidade: string;
  multiplicador: number;
  moedaCotacao: "BRL" | "USD";
  /** margem de garantia simplificada, fração do nocional. */
  margemPct: number;
  /** meses (1-12) com vencimento negociado. */
  meses: number[];
  /** dia do vencimento dentro do mês do contrato. */
  vencimento: (ano: number, mes: number) => Date;
  /**
   * Símbolo do Yahoo que serve de "spot" do contrato: move o ajuste no
   * intradiário e alimenta o preço teórico. Ausente = sem referência ao vivo
   * grátis (boi, milho, etanol ficam no último ajuste).
   */
  referencia?: string;
  /** referência do Yahoo -> unidade do contrato (ex.: centavos/lb -> US$/saca). */
  conversao?: number;
  /** quantidade física por contrato, para a calculadora de hedge. */
  quantidadeFisica?: number;
  unidadeFisica?: string;
  casas: number;
}

const TODOS_OS_MESES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const FUTUROS: Record<CodigoMercadoria, SpecFuturo> = {
  WDO: {
    codigo: "WDO",
    nome: "Mini dólar",
    tamanho: "US$ 10 mil",
    unidade: "R$ por US$ 1.000",
    multiplicador: 10,
    moedaCotacao: "BRL",
    margemPct: 0.15,
    meses: TODOS_OS_MESES,
    vencimento: (a, m) => primeiroDiaUtil(a, m),
    referencia: "USD",
    quantidadeFisica: 10_000,
    unidadeFisica: "US$",
    casas: 1,
  },
  DOL: {
    codigo: "DOL",
    nome: "Dólar cheio",
    tamanho: "US$ 50 mil",
    unidade: "R$ por US$ 1.000",
    multiplicador: 50,
    moedaCotacao: "BRL",
    margemPct: 0.15,
    meses: TODOS_OS_MESES,
    vencimento: (a, m) => primeiroDiaUtil(a, m),
    referencia: "USD",
    quantidadeFisica: 50_000,
    unidadeFisica: "US$",
    casas: 1,
  },
  WIN: {
    codigo: "WIN",
    nome: "Mini Ibovespa",
    tamanho: "R$ 0,20 por ponto",
    unidade: "pontos",
    multiplicador: 0.2,
    moedaCotacao: "BRL",
    margemPct: 0.12,
    meses: [2, 4, 6, 8, 10, 12],
    vencimento: (a, m) => quartaMaisProximaDo15(a, m),
    referencia: "^BVSP",
    casas: 0,
  },
  IND: {
    codigo: "IND",
    nome: "Ibovespa cheio",
    tamanho: "R$ 1 por ponto",
    unidade: "pontos",
    multiplicador: 1,
    moedaCotacao: "BRL",
    margemPct: 0.12,
    meses: [2, 4, 6, 8, 10, 12],
    vencimento: (a, m) => quartaMaisProximaDo15(a, m),
    referencia: "^BVSP",
    casas: 0,
  },
  BGI: {
    codigo: "BGI",
    nome: "Boi gordo",
    tamanho: "330 arrobas",
    unidade: "R$/@",
    multiplicador: 330,
    moedaCotacao: "BRL",
    margemPct: 0.1,
    meses: TODOS_OS_MESES,
    vencimento: (a, m) => ultimoDiaUtil(a, m),
    quantidadeFisica: 330,
    unidadeFisica: "@",
    casas: 2,
  },
  CCM: {
    codigo: "CCM",
    nome: "Milho",
    tamanho: "450 sacas de 60 kg",
    unidade: "R$/saca",
    multiplicador: 450,
    moedaCotacao: "BRL",
    margemPct: 0.12,
    meses: [1, 3, 5, 7, 8, 9, 11],
    vencimento: (a, m) => diaUtilAteh(a, m, 15),
    quantidadeFisica: 450,
    unidadeFisica: "sacas",
    casas: 2,
  },
  ICF: {
    codigo: "ICF",
    nome: "Café arábica",
    tamanho: "100 sacas de 60 kg",
    unidade: "US$/saca",
    multiplicador: 100,
    moedaCotacao: "USD",
    margemPct: 0.15,
    meses: [3, 5, 7, 9, 12],
    vencimento: (a, m) => somarDiasUteis(ultimoDiaUtil(a, m), -6),
    referencia: "KC=F",
    conversao: 1.32276, // centavos de US$/lb -> US$/saca (60 kg = 132,276 lb; ÷100 de centavos)
    quantidadeFisica: 100,
    unidadeFisica: "sacas",
    casas: 2,
  },
  SJC: {
    codigo: "SJC",
    nome: "Soja (CME)",
    tamanho: "450 sacas de 60 kg",
    unidade: "US$/saca",
    multiplicador: 450,
    moedaCotacao: "USD",
    margemPct: 0.12,
    meses: [1, 3, 5, 7, 8, 9, 11],
    vencimento: (a, m) => somarDiasUteis(ultimoDiaUtil(a, m), -1),
    referencia: "ZS=F",
    conversao: 0.0220462, // centavos de US$/bushel -> US$/saca (60 kg = 2,20462 bu)
    quantidadeFisica: 450,
    unidadeFisica: "sacas",
    casas: 2,
  },
};

export const MERCADORIAS = Object.keys(FUTUROS) as CodigoMercadoria[];

/** Símbolos do Yahoo usados como referência dos futuros (café, soja e Ibovespa). */
export const REFERENCIAS_YAHOO = ["KC=F", "ZS=F", "^BVSP"];

/** Futuros de índice: hedge de bolsa pelo beta, não pela calculadora de quantidade física. */
export const FUTUROS_INDICE: CodigoMercadoria[] = ["WIN", "IND"];

/** Letra de vencimento da B3: F=jan … Z=dez. */
export const LETRAS_MES = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"];

/** Juros usados quando as fontes ainda não responderam. */
export const TAXAS_PADRAO = { CDI: 0.14, USD: 0.04 };

/** Ajuste mais velho que isto (dias corridos) deixa de valer: cai no teórico. */
const AJUSTE_VALIDADE_DIAS = 5;

const MS_DIA = 86_400_000;

// ---------------------------------------------------------------------------
// Calendário (sem feriados)
// ---------------------------------------------------------------------------

function utc(ano: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function ehDiaUtil(d: Date): boolean {
  const w = d.getUTCDay();
  return w !== 0 && w !== 6;
}

function primeiroDiaUtil(ano: number, mes: number): Date {
  const d = utc(ano, mes, 1);
  while (!ehDiaUtil(d)) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function ultimoDiaUtil(ano: number, mes: number): Date {
  const d = utc(ano, mes + 1, 0); // dia 0 do mês seguinte = último dia deste
  while (!ehDiaUtil(d)) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/** O dia `dia` do mês, ou o dia útil anterior se cair em fim de semana. */
function diaUtilAteh(ano: number, mes: number, dia: number): Date {
  const d = utc(ano, mes, dia);
  while (!ehDiaUtil(d)) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function somarDiasUteis(base: Date, n: number): Date {
  const d = new Date(base.getTime());
  const passo = n >= 0 ? 1 : -1;
  let faltam = Math.abs(n);
  while (faltam > 0) {
    d.setUTCDate(d.getUTCDate() + passo);
    if (ehDiaUtil(d)) faltam--;
  }
  return d;
}

/** Quarta-feira mais próxima do dia 15 — vencimento do futuro de Ibovespa. */
function quartaMaisProximaDo15(ano: number, mes: number): Date {
  const d = utc(ano, mes, 15);
  const w = d.getUTCDay();
  let delta = 3 - w; // até a quarta da mesma semana
  if (delta > 3) delta -= 7;
  if (delta < -3) delta += 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

/** Dias úteis entre duas datas: conta os dias úteis em (de, ate]. */
export function diasUteisEntre(de: Date, ate: Date): number {
  const a = utc(de.getUTCFullYear(), de.getUTCMonth() + 1, de.getUTCDate());
  const b = utc(ate.getUTCFullYear(), ate.getUTCMonth() + 1, ate.getUTCDate());
  if (b <= a) return 0;
  let n = 0;
  const d = new Date(a.getTime());
  while (d < b) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (ehDiaUtil(d)) n++;
  }
  return n;
}

function diasCorridos(de: Date, ate: Date): number {
  return Math.max(0, Math.round((dia(ate).getTime() - dia(de).getTime()) / MS_DIA));
}

function dia(d: Date): Date {
  return utc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Códigos e vencimentos
// ---------------------------------------------------------------------------

export interface VencimentoFuturo {
  /** código B3 completo, ex.: "WDOZ26". */
  codigo: string;
  mercadoria: CodigoMercadoria;
  ano: number;
  mes: number;
  /** AAAA-MM-DD */
  vencimento: string;
}

export function codigoFuturo(mercadoria: CodigoMercadoria, ano: number, mes: number): string {
  return `${mercadoria}${LETRAS_MES[mes - 1]}${String(ano % 100).padStart(2, "0")}`;
}

/** "WDOZ26" -> { mercadoria, ano, mes, vencimento }; null se não for um futuro suportado. */
export function lerCodigoFuturo(codigo: string): VencimentoFuturo | null {
  const m = /^([A-Z]{3})([FGHJKMNQUVXZ])(\d{2})$/.exec(codigo.trim().toUpperCase());
  if (!m || !(m[1] in FUTUROS)) return null;
  const mercadoria = m[1] as CodigoMercadoria;
  const mes = LETRAS_MES.indexOf(m[2]) + 1;
  const ano = 2000 + Number(m[3]);
  return { codigo: m[0], mercadoria, ano, mes, vencimento: ymd(FUTUROS[mercadoria].vencimento(ano, mes)) };
}

/** Os próximos `n` vencimentos ainda negociáveis de uma mercadoria a partir de `hoje`. */
export function proximosVencimentos(mercadoria: CodigoMercadoria, hoje: Date, n = 4): VencimentoFuturo[] {
  const spec = FUTUROS[mercadoria];
  const out: VencimentoFuturo[] = [];
  const hojeYMD = ymd(hoje);
  let ano = hoje.getUTCFullYear();
  let mes = hoje.getUTCMonth() + 1;
  for (let i = 0; i < 36 && out.length < n; i++) {
    if (spec.meses.includes(mes)) {
      const venc = ymd(spec.vencimento(ano, mes));
      if (venc >= hojeYMD) out.push({ codigo: codigoFuturo(mercadoria, ano, mes), mercadoria, ano, mes, vencimento: venc });
    }
    mes++;
    if (mes > 12) {
      mes = 1;
      ano++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Insumos
// ---------------------------------------------------------------------------

export function taxa(precos: PrecosSnapshot, chave: "CDI" | "USD"): number {
  const t = precos.taxas?.[chave];
  return typeof t === "number" && isFinite(t) && t > -0.5 && t < 2 ? t : TAXAS_PADRAO[chave];
}

/** Preço da referência ao vivo de um futuro (dólar em R$/US$ 1.000; commodity na unidade do contrato). */
export function spotDaReferencia(spec: SpecFuturo, precos: PrecosSnapshot): number | null {
  if (!spec.referencia) return null;
  if (spec.referencia === "USD") {
    const c = precos.cambio?.USD;
    return typeof c === "number" && c > 0 ? c * 1000 : null;
  }
  const p = precos.acoes?.[spec.referencia];
  return typeof p === "number" && p > 0 ? p * (spec.conversao ?? 1) : null;
}

// ---------------------------------------------------------------------------
// Preço do futuro
// ---------------------------------------------------------------------------

export interface PrecoDerivativo {
  preco: number;
  /** "b3": último negócio na B3 (15 min de atraso); "ajuste": ajuste do pregão anterior. */
  origem: "b3" | "ajuste" | "teorico";
}

/**
 * Preço TEÓRICO do futuro.
 *  - Dólar: custo de carregamento, S·(1+CDI)^(du/252) / (1 + rUSD·dc/360).
 *  - Ibovespa: IBOV · (1+CDI)^(du/252) (sem dividendos).
 *  - Café/soja: futuro internacional convertido para US$/saca (sem basis).
 *  - Boi/milho: não há referência grátis ao vivo -> null.
 */
export function precoTeoricoFuturo(
  spec: SpecFuturo,
  vencimentoYMD: string,
  precos: PrecosSnapshot,
  hoje: Date,
): number | null {
  const spot = spotDaReferencia(spec, precos);
  if (spot == null) return null;
  const venc = new Date(`${vencimentoYMD}T00:00:00Z`);
  const du = diasUteisEntre(hoje, venc);
  if (spec.referencia === "^BVSP") return spot * Math.pow(1 + taxa(precos, "CDI"), du / 252);
  if (spec.referencia !== "USD") return spot;
  const dc = diasCorridos(hoje, venc);
  return (spot * Math.pow(1 + taxa(precos, "CDI"), du / 252)) / (1 + (taxa(precos, "USD") * dc) / 360);
}

/**
 * Preço do futuro, em ordem de preferência:
 *  1. último negócio na B3 (`acoes[código]`, vindo da API de cotações da B3);
 *  2. AJUSTE do pregão anterior (movido pelo spot no intradiário, quando há
 *     referência ao vivo e o spot de referência do ajuste é conhecido);
 *  3. TEÓRICO.
 */
export function precoFuturo(
  codigo: string,
  spec: SpecFuturo,
  vencimentoYMD: string,
  precos: PrecosSnapshot,
  hoje: Date,
): PrecoDerivativo | null {
  const spot = spotDaReferencia(spec, precos);
  const vencido = ymd(hoje) > vencimentoYMD;
  const ultimo = precos.acoes?.[codigo];
  if (!vencido && typeof ultimo === "number" && ultimo > 0) return { preco: ultimo, origem: "b3" };
  const aj = precos.ajustes?.[codigo];
  if (aj && aj.ajuste > 0) {
    const idade = diasCorridos(new Date(`${aj.data}T00:00:00Z`), hoje);
    // Sem referência ao vivo (boi, milho), o ajuste vale mesmo velho: é o único
    // preço que existe. Com referência, ajuste velho perde para o teórico.
    if (idade <= AJUSTE_VALIDADE_DIAS || spot == null) {
      const movido = spot != null && aj.spotRef && aj.spotRef > 0 ? aj.ajuste * (spot / aj.spotRef) : aj.ajuste;
      return { preco: movido, origem: "ajuste" };
    }
  }
  const teorico = precoTeoricoFuturo(spec, vencimentoYMD, precos, hoje);
  if (teorico == null || !(teorico > 0)) return null;
  return { preco: teorico, origem: "teorico" };
}

// ---------------------------------------------------------------------------
// Ponto de entrada: preço de qualquer derivativo
// ---------------------------------------------------------------------------

export function ehDerivativo(a: Pick<Ativo, "tipo"> | undefined): boolean {
  return a?.tipo === "futuro";
}

export function specDe(meta: DerivativoMeta): SpecFuturo | null {
  return meta.mercadoria && meta.mercadoria in FUTUROS ? FUTUROS[meta.mercadoria as CodigoMercadoria] : null;
}

export function estaVencido(meta: DerivativoMeta, hoje: Date): boolean {
  return ymd(hoje) > meta.vencimento;
}

/** Preço de mercado de um derivativo registrado (ticker = código do contrato). */
export function precoDerivativo(
  ticker: string,
  meta: DerivativoMeta,
  precos: PrecosSnapshot,
  hoje: Date,
): PrecoDerivativo | null {
  const spec = specDe(meta);
  if (!spec) return null;
  // Vencido: o teórico com prazo zero é o próprio spot (liquidação pela referência).
  return precoFuturo(ticker, spec, meta.vencimento, precos, hoje);
}

/**
 * Meta de um futuro a partir do código B3 (ex.: "WDOZ26"). `vencimento` é o
 * oficial da B3 quando conhecido; sem ele, vale a regra de calendário.
 */
export function metaFuturo(codigo: string, vencimento?: string): DerivativoMeta | null {
  const v = lerCodigoFuturo(codigo);
  if (!v) return null;
  const spec = FUTUROS[v.mercadoria];
  return {
    tipo: "futuro",
    mercadoria: v.mercadoria,
    subjacente: spec.referencia === "USD" ? "USD" : spec.referencia === "^BVSP" ? "IBOV" : v.mercadoria,
    vencimento: vencimento ?? v.vencimento,
    multiplicador: spec.multiplicador,
    moedaCotacao: spec.moedaCotacao,
  };
}

/** Ativo completo (para o registro) de um futuro. */
export function ativoFuturo(codigo: string, vencimento?: string): Ativo | null {
  const meta = metaFuturo(codigo, vencimento);
  if (!meta) return null;
  const spec = FUTUROS[meta.mercadoria as CodigoMercadoria];
  return {
    id: codigo,
    tipo: "futuro",
    ticker: codigo,
    bolsa: "B3",
    moeda: meta.moedaCotacao,
    nome: `${spec.nome} ${codigo.slice(3)} (${spec.tamanho})`,
    derivativo: meta,
  };
}

// ---------------------------------------------------------------------------
// API de cotações da B3 (cotacao.b3.com.br) — parser puro
// ---------------------------------------------------------------------------

/** Um contrato futuro como a B3 lista (15 min de atraso). */
export interface ContratoB3 {
  codigo: string;
  mercadoria: CodigoMercadoria;
  vencimento: string;
  /** ajuste do pregão anterior. */
  ajuste: number | null;
  /** último negócio do dia (null = não negociou hoje). */
  ultimo: number | null;
  compra: number | null;
  venda: number | null;
  contratosAbertos: number | null;
}

/**
 * Lê a resposta de `DerivativeQuotation/{mercadoria}`. A mesma lista traz
 * opções sobre o futuro (mkt "FOPT"): só os futuros ("FUT") interessam aqui.
 */
export function lerCotacaoFuturosB3(json: unknown): ContratoB3[] {
  const scty = (json as { Scty?: unknown[] })?.Scty;
  if (!Array.isArray(scty)) return [];
  const out: ContratoB3[] = [];
  for (const it of scty as Array<Record<string, any>>) {
    if (it?.mkt?.cd !== "FUT") continue;
    const v = lerCodigoFuturo(String(it.symb ?? ""));
    if (!v) continue;
    const q = it.SctyQtn ?? {};
    const r = it.asset?.AsstSummry ?? {};
    const num = (x: unknown) => (typeof x === "number" && x > 0 ? x : null);
    out.push({
      codigo: v.codigo,
      mercadoria: v.mercadoria,
      vencimento: typeof r.mtrtyCode === "string" ? r.mtrtyCode.slice(0, 10) : v.vencimento,
      ajuste: num(q.prvsDayAdjstmntPric),
      ultimo: num(q.curPrc),
      compra: num(it.buyOffer?.price),
      venda: num(it.sellOffer?.price),
      contratosAbertos: typeof r.opnCtrcts === "number" ? r.opnCtrcts : null,
    });
  }
  return out.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

// ---------------------------------------------------------------------------
// Margem e exposição
// ---------------------------------------------------------------------------

/**
 * Margem de garantia (BRL) de uma posição com `qtd` COM SINAL: margemPct × nocional,
 * comprado ou vendido.
 */
export function margemPosicao(meta: DerivativoMeta, qtd: number, preco: number, fx: number): number {
  const spec = specDe(meta);
  return Math.abs(qtd) * preco * meta.multiplicador * fx * (spec?.margemPct ?? 0.15);
}

/** Mapa ticker -> meta dos derivativos do registro (para o replay do ledger). */
export function mapaDerivativos(ativos: Ativo[]): Map<string, DerivativoMeta> {
  const m = new Map<string, DerivativoMeta>();
  for (const a of ativos) if (a.derivativo && ehDerivativo(a)) m.set(a.ticker, a.derivativo);
  return m;
}
