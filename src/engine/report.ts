import type { Config, PortfolioSnapshot } from "./types";
import type { Benchmark, Evolucao } from "./evolucao";

const ROTULO_BENCH: Record<Benchmark, string> = { IBOV: "IBOV", SP500: "S&P 500", CDI: "CDI", IPCA: "IPCA" };

export function fmtBRL(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function fmtNum(v: number | null | undefined, casas = 2): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * Gera um relatório HTML autocontido (sem dependências externas) — usado para
 * o snapshot exportável/commitável em reports/.
 */
export function renderReportHtml(
  config: Config,
  snap: PortfolioSnapshot,
  atualizadoEm: string | null,
  ev?: Evolucao,
): string {
  const linhas = snap.posicoes
    .map(
      (p) => `<tr>
      <td>${esc(p.ticker)}</td>
      <td>${esc(p.nome)}</td>
      <td>${esc(p.classe)}</td>
      <td>${esc(String(p.bolsa))}</td>
      <td>${esc(p.moeda)}</td>
      <td class="r">${fmtNum(p.qtd, 4)}</td>
      <td class="r">${fmtBRL(p.custoMedioBRL)}</td>
      <td class="r">${p.precoAtual == null ? "—" : fmtNum(p.precoAtual, 2)}</td>
      <td class="r">${fmtBRL(p.valorBRL)}</td>
      <td class="r ${sinal(p.plNaoRealizadoBRL)}">${fmtBRL(p.plNaoRealizadoBRL)}</td>
      <td class="r ${sinal(p.plNaoRealizadoPct)}">${fmtPct(p.plNaoRealizadoPct)}</td>
      <td class="r">${fmtPct(p.pesoPct)}</td>
    </tr>`,
    )
    .join("\n");

  const dataGer = new Date().toLocaleString("pt-BR");
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório — ${esc(config.nomeLiga)}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:2rem;color:#111;background:#fff}
  h1{margin:0 0 .25rem} .sub{color:#555;margin:0 0 1.5rem}
  .kpis{display:flex;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem}
  .kpi{border:1px solid #e5e7eb;border-radius:10px;padding:.75rem 1rem;min-width:170px}
  .kpi b{display:block;font-size:1.25rem} .kpi span{color:#555;font-size:.8rem}
  table{border-collapse:collapse;width:100%;font-size:.85rem}
  th,td{border-bottom:1px solid #eee;padding:.4rem .5rem;text-align:left}
  th{background:#f8fafc} .r{text-align:right} .pos{color:#047857} .neg{color:#b91c1c}
  footer{margin-top:1.5rem;color:#888;font-size:.8rem}
  h2{font-size:1.05rem;margin:1.5rem 0 .5rem}
  .periodo{border:1px solid #e5e7eb;border-radius:10px;padding:1rem 1.15rem;margin-bottom:1.5rem}
  .periodo .cab{color:#555;font-size:.82rem;margin:0 0 .75rem}
  .spark{width:100%;height:auto;display:block;margin:.5rem 0 1rem}
  .bench{display:flex;flex-wrap:wrap;gap:.5rem}
  .bench span{border:1px solid #e5e7eb;border-radius:999px;padding:.3rem .7rem;font-size:.82rem}
  .bench b{font-variant-numeric:tabular-nums}
</style></head><body>
<h1>${esc(config.nomeLiga)}</h1>
<p class="sub">Relatório da carteira — capital inicial ${fmtBRL(config.capitalInicial)} (fixo)</p>
<div class="kpis">
  <div class="kpi"><b>${fmtBRL(snap.patrimonioBRL)}</b><span>Patrimônio</span></div>
  <div class="kpi"><b class="${sinal(snap.retornoTotalPct)}">${fmtPct(snap.retornoTotalPct)}</b><span>Retorno total</span></div>
  <div class="kpi"><b>${fmtBRL(snap.caixaBRL)}</b><span>Caixa</span></div>
  <div class="kpi"><b>${fmtBRL(snap.valorInvestidoBRL)}</b><span>Investido</span></div>
  <div class="kpi"><b class="${sinal(snap.plRealizadoBRL)}">${fmtBRL(snap.plRealizadoBRL)}</b><span>P&amp;L realizado</span></div>
  <div class="kpi"><b>${snap.cambioUSD == null ? "—" : "R$ " + fmtNum(snap.cambioUSD, 4)}</b><span>Dólar usado</span></div>
</div>
${secaoPeriodo(ev)}
<h2>Posições</h2>
<table>
  <thead><tr>
    <th>Ticker</th><th>Nome</th><th>Classe</th><th>Bolsa</th><th>Moeda</th>
    <th class="r">Qtd</th><th class="r">Custo méd. (BRL)</th><th class="r">Preço/PU</th>
    <th class="r">Valor (BRL)</th><th class="r">P&amp;L (BRL)</th><th class="r">P&amp;L %</th><th class="r">Peso</th>
  </tr></thead>
  <tbody>${linhas || '<tr><td colspan="12">Sem posições.</td></tr>'}</tbody>
</table>
<footer>
  Dados atualizados em: ${atualizadoEm ? esc(new Date(atualizadoEm).toLocaleString("pt-BR")) : "—"}.
  Relatório gerado em ${esc(dataGer)}. Preços oficiais; capital inicial imutável.
</footer>
</body></html>`;
}

function sinal(v: number | null | undefined): string {
  if (v == null) return "";
  return v >= 0 ? "pos" : "neg";
}

/** Seção "Análise do período": KPIs de valorização + sparkline + benchmarks. */
function secaoPeriodo(ev?: Evolucao): string {
  if (!ev || !ev.temDados) return "";
  const benches = (Object.keys(ev.benchmarks) as Benchmark[])
    .map(
      (b) =>
        `<span>${ROTULO_BENCH[b]}: <b class="${sinal(ev.benchmarks[b])}">${fmtPct(ev.benchmarks[b])}</b></span>`,
    )
    .join("");

  return `<h2>Análise do período (${esc(fmtYMD(ev.intervalo.de))} → ${esc(fmtYMD(ev.intervalo.ate))})</h2>
<div class="periodo">
  <div class="kpis">
    <div class="kpi"><b class="${sinal(ev.valorizacaoBRL)}">${fmtBRL(ev.valorizacaoBRL)}</b><span>Valorização (R$)</span></div>
    <div class="kpi"><b class="${sinal(ev.valorizacaoPct)}">${fmtPct(ev.valorizacaoPct)}</b><span>Rentabilidade (%)</span></div>
    <div class="kpi"><b>${fmtBRL(ev.patrimonioInicio)}</b><span>Patrimônio no início</span></div>
    <div class="kpi"><b>${fmtBRL(ev.patrimonioFim)}</b><span>Patrimônio no fim</span></div>
  </div>
  ${sparkline(ev.serie.map((p) => p.patrimonioBRL))}
  ${benches ? `<div class="bench">${benches}</div>` : ""}
</div>`;
}

/** Sparkline SVG autocontido (sem dependências) da curva de patrimônio. */
function sparkline(valores: number[]): string {
  if (valores.length < 2) return "";
  const W = 600;
  const H = 120;
  const P = 6;
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const span = max - min || 1;
  const x = (i: number) => P + (i * (W - 2 * P)) / (valores.length - 1);
  const y = (v: number) => P + (H - 2 * P) * (1 - (v - min) / span);
  const pts = valores.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const linha = `M${pts.join(" L")}`;
  const area = `M${x(0).toFixed(1)},${(H - P).toFixed(1)} L${pts.join(" L")} L${x(valores.length - 1).toFixed(1)},${(H - P).toFixed(1)} Z`;
  const cor = valores[valores.length - 1] >= valores[0] ? "#047857" : "#b91c1c";
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evolução do patrimônio">
  <path d="${area}" fill="${cor}" fill-opacity="0.10"/>
  <path d="${linha}" fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;
}

/** "2026-07-24" -> "24/07/2026". */
function fmtYMD(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd;
}
