// Catálogo oficial do Tesouro Direto: tipos e normalização da resposta da fonte.
//
// POR QUE ESTE MÓDULO EXISTE
// A marcação a mercado de um título do Tesouro depende de um PU oficial diário.
// Antes, o app buscava esse PU direto na API da B3
// (tesourodireto.com.br/.../treasurybondsinfo.json), que está atrás de Cloudflare
// com proteção anti-bot: funciona no navegador e devolve 403 para IP de
// datacenter — exatamente o caso do runner da GitHub Action. Resultado prático:
// `prices_latest.tesouro` nunca era preenchido e todo título do Tesouro acabava
// marcado pelo crescimento linear, nunca a mercado.
//
// A fonte agora é a brapi (`/api/v2/treasury`), que espelha o Tesouro
// Transparente, entrega JSON e usa SLUGS ESTÁVEIS no formato
// `<nome-do-titulo>-<DDMMAAAA>` — é esse slug que virou a chave do catálogo.
//
// ATENÇÃO — O DADO É DIÁRIO, NÃO INTRADIÁRIO. O Tesouro Transparente publica os
// PUs uma vez por dia útil. A marcação a mercado é sempre o fechamento do último
// dia útil publicado; não existe PU minuto a minuto como nas ações.
//
// TOLERÂNCIA A NOMES DE CAMPO: `mapearTitulos` não exige um nome exato de campo.
// Ela indexa as chaves de cada item de forma normalizada (minúsculas, sem
// separadores) e aceita uma lista de sinônimos por campo, além de descer um nível
// em objetos aninhados. Isso mantém a ingestão de pé se a fonte publicar
// `redemptionUnitPrice`, `pu_venda` ou `unitPriceRedemption` para a mesma coisa —
// e é de propósito, porque o contrato exato não pôde ser verificado na máquina
// onde este código foi escrito (sem acesso de rede à brapi).

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
  const base = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

/** Títulos efetivamente ofertados hoje — o que o catálogo mostra por padrão. */
export function ofertados(titulos: TituloTesouro[], hoje: Date = new Date()): TituloTesouro[] {
  const limite = hoje.toISOString().slice(0, 10);
  return titulos.filter((t) => t.negociavel && t.vencimento >= limite);
}

// ---------------------------------------------------------------------------
// Normalização da resposta da fonte
// ---------------------------------------------------------------------------

type Bruto = Record<string, unknown>;

/** Sinônimos aceitos por campo (comparados de forma normalizada). */
const CHAVES = {
  slug: ["slug", "id", "code", "symbol", "ticker"],
  nome: ["name", "nome", "title", "bondname", "longname", "nm"],
  vencimento: ["maturitydate", "maturity", "vencimento", "expirationdate", "duedate", "mtrtydt"],
  puCompra: [
    "investmentunitprice", "unitpriceinvestment", "purchaseunitprice", "buyunitprice",
    "pucompra", "investmentprice", "untrinvstmtval",
  ],
  puVenda: [
    "redemptionunitprice", "unitpriceredemption", "sellunitprice", "saleunitprice",
    "puvenda", "redemptionprice", "untrredval",
  ],
  taxaCompra: [
    "investmentrate", "annualinvestmentrate", "buyrate", "purchaserate", "taxacompra",
    "rate", "anulinvstmtrate",
  ],
  taxaVenda: [
    "redemptionrate", "annualredemptionrate", "sellrate", "salerate", "taxavenda",
    "anulredrate",
  ],
  investimentoMinimo: [
    "minimuminvestment", "minimuminvestmentamount", "minimumamount", "investimentominimo",
    "mininvestmentamount", "minvstmtamt",
  ],
  negociavel: ["tradable", "istradable", "available", "isavailable", "negociavel", "active"],
} as const;

/** Onde a lista de títulos pode estar dentro do envelope da resposta. */
const CAMINHOS_LISTA = ["treasury", "treasuries", "bonds", "titulos", "results", "data", "items"];

function normalizarChave(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function ehObjeto(v: unknown): v is Bruto {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Índice achatado das chaves de um item, normalizadas. Desce um nível em objetos
 * aninhados (a API da B3, por exemplo, embrulha tudo num `TrsrBd`), sem deixar o
 * aninhado sobrescrever o que já veio na raiz.
 */
function indexar(item: Bruto): Map<string, unknown> {
  const idx = new Map<string, unknown>();
  for (const [k, v] of Object.entries(item)) {
    if (!ehObjeto(v)) idx.set(normalizarChave(k), v);
  }
  for (const v of Object.values(item)) {
    if (!ehObjeto(v)) continue;
    for (const [k2, v2] of Object.entries(v)) {
      const nk = normalizarChave(k2);
      if (!ehObjeto(v2) && !idx.has(nk)) idx.set(nk, v2);
    }
  }
  return idx;
}

function pegar(idx: Map<string, unknown>, chaves: readonly string[]): unknown {
  for (const c of chaves) {
    const v = idx.get(c);
    if (v != null && v !== "") return v;
  }
  return undefined;
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

function booleano(v: unknown, padrao: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "sim", "yes", "s", "y"].includes(s)) return true;
    if (["false", "0", "nao", "não", "no", "n"].includes(s)) return false;
  }
  return padrao;
}

/** Encontra o array de títulos dentro do envelope da resposta. */
export function extrairLista(bruto: unknown): Bruto[] {
  if (Array.isArray(bruto)) return bruto.filter(ehObjeto);
  if (!ehObjeto(bruto)) return [];

  for (const [k, v] of Object.entries(bruto)) {
    if (Array.isArray(v) && CAMINHOS_LISTA.includes(normalizarChave(k))) {
      return v.filter(ehObjeto);
    }
  }
  // Envelope de mais um nível (ex.: { response: { ... } }).
  for (const v of Object.values(bruto)) {
    if (ehObjeto(v) || Array.isArray(v)) {
      const achado = extrairLista(v);
      if (achado.length > 0) return achado;
    }
  }
  return [];
}

/**
 * Converte a resposta bruta da fonte no catálogo tipado. Função PURA — é ela que
 * os testes exercitam, sem rede.
 *
 * Descarta o que não dá para usar: item sem nome ou sem vencimento não tem como
 * ser identificado nem marcado, então fica fora em vez de virar linha suja no banco.
 */
export function mapearTitulos(bruto: unknown): TituloTesouro[] {
  const out: TituloTesouro[] = [];
  const vistos = new Set<string>();

  for (const item of extrairLista(bruto)) {
    const idx = indexar(item);

    const nome = String(pegar(idx, CHAVES.nome) ?? "").trim();
    const vencimento = dataISO(pegar(idx, CHAVES.vencimento));
    if (!nome || !vencimento) continue;

    const slugBruto = pegar(idx, CHAVES.slug);
    const slug = typeof slugBruto === "string" && slugBruto.trim() !== ""
      ? slugBruto.trim()
      : slugDe(nome, vencimento);
    if (vistos.has(slug)) continue;
    vistos.add(slug);

    out.push({
      slug,
      nome,
      indexador: indexadorDoNome(nome),
      vencimento,
      puCompra: numero(pegar(idx, CHAVES.puCompra)),
      puVenda: numero(pegar(idx, CHAVES.puVenda)),
      taxaCompra: numero(pegar(idx, CHAVES.taxaCompra)),
      taxaVenda: numero(pegar(idx, CHAVES.taxaVenda)),
      investimentoMinimo: numero(pegar(idx, CHAVES.investimentoMinimo)),
      negociavel: booleano(pegar(idx, CHAVES.negociavel), true),
    });
  }

  out.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.nome.localeCompare(b.nome));
  return out;
}
