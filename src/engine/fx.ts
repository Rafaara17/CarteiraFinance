import type { PrecosSnapshot } from "./types";

/**
 * Câmbio moeda->BRL a partir do snapshot oficial.
 * BRL é sempre 1. Se a moeda não estiver no snapshot, retorna null (sem cotação).
 */
export function cambioParaBRL(precos: PrecosSnapshot, moeda: string): number | null {
  if (moeda === "BRL") return 1;
  const c = precos.cambio?.[moeda];
  return typeof c === "number" && c > 0 ? c : null;
}

/** Converte um valor em `moeda` para BRL usando o câmbio atual. */
export function paraBRL(
  valor: number,
  moeda: string,
  precos: PrecosSnapshot,
): number | null {
  const c = cambioParaBRL(precos, moeda);
  return c == null ? null : valor * c;
}
