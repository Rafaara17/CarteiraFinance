// Catálogo oficial do Tesouro Direto: tipos e normalização da resposta da fonte.
//
// POR QUE ESTE MÓDULO EXISTE
// A marcação a mercado de um título do Tesouro depende de um PU oficial diário.
// Duas fontes foram descartadas antes desta:
//
//  1. API da B3 (tesourodireto.com.br/.../treasurybondsinfo.json) — está atrás de
//     Cloudflare com proteção anti-bot: funciona no navegador e devolve 403 para
//     IP de datacenter, exatamente o caso do runner da GitHub Action.
//  2. brapi /api/v2/treasury — o endpoint de Tesouro existe só no plano PRO, pago.
//
// A fonte é o TESOURO TRANSPARENTE, portal de dados abertos do próprio Tesouro
// Nacional: o CSV `PrecoTaxaTesouroDireto.csv`, sem token e sem custo, com todos
// os títulos e a série desde 2004. É de onde a própria brapi tira os dados dela.
//
// ATENÇÃO — O DADO É DIÁRIO, NÃO INTRADIÁRIO. O Tesouro publica os PUs uma vez por
// dia útil (as colunas do arquivo são literalmente "... Manha"). A marcação a
// mercado é sempre o último fechamento divulgado; não existe PU minuto a minuto
// como nas ações. Por isso cada título carrega a sua `dataBase`: é ela que
// distingue "o título não se moveu hoje" de "o dado parou de chegar".

/** Indexador do título, derivado do nome oficial. */
export type IndexadorTesouro =
  | "PREFIXADO"
  | "IPCA"
  | "SELIC"
  | "IGPM"
  | "RENDA+"
  | "EDUCA+"
  | "OUTRO";

/** Um título do catálogo oficial do Tesouro Direto. */
export interface TituloTesouro {
  /** Chave estável. Ex.: "tesouro-ipca-2035-15052035". */
  slug: string;
  /** Nome oficial. Ex.: "Tesouro IPCA+ 2035". */
  nome: string;
  indexador: IndexadorTesouro;
  /** Data ISO (AAAA-MM-DD) do vencimento. */
  vencimento: string;
  /** PU de investimento (o que se paga para comprar). */
  puCompra: number | null;
  /** PU de resgate — é ESTE que marca a mercado uma posição em carteira. */
  puVenda: number | null;
  /** Taxa de compra a.a. em % (ex.: 6.2 = 6,2% a.a.). */
  taxaCompra: number | null;
  taxaVenda: number | null;
  /** Investimento mínimo em BRL (fração de título). */
  investimentoMinimo: number | null;
  /** Se está sendo ofertado agora pelo Tesouro. */
  negociavel: boolean;
  /**
   * Data ISO a que os preços se referem — a "Data Base" do arquivo do Tesouro.
   *
   * Não confundir com "quando buscamos": `prices_latest.atualizado_em` diz que a
   * rotina rodou, não que o preço é de hoje. Numa marcação diária é esta data que
   * denuncia dado velho.
   */
  dataBase: string;
}

const ROTULO_INDEXADOR: Record<IndexadorTesouro, string> = {
  PREFIXADO: "Prefixado",
  IPCA: "IPCA+",
  SELIC: "Selic",
  IGPM: "IGP-M+",
  "RENDA+": "Renda+",
  "EDUCA+": "Educa+",
  OUTRO: "Outro",
};

export function rotuloIndexador(i: IndexadorTesouro): string {
  return ROTULO_INDEXADOR[i] ?? i;
}

/**
 * O que se SOMA à taxa contratada, para a taxa poder ser lida sem ambiguidade.
 *
 * Uma taxa de 0,05% num Tesouro Selic não é o rendimento do título: é o spread
 * SOBRE a Selic. Sem o sufixo, a coluna de taxa mente — o Selic pareceria o pior
 * título da lista, e não o mais previsível. Só o Prefixado tem taxa absoluta e
 * portanto não leva sufixo.
 */
export function sufixoIndexador(i: IndexadorTesouro): string | null {
  switch (i) {
    case "SELIC":
      return "+ Selic";
    case "IPCA":
    // Renda+ e Educa+ são produtos distintos, mas ambos corrigidos pelo IPCA.
    case "RENDA+":
    case "EDUCA+":
      return "+ IPCA";
    case "IGPM":
      return "+ IGP-M";
    default:
      return null;
  }
}

/**
 * Indexador a partir do nome oficial. A ordem importa: "Tesouro Renda+" e
 * "Tesouro Educa+" também são indexados ao IPCA, mas são produtos distintos e o
 * nome deles precisa ganhar do teste de IPCA.
 */
export function indexadorDoNome(nome: string): IndexadorTesouro {
  const n = nome.toUpperCase();
  if (/RENDA\s*\+/.test(n)) return "RENDA+";
  if (/EDUCA\s*\+/.test(n)) return "EDUCA+";
  if (/IGP-?\s*M/.test(n)) return "IGPM";
  if (/IPCA/.test(n)) return "IPCA";
  if (/SELIC/.test(n)) return "SELIC";
  if (/PR[EÉ]-?FIXADO/.test(n)) return "PREFIXADO";
  return "OUTRO";
}

/**
 * Slug estável no formato da fonte: `<nome-em-kebab>-<DDMMAAAA>`.
 * Ex.: ("Tesouro IPCA+ 2035", "2035-05-15") -> "tesouro-ipca-2035-15052035".
 *
 * Só é usado quando a fonte não traz um slug próprio. O sufixo com a data
 * completa é o que impede dois títulos do mesmo tipo e ano de colidirem.
 */
export function slugDe(nome: string, vencimentoISO: string): string {
  const base = semAcento(nome)
    .toLowerCase()
    .replace(/\+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const [ano, mes, dia] = vencimentoISO.split("-");
  return ano && mes && dia ? `${base}-${dia}${mes}${ano}` : base;
}

/** PU que marca a posição a mercado: o de resgate; na falta dele, o de compra. */
export function puDeMarcacao(t: TituloTesouro): number | null {
  if (t.puVenda != null && t.puVenda > 0) return t.puVenda;
  if (t.puCompra != null && t.puCompra > 0) return t.puCompra;
  return null;
}

/**
 * Mapa que vai para `prices_latest.tesouro`, consumido por `marcarBond`.
 *
 * Grava DUAS chaves por título — o slug e o nome — apontando para o mesmo PU.
 * A chave por nome existe para os ativos cadastrados antes do slug existir, que
 * só têm `bond.tesouroNome`: sem ela, esses títulos voltariam para o crescimento
 * linear no primeiro deploy.
 */
export function mapaPUs(titulos: TituloTesouro[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of titulos) {
    const pu = puDeMarcacao(t);
    if (pu == null) continue;
    out[t.slug] = pu;
    out[t.nome] = pu;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Normalização da resposta da fonte
// ---------------------------------------------------------------------------

/** Texto sem acento — o cabeçalho do CSV oscila entre "Manha" e "Manhã". */
function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Nome de coluna/chave comparável: minúsculo, sem acento e sem pontuação. */
function normalizarChave(k: string): string {
  return semAcento(k).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Número tolerante a formato pt-BR ("1.234,56") e a valores já numéricos. */
export function numero(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim().replace(/\s|R\$|%/g, "");
  if (s === "") return null;
  // "1.234,56" -> ponto é separador de milhar. "1.234" sozinho também é milhar
  // (PU nunca tem 3 casas decimais), mas "1.23" é decimal de verdade.
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return isFinite(n) ? n : null;
}

/** Data em ISO (AAAA-MM-DD), aceitando "AAAA-MM-DD...", "DD/MM/AAAA" e timestamp. */
export function dataISO(v: unknown): string | null {
  if (typeof v === "number") {
    const d = new Date(v > 1e11 ? v : v * 1000);
    return isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const d = new Date(s);
  return isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

// ---------------------------------------------------------------------------
// Parser do CSV do Tesouro Transparente
// ---------------------------------------------------------------------------

/**
 * Colunas do `PrecoTaxaTesouroDireto.csv`, por nome normalizado.
 *
 * Casamos pelo CABEÇALHO, não por posição: se o Tesouro inserir uma coluna no
 * meio do arquivo, nada quebra. A normalização tira acento e pontuação, então
 * "Taxa Compra Manha" e "Taxa Compra Manhã" caem na mesma chave.
 */
const COLUNAS = {
  tipo: "tipotitulo",
  vencimento: "datavencimento",
  dataBase: "database",
  taxaCompra: "taxacompramanha",
  taxaVenda: "taxavendamanha",
  puCompra: "pucompramanha",
  puVenda: "puvendamanha",
} as const;

type Coluna = keyof typeof COLUNAS;

/**
 * Quantos dias de `Data Base` para trás ainda contam como "em oferta".
 *
 * O arquivo é a série histórica inteira, e nela convivem títulos vendidos hoje
 * com títulos que o Tesouro parou de oferecer e ainda não venceram. A única
 * diferença entre os dois é a idade da última cotação. A janela precisa de folga
 * para fim de semana e feriado longo (Carnaval emenda até 5 dias).
 */
const DIAS_JANELA_OFERTA = 10;

/** Fração mínima de um título que o Tesouro vende (1%). */
const FRACAO_MINIMA = 0.01;

/**
 * Converte o CSV do Tesouro Transparente no catálogo de títulos em oferta.
 *
 * Função PURA — é ela que os testes exercitam, sem rede. O download em streaming
 * fica em scripts/fetch-tesouro.ts.
 *
 * O arquivo tem uma linha por título POR DIA desde 2004; o catálogo quer uma linha
 * por título. Então, para cada título, vale a linha de `Data Base` mais recente —
 * e o título só entra se essa data for recente (ver DIAS_JANELA_OFERTA).
 */
export function parsearCsvTesouro(csv: string, hoje: Date = new Date()): TituloTesouro[] {
  const linhas = csv.split(/\r?\n/);
  const col = indiceColunas(linhas[0] ?? "");
  if (!col) return [];

  /** Melhor linha por título, chaveada por tipo + vencimento. */
  const melhores = new Map<string, { tipo: string; vencimento: string; dataBase: string; campos: string[] }>();

  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim()) continue;
    const campos = linha.split(";");

    const tipo = (campos[col.tipo] ?? "").trim();
    const vencimento = dataISO(campos[col.vencimento]);
    const dataBase = dataISO(campos[col.dataBase]);
    if (!tipo || !vencimento || !dataBase) continue; // linha truncada ou suja

    const chave = `${tipo}|${vencimento}`;
    const atual = melhores.get(chave);
    if (!atual || dataBase > atual.dataBase) {
      melhores.set(chave, { tipo, vencimento, dataBase, campos });
    }
  }

  const hojeISO = iso(hoje);
  const limiteOferta = iso(new Date(hoje.getTime() - DIAS_JANELA_OFERTA * 86_400_000));
  const out: TituloTesouro[] = [];

  for (const m of melhores.values()) {
    // Vencido não é comprável; cotação velha significa fora de oferta.
    if (m.vencimento < hojeISO || m.dataBase < limiteOferta) continue;

    // O nome oficial junta o tipo e o ANO do vencimento: o arquivo traz
    // "Tesouro IPCA+ com Juros Semestrais" + 2055, a tela mostra os dois juntos.
    const nome = `${m.tipo} ${m.vencimento.slice(0, 4)}`;
    const puCompra = numero(m.campos[col.puCompra]);

    out.push({
      slug: slugDe(nome, m.vencimento),
      nome,
      indexador: indexadorDoNome(nome),
      vencimento: m.vencimento,
      dataBase: m.dataBase,
      puCompra,
      puVenda: numero(m.campos[col.puVenda]),
      taxaCompra: numero(m.campos[col.taxaCompra]),
      taxaVenda: numero(m.campos[col.taxaVenda]),
      // DERIVADO, não publicado: o arquivo não tem essa coluna. O Tesouro vende a
      // partir de 1% de um título, e é assim que o site chega em "R$ 32,21" para
      // um PU de R$ 3.221,87.
      investimentoMinimo: puCompra != null ? Math.round(puCompra * FRACAO_MINIMA * 100) / 100 : null,
      // Chegar até aqui já significa estar em oferta (ver o filtro acima).
      negociavel: true,
    });
  }

  out.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.nome.localeCompare(b.nome));
  return out;
}

/** Posição de cada coluna que interessa, ou null se o cabeçalho não for o esperado. */
function indiceColunas(cabecalho: string): Record<Coluna, number> | null {
  // O BOM entra na primeira célula e estragaria o nome da primeira coluna.
  const celulas = cabecalho.replace(/^﻿/, "").split(";").map(normalizarChave);
  const idx = {} as Record<Coluna, number>;
  for (const [campo, nome] of Object.entries(COLUNAS) as Array<[Coluna, string]>) {
    const pos = celulas.indexOf(nome);
    if (pos < 0) return null; // sem uma das colunas não há catálogo confiável
    idx[campo] = pos;
  }
  return idx;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
