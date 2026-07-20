import { describe, expect, it } from "vitest";
import { crescimentoLinear, marcarBond } from "./bonds";
import { parseLedger, replay } from "./ledger";
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

describe("replay do ledger", () => {
  it("começa com o capital inicial imutável", () => {
    const e = replay(config, []);
    expect(e.caixaBRL).toBe(1_000_000);
  });

  it("debita compras e credita vendas com custo médio", () => {
    const txs: Transacao[] = [
      tx({ tipo: "compra", ticker: "PETR4", ts: "2026-01-02T10:00:00Z", qtd: 100, preco: 30 }),
      tx({ tipo: "compra", ticker: "PETR4", ts: "2026-01-03T10:00:00Z", qtd: 100, preco: 40 }),
      tx({ tipo: "venda", ticker: "PETR4", ts: "2026-01-04T10:00:00Z", qtd: 100, preco: 50 }),
    ];
    const e = replay(config, txs);
    // custo médio = (100*30 + 100*40)/200 = 35; vende 100 a 50 -> lucro 15*100 = 1500
    expect(e.plRealizadoBRL).toBeCloseTo(1500, 6);
    const pos = e.posicoes.get("PETR4")!;
    expect(pos.qtd).toBe(100);
    expect(pos.custoTotalBRL).toBeCloseTo(3500, 6); // 100 restantes * 35
    // caixa = 1_000_000 - 3000 - 4000 + 5000 = 998_000
    expect(e.caixaBRL).toBeCloseTo(998_000, 6);
  });

  it("converte compras em moeda estrangeira para BRL pelo fx da operação", () => {
    const txs: Transacao[] = [
      tx({ tipo: "compra", ticker: "AAPL", ts: "2026-02-01T10:00:00Z", qtd: 10, preco: 200, moeda: "USD", fx: 5 }),
    ];
    const e = replay(config, txs);
    // custo BRL = 10 * 200 * 5 = 10_000
    expect(e.caixaBRL).toBeCloseTo(990_000, 6);
    expect(e.posicoes.get("AAPL")!.custoTotalBRL).toBeCloseTo(10_000, 6);
  });

  it("credita proventos e cupons no caixa", () => {
    const txs: Transacao[] = [
      tx({ tipo: "provento", ticker: "PETR4", ts: "2026-03-01T10:00:00Z", valor: 250 } as Partial<Transacao> as any),
    ];
    const e = replay(config, txs);
    expect(e.caixaBRL).toBeCloseTo(1_000_250, 6);
    expect(e.plRealizadoBRL).toBeCloseTo(250, 6);
  });
});

describe("integridade do capital inicial", () => {
  it("parseLedger descarta transações com tipo inválido (ex.: deposito)", () => {
    const jsonl =
      '{"id":"1","ts":"2026-01-02T00:00:00Z","tipo":"deposito","ticker":"CAIXA","valor":500000,"moeda":"BRL","fx":1,"membro":"x"}\n' +
      '{"id":"2","ts":"2026-01-03T00:00:00Z","tipo":"compra","ticker":"PETR4","qtd":10,"preco":30,"moeda":"BRL","fx":1,"membro":"x"}';
    const txs = parseLedger(jsonl);
    expect(txs).toHaveLength(1);
    expect(txs[0].tipo).toBe("compra");
    // O capital permanece 1MM mesmo com a tentativa de "deposito"
    const e = replay(config, txs);
    expect(e.caixaBRL).toBeCloseTo(1_000_000 - 300, 6);
  });
});

describe("marcação a mercado de renda fixa", () => {
  it("crescimento linear interpola o PU entre compra e vencimento", () => {
    // compra 100, vence 120, no meio do caminho -> 110
    const meio = crescimentoLinear(100, 120, "2026-01-01", "2028-01-01", new Date("2027-01-01"));
    expect(meio).toBeCloseTo(110, 4);
    // antes do início -> puCompra; no vencimento -> valorVencimento
    expect(crescimentoLinear(100, 120, "2026-01-01", "2028-01-01", new Date("2025-01-01"))).toBeCloseTo(100, 6);
    expect(crescimentoLinear(100, 120, "2026-01-01", "2028-01-01", new Date("2028-01-01"))).toBeCloseTo(120, 6);
  });

  it("Tesouro usa PU oficial do snapshot quando disponível", () => {
    const ativo: Ativo = {
      id: "TD-IPCA-2035", tipo: "tesouro", ticker: "TD-IPCA-2035", bolsa: "TESOURO", moeda: "BRL",
      nome: "Tesouro IPCA+ 2035",
      bond: { isTesouro: true, tesouroNome: "Tesouro IPCA+ 2035", dataCompra: "2026-01-01", vencimento: "2035-01-01", puCompra: 3000, valorVencimento: 5000 },
    };
    const precos: PrecosSnapshot = { atualizadoEm: null, cambio: {}, acoes: {}, tesouro: { "Tesouro IPCA+ 2035": 3200 } };
    const r = marcarBond(ativo, precos, new Date("2027-01-01"));
    expect(r.marcacao).toBe("mercado");
    expect(r.puAtual).toBe(3200);
  });

  it("Tesouro cai no crescimento linear se não houver PU oficial", () => {
    const ativo: Ativo = {
      id: "TD-IPCA-2035", tipo: "tesouro", ticker: "TD-IPCA-2035", bolsa: "TESOURO", moeda: "BRL",
      nome: "Tesouro IPCA+ 2035",
      bond: { isTesouro: true, tesouroNome: "Inexistente", dataCompra: "2026-01-01", vencimento: "2036-01-01", puCompra: 3000, valorVencimento: 5000 },
    };
    const precos: PrecosSnapshot = { atualizadoEm: null, cambio: {}, acoes: {}, tesouro: {} };
    const r = marcarBond(ativo, precos, new Date("2031-01-01"));
    expect(r.marcacao).toBe("linear");
    expect(r.puAtual).toBeCloseTo(4000, 2); // metade do caminho entre 3000 e 5000
  });
});

describe("computarPortfolio consolidando em BRL", () => {
  it("marca ações com preço oficial × câmbio real e calcula P&L não realizado", () => {
    const txs: Transacao[] = [
      tx({ tipo: "compra", ticker: "PETR4", ts: "2026-01-02T10:00:00Z", qtd: 100, preco: 30 }),
      tx({ tipo: "compra", ticker: "AAPL", ts: "2026-02-02T10:00:00Z", qtd: 10, preco: 200, moeda: "USD", fx: 5 }),
    ];
    const ativos: Ativo[] = [
      { id: "PETR4", tipo: "acao", ticker: "PETR4", bolsa: "B3", moeda: "BRL", nome: "Petrobras PN" },
      { id: "AAPL", tipo: "acao", ticker: "AAPL", bolsa: "NASDAQ", moeda: "USD", nome: "Apple" },
    ];
    const precos: PrecosSnapshot = {
      atualizadoEm: "2026-03-01T00:00:00Z",
      cambio: { USD: 5.5 },
      acoes: { PETR4: 33, AAPL: 210 },
      tesouro: {},
    };
    const snap = computarPortfolio(config, txs, ativos, precos);
    const petr = snap.posicoes.find((p) => p.ticker === "PETR4")!;
    const aapl = snap.posicoes.find((p) => p.ticker === "AAPL")!;
    // PETR4: valor 100*33 = 3300; custo 3000 -> +300
    expect(petr.valorBRL).toBeCloseTo(3300, 4);
    expect(petr.plNaoRealizadoBRL).toBeCloseTo(300, 4);
    // AAPL: valor 10*210*5.5 = 11550; custo 10*200*5 = 10000 -> +1550
    expect(aapl.valorBRL).toBeCloseTo(11_550, 4);
    expect(aapl.plNaoRealizadoBRL).toBeCloseTo(1550, 4);
    expect(snap.cambioUSD).toBe(5.5);
    // patrimônio = caixa + investido
    const caixa = 1_000_000 - 3000 - 10_000;
    expect(snap.patrimonioBRL).toBeCloseTo(caixa + 3300 + 11_550, 3);
  });
});
