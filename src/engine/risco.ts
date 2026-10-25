// Motor de RISCO da carteira (mesa de risco da aba Proteção). Puro e testável.
//
// Modelo de fatores, como numa mesa profissional simplificada:
//  - cada posição vira EXPOSIÇÕES em R$ a fatores de mercado (a própria ação, o
//    dólar, o Ibovespa, uma commodity, um cripto);
//  - os retornos diários dos fatores vêm de `prices_history` (252 pregões);
//  - VaR histórico = carteira de HOJE × retornos dos últimos 252 dias;
//    VaR paramétrico = z · √(eᵀ Σ e) (delta-normal).
//
// Simplificações: renda fixa fica fora (risco de mercado baixo no horizonte de
// 1–10 dias); fatores sem série histórica (boi, milho...) usam volatilidade
// padrão documentada e correlação zero, só no paramétrico.

import type { HistoricoPrecos, PortfolioSnapshot, Posicao } from "./types";

export const JANELA_PADRAO = 252;

/** Volatilidade anual usada para fatores sem série histórica. */
export const VOL_PADRAO_FATOR: Record<string, number> = {
  BGI: 0.18,
  CCM: 0.25,
  ICF: 0.35,
  SJC: 0.25,
  IBOV: 0.22,
  USD: 0.15,
  CRIPTO: 0.6,
};
const VOL_FATOR_DESCONHECIDO = 0.3;

const Z95 = 1.6449;
const Z99 = 2.3263;

// ---------------------------------------------------------------------------
// Exposições
// ---------------------------------------------------------------------------

export interface ExposicaoPosicao {
  ticker: string;
  derivativo: boolean;
  /** fator -> exposição em R$ (com sinal). */
  fatores: Record<string, number>;
}

/**
 * Converte posições em exposições a fatores:
 *  - ação/ETF/FII/BDR em R$: o próprio ticker;
 *  - ativo em US$: o ticker (preço em US$) + o dólar;
 *  - cripto: o próprio ticker;
 *  - futuro: o objeto (USD, IBOV ou a mercadoria) pelo nocional; contratos em
 *    US$ (café/soja) também carregam dólar.
 */
export function exposicoes(snapshot: PortfolioSnapshot): ExposicaoPosicao[] {
  const out: ExposicaoPosicao[] = [];
  for (const p of snapshot.posicoes) {
    const f: Record<string, number> = {};
    const d = p.derivativo;
    if (d) {
      f[d.meta.subjacente] = d.nocionalBRL;
      if (d.meta.moedaCotacao === "USD") f.USD = (f.USD ?? 0) + d.nocionalBRL;
    } else {
      if (p.classe === "tesouro" || p.classe === "bond") continue;
      const v = p.valorBRL ?? 0;
      if (v === 0) continue;
      f[p.ticker] = v;
      if (p.moeda === "USD") f.USD = v;
    }
    out.push({ ticker: p.ticker, derivativo: d != null, fatores: f });
  }
  return out;
}

function somarExposicoes(lista: ExposicaoPosicao[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const e of lista) for (const [k, v] of Object.entries(e.fatores)) t[k] = (t[k] ?? 0) + v;
  return t;
}

// ---------------------------------------------------------------------------
// Séries de retornos dos fatores
// ---------------------------------------------------------------------------

/** Nível de um fator num ponto da série histórica (null se ausente). */
function nivel(pt: HistoricoPrecos[number], fator: string): number | null {
  const v =
    fator === "USD" ? pt.cambio.USD
    : fator === "IBOV" ? pt.indices.IBOV
    : fator === "SP500" ? pt.indices.SP500
    : pt.acoes[fator];
  return typeof v === "number" && v > 0 ? v : null;
}

export interface MatrizRetornos {
  datas: string[];
  /** fator -> retornos diários simples, alinhados a `datas` (0 onde faltou dado). */
  retornos: Record<string, number[]>;
  /** fatores sem série suficiente (< 20 retornos válidos). */
  semHistorico: string[];
}

/**
 * Retornos diários dos fatores nos últimos `janela` pregões, alinhados por data.
 * Usa forward-fill do último nível conhecido: feriado num mercado não vira um
 * retorno falso no dia seguinte, vira zero.
 */
export function matrizRetornos(hist: HistoricoPrecos, fatores: string[], janela = JANELA_PADRAO): MatrizRetornos {
  const ordenado = [...hist].sort((a, b) => a.data.localeCompare(b.data));
  // Só dias com algum mercado aberto (IBOV ou dólar) contam como pregão.
  const pregoes = ordenado.filter((p) => nivel(p, "IBOV") != null || nivel(p, "USD") != null);
  const recorte = pregoes.slice(-(janela + 1));
  const datas = recorte.slice(1).map((p) => p.data);
  const retornos: Record<string, number[]> = {};
  const semHistorico: string[] = [];
  for (const f of fatores) {
    const r: number[] = [];
    let anterior: number | null = null;
    // forward-fill a partir do histórico ANTES do recorte
    for (const p of pregoes.slice(0, Math.max(0, pregoes.length - recorte.length))) anterior = nivel(p, f) ?? anterior;
    let validos = 0;
    recorte.forEach((p, i) => {
      const v = nivel(p, f);
      if (i > 0) {
        if (v != null && anterior != null) {
          r.push(v / anterior - 1);
          validos++;
        } else r.push(0);
      }
      if (v != null) anterior = v;
    });
    if (validos < 20) semHistorico.push(f);
    else retornos[f] = r;
  }
  return { datas, retornos, semHistorico };
}

// ---------------------------------------------------------------------------
// VaR
// ---------------------------------------------------------------------------

export interface ContribuicaoVaR {
  ticker: string;
  /** VaR componente 95% (R$): somando todas dá o VaR paramétrico da carteira. */
  varBRL: number;
  pct: number;
}

export interface Risco {
  /** pregões usados no histórico. */
  dias: number;
  patrimonioBRL: number;
  /** VaR histórico 1 dia (R$, positivo = perda). */
  varHist95: number;
  varHist99: number;
  /** Expected Shortfall 97,5% histórico 1 dia. */
  es975: number;
  /** VaR paramétrico (delta-normal) 1 dia. */
  varParam95: number;
  varParam99: number;
  /** volatilidade anualizada da carteira (% do patrimônio). */
  volAnualPct: number;
  contribuicoes: ContribuicaoVaR[];
  /** fatores que entraram só com volatilidade padrão. */
  fatoresSemHistorico: string[];
  /** P&L diário simulado (para o histograma). */
  plSimulado: number[];
}

function quantil(ordenado: number[], q: number): number {
  if (ordenado.length === 0) return 0;
  const pos = (ordenado.length - 1) * q;
  const i = Math.floor(pos);
  const f = pos - i;
  return ordenado[i] + (ordenado[Math.min(i + 1, ordenado.length - 1)] - ordenado[i]) * f;
}

function covariancia(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
}

/** Vol diária de um fator sem histórico: padrão do fator, de cripto, ou genérica. */
function volDiariaPadrao(f: string, criptos: Set<string>): number {
  const anual = VOL_PADRAO_FATOR[f] ?? (criptos.has(f) ? VOL_PADRAO_FATOR.CRIPTO : VOL_FATOR_DESCONHECIDO);
  return anual / Math.sqrt(252);
}

/**
 * Risco da carteira de hoje. `incluirDerivativos = false` dá a mesma conta só
 * com as posições físicas — a comparação "sem hedge × com hedge".
 */
export function calcularRisco(
  snapshot: PortfolioSnapshot,
  hist: HistoricoPrecos,
  incluirDerivativos = true,
  janela = JANELA_PADRAO,
): Risco {
  const exps = exposicoes(snapshot).filter((e) => incluirDerivativos || !e.derivativo);
  const total = somarExposicoes(exps);
  const fatores = Object.keys(total).filter((f) => total[f] !== 0 || exps.some((e) => e.fatores[f]));
  const { datas, retornos, semHistorico } = matrizRetornos(hist, fatores, janela);
  const criptos = new Set(snapshot.posicoes.filter((p) => p.classe === "cripto").map((p) => p.ticker));
  const patrimonio = snapshot.patrimonioBRL;

  // --- histórico: P&L de cada dia com a carteira de hoje ---
  const pl: number[] = datas.map((_, t) => {
    let s = 0;
    for (const f of Object.keys(retornos)) s += total[f] * retornos[f][t];
    return s;
  });
  const ord = [...pl].sort((a, b) => a - b);
  const varHist95 = Math.max(0, -quantil(ord, 0.05));
  const varHist99 = Math.max(0, -quantil(ord, 0.01));
  const cauda = ord.slice(0, Math.max(1, Math.floor(ord.length * 0.025)));
  const es975 = ord.length ? Math.max(0, -cauda.reduce((a, b) => a + b, 0) / cauda.length) : 0;

  // --- paramétrico: Σ dos fatores com histórico + diagonal para os sem ---
  const comHist = Object.keys(retornos);
  const cov = (a: string, b: string): number => {
    const ha = a in retornos, hb = b in retornos;
    if (ha && hb) return covariancia(retornos[a], retornos[b]);
    if (a === b) return volDiariaPadrao(a, criptos) ** 2;
    return 0;
  };
  // (Σe)_f para cada fator
  const sigmaE: Record<string, number> = {};
  for (const a of fatores) {
    let s = 0;
    for (const b of fatores) s += cov(a, b) * total[b];
    sigmaE[a] = s;
  }
  let variancia = 0;
  for (const f of fatores) variancia += total[f] * sigmaE[f];
  const sigma = Math.sqrt(Math.max(0, variancia));
  const varParam95 = Z95 * sigma;
  const varParam99 = Z99 * sigma;

  // VaR componente por posição: Σ_f e_if·(Σe)_f / σ · z
  const contribuicoes: ContribuicaoVaR[] =
    sigma > 0
      ? exps
          .map((e) => {
            let c = 0;
            for (const [f, v] of Object.entries(e.fatores)) c += v * (sigmaE[f] ?? 0);
            const varBRL = (Z95 * c) / sigma;
            return { ticker: e.ticker, varBRL, pct: (varBRL / varParam95) * 100 };
          })
          .sort((a, b) => b.varBRL - a.varBRL)
      : [];

  return {
    dias: datas.length,
    patrimonioBRL: patrimonio,
    varHist95,
    varHist99,
    es975,
    varParam95,
    varParam99,
    volAnualPct: patrimonio > 0 ? ((sigma * Math.sqrt(252)) / patrimonio) * 100 : 0,
    contribuicoes,
    fatoresSemHistorico: [...new Set([...semHistorico.filter((f) => !comHist.includes(f))])],
    plSimulado: pl,
  };
}

/** VaR de h dias pela regra da raiz do tempo. */
export function varHorizonte(var1d: number, dias: number): number {
  return var1d * Math.sqrt(dias);
}

/** Drawdown máximo (%) de uma série de patrimônio. */
export function drawdownMaximo(serie: Array<{ patrimonioBRL: number }>): number {
  let pico = -Infinity;
  let pior = 0;
  for (const p of serie) {
    pico = Math.max(pico, p.patrimonioBRL);
    if (pico > 0) pior = Math.min(pior, p.patrimonioBRL / pico - 1);
  }
  return pior * 100;
}

// ---------------------------------------------------------------------------
// Beta
// ---------------------------------------------------------------------------

/** Beta de cada ticker contra o Ibovespa (regressão dos retornos diários). */
export function betas(hist: HistoricoPrecos, tickers: string[], janela = JANELA_PADRAO): Record<string, number> {
  const { retornos } = matrizRetornos(hist, ["IBOV", ...tickers], janela);
  const ibov = retornos.IBOV;
  const out: Record<string, number> = {};
  if (!ibov) return out;
  const varIbov = covariancia(ibov, ibov);
  if (!(varIbov > 0)) return out;
  for (const t of tickers) if (retornos[t]) out[t] = covariancia(retornos[t], ibov) / varIbov;
  return out;
}

export interface BetaCarteira {
  /** ações brasileiras consideradas (R$). */
  acoesBRL: number;
  /** soma de valor × beta das ações (R$ "equivalentes a Ibovespa"). */
  exposicaoBetaBRL: number;
  /** nocional dos futuros de índice já na carteira (R$, com sinal). */
  futurosIndiceBRL: number;
  /** exposição líquida ao Ibovespa (ações × beta + futuros de índice). */
  liquidaBRL: number;
  /** beta da carteira sobre o patrimônio. */
  betaPatrimonio: number;
  /** beta só da parte em ações. */
  betaAcoes: number;
}

export function betaDaCarteira(snapshot: PortfolioSnapshot, b: Record<string, number>): BetaCarteira {
  let acoesBRL = 0, expo = 0, fut = 0;
  for (const p of snapshot.posicoes) {
    if (p.derivativo) {
      if (p.derivativo.meta.subjacente === "IBOV") fut += p.derivativo.nocionalBRL;
      continue;
    }
    if (!ehAcaoBRPos(p)) continue;
    const v = p.valorBRL ?? 0;
    acoesBRL += v;
    expo += v * (b[p.ticker] ?? 1);
  }
  const liquida = expo + fut;
  return {
    acoesBRL,
    exposicaoBetaBRL: expo,
    futurosIndiceBRL: fut,
    liquidaBRL: liquida,
    betaPatrimonio: snapshot.patrimonioBRL > 0 ? liquida / snapshot.patrimonioBRL : 0,
    betaAcoes: acoesBRL > 0 ? expo / acoesBRL : 0,
  };
}

function ehAcaoBRPos(p: Posicao): boolean {
  return !p.derivativo && p.moeda === "BRL" && (p.classe === "acao" || p.classe === "etf" || p.classe === "fii");
}

// ---------------------------------------------------------------------------
// Stress test
// ---------------------------------------------------------------------------

export type FatorStress = "IBOV" | "USD" | "SP500" | "COMMODITIES" | "CRIPTO";

export const FATORES_STRESS: Array<{ id: FatorStress; rotulo: string }> = [
  { id: "IBOV", rotulo: "Ibovespa" },
  { id: "USD", rotulo: "Dólar" },
  { id: "SP500", rotulo: "S&P 500" },
  { id: "COMMODITIES", rotulo: "Commodities" },
  { id: "CRIPTO", rotulo: "Cripto" },
];

export interface Cenario {
  id: string;
  nome: string;
  descricao: string;
  /** choques em % por fator. */
  choques: Partial<Record<FatorStress, number>>;
}

/** Cenários de referência (magnitudes aproximadas dos episódios históricos). */
export const CENARIOS: Cenario[] = [
  { id: "2008", nome: "Crise de 2008", descricao: "set–out/2008: quebra do Lehman", choques: { IBOV: -40, USD: 35, SP500: -30, COMMODITIES: -30, CRIPTO: -50 } },
  { id: "covid", nome: "Covid-19", descricao: "fev–mar/2020", choques: { IBOV: -30, USD: 15, SP500: -25, COMMODITIES: -20, CRIPTO: -40 } },
  { id: "joesley", nome: "Joesley Day", descricao: "18/05/2017: circuit breaker", choques: { IBOV: -9, USD: 8 } },
  { id: "cambio", nome: "Choque cambial", descricao: "fuga de capital: real derrete", choques: { USD: 20, IBOV: -10 } },
  { id: "commodities", nome: "Queda de commodities", descricao: "safra recorde + demanda fraca", choques: { COMMODITIES: -25, IBOV: -5, USD: 5 } },
  { id: "cripto", nome: "Inverno cripto", descricao: "2022: colapso FTX/Luna", choques: { CRIPTO: -60, SP500: -5 } },
  { id: "rali", nome: "Rali de risco", descricao: "corte de juros + fluxo estrangeiro", choques: { IBOV: 15, USD: -8, SP500: 10, COMMODITIES: 10, CRIPTO: 30 } },
];

export interface ResultadoStressPosicao {
  ticker: string;
  derivativo: boolean;
  plBRL: number;
}

export interface ResultadoStress {
  posicoes: ResultadoStressPosicao[];
  totalBRL: number;
  totalPct: number;
  /** só as posições físicas (sem derivativos): o "antes do hedge". */
  semDerivativosBRL: number;
}

const COMMODITIES = new Set(["BGI", "CCM", "ICF", "SJC"]);

/**
 * Aplica os choques posição a posição:
 *  - ação BR: β × choque do Ibovespa; ativo em US$: (1+S&P)(1+dólar) − 1;
 *  - cripto: choque cripto (em R$: o dólar também entra);
 *  - futuro: nocional × choque do objeto (café/soja ainda × dólar).
 */
export function aplicarStress(
  snapshot: PortfolioSnapshot,
  choques: Partial<Record<FatorStress, number>>,
  b: Record<string, number>,
): ResultadoStress {
  const c = (f: FatorStress) => (choques[f] ?? 0) / 100;
  const out: ResultadoStressPosicao[] = [];
  const choqueAcao = (ticker: string): number => {
    const p = snapshot.posicoes.find((x) => x.ticker === ticker && !x.derivativo);
    if (p?.moeda === "USD") return (1 + c("SP500")) * (1 + c("USD")) - 1;
    return (b[ticker] ?? 1) * c("IBOV");
  };

  for (const p of snapshot.posicoes) {
    const d = p.derivativo;
    let pl = 0;
    if (d) {
      const obj = d.meta.subjacente;
      const choque =
        obj === "USD" ? c("USD")
        : obj === "IBOV" ? c("IBOV")
        : COMMODITIES.has(obj) ? (d.meta.moedaCotacao === "USD" ? (1 + c("COMMODITIES")) * (1 + c("USD")) - 1 : c("COMMODITIES"))
        : 0;
      pl = d.nocionalBRL * choque;
    } else {
      const v = p.valorBRL ?? 0;
      if (p.classe === "tesouro" || p.classe === "bond") pl = 0;
      else if (p.classe === "cripto") pl = v * c("CRIPTO");
      else pl = v * choqueAcao(p.ticker);
    }
    out.push({ ticker: p.ticker, derivativo: d != null, plBRL: pl });
  }

  const totalBRL = out.reduce((s, x) => s + x.plBRL, 0);
  return {
    posicoes: out.sort((a, b2) => a.plBRL - b2.plBRL),
    totalBRL,
    totalPct: snapshot.patrimonioBRL > 0 ? (totalBRL / snapshot.patrimonioBRL) * 100 : 0,
    semDerivativosBRL: out.filter((x) => !x.derivativo).reduce((s, x) => s + x.plBRL, 0),
  };
}
