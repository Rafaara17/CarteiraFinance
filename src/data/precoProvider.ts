// Cotações no MOMENTO DA OPERAÇÃO (comprar/vender).
//
// Antes este módulo batia direto na brapi.dev, que só cobre a B3 e consome cota.
// Agora ele roteia pela Edge Function `cotacoes` (ver src/data/cotacoes.ts), que
// consulta o Yahoo server-side: cobre B3 e bolsas americanas, é grátis e não
// esbarra em CORS.
//
// Exceção: o dólar continua vindo da AwesomeAPI, que é pública, tem CORS
// liberado e devolve a cotação momentânea — não vale gastar uma ida à Edge
// Function para isso. Se ela falhar, caímos no câmbio do snapshot.

import type { Bolsa, ClasseAtivo, Moeda, PrecosSnapshot } from "../engine/types";
import { classificarPorTicker } from "../engine/classificacao";
import { resolverTicker } from "./cotacoes";

/** Cotação real e momentânea do Dólar (USD/BRL). */
export async function cotacaoDolar(): Promise<number> {
  const r = await fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL", { cache: "no-store" });
  if (!r.ok) throw new Error(`Falha ao obter câmbio USD/BRL (HTTP ${r.status})`);
  const j = (await r.json()) as { USDBRL?: { bid?: string } };
  const bid = Number(j.USDBRL?.bid);
  if (!isFinite(bid) || bid <= 0) throw new Error("Cotação do Dólar inválida");
  return bid;
}

/** Dólar com rede de segurança: ao vivo e, se falhar, o do snapshot oficial. */
export async function cotacaoDolarOuSnapshot(precos: PrecosSnapshot): Promise<number> {
  try {
    return await cotacaoDolar();
  } catch {
    const c = precos.cambio?.USD;
    if (typeof c === "number" && c > 0) return c;
    throw new Error("Sem cotação do dólar para converter a operação.");
  }
}

/** Resultado da identificação de um ativo de renda variável. */
export interface AtivoClassificado {
  tipo: ClasseAtivo;
  moeda: Moeda;
  bolsa: Bolsa;
  /** Preço de mercado agora, na moeda do ativo (null se a fonte não respondeu). */
  precoRef: number | null;
  /** Nome longo do ativo, quando a fonte fornece. */
  nome?: string;
}

/**
 * Descobre moeda/bolsa/tipo e o preço atual a partir SÓ do ticker.
 *
 * Nunca lança: se o gateway estiver fora do ar, cai na heurística offline
 * (`classificarPorTicker`) e usa o preço do snapshot, se houver. O usuário
 * sempre consegue registrar a operação.
 */
export async function classificarAtivo(ticker: string, precos: PrecosSnapshot): Promise<AtivoClassificado> {
  const tk = ticker.trim().toUpperCase();
  const resolvido = await resolverTicker(tk);

  if (resolvido) {
    return {
      tipo: resolvido.tipo,
      moeda: resolvido.moeda,
      bolsa: resolvido.bolsa,
      precoRef: resolvido.preco ?? precoDoSnapshot(tk, precos),
      nome: resolvido.nome,
    };
  }

  return { ...classificarPorTicker(tk), precoRef: precoDoSnapshot(tk, precos) };
}

/**
 * Preço oficial para executar uma operação: cota ao vivo pelo gateway e, se ele
 * não responder, usa o último preço oficial do snapshot. `null` = sem preço.
 */
export async function precoDeMercado(ticker: string, precos: PrecosSnapshot): Promise<number | null> {
  const tk = ticker.trim().toUpperCase();
  const resolvido = await resolverTicker(tk);
  if (resolvido?.preco != null && resolvido.preco > 0) return resolvido.preco;
  return precoDoSnapshot(tk, precos);
}

function precoDoSnapshot(ticker: string, precos: PrecosSnapshot): number | null {
  const p = precos.acoes?.[ticker];
  return typeof p === "number" && p > 0 ? p : null;
}
