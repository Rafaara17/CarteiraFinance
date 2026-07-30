/**
 * Catálogo e PU oficial do TESOURO DIRETO, do Tesouro Transparente para o Supabase.
 * Rodado pela GitHub Action `tesouro.yml` (1x/dia útil).
 *
 * Env necessárias (secrets da Action):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   (nenhum token de API — a fonte é dados abertos do governo)
 *
 * POR QUE UM SCRIPT SEPARADO DO fetch-prices
 * A cadência é outra. `fetch-prices` roda de hora em hora porque ação e câmbio
 * mudam a cada minuto; o Tesouro publica os PUs UMA VEZ por dia útil, e o arquivo
 * tem ~35 MB (a série inteira desde 2004). Baixar isso doze vezes por dia para
 * reler o mesmo dado não se justifica.
 *
 * POR QUE ESTA FONTE, e não as duas anteriores: ver o cabeçalho de
 * src/engine/tesouro.ts (API da B3 barrada por Cloudflare; Tesouro na brapi só no
 * plano pago).
 *
 * O download é em STREAMING e o arquivo NUNCA é materializado inteiro: as linhas
 * são consumidas por chunk. O que fica na memória é só a melhor linha por título
 * (algumas dezenas), não os 35 MB.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mapaPUs, parsearCsvTesouro, puDeMarcacao, type TituloTesouro } from "../src/engine/tesouro";

/**
 * Recurso `PrecoTaxaTesouroDireto.csv` do dataset "Taxas dos Títulos Ofertados
 * pelo Tesouro Direto". Se um dia devolver 404, o id do recurso mudou — reresolver
 * em .../ckan/api/3/action/package_show?id=<DATASET>.
 */
const DATASET = "df56aa42-484a-4a59-8184-7676580c81e3";
const RECURSO = "796d2059-14e9-44e3-80c9-2d9e30b405c1";
const CSV_URL =
  `https://www.tesourotransparente.gov.br/ckan/dataset/${DATASET}/resource/${RECURSO}/download/precotaxatesourodireto.csv`;

async function main() {
  const url = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  console.log(`Baixando ${CSV_URL}`);
  const csv = await baixarCsv();
  console.log(`CSV recebido: ${(csv.length / 1_048_576).toFixed(1)} MiB`);

  const titulos = parsearCsvTesouro(csv);
  if (titulos.length === 0) {
    // Cabeçalho diferente do esperado, ou nenhuma cotação recente. Mostra a
    // primeira linha para dar como reconhecer o formato novo pelo log da Action.
    throw new Error(`nenhum título em oferta reconhecido. Cabeçalho: ${csv.slice(0, 300)}`);
  }

  const comPU = titulos.filter((t) => puDeMarcacao(t) != null).length;
  const datas = [...new Set(titulos.map((t) => t.dataBase))].sort();
  console.log(
    `${titulos.length} títulos em oferta (${comPU} com PU), data base ${datas[datas.length - 1]}` +
      (datas.length > 1 ? ` (também presentes: ${datas.slice(0, -1).join(", ")})` : ""),
  );

  await gravarCatalogo(db, titulos);
  await gravarPUs(db, titulos);
  console.log("Catálogo e PUs gravados.");
}

/**
 * Espera antes de cada tentativa de download. O servidor do Tesouro Transparente
 * recusa conexão de forma intermitente a partir dos runners do GitHub: metade das
 * execuções agendadas morria em ConnectTimeout, sem trocar um byte, enquanto o
 * mesmo endereço respondia em ~300 ms de dentro do Brasil. A indisponibilidade
 * dura minutos, então basta insistir — não é caso de trocar de fonte.
 */
const ESPERAS_MS = [0, 20_000, 60_000, 150_000];

async function baixarCsv(): Promise<string> {
  let ultimoErro: unknown;
  for (const [i, espera] of ESPERAS_MS.entries()) {
    if (espera > 0) {
      console.log(`Nova tentativa (${i + 1}/${ESPERAS_MS.length}) em ${espera / 1000}s...`);
      await new Promise((r) => setTimeout(r, espera));
    }
    try {
      return await baixarUmaVez();
    } catch (e) {
      ultimoErro = e;
      console.warn(`Falha ao baixar: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw ultimoErro;
}

/**
 * Consome o corpo em pedaços. `TextDecoder` não-fatal de propósito: nenhum nome de
 * título tem acento ("Tesouro Prefixado", "Tesouro IPCA+", "Tesouro Selic"...),
 * então um byte estranho no cabeçalho não pode derrubar a rotina — e o casamento de
 * coluna já ignora acento (ver COLUNAS em src/engine/tesouro.ts).
 */
async function baixarUmaVez(): Promise<string> {
  const r = await fetch(CSV_URL, { headers: { "User-Agent": "CarteiraFinance" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ao baixar o CSV do Tesouro`);
  if (!r.body) throw new Error("resposta sem corpo");

  const decoder = new TextDecoder("utf-8");
  const partes: string[] = [];
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    partes.push(decoder.decode(chunk, { stream: true }));
  }
  partes.push(decoder.decode());
  return partes.join("");
}

/** Espelha o catálogo em `tesouro_titulos`. Upsert por slug: nada é apagado. */
async function gravarCatalogo(db: SupabaseClient, titulos: TituloTesouro[]): Promise<void> {
  const agora = new Date().toISOString();
  const linhas = titulos.map((t) => ({
    slug: t.slug,
    nome: t.nome,
    indexador: t.indexador,
    vencimento: t.vencimento,
    data_base: t.dataBase,
    pu_compra: t.puCompra,
    pu_venda: t.puVenda,
    taxa_compra: t.taxaCompra,
    taxa_venda: t.taxaVenda,
    investimento_minimo: t.investimentoMinimo,
    negociavel: t.negociavel,
    atualizado_em: agora,
  }));
  const { error } = await db.from("tesouro_titulos").upsert(linhas, { onConflict: "slug" });
  if (error) throw new Error(`tesouro_titulos: ${error.message}`);
}

/**
 * Grava o mapa de PU em `prices_latest.tesouro` — é ele que `marcarBond` lê para
 * marcar a posição a mercado.
 *
 * Upsert PARCIAL: só a coluna `tesouro` vai no payload, então `acoes`, `cambio` e
 * `fechamento_anterior` (que são do fetch-prices, de hora em hora) ficam intactos.
 * Os dois scripts escrevem na mesma linha sem se atropelar.
 */
async function gravarPUs(db: SupabaseClient, titulos: TituloTesouro[]): Promise<void> {
  const { error } = await db
    .from("prices_latest")
    .upsert({ id: 1, tesouro: mapaPUs(titulos) }, { onConflict: "id" });
  if (error) throw new Error(`prices_latest.tesouro: ${error.message}`);
}

function requireEnv(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
