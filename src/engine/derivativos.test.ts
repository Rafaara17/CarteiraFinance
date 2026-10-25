import { describe, expect, it } from "vitest";
import {
  ativoFuturo,
  diasUteisEntre,
  lerCodigoFuturo,
  precoFuturo,
  proximosVencimentos,
  FUTUROS,
} from "./derivativos";
import { computarPortfolio } from "./portfolio";
import type { Config, PrecosSnapshot, Transacao } from "./types";

const config: Config = { nomeLiga: "T", capitalInicial: 1_000_000, moedaBase: "BRL", dataInicio: "2026-01-01" };
const HOJE = new Date("2026-10-26T15:00:00Z"); // segunda-feira

function tx(t: Partial<Transacao> & { tipo: "compra" | "venda"; ticker: string; ts: string; qtd: number; preco: number }): Transacao {
  return { id: t.ts, membro: "t", moeda: "BRL", fx: 1, ...t } as Transacao;
}

function precos(extra: Partial<PrecosSnapshot> = {}): PrecosSnapshot {
  return {
    atualizadoEm: null,
    cambio: { BRL: 1, USD: 5.5 },
    acoes: { PETR4: 40 },
    tesouro: {},
    taxas: { CDI: 0.14, USD: 0.04 },
    ...extra,
  };
}

describe("calendário e códigos", () => {
  it("lê o código B3 e calcula o vencimento do dólar (1º dia útil)", () => {
    const v = lerCodigoFuturo("WDOX26");
    expect(v).toMatchObject({ mercadoria: "WDO", ano: 2026, mes: 11, vencimento: "2026-11-02" });
    expect(lerCodigoFuturo("PETR4")).toBeNull();
  });

  it("próximos vencimentos pela regra (reserva quando a B3 não responde)", () => {
    const v = proximosVencimentos("ICF", HOJE, 2);
    expect(v.map((x) => x.codigo)).toEqual(["ICFZ26", "ICFH27"]);
  });

  it("conta dias úteis pulando fim de semana", () => {
    expect(diasUteisEntre(new Date("2026-10-23T00:00:00Z"), new Date("2026-10-26T00:00:00Z"))).toBe(1);
  });
});

describe("preço do futuro", () => {
  it("dólar teórico fica acima do spot quando o CDI supera o juro americano", () => {
    const p = precoFuturo("WDOZ26", FUTUROS.WDO, "2026-12-01", precos(), HOJE)!;
    expect(p.origem).toBe("teorico");
    expect(p.preco).toBeGreaterThan(5500);
    expect(p.preco).toBeLessThan(5600);
  });

  it("ajuste B3 recente vence o teórico e acompanha o spot no intradiário", () => {
    const p = precoFuturo("WDOZ26", FUTUROS.WDO, "2026-12-01",
      precos({ ajustes: { WDOZ26: { ajuste: 5600, data: "2026-10-23", spotRef: 5450 } } }), HOJE)!;
    expect(p.origem).toBe("ajuste");
    expect(p.preco).toBeCloseTo(5600 * (5500 / 5450), 6);
  });

  it("boi gordo sem ajuste não tem preço; com ajuste velho ainda vale", () => {
    expect(precoFuturo("BGIX26", FUTUROS.BGI, "2026-11-30", precos(), HOJE)).toBeNull();
    const p = precoFuturo("BGIX26", FUTUROS.BGI, "2026-11-30",
      precos({ ajustes: { BGIX26: { ajuste: 310, data: "2026-09-01" } } }), HOJE)!;
    expect(p.preco).toBe(310);
  });
});

describe("contabilidade de futuros", () => {
  const wdo = ativoFuturo("WDOZ26")!;
  const p = (preco: number) => precos({ ajustes: { WDOZ26: { ajuste: preco, data: "2026-10-26" } } });

  it("abrir não mexe no caixa, mas exige margem", () => {
    const txs = [tx({ tipo: "compra", ticker: "WDOZ26", ts: "2026-10-26T10:00:00Z", qtd: 2, preco: 5500 })];
    const s = computarPortfolio(config, txs, [wdo], p(5500), HOJE);
    expect(s.caixaBRL).toBe(1_000_000);
    expect(s.patrimonioBRL).toBeCloseTo(1_000_000, 6);
    expect(s.margemRequeridaBRL).toBeCloseTo(2 * 5500 * 10 * 0.15, 6);
    expect(s.caixaLivreBRL).toBeCloseTo(1_000_000 - 16_500, 6);
    expect(s.alocacaoPorClasse).toHaveLength(0);
  });

  it("P&L acompanha o preço e é realizado no caixa ao zerar", () => {
    const abrir = tx({ tipo: "compra", ticker: "WDOZ26", ts: "2026-10-26T10:00:00Z", qtd: 2, preco: 5500 });
    const aberto = computarPortfolio(config, [abrir], [wdo], p(5600), HOJE);
    expect(aberto.patrimonioBRL).toBeCloseTo(1_000_000 + 100 * 2 * 10, 6);
    const zerar = tx({ tipo: "venda", ticker: "WDOZ26", ts: "2026-10-26T12:00:00Z", qtd: 2, preco: 5600 });
    const fechado = computarPortfolio(config, [abrir, zerar], [wdo], p(5700), HOJE);
    expect(fechado.posicoes).toHaveLength(0);
    expect(fechado.caixaBRL).toBeCloseTo(1_002_000, 6);
    expect(fechado.plRealizadoBRL).toBeCloseTo(2_000, 6);
  });

  it("venda a descoberto ganha com a queda e a ordem maior inverte o lado", () => {
    const vender = tx({ tipo: "venda", ticker: "WDOZ26", ts: "2026-10-26T10:00:00Z", qtd: 1, preco: 5500 });
    const s = computarPortfolio(config, [vender], [wdo], p(5400), HOJE);
    expect(s.posicoes[0].derivativo?.lado).toBe("vendido");
    expect(s.patrimonioBRL).toBeCloseTo(1_001_000, 6);
    const virar = tx({ tipo: "compra", ticker: "WDOZ26", ts: "2026-10-26T11:00:00Z", qtd: 3, preco: 5400 });
    const s2 = computarPortfolio(config, [vender, virar], [wdo], p(5400), HOJE);
    expect(s2.caixaBRL).toBeCloseTo(1_001_000, 6);
    expect(s2.posicoes[0].qtd).toBe(2);
    expect(s2.posicoes[0].derivativo?.precoMedio).toBe(5400);
  });
});

describe("fontes reais da B3", () => {
  it("último negócio da B3 vence o ajuste e o teórico", () => {
    const p = precoFuturo("WDOZ26", FUTUROS.WDO, "2026-12-01",
      precos({ acoes: { WDOZ26: 5555 }, ajustes: { WDOZ26: { ajuste: 5600, data: "2026-10-26" } } }), HOJE)!;
    expect(p).toMatchObject({ preco: 5555, origem: "b3" });
  });

  it("mini-índice teórico = IBOV × (1+CDI)^(du/252)", () => {
    const p = precoFuturo("WINZ26", FUTUROS.WIN, "2026-12-16", precos({ acoes: { "^BVSP": 200_000 } }), HOJE)!;
    expect(p.origem).toBe("teorico");
    expect(p.preco).toBeGreaterThan(200_000);
    expect(p.preco).toBeLessThan(205_000);
  });

  it("cripto entra como ativo comum, fracionado, em reais", () => {
    const btc = { id: "BTC", tipo: "cripto" as const, ticker: "BTC", bolsa: "CRIPTO", moeda: "BRL", nome: "Bitcoin" };
    const txs = [tx({ tipo: "compra", ticker: "BTC", ts: "2026-10-26T10:00:00Z", qtd: 0.05, preco: 400_000 })];
    const s = computarPortfolio(config, txs, [btc], precos({ acoes: { BTC: 440_000 } }), HOJE);
    expect(s.caixaBRL).toBeCloseTo(980_000, 6);
    expect(s.posicoes[0].valorBRL).toBeCloseTo(22_000, 6);
    expect(s.alocacaoPorClasse[0].chave).toBe("cripto");
  });
});
