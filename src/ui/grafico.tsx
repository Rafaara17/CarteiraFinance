// Peças compartilhadas dos gráficos: paleta, detecção de tema e tooltip.
//
// A paleta categórica vive nos tokens CSS (--serie-1..8) e é validada para
// daltonismo nos dois temas. Aqui só a lemos, para não haver dois lugares com
// hex divergindo. Recharts precisa de string de cor (não aceita `var(--x)` em
// todos os pontos), então resolvemos os tokens uma vez por tema.

import { useEffect, useState } from "react";
import type { Benchmark } from "../engine/evolucao";

/** true quando o tema escuro está ativo (segue a preferência do sistema). */
export function useTemaEscuro(): boolean {
  const [escuro, setEscuro] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setEscuro(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return escuro;
}

/** Lê um custom property do documento (com fallback para SSR/teste). */
function token(nome: string, padrao: string): string {
  if (typeof window === "undefined") return padrao;
  const v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  return v || padrao;
}

export interface Paleta {
  series: string[];
  carteira: string;
  pos: string;
  neg: string;
  grade: string;
  eixo: string;
  benchmark: Record<Benchmark, string>;
}

/**
 * Resolve a paleta a partir dos tokens. Depende de `escuro` só para recalcular
 * quando o tema muda — os valores em si vêm do CSS.
 */
export function usarPaleta(escuro: boolean): Paleta {
  // `escuro` entra como dependência de recálculo; o valor vem do CSS resolvido.
  void escuro;
  const series = [
    token("--serie-1", "#2a78d6"),
    token("--serie-2", "#eb6834"),
    token("--serie-3", "#1baf7a"),
    token("--serie-4", "#eda100"),
    token("--serie-5", "#e87ba4"),
    token("--serie-6", "#008300"),
    token("--serie-7", "#4a3aa7"),
    token("--serie-8", "#e34948"),
  ];
  return {
    series,
    carteira: series[0],
    pos: token("--pos", "#0e7a45"),
    neg: token("--neg", "#b11d1d"),
    grade: token("--grade", "#e2e6ec"),
    eixo: token("--eixo", "#78859a"),
    // Slots fixos por benchmark: a cor segue a ENTIDADE, então ligar/desligar
    // um benchmark nunca repinta os outros.
    benchmark: {
      IBOV: series[1],
      SP500: series[2],
      CDI: series[3],
      IPCA: series[4],
    },
  };
}

/** Tooltip do Recharts com a cara do app (o `contentStyle` padrão não basta). */
export function Dica({
  active,
  payload,
  label,
  rotulo,
  formatar,
}: {
  active?: boolean;
  payload?: Array<{ name?: string | number; value?: number | string; color?: string }>;
  label?: string | number;
  rotulo: (nome: string) => string;
  formatar: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="dica">
      <div className="dica__data">{fmtDataLonga(String(label ?? ""))}</div>
      {payload.map((p, i) => (
        <div className="dica__linha" key={i}>
          <span style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
            <span className="ponto" style={{ background: p.color }} />
            {rotulo(String(p.name ?? ""))}
          </span>
          <b>{formatar(Number(p.value))}</b>
        </div>
      ))}
    </div>
  );
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-07-24" -> "24/07". */
export function fmtData(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  return m ? `${m[3]}/${m[2]}` : ymd;
}

/** "2026-07-24" -> "24 jul 2026"; "2026-07" -> "jul/26". */
export function fmtDataLonga(ymd: string): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (d) return `${d[3]} ${MESES[Number(d[2]) - 1] ?? d[2]} ${d[1]}`;
  return fmtMes(ymd);
}

/** "2026-07" -> "jul/26". */
export function fmtMes(ym: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  if (!m) return ym;
  return `${MESES[Number(m[2]) - 1] ?? m[2]}/${m[1].slice(2)}`;
}

/** BRL compacto para o eixo Y (ex.: "R$ 1,2 mi"). */
export function fmtBRLCurto(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (abs >= 1_000) return `R$ ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

/** Classe de cor pelo sinal (o valor formatado sempre carrega +/−, nunca cor sozinha). */
export function sinal(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "";
  return v >= 0 ? "pos" : "neg";
}
