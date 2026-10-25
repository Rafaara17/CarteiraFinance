/**
 * AJUSTES DOS FUTUROS da B3 para o Supabase (tabela `b3_ajustes` + histórico).
 * Rodado pela GitHub Action `ajustes.yml` (1x/dia útil, depois do fechamento).
 *
 * Env necessárias (secrets da Action):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Teste local sem gravar nada:  npm run fetch-ajustes -- --dry-run
 *
 * FONTE: a API pública que alimenta o próprio site da B3,
 *   https://cotacao.b3.com.br/mds/api/v1/DerivativeQuotation/{WDO|DOL|WIN|...}
 * — lista todos os contratos com vencimento oficial e o ajuste do pregão
 * (`prvsDayAdjstmntPric`). É a mesma fonte que o app consulta ao vivo; este job
 * existe para (1) quem abre o app fora do pregão ter o último ajuste gravado e
 * (2) a curva de evolução marcar os futuros pelo preço oficial de cada dia.
 *
 * "Melhor esforço": se a B3 barrar o runner, o job avisa e termina verde — o app
 * continua consultando a B3 direto do navegador.
 */
import { createClient } from "@supabase/supabase-js";
import { MERCADORIAS, lerCotacaoFuturosB3, type ContratoB3 } from "../src/engine/derivativos";

const DRY_RUN = process.argv.includes("--dry-run");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
/** Só os vencimentos próximos interessam (os longos quase não negociam). */
const MAX_POR_MERCADORIA = 8;

async function main() {
  const db = DRY_RUN
    ? null
    : createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false },
      });

  // Data do pregão no fuso de Brasília (o job roda ~20h BRT).
  const dataPregao = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const contratos: ContratoB3[] = [];
  for (const m of MERCADORIAS) {
    try {
      const r = await fetch(`https://cotacao.b3.com.br/mds/api/v1/DerivativeQuotation/${m}`, { headers: { "User-Agent": UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const lista = lerCotacaoFuturosB3(await r.json()).filter((c) => c.vencimento >= dataPregao && c.ajuste != null);
      contratos.push(...lista.slice(0, MAX_POR_MERCADORIA));
      console.log(`${m}: ${lista.length} contratos`);
    } catch (e) {
      console.warn(`${m}: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (contratos.length === 0) {
    console.warn("::warning::A B3 não respondeu. O app segue consultando a B3 direto do navegador.");
    return;
  }

  const linhas = contratos.map((c) => ({
    codigo: c.codigo,
    mercadoria: c.mercadoria,
    vencimento: c.vencimento,
    ajuste: c.ajuste,
    data_pregao: dataPregao,
    spot_ref: null, // o app usa o fechamento anterior do objeto como referência
    fonte: "b3",
    atualizado_em: new Date().toISOString(),
  }));
  for (const l of linhas) console.log(`  ${l.codigo.padEnd(7)} venc ${l.vencimento}  ajuste ${l.ajuste}`);
  if (!db) {
    console.log("--dry-run: nada gravado.");
    return;
  }

  const { error } = await db.from("b3_ajustes").upsert(linhas, { onConflict: "codigo" });
  if (error) throw new Error(`Falha ao gravar b3_ajustes: ${error.message}`);

  // Série histórica: mescla no `acoes` do dia sem apagar os preços já gravados.
  const { data: linhaHist } = await db.from("prices_history").select("acoes").eq("data", dataPregao).maybeSingle();
  const acoes: Record<string, number> = { ...((linhaHist?.acoes as Record<string, number>) ?? {}) };
  for (const c of contratos) acoes[c.codigo] = c.ajuste!;
  const { error: errHist } = await db.from("prices_history").upsert({ data: dataPregao, acoes }, { onConflict: "data" });
  if (errHist) console.warn("Falha ao gravar o ajuste no histórico:", errHist.message);

  console.log(`${linhas.length} ajustes gravados.`);
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
