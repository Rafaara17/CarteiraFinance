import { describe, expect, it } from "vitest";
import { classificarPorTicker, ehTickerB3, inferirTipoB3 } from "./classificacao";
import { qtdNaData } from "./ledger";
import type { Transacao } from "./types";

describe("ehTickerB3", () => {
  it("reconhece códigos da B3 e rejeita tickers estrangeiros", () => {
    expect(ehTickerB3("PETR4")).toBe(true);
    expect(ehTickerB3("HGLG11")).toBe(true);
    expect(ehTickerB3("AAPL34")).toBe(true);
    expect(ehTickerB3("petr4")).toBe(true); // normaliza caixa
    expect(ehTickerB3("AAPL")).toBe(false);
    expect(ehTickerB3("MSFT")).toBe(false);
  });
});

describe("inferirTipoB3", () => {
  it("classifica ações ordinárias/preferenciais", () => {
    expect(inferirTipoB3("PETR4")).toBe("acao");
    expect(inferirTipoB3("VALE3")).toBe("acao");
    expect(inferirTipoB3("ITUB4")).toBe("acao");
  });

  it("trata BDRs como ação", () => {
    expect(inferirTipoB3("AAPL34")).toBe("acao");
    expect(inferirTipoB3("MSFT34")).toBe("acao");
  });

  it("usa o nome para desambiguar o final 11 (FII/ETF/Unit)", () => {
    expect(inferirTipoB3("HGLG11", "CSHG LOG FDO INV IMOB")).toBe("fii");
    expect(inferirTipoB3("MXRF11", "MAXI RENDA FII")).toBe("fii");
    expect(inferirTipoB3("BOVA11", "ISHARES IBOVESPA FDO ETF")).toBe("etf");
    expect(inferirTipoB3("SANB11", "SANTANDER BRASIL UNT")).toBe("acao");
  });

  it("trata Unit como ação mesmo quando o nome não diz 'UNT'", () => {
    // Nomes reais que o Yahoo devolve — nenhum tem marca de fundo, então são Units.
    expect(inferirTipoB3("SANB11", "Banco Santander (Brasil) S.A.")).toBe("acao");
    expect(inferirTipoB3("TAEE11", "Transmissora Aliança de Energia Elétrica S.A.")).toBe("acao");
    // ...e os fundos continuam sendo reconhecidos pelos nomes reais.
    expect(inferirTipoB3("HGLG11", "Cshg Logistica - Fundo De Investimento Imobiliario")).toBe("fii");
    expect(inferirTipoB3("BOVA11", "ISHARES IBOVESPA CLASSE DE ÍNDICE - RESPONSABILIDADE LIMITADA")).toBe("etf");
  });

  it("assume FII no final 11 quando não há nome", () => {
    expect(inferirTipoB3("KNRI11")).toBe("fii");
  });
});

describe("classificarPorTicker (fallback sem rede)", () => {
  it("infere BRL/B3 para tickers da B3", () => {
    expect(classificarPorTicker("HGLG11")).toEqual({ moeda: "BRL", bolsa: "B3", tipo: "fii" });
    expect(classificarPorTicker("PETR4")).toEqual({ moeda: "BRL", bolsa: "B3", tipo: "acao" });
  });

  it("assume USD/estrangeiro para tickers fora do padrão B3", () => {
    expect(classificarPorTicker("AAPL")).toEqual({ moeda: "USD", bolsa: "OUTRA", tipo: "acao" });
  });
});

describe("qtdNaData (elegibilidade de proventos)", () => {
  const txs: Transacao[] = [
    { id: "1", ts: "2026-01-02T10:00:00Z", tipo: "compra", membro: "t", ticker: "HGLG11", moeda: "BRL", fx: 1, qtd: 100, preco: 150 },
    { id: "2", ts: "2026-01-05T10:00:00Z", tipo: "venda", membro: "t", ticker: "HGLG11", moeda: "BRL", fx: 1, qtd: 30, preco: 160 },
  ];

  it("é zero antes da primeira compra", () => {
    expect(qtdNaData(txs, "HGLG11", "2026-01-01T23:59:59Z")).toBe(0);
  });

  it("conta a compra até a venda", () => {
    expect(qtdNaData(txs, "HGLG11", "2026-01-03T23:59:59Z")).toBe(100);
  });

  it("desconta a venda depois dela", () => {
    expect(qtdNaData(txs, "HGLG11", "2026-01-06T23:59:59Z")).toBe(70);
  });

  it("ignora outros tickers", () => {
    expect(qtdNaData(txs, "MXRF11", "2026-12-31T23:59:59Z")).toBe(0);
  });
});
