import { describe, expect, it } from "vitest";
import { computarRanking, diffCarteiras, type CarteiraInfo } from "./comparacao";
import { computarPortfolio } from "./portfolio";
import type { Ativo, Config, PrecosSnapshot, Transacao } from "./types";

const config: Config = {
  nomeLiga: "Teste",
  capitalInicial: 1_000_000,
  moedaBase: "BRL",
  dataInicio: "2026-01-01",
};

const ativos: Ativo[] = [
  { id: "PETR4", tipo: "acao", ticker: "PETR4", bolsa: "B3", moeda: "BRL", nome: "Petrobras PN" },
  { id: "VALE3", tipo: "acao", ticker: "VALE3", bolsa: "B3", moeda: "BRL", nome: "Vale ON" },
];

const precos: PrecosSnapshot = {
  atualizadoEm: "2026-03-01T00:00:00Z",
  cambio: { USD: 5 },
  acoes: { PETR4: 40, VALE3: 40 }, // ambos valem 40 agora
  tesouro: {},
};

function tx(t: Partial<Transacao> & { tipo: Transacao["tipo"]; ticker: string; ts: string }): Transacao {
  return { id: t.ts, membro: "t", moeda: "BRL", fx: 1, ...t } as Transacao;
}

// Liga comprou PETR4 a 30 (agora 40 -> +33%). Minha carteira (fork) discordou e
// trocou por VALE3 a 20 (agora 40 -> valorização maior). Outro membro seguiu igual à liga.
const txsLiga: Transacao[] = [tx({ tipo: "compra", ticker: "PETR4", ts: "2026-01-02T10:00:00Z", qtd: 1000, preco: 30 })];
const txsMinha: Transacao[] = [tx({ tipo: "compra", ticker: "VALE3", ts: "2026-01-02T10:00:00Z", qtd: 1500, preco: 20 })];
const txsOutro: Transacao[] = [tx({ tipo: "compra", ticker: "PETR4", ts: "2026-01-02T10:00:00Z", qtd: 1000, preco: 30 })];

const carteiras: CarteiraInfo[] = [
  { id: "liga", tipo: "liga", dono: null, nome: "Carteira da Liga" },
  { id: "minha", tipo: "pessoal", dono: "u1", nome: "Rafael" },
  { id: "outro", tipo: "pessoal", dono: "u2", nome: "Bia" },
];

const porCarteira = new Map<string, Transacao[]>([
  ["liga", txsLiga],
  ["minha", txsMinha],
  ["outro", txsOutro],
]);

describe("computarRanking", () => {
  it("ordena por retorno total decrescente e marca liga/minha", () => {
    const r = computarRanking(config, ativos, precos, carteiras, porCarteira, "minha");
    expect(r).toHaveLength(3);
    // Minha (VALE3: investiu 30k, agora 60k) rende mais que a liga/outro (PETR4: 30k->40k).
    expect(r[0].carteiraId).toBe("minha");
    expect(r[0].ehMinha).toBe(true);
    expect(r[0].retornoTotalPct).toBeGreaterThan(r[1].retornoTotalPct);
    const liga = r.find((i) => i.ehLiga)!;
    expect(liga.carteiraId).toBe("liga");
    // Liga e "outro" seguiram a mesma estratégia -> mesmo retorno.
    const outro = r.find((i) => i.carteiraId === "outro")!;
    expect(outro.retornoTotalPct).toBeCloseTo(liga.retornoTotalPct, 9);
  });

  it("carteira sem transações tem retorno zero (só o capital inicial)", () => {
    const r = computarRanking(config, ativos, precos, carteiras, new Map(), null);
    for (const item of r) {
      expect(item.patrimonioBRL).toBeCloseTo(1_000_000, 6);
      expect(item.retornoTotalPct).toBeCloseTo(0, 9);
    }
  });
});

describe("diffCarteiras", () => {
  it("delta positivo quando a minha ganha da liga", () => {
    const minha = computarPortfolio(config, txsMinha, ativos, precos);
    const liga = computarPortfolio(config, txsLiga, ativos, precos);
    const d = diffCarteiras(minha, liga);
    expect(d.deltaPct).toBeGreaterThan(0);
    expect(d.deltaPatrimonioBRL).toBeCloseTo(minha.patrimonioBRL - liga.patrimonioBRL, 6);
    expect(d.retornoLigaPct).toBeCloseTo(liga.retornoTotalPct, 9);
  });
});
