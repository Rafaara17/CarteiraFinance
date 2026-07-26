import { describe, expect, it } from "vitest";
import {
  dataISO,
  indexadorDoNome,
  mapaPUs,
  numero,
  parsearCsvTesouro,
  puDeMarcacao,
  slugDe,
  sufixoIndexador,
  type TituloTesouro,
} from "./tesouro";

/** Molde de título, para os testes só dizerem o que importa em cada caso. */
function titulo(p: Partial<TituloTesouro> = {}): TituloTesouro {
  return {
    slug: "tesouro-ipca-2035-15052035",
    nome: "Tesouro IPCA+ 2035",
    indexador: "IPCA",
    vencimento: "2035-05-15",
    dataBase: "2026-07-24",
    puCompra: 3200,
    puVenda: 3180,
    taxaCompra: 6.2,
    taxaVenda: 6.35,
    investimentoMinimo: 31.8,
    negociavel: true,
    ...p,
  };
}

describe("indexadorDoNome", () => {
  it("classifica cada família de título pelo nome oficial", () => {
    expect(indexadorDoNome("Tesouro Prefixado 2029")).toBe("PREFIXADO");
    expect(indexadorDoNome("Tesouro Prefixado com Juros Semestrais 2035")).toBe("PREFIXADO");
    expect(indexadorDoNome("Tesouro IPCA+ 2035")).toBe("IPCA");
    expect(indexadorDoNome("Tesouro IPCA+ com Juros Semestrais 2055")).toBe("IPCA");
    expect(indexadorDoNome("Tesouro Selic 2029")).toBe("SELIC");
    expect(indexadorDoNome("Tesouro IGPM+ com Juros Semestrais 2031")).toBe("IGPM");
  });

  it("Renda+ e Educa+ ganham do teste de IPCA, apesar de indexados a ele", () => {
    expect(indexadorDoNome("Tesouro Renda+ Aposentadoria Extra 2065")).toBe("RENDA+");
    expect(indexadorDoNome("Tesouro Educa+ 2030")).toBe("EDUCA+");
  });
});

describe("sufixoIndexador", () => {
  it("diz o que se soma à taxa em cada família indexada", () => {
    expect(sufixoIndexador("SELIC")).toBe("+ Selic");
    expect(sufixoIndexador("IPCA")).toBe("+ IPCA");
    expect(sufixoIndexador("IGPM")).toBe("+ IGP-M");
    // Produtos diferentes, mas corrigidos pelo IPCA.
    expect(sufixoIndexador("RENDA+")).toBe("+ IPCA");
    expect(sufixoIndexador("EDUCA+")).toBe("+ IPCA");
  });

  it("Prefixado não leva sufixo — a taxa dele é absoluta", () => {
    expect(sufixoIndexador("PREFIXADO")).toBeNull();
    expect(sufixoIndexador("OUTRO")).toBeNull();
  });
});

describe("slugDe", () => {
  it("monta a chave estável no formato <nome-em-kebab>-<DDMMAAAA>", () => {
    expect(slugDe("Tesouro IPCA+ 2035", "2035-05-15")).toBe("tesouro-ipca-2035-15052035");
    expect(slugDe("Tesouro Selic 2029", "2029-03-01")).toBe("tesouro-selic-2029-01032029");
  });

  it("remove acentos para o slug nunca depender de codificação", () => {
    expect(slugDe("Tesouro Prefixado com Juros Semestrais 2035", "2035-01-01"))
      .toBe("tesouro-prefixado-com-juros-semestrais-2035-01012035");
  });

  it("separa dois títulos do mesmo tipo e ano pela data completa", () => {
    const a = slugDe("Tesouro Selic 2029", "2029-03-01");
    const b = slugDe("Tesouro Selic 2029", "2029-09-01");
    expect(a).not.toBe(b);
  });
});

describe("numero", () => {
  it("aceita número, decimal com ponto e formato pt-BR", () => {
    expect(numero(3200.55)).toBe(3200.55);
    expect(numero("3200.55")).toBe(3200.55);
    expect(numero("3.200,55")).toBe(3200.55);
    expect(numero("R$ 3.200,55")).toBe(3200.55);
    expect(numero("6,2%")).toBe(6.2);
  });

  it("trata ponto isolado de milhar sem confundir com decimal", () => {
    expect(numero("1.000")).toBe(1000);
    expect(numero("1.23")).toBe(1.23);
  });

  it("devolve null para o que não é número", () => {
    expect(numero(null)).toBeNull();
    expect(numero("")).toBeNull();
    expect(numero("—")).toBeNull();
    expect(numero(Infinity)).toBeNull();
  });
});

describe("dataISO", () => {
  it("normaliza os formatos que as fontes usam", () => {
    expect(dataISO("2035-05-15")).toBe("2035-05-15");
    expect(dataISO("2035-05-15T00:00:00.000Z")).toBe("2035-05-15");
    expect(dataISO("15/05/2035")).toBe("2035-05-15");
  });

  it("devolve null para data inválida", () => {
    expect(dataISO("qualquer coisa")).toBeNull();
    expect(dataISO(null)).toBeNull();
  });
});

describe("puDeMarcacao", () => {
  it("prefere o PU de resgate — é ele que vale para quem já tem o título", () => {
    expect(puDeMarcacao(titulo({ puCompra: 3200, puVenda: 3180 }))).toBe(3180);
  });

  it("cai no PU de compra quando não há PU de resgate", () => {
    expect(puDeMarcacao(titulo({ puVenda: null }))).toBe(3200);
    expect(puDeMarcacao(titulo({ puVenda: 0 }))).toBe(3200);
  });

  it("devolve null sem nenhum PU utilizável", () => {
    expect(puDeMarcacao(titulo({ puCompra: null, puVenda: null }))).toBeNull();
  });
});

describe("mapaPUs", () => {
  it("indexa por slug E por nome, para não quebrar ativo cadastrado antes do slug", () => {
    const m = mapaPUs([titulo()]);
    expect(m["tesouro-ipca-2035-15052035"]).toBe(3180);
    expect(m["Tesouro IPCA+ 2035"]).toBe(3180);
  });

  it("ignora título sem PU", () => {
    expect(mapaPUs([titulo({ puCompra: null, puVenda: null })])).toEqual({});
  });
});

describe("parsearCsvTesouro", () => {
  /** Cabeçalho publicado pelo Tesouro Transparente. */
  const CAB =
    "Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha";
  /** "Hoje" fixo em todos os casos, para a janela de oferta ser determinística. */
  const HOJE = new Date("2026-07-26T12:00:00Z");

  function csv(...linhas: string[]): string {
    return [CAB, ...linhas].join("\n");
  }

  it("monta o título a partir do tipo e do ANO do vencimento", () => {
    const [t] = parsearCsvTesouro(
      csv("Tesouro IPCA+ com Juros Semestrais;15/05/2055;24/07/2026;7,12;7,30;4.102,66;4.055,19;4.080,00"),
      HOJE,
    );
    expect(t.nome).toBe("Tesouro IPCA+ com Juros Semestrais 2055");
    expect(t.slug).toBe("tesouro-ipca-com-juros-semestrais-2055-15052055");
    expect(t.indexador).toBe("IPCA");
    expect(t.vencimento).toBe("2055-05-15");
    expect(t.dataBase).toBe("2026-07-24");
  });

  it("lê preços e taxas em formato pt-BR", () => {
    const [t] = parsearCsvTesouro(
      csv("Tesouro Selic;01/03/2029;24/07/2026;0,0464;0,1464;16.283,45;16.280,10;16.281,00"),
      HOJE,
    );
    expect(t.puCompra).toBe(16283.45);
    expect(t.puVenda).toBe(16280.1);
    expect(t.taxaCompra).toBe(0.0464);
    expect(t.taxaVenda).toBe(0.1464);
  });

  it("deriva o investimento mínimo como 1% do PU de compra", () => {
    const [t] = parsearCsvTesouro(
      csv("Tesouro IPCA+;15/05/2035;24/07/2026;7,28;7,42;3.221,87;3.198,44;3.210,00"),
      HOJE,
    );
    // É como o site do Tesouro chega em "R$ 32,21" para um PU de R$ 3.221,87.
    expect(t.investimentoMinimo).toBe(32.22);
  });

  it("de várias datas do mesmo título, fica com a Data Base mais recente", () => {
    const r = parsearCsvTesouro(
      csv(
        "Tesouro Prefixado;01/01/2028;20/07/2026;13,90;14,10;838,00;834,00;836,00",
        "Tesouro Prefixado;01/01/2028;24/07/2026;13,42;13,62;842,31;838,02;840,00",
        "Tesouro Prefixado;01/01/2028;22/07/2026;13,70;13,90;840,10;836,00;838,00",
      ),
      HOJE,
    );
    expect(r).toHaveLength(1);
    expect(r[0].dataBase).toBe("2026-07-24");
    expect(r[0].puCompra).toBe(842.31);
  });

  it("descarta título fora de oferta — o sinal é a cotação velha", () => {
    const r = parsearCsvTesouro(
      csv(
        // Não vence antes de 2045, mas a última cotação é de 2019: saiu de oferta.
        "Tesouro IPCA+;15/05/2045;10/06/2019;4,50;4,70;1.500,00;1.480,00;1.490,00",
        "Tesouro IPCA+;15/05/2035;24/07/2026;7,28;7,42;3.221,87;3.198,44;3.210,00",
      ),
      HOJE,
    );
    expect(r.map((t) => t.nome)).toEqual(["Tesouro IPCA+ 2035"]);
  });

  it("descarta título já vencido", () => {
    const r = parsearCsvTesouro(
      csv("Tesouro Prefixado;01/01/2020;24/07/2026;10,00;10,20;1.000,00;1.000,00;1.000,00"),
      HOJE,
    );
    expect(r).toEqual([]);
  });

  it("aguenta fim de semana e feriado dentro da janela de oferta", () => {
    // Segunda-feira lendo o arquivo publicado na sexta anterior.
    const r = parsearCsvTesouro(
      csv("Tesouro Selic;01/03/2029;17/07/2026;0,05;0,15;16.283,45;16.280,10;16.281,00"),
      HOJE,
    );
    expect(r).toHaveLength(1);
  });

  it("ordena por vencimento", () => {
    const r = parsearCsvTesouro(
      csv(
        "Tesouro IPCA+;15/05/2035;24/07/2026;7,28;7,42;3.221,87;3.198,44;3.210,00",
        "Tesouro Selic;01/03/2029;24/07/2026;0,05;0,15;16.283,45;16.280,10;16.281,00",
        "Tesouro Prefixado;01/01/2028;24/07/2026;13,42;13,62;842,31;838,02;840,00",
      ),
      HOJE,
    );
    expect(r.map((t) => t.nome)).toEqual([
      "Tesouro Prefixado 2028",
      "Tesouro Selic 2029",
      "Tesouro IPCA+ 2035",
    ]);
  });

  it("pula linha truncada ou suja sem derrubar o resto do arquivo", () => {
    const r = parsearCsvTesouro(
      csv(
        "Tesouro Prefixado;01/01/2028",
        ";;;;;;;",
        "linha completamente fora do formato",
        "",
        "Tesouro Selic;01/03/2029;24/07/2026;0,05;0,15;16.283,45;16.280,10;16.281,00",
      ),
      HOJE,
    );
    expect(r.map((t) => t.nome)).toEqual(["Tesouro Selic 2029"]);
  });

  it("casa as colunas pelo cabeçalho, não pela posição", () => {
    // Coluna nova no meio e "Manhã" acentuado: nada disso pode quebrar o parse.
    const cabAlternativo =
      "Tipo Titulo;Coluna Nova;Data Vencimento;Data Base;Taxa Compra Manhã;Taxa Venda Manhã;PU Compra Manhã;PU Venda Manhã";
    const r = parsearCsvTesouro(
      [cabAlternativo, "Tesouro Selic;lixo;01/03/2029;24/07/2026;0,05;0,15;16.283,45;16.280,10"].join("\n"),
      HOJE,
    );
    expect(r).toHaveLength(1);
    expect(r[0].puCompra).toBe(16283.45);
    expect(r[0].puVenda).toBe(16280.1);
  });

  it("devolve vazio se o cabeçalho não tiver as colunas esperadas", () => {
    expect(parsearCsvTesouro("a;b;c\n1;2;3", HOJE)).toEqual([]);
    expect(parsearCsvTesouro("", HOJE)).toEqual([]);
  });

  it("ignora o BOM na primeira coluna", () => {
    const r = parsearCsvTesouro(
      "﻿" + csv("Tesouro Selic;01/03/2029;24/07/2026;0,05;0,15;16.283,45;16.280,10;16.281,00"),
      HOJE,
    );
    expect(r).toHaveLength(1);
  });
});
