// Cliente da Edge Function `cotacoes` (supabase/functions/cotacoes/index.ts).
//
// É por aqui que o app consegue preço AO VIVO. O Yahoo não manda header CORS,
// então o navegador não pode chamá-lo direto; a Edge Function faz a ponte
// server-side, devolve a cotação e ainda grava o snapshot oficial no banco.
//
// Nada aqui lança: preço é infraestrutura, e a carteira precisa abrir mesmo com
// o gateway fora do ar (nesse caso o app cai no `prices_latest` do cron).

import type { Bolsa, ClasseAtivo, Moeda, PrecosSnapshot } from "../engine/types";
import { supabase } from "./supabase";

/** Resposta do modo "tickers": preços frescos para mesclar sobre o snapshot. */
export interface CotacoesVivas {
  atualizadoEm: string;
  fonte: string;
  cambio: Record<string, number>;
  acoes: Record<string, number>;
  fechamentoAnterior: Record<string, number>;
  /** tickers que o Yahoo não soube cotar (ficam avaliados a custo). */
  falhas: string[];
}

/** Ativo resolvido pela busca de ticker — alimenta o formulário de compra. */
export interface TickerResolvido {
  ticker: string;
  nome: string;
  moeda: Moeda;
  bolsa: Bolsa;
  tipo: ClasseAtivo;
  preco: number | null;
  fechamentoAnterior: number | null;
}

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("cotacoes", { body: corpo });
  if (error) throw new Error(traduzir(error.message));
  if (data && typeof data === "object" && "erro" in data) {
    throw new Error(String((data as { erro: unknown }).erro));
  }
  return data as T;
}

function traduzir(msg: string): string {
  if (/not found|404/i.test(msg)) {
    return "A função de cotações ainda não foi publicada no Supabase (veja o README).";
  }
  return msg;
}

/**
 * Cotação ao vivo dos tickers informados. Retorna `null` (em vez de lançar) se o
 * gateway não estiver disponível — o chamador segue com o snapshot do cron.
 */
export async function buscarCotacoes(tickers: string[]): Promise<CotacoesVivas | null> {
  const lista = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  if (lista.length === 0) return null;
  try {
    return await chamar<CotacoesVivas>({ tickers: lista });
  } catch (e) {
    console.warn("Cotações ao vivo indisponíveis:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Resolve um ticker: nome, bolsa, moeda, tipo e preço de mercado agora.
 * Usado ao digitar o ticker na compra — é o que pré-preenche o campo de preço.
 */
export async function resolverTicker(termo: string): Promise<TickerResolvido | null> {
  const tk = termo.trim().toUpperCase();
  if (!tk) return null;
  try {
    const r = await chamar<{
      achou: boolean;
      ticker?: string;
      nome?: string;
      moeda?: string;
      bolsa?: string;
      tipo?: string;
      preco?: number;
      fechamentoAnterior?: number | null;
      candidatos?: Array<{ ticker: string; nome: string; moeda: string; bolsa: string; tipo: string }>;
    }>({ buscar: tk });

    if (r.achou) {
      return {
        ticker: r.ticker ?? tk,
        nome: r.nome ?? tk,
        moeda: r.moeda ?? "BRL",
        bolsa: r.bolsa ?? "OUTRA",
        tipo: (r.tipo ?? "acao") as ClasseAtivo,
        preco: typeof r.preco === "number" ? r.preco : null,
        fechamentoAnterior: r.fechamentoAnterior ?? null,
      };
    }

    const c = r.candidatos?.[0];
    if (!c) return null;
    return {
      ticker: c.ticker,
      nome: c.nome,
      moeda: c.moeda,
      bolsa: c.bolsa,
      tipo: c.tipo as ClasseAtivo,
      preco: null,
      fechamentoAnterior: null,
    };
  } catch (e) {
    console.warn("Busca de ticker indisponível:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Semeia `prices_history` (~2 anos) na hora, sem depender da GitHub Action.
 * Só admin — a Edge Function confere o papel no banco. Este lança: é uma ação
 * explícita do admin e o erro precisa aparecer na tela.
 */
export async function semearHistorico(): Promise<{ dias: number; de?: string; ate?: string }> {
  return await chamar<{ dias: number; de?: string; ate?: string }>({ historico: true });
}

/** Mescla as cotações ao vivo por cima do snapshot do banco (ao vivo vence). */
export function mesclarPrecos(base: PrecosSnapshot, vivas: CotacoesVivas | null): PrecosSnapshot {
  if (!vivas) return base;
  return {
    ...base,
    atualizadoEm: vivas.atualizadoEm,
    fonte: vivas.fonte,
    cambio: { ...base.cambio, ...vivas.cambio },
    acoes: { ...base.acoes, ...vivas.acoes },
    fechamentoAnterior: { ...(base.fechamentoAnterior ?? {}), ...vivas.fechamentoAnterior },
  };
}
