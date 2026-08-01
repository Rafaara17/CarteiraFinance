import { describe, expect, it } from "vitest";
import { computarEvolucao, intervaloDoPreset, rentabilidadeDaSerie } from "./evolucao";
import type { Ativo, Config, HistoricoPrecos, Transacao } from "./types";

const config: Config = {
  nomeLiga: "Teste",
  capitalInicial: 2000,
  moedaBase: "BRL",
  dataInicio: "2026-01-01",
};

const AAA: Ativo = { id: "AAA", tipo: "acao", ticker: "AAA", bolsa: "B3", moeda: "BRL", nome: "Ação AAA" };

function compra(ts: string, ticker: string, qtd: number, preco: number, fx = 1, moeda = "BRL"): Transacao {
  return { id: ts, ts, tipo: "compra", membro: "t", ticker, qtd, preco, moeda, fx };
}

describe("computarEvolucao", () => {
  // Compra 10 AAA a 100 (custo 1000) => caixa 1000, 10 ações em carteira.
  const txs = [compra("2026-01-05T13:00:00Z", "AAA", 10, 100)];

  const historico: HistoricoPrecos = [
    { data: "2026-01-05", acoes: { AAA: 100 }, cambio: {}, indices: { IBOV: 100, CDI: 100 } },
    { data: "2026-01-06", acoes: { AAA: 110 }, cambio: {}, indices: { IBOV: 102, CDI: 100.1 } },
    { data: "2026-01-07", acoes: { AAA: 120 }, cambio: {}, indices: { IBOV: 105, CDI: 100.2 } },
  ];

  it("reconstrói a curva de patrimônio (caixa + posições marcadas ao preço do dia)", () => {
    const ev = computarEvolucao(config, txs, [AAA], historico, { de: "2026-01-05", ate: "2026-01-07" });
    expect(ev.temDados).toBe(true);
    expect(ev.serie.map((p) => p.patrimonioBRL)).toEqual([2000, 2100, 2200]);
    expect(ev.patrimonioInicio).toBe(2000);
    expect(ev.patrimonioFim).toBe(2200);
    expect(ev.valorizacaoBRL).toBe(200);
    expect(ev.valorizacaoPct).toBeCloseTo(10, 6);
  });

  it("calcula a rentabilidade dos benchmarks no período (rebase à base do período)", () => {
    const ev = computarEvolucao(config, txs, [AAA], historico, { de: "2026-01-05", ate: "2026-01-07" });
    expect(ev.benchmarks.IBOV).toBeCloseTo(5, 6); // 105/100 - 1
    expect(ev.benchmarks.CDI).toBeCloseTo(0.2, 6); // 100.2/100 - 1
    const ultimo = ev.serieRentabilidade[ev.serieRentabilidade.length - 1];
    expect(ultimo.carteira).toBeCloseTo(10, 6);
    expect(ultimo.IBOV).toBeCloseTo(5, 6);
  });

  it("faz forward-fill do último preço quando falta cotação num dia", () => {
    const comBuraco: HistoricoPrecos = [
      ...historico,
      { data: "2026-01-08", acoes: {}, cambio: {}, indices: { IBOV: 106 } }, // sem preço de AAA
    ];
    const ev = computarEvolucao(config, txs, [AAA], comBuraco, { de: "2026-01-05", ate: "2026-01-08" });
    // 2026-01-08 reaproveita o último preço (120) => patrimônio 2200.
    expect(ev.serie[ev.serie.length - 1]).toEqual({ data: "2026-01-08", patrimonioBRL: 2200 });
  });

  it("antes da compra o patrimônio é só o caixa (capital inicial)", () => {
    const comAntes: HistoricoPrecos = [
      { data: "2026-01-02", acoes: {}, cambio: {}, indices: {} },
      ...historico,
    ];
    const ev = computarEvolucao(config, txs, [AAA], comAntes, { de: "2026-01-02", ate: "2026-01-07" });
    expect(ev.serie[0]).toEqual({ data: "2026-01-02", patrimonioBRL: 2000 });
  });

  it("agrupa retornos mês a mês", () => {
    const doisMeses: HistoricoPrecos = [
      { data: "2026-01-31", acoes: { AAA: 100 }, cambio: {}, indices: {} },
      { data: "2026-02-28", acoes: { AAA: 150 }, cambio: {}, indices: {} },
    ];
    // caixa 1000 + 10*100 = 2000 (jan); 1000 + 10*150 = 2500 (fev) => +25%
    const ev = computarEvolucao(config, txs, [AAA], doisMeses, { de: "2026-01-01", ate: "2026-02-28" });
    expect(ev.retornosMensais).toHaveLength(2);
    expect(ev.retornosMensais[0]).toEqual({ mes: "2026-01", retornoPct: 0 }); // base = abertura
    expect(ev.retornosMensais[1].mes).toBe("2026-02");
    expect(ev.retornosMensais[1].retornoPct).toBeCloseTo(25, 6);
  });

  it("retorna temDados=false quando não há histórico no período", () => {
    const ev = computarEvolucao(config, txs, [AAA], [], { de: "2026-01-05", ate: "2026-01-07" });
    expect(ev.temDados).toBe(false);
    expect(ev.serie).toEqual([]);
  });

  it("marca renda fixa por crescimento linear na data histórica", () => {
    const bond: Ativo = {
      id: "CDB1",
      tipo: "bond",
      ticker: "CDB1",
      bolsa: "OUTRA",
      moeda: "BRL",
      nome: "CDB genérico",
      bond: {
        dataCompra: "2026-01-01",
        vencimento: "2026-12-31", // ~364 dias
        puCompra: 1000,
        valorVencimento: 1120,
        isTesouro: false,
      },
    };
    const txsBond = [compra("2026-01-01T12:00:00Z", "CDB1", 1, 1000)];
    // No dia 2026-07-01 (~181 dias), o PU linear está entre 1000 e 1120.
    const histBond: HistoricoPrecos = [{ data: "2026-07-01", acoes: {}, cambio: {}, indices: {} }];
    const ev = computarEvolucao(config, txsBond, [bond], histBond, { de: "2026-07-01", ate: "2026-07-01" });
    const pu = ev.serie[0].patrimonioBRL - 1000; // patrimônio = caixa(1000) + valor do título
    expect(pu).toBeGreaterThan(1000);
    expect(pu).toBeLessThan(1120);
  });
});

describe("rentabilidadeDaSerie", () => {
  const txs = [compra("2026-01-05T13:00:00Z", "AAA", 10, 100)];
  const historico: HistoricoPrecos = [
    { data: "2026-01-05", acoes: { AAA: 100 }, cambio: {}, indices: {} },
    { data: "2026-01-06", acoes: { AAA: 110 }, cambio: {}, indices: {} },
    { data: "2026-01-07", acoes: { AAA: 120 }, cambio: {}, indices: {} },
  ];

  it("dá o mesmo resultado que computarEvolucao para o mesmo intervalo", () => {
    // É a garantia que permite reaproveitar uma série já calculada no gráfico
    // de comparação em vez de replayar o ledger de cada carteira de novo.
    const intervalo = { de: "2026-01-06", ate: "2026-01-07" };
    const completa = computarEvolucao(config, txs, [AAA], historico, {
      de: "2026-01-05",
      ate: "2026-01-07",
    });
    const recorte = computarEvolucao(config, txs, [AAA], historico, intervalo);

    expect(rentabilidadeDaSerie(completa.serie, intervalo)).toEqual(
      recorte.serieRentabilidade.map((p) => ({ data: p.data, pct: p.carteira })),
    );
  });

  it("rebaseia a 0% no primeiro ponto dentro do intervalo", () => {
    const r = rentabilidadeDaSerie(
      [
        { data: "2026-01-05", patrimonioBRL: 1000 },
        { data: "2026-01-06", patrimonioBRL: 1100 },
      ],
      { de: "2026-01-05", ate: "2026-01-06" },
    );
    expect(r[0].pct).toBe(0);
    expect(r[1].pct).toBeCloseTo(10, 9);
  });

  it("intervalo sem pontos devolve vazio", () => {
    const serie = [{ data: "2026-01-05", patrimonioBRL: 1000 }];
    expect(rentabilidadeDaSerie(serie, { de: "2026-02-01", ate: "2026-02-28" })).toEqual([]);
  });
});

describe("intervaloDoPreset", () => {
  const hoje = new Date("2026-07-24T15:00:00Z");

  it("'mes' começa no dia 1 do mês corrente", () => {
    expect(intervaloDoPreset("mes", hoje, "2026-01-01")).toEqual({ de: "2026-07-01", ate: "2026-07-24" });
  });

  it("'tudo' começa na data de início da liga", () => {
    expect(intervaloDoPreset("tudo", hoje, "2026-01-01")).toEqual({ de: "2026-01-01", ate: "2026-07-24" });
  });

  it("'3m' e '12m' recuam meses a partir de hoje", () => {
    expect(intervaloDoPreset("3m", hoje, "2026-01-01").de).toBe("2026-04-24");
    expect(intervaloDoPreset("12m", hoje, "2026-01-01").de).toBe("2025-07-24");
  });
});
