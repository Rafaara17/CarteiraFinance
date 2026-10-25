// Cotações buscadas DIRETO pelo navegador, sem passar pela Edge Function.
//
// Por que existe: na v1 os futuros dependiam de a Edge Function estar
// republicada (juros) e de um download da B3 que não funciona. As
// fontes abaixo têm CORS liberado — o app as consulta sozinho, então futuros,
// cripto e juros funcionam sem nenhum deploy:
//
//  - cotacao.b3.com.br  : API pública que alimenta o próprio site da B3. Contratos
//                          futuros (com vencimento oficial, ajuste e último negócio)
//                          e índices. Atraso de 15 minutos.
//  - api.bcb.gov.br      : CDI anualizado (SGS 4389).
//  - AwesomeAPI          : cripto em reais (BTC, ETH...), ao vivo, 24/7.
//
// Nada aqui lança: preço é infraestrutura, a tela abre mesmo com a fonte fora.

import {
  FUTUROS,
  lerCotacaoFuturosB3,
  type CodigoMercadoria,
  type ContratoB3,
} from "../engine/derivativos";
import type { Ativo, PrecosSnapshot } from "../engine/types";

const B3 = "https://cotacao.b3.com.br/mds/api/v1";

/** Cache curto em memória: a B3 tem 15 min de atraso, recotar a cada clique é desperdício. */
const CACHE_MS = 45_000;
const cache = new Map<string, { em: number; valor: Promise<unknown> }>();

function memo<T>(chave: string, validade: number, buscar: () => Promise<T>): Promise<T> {
  const c = cache.get(chave);
  if (c && Date.now() - c.em < validade) return c.valor as Promise<T>;
  const valor = buscar().catch((e) => {
    cache.delete(chave); // erro não fica em cache
    throw e;
  });
  cache.set(chave, { em: Date.now(), valor });
  return valor;
}

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------------------
// B3
// ---------------------------------------------------------------------------

/** Todos os contratos futuros de uma mercadoria, com vencimento oficial. [] se a B3 não responder. */
export async function cotarFuturosB3(mercadoria: CodigoMercadoria): Promise<ContratoB3[]> {
  try {
    return await memo(`fut:${mercadoria}`, CACHE_MS, async () =>
      lerCotacaoFuturosB3(await getJson(`${B3}/DerivativeQuotation/${mercadoria}`)),
    );
  } catch (e) {
    console.warn(`B3 indisponível para ${mercadoria}:`, e instanceof Error ? e.message : e);
    return [];
  }
}

export interface InstrumentoB3 {
  simbolo: string;
  preco: number;
  /** fechamento anterior, derivado da variação do dia. */
  anterior: number | null;
  descricao: string;
  mercado: string;
}

/** Último preço de um instrumento (ação, índice). null se não negociou/não existe. */
export async function cotarInstrumentoB3(simbolo: string): Promise<InstrumentoB3 | null> {
  const tk = simbolo.trim().toUpperCase();
  if (!tk) return null;
  try {
    return await memo(`ins:${tk}`, CACHE_MS, async () => {
      const j = (await getJson(`${B3}/InstrumentQuotation/${encodeURIComponent(tk)}`)) as any;
      const s = j?.Trad?.[0]?.scty;
      const preco = Number(s?.SctyQtn?.curPrc);
      if (!(preco > 0)) return null;
      const varPct = Number(s?.SctyQtn?.prcFlcn);
      return {
        simbolo: String(s.symb ?? tk),
        preco,
        anterior: isFinite(varPct) ? preco / (1 + varPct / 100) : null,
        descricao: String(s.desc ?? ""),
        mercado: String(s.mkt?.nm ?? ""),
      };
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Juros (BCB)
// ---------------------------------------------------------------------------

/** CDI anualizado (decimal), do Banco Central. null se indisponível. */
export async function cdiAoVivo(): Promise<number | null> {
  try {
    return await memo("cdi", 6 * 3600_000, async () => {
      const j = (await getJson(
        "https://api.bcb.gov.br/dados/serie/bcdata.sgs.4389/dados/ultimos/1?formato=json",
      )) as Array<{ valor?: string }>;
      const v = Number(j?.[0]?.valor);
      if (!(v > 0)) throw new Error("CDI inválido");
      return v / 100;
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cripto (AwesomeAPI)
// ---------------------------------------------------------------------------

export interface Cripto {
  simbolo: string;
  nome: string;
}

/** Criptoativos negociáveis (pares em reais da AwesomeAPI). */
export const CRIPTOS: Cripto[] = [
  { simbolo: "BTC", nome: "Bitcoin" },
  { simbolo: "ETH", nome: "Ethereum" },
  { simbolo: "SOL", nome: "Solana" },
  { simbolo: "XRP", nome: "XRP" },
  { simbolo: "LTC", nome: "Litecoin" },
];

export interface CotacaoCripto {
  preco: number;
  anterior: number | null;
  /** variação em 24 h (%). */
  variacaoPct: number | null;
  em: string;
}

/** Cotação em R$ dos criptoativos pedidos. {} se a fonte não responder. */
export async function cotarCripto(simbolos: string[]): Promise<Record<string, CotacaoCripto>> {
  const lista = [...new Set(simbolos.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();
  if (lista.length === 0) return {};
  try {
    return await memo(`cripto:${lista.join(",")}`, 30_000, async () => {
      const pares = lista.map((s) => `${s}-BRL`).join(",");
      const j = (await getJson(`https://economia.awesomeapi.com.br/json/last/${pares}`)) as Record<string, any>;
      const out: Record<string, CotacaoCripto> = {};
      for (const s of lista) {
        const q = j?.[`${s}BRL`];
        const preco = Number(q?.bid);
        if (!(preco > 0)) continue;
        const varBid = Number(q?.varBid);
        const pct = Number(q?.pctChange);
        out[s] = {
          preco,
          anterior: isFinite(varBid) ? preco - varBid : null,
          variacaoPct: isFinite(pct) ? pct : null,
          em: String(q?.create_date ?? ""),
        };
      }
      return out;
    });
  } catch (e) {
    console.warn("Cripto indisponível:", e instanceof Error ? e.message : e);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Pacote para a carteira
// ---------------------------------------------------------------------------

/** O que as fontes diretas acrescentam ao snapshot de preços. */
export type PrecosDiretos = Pick<PrecosSnapshot, "acoes" | "fechamentoAnterior" | "ajustes" | "taxas">;

/**
 * Cotações diretas de tudo que a carteira precisa e o Yahoo/Edge Function não
 * cobre: futuros (por mercadoria em carteira), o Ibovespa (referência do
 * mini-índice), cripto e o CDI.
 *
 * `extrasMercadorias` força buscar mercadorias que não estão em carteira (tela de
 * operar, mesa de risco).
 */
export async function precosDiretos(
  ativos: Ativo[],
  extrasMercadorias: CodigoMercadoria[] = [],
): Promise<PrecosDiretos> {
  const mercadorias = new Set<CodigoMercadoria>(extrasMercadorias);
  const criptos: string[] = [];
  for (const a of ativos) {
    const d = a.derivativo;
    if (a.tipo === "cripto") criptos.push(a.ticker);
    else if (d?.mercadoria && d.mercadoria in FUTUROS) mercadorias.add(d.mercadoria as CodigoMercadoria);
  }
  const temDerivativo = mercadorias.size > 0;

  const [contratos, ibov, cripto, cdi] = await Promise.all([
    Promise.all([...mercadorias].map((m) => cotarFuturosB3(m))),
    temDerivativo ? cotarInstrumentoB3("IBOV") : Promise.resolve(null),
    cotarCripto(criptos),
    temDerivativo ? cdiAoVivo() : Promise.resolve(null),
  ]);

  const hoje = new Date().toISOString().slice(0, 10);
  const out: Required<PrecosDiretos> = { acoes: {}, fechamentoAnterior: {}, ajustes: {}, taxas: {} };
  for (const c of contratos.flat()) {
    if (c.ultimo != null) out.acoes[c.codigo] = c.ultimo;
    if (c.ajuste != null) out.ajustes[c.codigo] = { ajuste: c.ajuste, data: hoje };
  }
  if (ibov) {
    out.acoes["^BVSP"] = ibov.preco;
    if (ibov.anterior) out.fechamentoAnterior["^BVSP"] = ibov.anterior;
  }
  for (const [s, q] of Object.entries(cripto)) {
    out.acoes[s] = q.preco;
    if (q.anterior) out.fechamentoAnterior[s] = q.anterior;
  }
  if (cdi != null) out.taxas.CDI = cdi;
  return out;
}

/**
 * Mescla as cotações diretas no snapshot. O ajuste da B3 é do pregão ANTERIOR:
 * guarda como spot de referência o fechamento anterior do objeto, para o engine
 * poder movê-lo pelo spot de agora quando o contrato não negociou hoje.
 */
export function mesclarDiretos(base: PrecosSnapshot, d: PrecosDiretos | null): PrecosSnapshot {
  if (!d) return base;
  const fechamentoAnterior = { ...(base.fechamentoAnterior ?? {}), ...(d.fechamentoAnterior ?? {}) };
  const ajustes = { ...(base.ajustes ?? {}) };
  for (const [codigo, aj] of Object.entries(d.ajustes ?? {})) {
    const spec = FUTUROS[codigo.slice(0, 3) as CodigoMercadoria];
    let spotRef: number | undefined;
    if (spec?.referencia === "USD") {
      const u = fechamentoAnterior.USD;
      spotRef = u ? u * 1000 : undefined;
    } else if (spec?.referencia) {
      const r = fechamentoAnterior[spec.referencia];
      spotRef = r ? r * (spec.conversao ?? 1) : undefined;
    }
    ajustes[codigo] = { ...aj, spotRef };
  }
  return {
    ...base,
    acoes: { ...base.acoes, ...(d.acoes ?? {}) },
    fechamentoAnterior,
    ajustes,
    taxas: { ...(base.taxas ?? {}), ...(d.taxas ?? {}) },
  };
}
