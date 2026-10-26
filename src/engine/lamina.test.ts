import { describe, expect, it } from "vitest";
import type { Evolucao, PontoRentabilidade } from "./evolucao";
import { computarLamina, pregoesDoHistorico } from "./lamina";

/** Evolução sintética a partir de níveis diários (1 = início). */
function evolucao(pontos: Array<{ data: string; c: number; cdi?: number; ibov?: number }>): Evolucao {
  const serieRentabilidade: PontoRentabilidade[] = pontos.map((p) => ({
    data: p.data,
    carteira: (p.c - 1) * 100,
    ...(p.cdi != null ? { CDI: (p.cdi - 1) * 100 } : {}),
    ...(p.ibov != null ? { IBOV: (p.ibov - 1) * 100 } : {}),
  }));
  return {
    temDados: true,
    intervalo: { de: pontos[0].data, ate: pontos[pontos.length - 1].data },
    serie: pontos.map((p) => ({ data: p.data, patrimonioBRL: p.c * 1000 })),
    serieRentabilidade,
    retornosMensais: [],
    patrimonioInicio: 1000,
    patrimonioFim: pontos[pontos.length - 1].c * 1000,
    valorizacaoBRL: 0,
    valorizacaoPct: 0,
    benchmarks: {},
  };
}

describe("computarLamina", () => {
  const ev = evolucao([
    { data: "2026-01-02", c: 1.0, cdi: 1.0, ibov: 1.0 },
    { data: "2026-01-30", c: 1.02, cdi: 1.01, ibov: 1.03 },
    { data: "2026-02-27", c: 0.99, cdi: 1.02, ibov: 0.98 },
    { data: "2026-03-10", c: 1.05, cdi: 1.025, ibov: 1.04 },
    { data: "2026-03-11", c: 1.06 }, // hoje: sem nível de índice
  ]);
  const l = computarLamina(ev);

  it("rentabilidade por janela usa o fechamento anterior à janela como base", () => {
    const mes = l.rentabilidades.find((r) => r.janela === "mes")!;
    expect(mes.carteira).toBeCloseTo((1.06 / 0.99 - 1) * 100, 6);
    // índice sem ponto hoje: segue o último nível conhecido
    expect(mes.CDI).toBeCloseTo((1.025 / 1.02 - 1) * 100, 6);

    const inicio = l.rentabilidades.find((r) => r.janela === "inicio")!;
    expect(inicio.carteira).toBeCloseTo(6, 6);
    expect(inicio.pctCDI).toBeCloseTo((6 / 2.5) * 100, 4);
  });

  it("não mostra 12 meses sem um ano de história", () => {
    expect(l.rentabilidades.find((r) => r.janela === "12m")!.carteira).toBeNull();
    expect(l.indicadores.retornoAnualizado).toBeNull();
  });

  it("monta a grade mensal e o acumulado do ano", () => {
    expect(l.grade).toHaveLength(1);
    const g = l.grade[0];
    expect(g.carteira[0]).toBeCloseTo(2, 6);
    expect(g.carteira[1]).toBeCloseTo((0.99 / 1.02 - 1) * 100, 6);
    expect(g.carteira[3]).toBeNull();
    expect(g.totalCarteira).toBeCloseTo(6, 6);
    expect(g.acumulado).toBeCloseTo(6, 6);
  });

  it("drawdown máximo, meses positivos e melhor/pior mês", () => {
    const i = l.indicadores;
    expect(i.drawdownMax).toBeCloseTo((0.99 / 1.02 - 1) * 100, 6);
    expect(i.drawdownPico).toBe("2026-01-30");
    expect(i.drawdownFundo).toBe("2026-02-27");
    expect(i.meses).toBe(3);
    expect(i.mesesPositivos).toBe(2);
    expect(i.mesesNegativos).toBe(1);
    expect(i.piorMes!.mes).toBe("2026-02");
  });

  it("estatísticas diárias pedem um mínimo de pregões", () => {
    expect(l.indicadores.volAnual).toBeNull();
    expect(l.indicadores.sharpe).toBeNull();
  });

  it("beta 1 e correlação 1 quando a carteira replica o IBOV", () => {
    const pts = Array.from({ length: 40 }, (_, k) => {
      const nivel = 1 + 0.01 * Math.sin(k) + k * 0.001;
      const d = new Date(Date.UTC(2026, 0, 1 + k)).toISOString().slice(0, 10);
      return { data: d, c: nivel, ibov: nivel, cdi: 1 + k * 0.0004 };
    });
    const r = computarLamina(evolucao(pts)).indicadores;
    expect(r.beta).toBeCloseTo(1, 6);
    expect(r.correlacao).toBeCloseTo(1, 6);
    expect(r.trackingError).toBeNull();
    expect(r.volAnual).toBeGreaterThan(0);
    expect(r.var95).toBeGreaterThan(0);
  });

  it("carteira só em caixa não ganha Sharpe nem beta", () => {
    const pts = Array.from({ length: 30 }, (_, k) => {
      const d = new Date(Date.UTC(2026, 0, 1 + k)).toISOString().slice(0, 10);
      return { data: d, c: 1, ibov: 1 + 0.01 * Math.sin(k), cdi: 1 + k * 0.0004 };
    });
    const r = computarLamina(evolucao(pts)).indicadores;
    expect(r.sharpe).toBeNull();
    expect(r.sortino).toBeNull();
    expect(r.beta).toBeNull();
    expect(r.volAnual).toBe(0);
  });

  it("filtra dias sem pregão das estatísticas diárias", () => {
    const pts = Array.from({ length: 30 }, (_, k) => {
      const d = new Date(Date.UTC(2026, 0, 1 + k)).toISOString().slice(0, 10);
      return { data: d, c: 1 + (k % 2) * 0.01, ibov: 1, cdi: 1 };
    });
    const pregoes = new Set(pts.filter((_, k) => k < 25).map((p) => p.data));
    expect(computarLamina(evolucao(pts), pregoes).indicadores.dias).toBe(25);
  });

  it("beta ignora pares de dias com lacuna no IBOV", () => {
    // carteira = 2 × IBOV todo dia; um buraco no IBOV não pode distorcer o beta
    let c = 1;
    let ibov = 1;
    const pts = Array.from({ length: 40 }, (_, k) => {
      const d = new Date(Date.UTC(2026, 0, 1 + k)).toISOString().slice(0, 10);
      const r = 0.01 * Math.sin(k * 1.7);
      if (k > 0) {
        c *= 1 + 2 * r;
        ibov *= 1 + r;
      }
      const lacuna = k >= 10 && k < 15;
      return { data: d, c, cdi: 1, ...(lacuna ? {} : { ibov }) };
    });
    const i = computarLamina(evolucao(pts)).indicadores;
    expect(i.dias).toBe(39);
    expect(i.beta).toBeCloseTo(2, 6);
    expect(i.correlacao).toBeCloseTo(1, 6);
  });
});

describe("pregoesDoHistorico", () => {
  it("conta qualquer dia com IBOV, CDI ou cotação, não só IBOV", () => {
    const p = pregoesDoHistorico([
      { data: "2026-01-05", acoes: {}, cambio: {}, indices: { IBOV: 1, CDI: 1 } },
      { data: "2026-01-06", acoes: {}, cambio: {}, indices: { CDI: 1 } },
      { data: "2026-01-07", acoes: { PETR4: 30 }, cambio: {}, indices: {} },
      { data: "2026-01-10", acoes: {}, cambio: { USD: 5 }, indices: {} },
    ]);
    expect([...p]).toEqual(["2026-01-05", "2026-01-06", "2026-01-07"]);
  });
});
