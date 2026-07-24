// Classificação automática de ativos de renda variável.
//
// Objetivo: o usuário informa só o ticker; a moeda/bolsa e o tipo (ação/ETF/FII)
// são inferidos automaticamente. Este módulo é TypeScript PURO (sem rede/DOM),
// para ser testável. O wrapper de rede (que consulta a brapi e refina o tipo
// pelo nome do ativo) vive em src/data/precoProvider.ts.

import type { Bolsa, ClasseAtivo, Moeda } from "./types";

/** Padrão de ticker da B3: 4 letras + 1‑2 dígitos + sufixo opcional (ex.: PETR4, HGLG11, SANB11, AAPL34). */
const RE_TICKER_B3 = /^[A-Z]{4}\d{1,2}[A-Z]?$/;

/** Finais de BDR (recibos de ativos estrangeiros negociados na B3). */
const RE_BDR = /(3[2359]|34)$/;

/** Palavras que denunciam FII no nome do ativo. */
const RE_NOME_FII = /(FII|FDO\.?\s*INV\.?\s*IMOB|FUNDO.*IMOB|IMOB)/i;
/** Palavras que denunciam ETF no nome do ativo. */
const RE_NOME_ETF = /(ETF|ISHARES|IT\s*NOW|INDEX|[IÍ]NDICE|TRUST)/i;
/** Palavras que denunciam Unit (cesto de ações) — é ação, não FII. */
const RE_NOME_UNIT = /(UNT|UNIT)/i;

/** Diz se o ticker segue o padrão de código da B3. */
export function ehTickerB3(ticker: string): boolean {
  return RE_TICKER_B3.test(ticker.trim().toUpperCase());
}

/**
 * Infere o tipo (ação/ETF/FII) de um ticker da B3.
 *
 * A ambiguidade real está no final "11", que pode ser FII, ETF ou Unit (ação).
 * Quando o nome do ativo está disponível (vindo da brapi), usamos ele para
 * desambiguar; sem nome, o padrão para "11" é FII (caso mais comum na B3).
 */
export function inferirTipoB3(ticker: string, nome?: string): ClasseAtivo {
  const tk = ticker.trim().toUpperCase();

  // BDRs (ex.: AAPL34) são recibos de ações estrangeiras → tratamos como ação.
  if (RE_BDR.test(tk)) return "acao";

  const termina11 = /11B?$/.test(tk);
  if (termina11) {
    if (nome) {
      if (RE_NOME_UNIT.test(nome)) return "acao";
      if (RE_NOME_ETF.test(nome)) return "etf";
      if (RE_NOME_FII.test(nome)) return "fii";
    }
    return "fii"; // default para "11" sem pista de nome
  }

  // Finais 3/4/5/6/7/8 → ações ordinárias/preferenciais.
  if (/[345678]$/.test(tk)) return "acao";

  return "acao";
}

/**
 * Classificação best‑effort só pelo ticker, sem rede. Serve de fallback quando
 * a consulta à brapi falha (offline, indisponível) e para ativos estrangeiros.
 * - Ticker no padrão B3 → BRL / B3 / tipo inferido.
 * - Caso contrário → assume estrangeiro em USD (ação).
 */
export function classificarPorTicker(ticker: string): {
  moeda: Moeda;
  bolsa: Bolsa;
  tipo: ClasseAtivo;
} {
  const tk = ticker.trim().toUpperCase();
  if (ehTickerB3(tk)) {
    return { moeda: "BRL", bolsa: "B3", tipo: inferirTipoB3(tk) };
  }
  return { moeda: "USD", bolsa: "OUTRA", tipo: "acao" };
}
