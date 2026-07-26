import { describe, expect, it } from "vitest";
import {
  dataISO,
  indexadorDoNome,
  mapaPUs,
  mapearTitulos,
  numero,
  ofertados,
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

describe("mapearTitulos", () => {
  it("mapeia o formato esperado da brapi (camelCase, envelope `treasury`)", () => {
    const bruto = {
      treasury: [
        {
          slug: "tesouro-ipca-2035-15052035",
          name: "Tesouro IPCA+ 2035",
          maturityDate: "2035-05-15",
          investmentUnitPrice: 3200.11,
          redemptionUnitPrice: 3180.42,
          annualInvestmentRate: 6.2,
          annualRedemptionRate: 6.35,
          minimumInvestment: 32.01,
        },
      ],
    };

    const [t] = mapearTitulos(bruto);
    expect(t.slug).toBe("tesouro-ipca-2035-15052035");
    expect(t.nome).toBe("Tesouro IPCA+ 2035");
    expect(t.indexador).toBe("IPCA");
    expect(t.vencimento).toBe("2035-05-15");
    expect(t.puCompra).toBe(3200.11);
    expect(t.puVenda).toBe(3180.42);
    expect(t.taxaCompra).toBe(6.2);
    expect(t.taxaVenda).toBe(6.35);
    expect(t.investimentoMinimo).toBe(32.01);
    expect(t.negociavel).toBe(true);
  });

  it("aceita snake_case e valores em texto pt-BR", () => {
    const [t] = mapearTitulos([
      {
        name: "Tesouro Selic 2029",
        vencimento: "01/03/2029",
        pu_compra: "16.283,45",
        pu_venda: "16.280,10",
        taxa_compra: "0,0464",
      },
    ]);
    expect(t.slug).toBe("tesouro-selic-2029-01032029");
    expect(t.vencimento).toBe("2029-03-01");
    expect(t.puCompra).toBe(16283.45);
    expect(t.puVenda).toBe(16280.1);
    expect(t.taxaCompra).toBe(0.0464);
  });

  it("desce um nível em objetos aninhados (formato da API da B3)", () => {
    const [t] = mapearTitulos({
      response: {
        TrsrBdTradgList: [
          { TrsrBd: { nm: "Tesouro Prefixado 2029", mtrtyDt: "2029-01-01", untrRedVal: 780.55 } },
        ],
      },
    });
    expect(t.nome).toBe("Tesouro Prefixado 2029");
    expect(t.puVenda).toBe(780.55);
    expect(t.indexador).toBe("PREFIXADO");
  });

  it("descarta item sem nome ou sem vencimento em vez de gravar linha suja", () => {
    const r = mapearTitulos([
      { name: "Tesouro IPCA+ 2035" }, // sem vencimento
      { maturityDate: "2035-05-15" }, // sem nome
      { name: "Tesouro Selic 2029", maturityDate: "2029-03-01" },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].nome).toBe("Tesouro Selic 2029");
  });

  it("deduplica por slug e ordena por vencimento", () => {
    const r = mapearTitulos([
      { name: "Tesouro IPCA+ 2035", maturityDate: "2035-05-15" },
      { name: "Tesouro Selic 2029", maturityDate: "2029-03-01" },
      { name: "Tesouro IPCA+ 2035", maturityDate: "2035-05-15" },
    ]);
    expect(r.map((t) => t.nome)).toEqual(["Tesouro Selic 2029", "Tesouro IPCA+ 2035"]);
  });

  it("devolve lista vazia para resposta inesperada, sem lançar", () => {
    expect(mapearTitulos(null)).toEqual([]);
    expect(mapearTitulos({ erro: "token inválido" })).toEqual([]);
    expect(mapearTitulos("texto")).toEqual([]);
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

describe("ofertados", () => {
  it("esconde vencidos e não negociáveis", () => {
    const lista = [
      titulo({ slug: "a", nome: "Vencido", vencimento: "2020-01-01" }),
      titulo({ slug: "b", nome: "Fora de oferta", negociavel: false }),
      titulo({ slug: "c", nome: "Tesouro Selic 2029", vencimento: "2029-03-01" }),
    ];
    expect(ofertados(lista, new Date("2026-07-26")).map((t) => t.nome)).toEqual(["Tesouro Selic 2029"]);
  });
});
