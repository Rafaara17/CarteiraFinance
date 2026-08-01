import { describe, expect, it } from "vitest";
import {
  computarRankingSemanal,
  domingoDaSemana,
  retornosSemanais,
  segundaDaSemana,
  type EntradaCarteira,
} from "./semanal";
import type { Ativo, Config, HistoricoPrecos, PrecosSnapshot, Transacao } from "./types";

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

function tx(t: Partial<Transacao> & { tipo: Transacao["tipo"]; ticker: string; ts: string }): Transacao {
  return { id: t.ts, membro: "t", moeda: "BRL", fx: 1, ...t } as Transacao;
}

// Liga: 10.000 PETR4 a 10 (100k investido). Minha: 10.000 VALE3 a 10.
const txsLiga: Transacao[] = [tx({ tipo: "compra", ticker: "PETR4", ts: "2026-01-02T10:00:00Z", qtd: 10_000, preco: 10 })];
const txsMinha: Transacao[] = [tx({ tipo: "compra", ticker: "VALE3", ts: "2026-01-02T10:00:00Z", qtd: 10_000, preco: 10 })];

/**
 * Duas semanas de pregão. Semana 1 fecha em 11/01 (domingo), semana 2 em 18/01.
 *
 * VALE3 dispara na semana 1 e para; PETR4 só reage na semana 2, sem alcançar o
 * acumulado. Assim a liga ganha a SEMANA enquanto a minha lidera o ACUMULADO —
 * é justamente o caso que os dois critérios precisam distinguir.
 */
const historico: HistoricoPrecos = [
  { data: "2026-01-05", acoes: { PETR4: 10, VALE3: 10 }, cambio: {}, indices: {} },
  { data: "2026-01-09", acoes: { PETR4: 10, VALE3: 15 }, cambio: {}, indices: {} }, // sexta da semana 1
  { data: "2026-01-12", acoes: { PETR4: 11, VALE3: 15 }, cambio: {}, indices: {} },
  { data: "2026-01-16", acoes: { PETR4: 13, VALE3: 15 }, cambio: {}, indices: {} }, // sexta da semana 2
];

const precos: PrecosSnapshot = {
  atualizadoEm: "2026-01-16T21:00:00Z",
  cambio: {},
  acoes: { PETR4: 13, VALE3: 15 },
  tesouro: {},
};

const entradas: EntradaCarteira[] = [
  {
    info: { id: "liga", tipo: "liga", dono: null, nome: "Carteira da Liga" },
    criadaEm: "2026-01-01T00:00:00.000Z",
    transacoes: txsLiga,
  },
  {
    info: { id: "minha", tipo: "pessoal", dono: "u1", nome: "Rafael" },
    criadaEm: "2026-01-01T00:00:00.000Z",
    transacoes: txsMinha,
  },
];

describe("domingoDaSemana", () => {
  it("leva qualquer dia para o domingo que fecha a semana", () => {
    expect(domingoDaSemana("2026-01-05")).toBe("2026-01-11"); // segunda
    expect(domingoDaSemana("2026-01-09")).toBe("2026-01-11"); // sexta
    expect(domingoDaSemana("2026-01-11")).toBe("2026-01-11"); // o próprio domingo
  });

  it("põe a sexta e o domingo seguinte no mesmo balde", () => {
    // prices_history nunca tem linha de domingo: é isso que faz o agrupamento
    // fechar a semana no último pregão.
    expect(domingoDaSemana("2026-01-16")).toBe(domingoDaSemana("2026-01-18"));
  });

  it("segundaDaSemana volta para a abertura", () => {
    expect(segundaDaSemana("2026-01-11")).toBe("2026-01-05");
  });
});

describe("retornosSemanais", () => {
  it("encadeia o retorno a partir do fechamento da semana anterior", () => {
    const r = retornosSemanais([
      { data: "2026-01-05", patrimonioBRL: 1_000_000 },
      { data: "2026-01-09", patrimonioBRL: 1_100_000 },
      { data: "2026-01-16", patrimonioBRL: 1_210_000 },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0].semana).toBe("2026-01-11");
    expect(r[0].retornoPct).toBeCloseTo(10, 9);
    // Semana 2 rende sobre o fechamento da semana 1, não sobre a abertura.
    expect(r[1].semana).toBe("2026-01-18");
    expect(r[1].retornoPct).toBeCloseTo(10, 9);
  });

  it("série vazia não gera semanas", () => {
    expect(retornosSemanais([])).toEqual([]);
  });
});

describe("computarRankingSemanal", () => {
  const hoje = new Date("2026-01-16T21:00:00.000Z"); // sexta da semana 2

  it("ordena pelo retorno da semana, não pelo acumulado", () => {
    const r = computarRankingSemanal(config, ativos, precos, historico, entradas, "minha", hoje);

    // Na semana 2 quem sobe é PETR4 (liga), embora a minha lidere o acumulado.
    expect(r.linhas[0].carteiraId).toBe("liga");
    expect(r.linhas[0].retornoSemanaPct).toBeGreaterThan(r.linhas[1].retornoSemanaPct);
    const minha = r.linhas.find((l) => l.carteiraId === "minha")!;
    expect(minha.ehMinha).toBe(true);
    expect(minha.retornoAcumuladoPct).toBeGreaterThan(r.linhas[0].retornoAcumuladoPct);
  });

  it("expõe a semana corrente e a lista de campeões das semanas fechadas", () => {
    const r = computarRankingSemanal(config, ativos, precos, historico, entradas, "minha", hoje);

    expect(r.semanaAtual).toBe("2026-01-18");
    expect(r.inicioSemanaAtual).toBe("2026-01-12");
    expect(r.temHistorico).toBe(true);
    // Só a semana 1 está fechada; nela quem subiu foi VALE3 (minha carteira).
    expect(r.campeoes).toHaveLength(1);
    expect(r.campeoes[0].semana).toBe("2026-01-11");
    expect(r.campeoes[0].carteiraId).toBe("minha");
    expect(r.titulos[0]).toMatchObject({ carteiraId: "minha", titulos: 1 });
  });

  it("não dá título retroativo a carteira criada depois da semana", () => {
    // A carteira nasceu como cópia da liga, então o ledger dela retroage — mas
    // ela não existia na semana 1 e não pode figurar como campeã.
    const recente: EntradaCarteira[] = [
      entradas[0],
      { ...entradas[1], criadaEm: "2026-01-14T00:00:00.000Z" },
    ];
    const r = computarRankingSemanal(config, ativos, precos, historico, recente, "minha", hoje);

    expect(r.campeoes).toHaveLength(1);
    expect(r.campeoes[0].carteiraId).toBe("liga");
    // Mas continua disputando a semana corrente normalmente.
    expect(r.linhas.some((l) => l.carteiraId === "minha")).toBe(true);
  });

  it("sem série histórica devolve o ranking sem campeões", () => {
    const r = computarRankingSemanal(config, ativos, precos, [], entradas, "minha", hoje);
    expect(r.temHistorico).toBe(false);
    expect(r.campeoes).toEqual([]);
    expect(r.linhas).toHaveLength(2);
  });

  it("sem carteiras não quebra", () => {
    const r = computarRankingSemanal(config, ativos, precos, historico, [], null, hoje);
    expect(r.linhas).toEqual([]);
    expect(r.semanaAtual).toBe("2026-01-18");
  });
});
