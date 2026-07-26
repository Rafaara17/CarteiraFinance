import type { Ativo, PrecosSnapshot } from "./types";

const MS_POR_DIA = 1000 * 60 * 60 * 24;

export interface ResultadoMtM {
  /** valor unitário (PU) atual do título, na moeda do título. */
  puAtual: number;
  /** como o valor foi obtido. */
  marcacao: "mercado" | "linear";
}

/**
 * Marcação a mercado de renda fixa.
 *
 * - Tesouro Direto: usa o PU OFICIAL do snapshot (fonte: Tesouro Transparente).
 *   Procura primeiro pelo slug do catálogo e só depois pelo nome — o nome é a
 *   compatibilidade com os ativos cadastrados antes do catálogo existir.
 *   Se o PU oficial não estiver disponível, cai no crescimento linear.
 * - Demais títulos (CDB/debênture/bond): **crescimento linear** do PU entre a
 *   compra e o vencimento, pela reta que liga puCompra -> valorVencimento.
 *
 *   valor(t) = puCompra + (valorVencimento - puCompra) * (diasDecorridos / diasTotais)
 *
 *   Antes da compra o valor é puCompra; no/após o vencimento é valorVencimento.
 */
export function marcarBond(
  ativo: Ativo,
  precos: PrecosSnapshot,
  hoje: Date = new Date(),
): ResultadoMtM {
  const meta = ativo.bond;
  if (!meta) {
    // não é renda fixa — não deveria chegar aqui
    return { puAtual: 0, marcacao: "linear" };
  }

  if (meta.isTesouro) {
    const puOficial = puDoSnapshot(precos, meta.tesouroSlug) ?? puDoSnapshot(precos, meta.tesouroNome);
    if (puOficial != null) return { puAtual: puOficial, marcacao: "mercado" };
  }

  return { puAtual: crescimentoLinear(meta.puCompra, meta.valorVencimento, meta.dataCompra, meta.vencimento, hoje), marcacao: "linear" };
}

/** PU oficial de uma chave do snapshot, ou null se ausente/inválido. */
function puDoSnapshot(precos: PrecosSnapshot, chave: string | undefined): number | null {
  if (!chave) return null;
  const pu = precos.tesouro?.[chave];
  return typeof pu === "number" && pu > 0 ? pu : null;
}

/** Interpolação linear do PU entre a data de compra e o vencimento. */
export function crescimentoLinear(
  puCompra: number,
  valorVencimento: number,
  dataCompraISO: string,
  vencimentoISO: string,
  hoje: Date = new Date(),
): number {
  const inicio = new Date(dataCompraISO).getTime();
  const fim = new Date(vencimentoISO).getTime();
  const agora = hoje.getTime();

  const diasTotais = (fim - inicio) / MS_POR_DIA;
  if (!isFinite(diasTotais) || diasTotais <= 0) return valorVencimento;

  const diasDecorridos = (agora - inicio) / MS_POR_DIA;
  const frac = clamp(diasDecorridos / diasTotais, 0, 1);
  return puCompra + (valorVencimento - puCompra) * frac;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
