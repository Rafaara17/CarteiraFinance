import { describe, expect, it } from "vitest";
import { computarPortfolio } from "./portfolio";
import type { Ativo, Config, PrecosSnapshot, Transacao } from "./types";

const config: Config = {
  nomeLiga: "Teste",
  capitalInicial: 1_000_000,
  moedaBase: "BRL",
  dataInicio: "2026-01-01",
};

function tx(t: Partial<Transacao> & { tipo: Transacao["tipo"]; ticker: string; ts: string }): Transacao {
  return { id: t.ts, membro: "t", moeda: "BRL", fx: 1, ...t } as Transacao;
}

const PETR4: Ativo = { id: "PETR4", tipo: "acao", ticker: "PETR4", bolsa: "B3", moeda: "BRL", nome: "Petrobras PN" };
const AAPL: Ativo = { id: "AAPL", tipo: "acao", ticker: "AAPL", bolsa: "NASDAQ", moeda: "USD", nome: "Apple" };

const SEM_PRECO: PrecosSnapshot = { atualizadoEm: null, cambio: { BRL: 1 }, acoes: {}, tesouro: {} };

describe("posição sem cotação não some do patrimônio", () => {
  const compra = [tx({ tipo: "compra", ticker: "PETR4", ts: "2026-01-02T10:00:00Z", qtd: 100, preco: 30 })];

  it("avalia pelo custo e marca como 'custo'", () => {
    const snap = computarPortfolio(config, compra, [PETR4], SEM_PRECO);
    const p = snap.posicoes[0];
    expect(p.marcacao).toBe("custo");
    expect(p.valorBRL).toBeCloseTo(3000, 6);
    expect(p.plNaoRealizadoBRL).toBeCloseTo(0, 6);
    expect(snap.posicoesSemPreco).toBe(1);
  });

  it("mantém o patrimônio igual ao capital inicial (o dinheiro não sumiu)", () => {
    const snap = computarPortfolio(config, compra, [PETR4], SEM_PRECO);
    // Era o bug central: sem preço o patrimônio caía para o caixa (997.000).
    expect(snap.caixaBRL).toBeCloseTo(997_000, 6);
    expect(snap.patrimonioBRL).toBeCloseTo(1_000_000, 6);
    expect(snap.retornoTotalPct).toBeCloseTo(0, 9);
  });

  it("também vale para ativo em USD sem câmbio no snapshot", () => {
    const txs = [tx({ tipo: "compra", ticker: "AAPL", ts: "2026-02-02T10:00:00Z", qtd: 10, preco: 200, moeda: "USD", fx: 5 })];
    const snap = computarPortfolio(config, txs, [AAPL], { ...SEM_PRECO, acoes: { AAPL: 210 } });
    expect(snap.posicoes[0].marcacao).toBe("custo");
    expect(snap.patrimonioBRL).toBeCloseTo(1_000_000, 6);
  });

  it("a posição a custo entra na alocação (senão os gráficos ficariam vazios)", () => {
    const snap = computarPortfolio(config, compra, [PETR4], SEM_PRECO);
    expect(snap.alocacaoPorClasse).toHaveLength(1);
    expect(snap.alocacaoPorClasse[0]).toMatchObject({ chave: "acao", valorBRL: 3000 });
    expect(snap.valorInvestidoBRL).toBeCloseTo(3000, 6);
  });
});

describe("variação do dia", () => {
  const txs = [
    tx({ tipo: "compra", ticker: "PETR4", ts: "2026-01-02T10:00:00Z", qtd: 100, preco: 30 }),
    tx({ tipo: "compra", ticker: "AAPL", ts: "2026-02-02T10:00:00Z", qtd: 10, preco: 200, moeda: "USD", fx: 5 }),
  ];

  it("usa o fechamento anterior do ativo", () => {
    const precos: PrecosSnapshot = {
      atualizadoEm: "2026-03-01T00:00:00Z",
      cambio: { USD: 5.5 },
      acoes: { PETR4: 33 },
      tesouro: {},
      fechamentoAnterior: { PETR4: 30 },
    };
    const snap = computarPortfolio(config, txs, [PETR4, AAPL], precos);
    const p = snap.posicoes.find((x) => x.ticker === "PETR4")!;
    expect(p.precoAnterior).toBe(30);
    expect(p.variacaoDiaPct).toBeCloseTo(10, 6); // 30 -> 33
    expect(p.variacaoDiaBRL).toBeCloseTo(300, 6); // 100 * (33 - 30)
  });

  it("em ativo estrangeiro, separa efeito de preço do efeito de câmbio", () => {
    const precos: PrecosSnapshot = {
      atualizadoEm: "2026-03-01T00:00:00Z",
      cambio: { USD: 5.5 },
      acoes: { AAPL: 210 },
      tesouro: {},
      fechamentoAnterior: { AAPL: 200, USD: 5.0 },
    };
    const snap = computarPortfolio(config, txs, [PETR4, AAPL], precos);
    const p = snap.posicoes.find((x) => x.ticker === "AAPL")!;
    expect(p.variacaoDiaPct).toBeCloseTo(5, 6); // 200 -> 210, em USD
    // em BRL: 10 * (210*5.5 - 200*5.0) = 10 * (1155 - 1000) = 1550
    expect(p.variacaoDiaBRL).toBeCloseTo(1550, 6);
  });

  it("fica nula quando não há fechamento anterior", () => {
    const precos: PrecosSnapshot = {
      atualizadoEm: null,
      cambio: { USD: 5.5 },
      acoes: { PETR4: 33 },
      tesouro: {},
    };
    const snap = computarPortfolio(config, txs, [PETR4, AAPL], precos);
    const p = snap.posicoes.find((x) => x.ticker === "PETR4")!;
    expect(p.variacaoDiaPct).toBeNull();
    expect(p.variacaoDiaBRL).toBeNull();
    expect(snap.variacaoDiaBRL).toBeCloseTo(0, 9);
  });

  it("soma a variação das posições e calcula o % sobre o patrimônio de ontem", () => {
    const precos: PrecosSnapshot = {
      atualizadoEm: "2026-03-01T00:00:00Z",
      cambio: { USD: 5.5 },
      acoes: { PETR4: 33, AAPL: 210 },
      tesouro: {},
      fechamentoAnterior: { PETR4: 30, AAPL: 200, USD: 5.0 },
    };
    const snap = computarPortfolio(config, txs, [PETR4, AAPL], precos);
    expect(snap.variacaoDiaBRL).toBeCloseTo(300 + 1550, 6);
    const ontem = snap.patrimonioBRL - snap.variacaoDiaBRL;
    expect(snap.variacaoDiaPct).toBeCloseTo((1850 / ontem) * 100, 9);
  });
});

describe("P&L não realizado agregado", () => {
  it("soma o P&L das posições abertas", () => {
    const txs = [
      tx({ tipo: "compra", ticker: "PETR4", ts: "2026-01-02T10:00:00Z", qtd: 100, preco: 30 }),
      tx({ tipo: "compra", ticker: "AAPL", ts: "2026-02-02T10:00:00Z", qtd: 10, preco: 200, moeda: "USD", fx: 5 }),
    ];
    const precos: PrecosSnapshot = {
      atualizadoEm: "2026-03-01T00:00:00Z",
      cambio: { USD: 5.5 },
      acoes: { PETR4: 33, AAPL: 210 },
      tesouro: {},
    };
    const snap = computarPortfolio(config, txs, [PETR4, AAPL], precos);
    // PETR4: 3300 - 3000 = +300; AAPL: 11550 - 10000 = +1550
    expect(snap.plNaoRealizadoBRL).toBeCloseTo(1850, 4);
    expect(snap.posicoesSemPreco).toBe(0);
  });
});
