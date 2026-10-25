import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ativoFuturo, lerCotacaoFuturosB3 } from "./derivativos";
import { computarPortfolio } from "./portfolio";
import { aplicarStress, betaDaCarteira, betas, calcularRisco, drawdownMaximo, matrizRetornos } from "./risco";
import type { Ativo, Config, HistoricoPrecos, PrecosSnapshot, Transacao } from "./types";

const config: Config = { nomeLiga: "T", capitalInicial: 1_000_000, moedaBase: "BRL", dataInicio: "2025-01-01" };
const HOJE = new Date("2026-10-26T15:00:00Z");

function tx(t: Partial<Transacao> & { tipo: "compra" | "venda"; ticker: string; qtd: number; preco: number }): Transacao {
  return { id: `${t.ticker}${t.tipo}${t.qtd}`, ts: "2026-10-01T10:00:00Z", membro: "t", moeda: "BRL", fx: 1, ...t } as Transacao;
}

/** Série sintética: IBOV com retornos alternados; ACAO = 1,5 × IBOV; USD independente. */
function historico(n = 300): HistoricoPrecos {
  const out: HistoricoPrecos = [];
  let ibov = 100_000, acao = 10, usd = 5;
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
    const r = (i % 2 === 0 ? 1 : -1) * 0.01 * (1 + (i % 5) / 10);
    const ru = (i % 3 === 0 ? 1 : -0.5) * 0.004;
    if (i > 0) {
      ibov *= 1 + r;
      acao *= 1 + 1.5 * r;
      usd *= 1 + ru;
    }
    out.push({ data: d, acoes: { ACAO3: acao }, cambio: { USD: usd }, indices: { IBOV: ibov } });
  }
  return out;
}

const ACAO: Ativo = { id: "ACAO3", tipo: "acao", ticker: "ACAO3", bolsa: "B3", moeda: "BRL", nome: "Ação" };

describe("fatores e beta", () => {
  it("recupera beta 1,5 da série sintética", () => {
    const b = betas(historico(), ["ACAO3"]);
    expect(b.ACAO3).toBeCloseTo(1.5, 6);
  });

  it("marca fator sem série como sem histórico", () => {
    const m = matrizRetornos(historico(), ["IBOV", "BGI"]);
    expect(m.semHistorico).toEqual(["BGI"]);
    expect(m.retornos.IBOV).toHaveLength(252);
  });
});

describe("VaR", () => {
  const precos: PrecosSnapshot = { atualizadoEm: null, cambio: { BRL: 1, USD: 5 }, acoes: { ACAO3: 10 }, tesouro: {} };
  const txs = [tx({ tipo: "compra", ticker: "ACAO3", qtd: 50_000, preco: 10 })];
  const snap = computarPortfolio(config, txs, [ACAO], precos, HOJE);

  it("VaR histórico = quantil 5% das perdas da posição × retornos", () => {
    const h = historico();
    const r = calcularRisco(snap, h);
    const rets = matrizRetornos(h, ["ACAO3"]).retornos.ACAO3.map((x) => x * 500_000).sort((a, b) => a - b);
    expect(r.dias).toBe(252);
    expect(r.varHist95).toBeGreaterThan(0);
    expect(r.varHist95).toBeLessThanOrEqual(-rets[0] + 1e-6);
    expect(r.es975).toBeGreaterThanOrEqual(r.varHist95);
    expect(r.varParam99).toBeGreaterThan(r.varParam95);
    // uma única posição responde por 100% do VaR
    expect(r.contribuicoes[0].pct).toBeCloseTo(100, 6);
  });

  it("vender mini-índice reduz o VaR (hedge de beta)", () => {
    const win = ativoFuturo("WINZ26", "2026-12-16")!;
    const p2: PrecosSnapshot = { ...precos, acoes: { ...precos.acoes, WINZ26: 200_000, "^BVSP": 198_000 } };
    const hedge = [...txs, tx({ tipo: "venda", ticker: "WINZ26", qtd: 18, preco: 200_000 })];
    const s2 = computarPortfolio(config, hedge, [ACAO, win], p2, HOJE);
    const sem = calcularRisco(s2, historico(), false);
    const com = calcularRisco(s2, historico(), true);
    expect(com.varParam95).toBeLessThan(sem.varParam95 * 0.2);
    const b = betaDaCarteira(s2, { ACAO3: 1.5 });
    expect(b.exposicaoBetaBRL).toBeCloseTo(750_000, 0);
    expect(b.futurosIndiceBRL).toBeCloseTo(-720_000, 0);
  });
});

describe("stress", () => {
  it("aplica beta nas ações; o mini-índice vendido compensa a queda", () => {
    const win = ativoFuturo("WINZ26", "2026-12-16")!;
    const precos: PrecosSnapshot = { atualizadoEm: null, cambio: { BRL: 1 }, acoes: { ACAO3: 10, WINZ26: 200_000 }, tesouro: {} };
    const txs = [
      tx({ tipo: "compra", ticker: "ACAO3", qtd: 100_000, preco: 10 }),
      tx({ tipo: "venda", ticker: "WINZ26", qtd: 25, preco: 200_000 }),
    ];
    const snap = computarPortfolio(config, txs, [ACAO, win], precos, HOJE);
    const r = aplicarStress(snap, { IBOV: -30 }, { ACAO3: 1 });
    expect(r.semDerivativosBRL).toBeCloseTo(-300_000, 6);
    // 25 WIN × 200.000 × 0,20 = R$ 1 mi vendido: ganha 300 mil e zera o choque
    expect(r.totalBRL).toBeCloseTo(0, 6);
    expect(aplicarStress(snap, {}, { ACAO3: 1 }).totalBRL).toBeCloseTo(0, 6);
  });

  it("drawdown máximo", () => {
    expect(drawdownMaximo([100, 120, 90, 130, 117].map((patrimonioBRL) => ({ patrimonioBRL })))).toBeCloseTo(-25, 6);
  });
});

describe("parsers das fontes", () => {
  it("lê a resposta da API de cotações da B3 (só futuros, vencimento oficial)", () => {
    const json = JSON.parse(readFileSync(new URL("./__fixtures__/b3-win.json", import.meta.url), "utf-8"));
    const c = lerCotacaoFuturosB3(json);
    expect(c.length).toBeGreaterThan(0);
    const j27 = c.find((x) => x.codigo === "WINJ27")!;
    expect(j27).toMatchObject({ mercadoria: "WIN", vencimento: "2027-04-14", ajuste: 216693, ultimo: 216415, contratosAbertos: 410 });
    expect(c.every((x) => x.codigo.startsWith("WIN"))).toBe(true);
  });
});
