import { describe, expect, it } from "vitest";
import {
  aberturaDe,
  computarRankingPeriodo,
  computarSeriesCarteiras,
  domingoDaSemana,
  ehDiaDePregao,
  fechamentoDe,
  retornosDoPeriodo,
  segundaDaSemana,
  type EntradaCarteira,
  type PeriodoRanking,
} from "./disputa";
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

const SEXTA = new Date("2026-01-16T21:00:00.000Z"); // sexta da semana 2

/** Atalho: monta a base cara e lê o ranking de um período. */
function ranking(
  periodo: PeriodoRanking,
  args?: { entradas?: EntradaCarteira[]; historico?: HistoricoPrecos; hoje?: Date },
) {
  const hoje = args?.hoje ?? SEXTA;
  const base = computarSeriesCarteiras(
    config,
    ativos,
    precos,
    args?.historico ?? historico,
    args?.entradas ?? entradas,
    "minha",
    hoje,
  );
  return computarRankingPeriodo(base, periodo, hoje);
}

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

describe("aberturaDe / fechamentoDe", () => {
  it("dia abre e fecha no próprio dia", () => {
    expect(aberturaDe("dia", "2026-01-16")).toBe("2026-01-16");
    expect(fechamentoDe("dia", "2026-01-16")).toBe("2026-01-16");
  });

  it("semana vai de segunda a domingo", () => {
    expect(aberturaDe("semana", "2026-01-18")).toBe("2026-01-12");
    expect(fechamentoDe("semana", "2026-01-18")).toBe("2026-01-18");
  });

  it("mês fecha no último dia, inclusive fevereiro e meses de 30", () => {
    expect(aberturaDe("mes", "2026-02")).toBe("2026-02-01");
    expect(fechamentoDe("mes", "2026-02")).toBe("2026-02-28");
    expect(fechamentoDe("mes", "2024-02")).toBe("2024-02-29"); // bissexto
    expect(fechamentoDe("mes", "2026-04")).toBe("2026-04-30");
    expect(fechamentoDe("mes", "2026-12")).toBe("2026-12-31"); // virada de ano
  });
});

describe("ehDiaDePregao", () => {
  it("aceita seg–sex e recusa o fim de semana", () => {
    expect(ehDiaDePregao(new Date("2026-01-16T21:00:00.000Z"))).toBe(true); // sexta
    expect(ehDiaDePregao(new Date("2026-01-17T12:00:00.000Z"))).toBe(false); // sábado
    expect(ehDiaDePregao(new Date("2026-01-18T12:00:00.000Z"))).toBe(false); // domingo
    expect(ehDiaDePregao(new Date("2026-01-19T12:00:00.000Z"))).toBe(true); // segunda
  });
});

describe("retornosDoPeriodo", () => {
  const serie = [
    { data: "2026-01-05", patrimonioBRL: 1_000_000 },
    { data: "2026-01-09", patrimonioBRL: 1_100_000 },
    { data: "2026-01-16", patrimonioBRL: 1_210_000 },
  ];

  it("encadeia o retorno semanal a partir do fechamento da semana anterior", () => {
    const r = retornosDoPeriodo(serie, "semana");
    expect(r).toHaveLength(2);
    expect(r[0].chave).toBe("2026-01-11");
    expect(r[0].retornoPct).toBeCloseTo(10, 9);
    // Semana 2 rende sobre o fechamento da semana 1, não sobre a abertura.
    expect(r[1].chave).toBe("2026-01-18");
    expect(r[1].retornoPct).toBeCloseTo(10, 9);
  });

  it("agrupa por dia usando a própria data", () => {
    const r = retornosDoPeriodo(serie, "dia");
    expect(r.map((x) => x.chave)).toEqual(["2026-01-05", "2026-01-09", "2026-01-16"]);
    expect(r[0].retornoPct).toBeCloseTo(0, 9); // o primeiro ponto é a base
    expect(r[1].retornoPct).toBeCloseTo(10, 9);
    expect(r[2].retornoPct).toBeCloseTo(10, 9);
  });

  it("agrupa por mês pelo prefixo AAAA-MM", () => {
    const r = retornosDoPeriodo([...serie, { data: "2026-02-03", patrimonioBRL: 1_331_000 }], "mes");
    expect(r.map((x) => x.chave)).toEqual(["2026-01", "2026-02"]);
    expect(r[1].retornoPct).toBeCloseTo(10, 9);
  });

  it("série vazia não gera períodos", () => {
    expect(retornosDoPeriodo([], "semana")).toEqual([]);
  });
});

describe("computarRankingPeriodo — semana", () => {
  it("ordena pelo retorno da semana, não pelo acumulado", () => {
    const r = ranking("semana");

    // Na semana 2 quem sobe é PETR4 (liga), embora a minha lidere o acumulado.
    expect(r.linhas[0].carteiraId).toBe("liga");
    expect(r.linhas[0].retornoPeriodoPct).toBeGreaterThan(r.linhas[1].retornoPeriodoPct);
    const minha = r.linhas.find((l) => l.carteiraId === "minha")!;
    expect(minha.ehMinha).toBe(true);
    expect(minha.retornoAcumuladoPct).toBeGreaterThan(r.linhas[0].retornoAcumuladoPct);
  });

  it("expõe a semana corrente e a lista de campeões das semanas fechadas", () => {
    const r = ranking("semana");

    expect(r.periodoAtual).toBe("2026-01-18");
    expect(r.inicioPeriodoAtual).toBe("2026-01-12");
    expect(r.fimPeriodoAtual).toBe("2026-01-18");
    expect(r.parcial).toBe(true); // ainda é sexta
    expect(r.temHistorico).toBe(true);
    // Só a semana 1 está fechada; nela quem subiu foi VALE3 (minha carteira).
    expect(r.campeoes).toHaveLength(1);
    expect(r.campeoes[0].chave).toBe("2026-01-11");
    expect(r.campeoes[0].carteiraId).toBe("minha");
    expect(r.titulos[0]).toMatchObject({ carteiraId: "minha", titulos: 1 });
  });

  it("não dá título retroativo a carteira criada depois da semana", () => {
    // A carteira nasceu como cópia da liga, então o ledger dela retroage — mas
    // ela não existia na semana 1 e não pode figurar como campeã.
    const r = ranking("semana", {
      entradas: [entradas[0], { ...entradas[1], criadaEm: "2026-01-14T00:00:00.000Z" }],
    });

    expect(r.campeoes).toHaveLength(1);
    expect(r.campeoes[0].carteiraId).toBe("liga");
    // Mas continua disputando a semana corrente normalmente.
    expect(r.linhas.some((l) => l.carteiraId === "minha")).toBe(true);
  });

  it("sem série histórica devolve o ranking sem campeões", () => {
    const r = ranking("semana", { historico: [] });
    expect(r.temHistorico).toBe(false);
    expect(r.campeoes).toEqual([]);
    expect(r.linhas).toHaveLength(2);
  });

  it("sem carteiras não quebra", () => {
    const base = computarSeriesCarteiras(config, ativos, precos, historico, [], null, SEXTA);
    const r = computarRankingPeriodo(base, "semana", SEXTA);
    expect(r.linhas).toEqual([]);
    expect(r.periodoAtual).toBe("2026-01-18");
  });
});

describe("computarRankingPeriodo — dia e mês", () => {
  it("o dia corrente é hoje, com o ponto ao vivo, quando há pregão", () => {
    const r = ranking("dia");

    expect(r.periodoAtual).toBe("2026-01-16");
    expect(r.parcial).toBe(true); // o dia ainda não fechou
    // De 12/01 a 16/01 a PETR4 foi de 11 para 13; a VALE3 não se mexeu.
    expect(r.linhas[0].carteiraId).toBe("liga");
    expect(r.linhas.find((l) => l.carteiraId === "minha")!.retornoPeriodoPct).toBeCloseTo(0, 6);
  });

  it("no fim de semana o dia corrente volta para o último pregão", () => {
    const sabado = new Date("2026-01-17T12:00:00.000Z");
    const r = ranking("dia", { hoje: sabado });

    // Sem o descarte, o balde seria o próprio sábado e todo mundo marcaria ~0%.
    expect(r.periodoAtual).toBe("2026-01-16");
    expect(r.parcial).toBe(false); // aquele dia já fechou
    expect(r.linhas[0].carteiraId).toBe("liga");
    expect(r.linhas[0].retornoPeriodoPct).toBeGreaterThan(0);
  });

  it("agrupa por mês e mantém o filtro de carteira recém-criada", () => {
    const r = ranking("mes");
    expect(r.periodoAtual).toBe("2026-01");
    expect(r.inicioPeriodoAtual).toBe("2026-01-01");
    expect(r.fimPeriodoAtual).toBe("2026-01-31");
    expect(r.parcial).toBe(true);
    // Janeiro ainda é o mês corrente: nenhum mês fechado, nenhum campeão.
    expect(r.campeoes).toEqual([]);

    // Com fevereiro em curso, janeiro fecha e a melhor de janeiro leva o título.
    const comFevereiro = ranking("mes", {
      historico: [
        ...historico,
        { data: "2026-02-03", acoes: { PETR4: 13, VALE3: 15 }, cambio: {}, indices: {} },
      ],
      hoje: new Date("2026-02-03T21:00:00.000Z"),
    });
    expect(comFevereiro.periodoAtual).toBe("2026-02");
    expect(comFevereiro.campeoes).toHaveLength(1);
    expect(comFevereiro.campeoes[0].chave).toBe("2026-01");
    expect(comFevereiro.campeoes[0].carteiraId).toBe("minha"); // VALE3 +50% em janeiro
  });

  it("reagrupa a mesma base sem recalcular as séries", () => {
    const base = computarSeriesCarteiras(config, ativos, precos, historico, entradas, "minha", SEXTA);
    const porDia = computarRankingPeriodo(base, "dia", SEXTA);
    const porMes = computarRankingPeriodo(base, "mes", SEXTA);

    expect(porDia.periodo).toBe("dia");
    expect(porMes.periodo).toBe("mes");
    expect(porDia.periodoAtual).not.toBe(porMes.periodoAtual);
    // Acumulado e patrimônio saem do mesmo cálculo, então não podem divergir.
    expect(porDia.linhas.map((l) => l.retornoAcumuladoPct).sort()).toEqual(
      porMes.linhas.map((l) => l.retornoAcumuladoPct).sort(),
    );
  });
});
