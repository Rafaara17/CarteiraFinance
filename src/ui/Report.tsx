import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtBRL, fmtPct, renderReportHtml } from "../engine/report";
import {
  BENCHMARKS,
  ROTULO_BENCHMARK,
  computarEvolucao,
  intervaloDoPreset,
  type Benchmark,
  type Intervalo,
  type PresetPeriodo,
} from "../engine/evolucao";
import type { Ativo, Config, HistoricoPrecos, PortfolioSnapshot, Transacao } from "../engine/types";
import { carregarHistorico, salvarRelatorio } from "../data/supabaseClient";
import { Positions } from "./Positions";

interface Props {
  config: Config;
  snapshot: PortfolioSnapshot;
  transacoes: Transacao[];
  ativos: Ativo[];
  precoAtualizadoEm: string | null;
  membro: string;
}

// Cores categóricas [claro, escuro] — validadas p/ daltonismo nos dois temas.
const COR_CARTEIRA: [string, string] = ["#2a78d6", "#3987e5"];
const COR_BENCH: Record<Benchmark, [string, string]> = {
  IBOV: ["#eb6834", "#d95926"],
  SP500: ["#1baf7a", "#199e70"],
  CDI: ["#eda100", "#c98500"],
  IPCA: ["#e87ba4", "#d55181"],
};

const PRESETS: Array<{ id: PresetPeriodo; rotulo: string }> = [
  { id: "mes", rotulo: "Este mês" },
  { id: "3m", rotulo: "3 meses" },
  { id: "12m", rotulo: "12 meses" },
  { id: "tudo", rotulo: "Tudo" },
  { id: "custom", rotulo: "Personalizado" },
];

/** Detecta tema para escolher tons de eixo/grade e a coluna de cor certa. */
function useTemaEscuro(): boolean {
  const [escuro, setEscuro] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setEscuro(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return escuro;
}

export function Report({ config, snapshot, transacoes, ativos, precoAtualizadoEm, membro }: Props) {
  const escuro = useTemaEscuro();
  const idx = escuro ? 1 : 0;
  const cores = {
    eixo: escuro ? "#97a3b2" : "#6c6558",
    grade: escuro ? "#263544" : "#e4ddd0",
    carteira: COR_CARTEIRA[idx],
    tooltip: {
      background: "var(--superficie)",
      border: "1px solid var(--borda)",
      borderRadius: 8,
      color: "var(--texto)",
      fontSize: "0.85rem",
    } as const,
  };

  const [historico, setHistorico] = useState<HistoricoPrecos | null>(null);
  const [carregandoHist, setCarregandoHist] = useState(true);
  const [erroHist, setErroHist] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [preset, setPreset] = useState<PresetPeriodo>("12m");
  const hoje = useMemo(() => new Date(), []);
  const [custom, setCustom] = useState<Intervalo>(() => intervaloDoPreset("3m", hoje, config.dataInicio));
  const [benches, setBenches] = useState<Benchmark[]>(["IBOV", "CDI"]);

  useEffect(() => {
    let vivo = true;
    setCarregandoHist(true);
    setErroHist(null);
    carregarHistorico()
      .then((h) => vivo && setHistorico(h))
      .catch((e) => vivo && setErroHist(e instanceof Error ? e.message : String(e)))
      .finally(() => vivo && setCarregandoHist(false));
    return () => {
      vivo = false;
    };
  }, []);

  const intervalo = useMemo<Intervalo>(
    () => (preset === "custom" ? custom : intervaloDoPreset(preset, hoje, config.dataInicio)),
    [preset, custom, hoje, config.dataInicio],
  );

  const evolucao = useMemo(
    () => (historico ? computarEvolucao(config, transacoes, ativos, historico, intervalo) : null),
    [historico, config, transacoes, ativos, intervalo],
  );

  const html = () => renderReportHtml(config, snapshot, precoAtualizadoEm, evolucao ?? undefined);

  const baixar = () => {
    const blob = new Blob([html()], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const commitarSnapshot = async () => {
    setStatus("Salvando snapshot na nuvem...");
    try {
      await salvarRelatorio(html(), membro);
      setStatus("Snapshot salvo na nuvem (tabela reports).");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleBench = (b: Benchmark) =>
    setBenches((atual) => (atual.includes(b) ? atual.filter((x) => x !== b) : [...atual, b]));

  const temEvolucao = evolucao?.temDados ?? false;

  return (
    <div className="grid">
      {/* Barra de ações */}
      <div className="card no-print">
        <div className="row">
          <h3 style={{ margin: 0 }}>Relatório da carteira</h3>
          <div className="spacer" />
          <button className="secundario" onClick={() => window.print()}>
            Imprimir / PDF
          </button>
          <button className="secundario" onClick={baixar}>
            Baixar HTML
          </button>
          <button onClick={commitarSnapshot}>Salvar snapshot na nuvem</button>
        </div>
        {status && (
          <p className="muted" style={{ marginBottom: 0 }}>
            {status}
          </p>
        )}
      </div>

      {/* Cabeçalho */}
      <div className="card">
        <h2 style={{ marginBottom: "0.25rem" }}>{config.nomeLiga}</h2>
        <p className="muted" style={{ margin: 0 }}>
          Capital inicial {fmtBRL(config.capitalInicial)} (fixo) ·{" "}
          {temEvolucao
            ? `período ${fmtData(evolucao!.intervalo.de)} → ${fmtData(evolucao!.intervalo.ate)}`
            : "análise por período"}
        </p>
      </div>

      {/* Controles: período + benchmarks */}
      <div className="card no-print">
        <div className="controles">
          <div className="controles__linha">
            <span className="controles__rotulo">Período</span>
            <div className="segmented">
              {PRESETS.map((p) => (
                <button key={p.id} className={preset === p.id ? "ativo" : ""} onClick={() => setPreset(p.id)}>
                  {p.rotulo}
                </button>
              ))}
            </div>
          </div>

          {preset === "custom" && (
            <div className="datas-custom">
              <div className="campo">
                <label htmlFor="de">De</label>
                <input id="de" type="date" value={custom.de} onChange={(e) => setCustom((c) => ({ ...c, de: e.target.value }))} />
              </div>
              <div className="campo">
                <label htmlFor="ate">Até</label>
                <input id="ate" type="date" value={custom.ate} onChange={(e) => setCustom((c) => ({ ...c, ate: e.target.value }))} />
              </div>
            </div>
          )}

          <div className="controles__linha">
            <span className="controles__rotulo">Comparar com</span>
            <div className="chips">
              {BENCHMARKS.map((b) => (
                <button
                  key={b}
                  className={`chip-toggle ${benches.includes(b) ? "ativo" : ""}`}
                  onClick={() => toggleBench(b)}
                  aria-pressed={benches.includes(b)}
                >
                  <span className="ponto" style={{ background: COR_BENCH[b][idx] }} />
                  {ROTULO_BENCHMARK[b]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* KPIs do período */}
      <div className="kpis">
        <Kpi rotulo="Patrimônio" valor={fmtBRL(snapshot.patrimonioBRL)} />
        {temEvolucao ? (
          <>
            <Kpi
              rotulo="Valorização no período"
              valor={fmtBRL(evolucao!.valorizacaoBRL)}
              classe={sinal(evolucao!.valorizacaoBRL)}
              extra={fmtPct(evolucao!.valorizacaoPct)}
              extraClasse={sinal(evolucao!.valorizacaoPct)}
            />
            <Kpi
              rotulo="Patrimônio no início"
              valor={fmtBRL(evolucao!.patrimonioInicio)}
              extra={`até ${fmtBRL(evolucao!.patrimonioFim)}`}
            />
          </>
        ) : (
          <Kpi rotulo="Valorização no período" valor="—" extra="sem histórico ainda" />
        )}
        <Kpi
          rotulo="Retorno total (desde início)"
          valor={fmtPct(snapshot.retornoTotalPct)}
          classe={sinal(snapshot.retornoTotalPct)}
        />
      </div>

      {/* Comparativo carteira × benchmarks */}
      {temEvolucao && benches.length > 0 && (
        <div className="card">
          <div className="grafico-cab">
            <h3>Rentabilidade no período</h3>
            <span className="muted">carteira vs. índices</span>
          </div>
          <div className="comparativo">
            <span className="pill">
              <span className="ponto" style={{ background: cores.carteira }} />
              <span className="rot">Carteira</span>
              <b className={sinal(evolucao!.valorizacaoPct)}>{fmtPct(evolucao!.valorizacaoPct)}</b>
            </span>
            {benches.map((b) => {
              const v = evolucao!.benchmarks[b];
              const delta = v == null ? null : evolucao!.valorizacaoPct - v;
              return (
                <span className="pill" key={b}>
                  <span className="ponto" style={{ background: COR_BENCH[b][idx] }} />
                  <span className="rot">{ROTULO_BENCHMARK[b]}</span>
                  <b className={sinal(v)}>{fmtPct(v)}</b>
                  {delta != null && (
                    <span className="muted" style={{ fontSize: "0.78rem" }}>
                      ({delta >= 0 ? "+" : ""}
                      {delta.toFixed(2)} p.p.)
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Estados de carregamento / vazio */}
      {carregandoHist && <div className="card muted">Carregando série histórica...</div>}
      {erroHist && <div className="alerta">Erro ao carregar histórico: {erroHist}</div>}
      {!carregandoHist && !erroHist && evolucao && !temEvolucao && (
        <div className="card aviso">
          Ainda não há série histórica para este período. Rode a Action de histórico (<code>fetch-history</code>) —
          ela preenche a evolução com ~1 ano de dados. Enquanto isso, os indicadores acima e as posições abaixo
          seguem atualizados.
        </div>
      )}

      {/* Gráfico de evolução do patrimônio */}
      {temEvolucao && (
        <div className="card">
          <div className="grafico-cab">
            <h3>Evolução do patrimônio</h3>
            <span className="muted">valor de mercado consolidado em BRL</span>
          </div>
          <div className="grafico-caixa" style={{ height: 300 }}>
            <ResponsiveContainer>
              <AreaChart data={evolucao!.serie} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id="gradPatrimonio" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={cores.carteira} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={cores.carteira} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={cores.grade} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="data"
                  tickFormatter={fmtData}
                  tick={{ fill: cores.eixo, fontSize: 12 }}
                  minTickGap={40}
                  tickLine={false}
                  axisLine={{ stroke: cores.grade }}
                />
                <YAxis
                  tickFormatter={(v) => fmtBRLCurto(Number(v))}
                  tick={{ fill: cores.eixo, fontSize: 12 }}
                  width={64}
                  tickLine={false}
                  axisLine={false}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  contentStyle={cores.tooltip}
                  labelFormatter={(l) => fmtData(String(l))}
                  formatter={(v) => [fmtBRL(Number(v)), "Patrimônio"]}
                />
                <Area
                  type="monotone"
                  dataKey="patrimonioBRL"
                  stroke={cores.carteira}
                  strokeWidth={2}
                  fill="url(#gradPatrimonio)"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Gráfico de rentabilidade % (carteira vs benchmarks) */}
      {temEvolucao && (
        <div className="card">
          <div className="grafico-cab">
            <h3>Rentabilidade acumulada (%)</h3>
            <span className="muted">rebase a 0% no início do período</span>
          </div>
          <div className="grafico-caixa" style={{ height: 300 }}>
            <ResponsiveContainer>
              <LineChart data={evolucao!.serieRentabilidade} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={cores.grade} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="data"
                  tickFormatter={fmtData}
                  tick={{ fill: cores.eixo, fontSize: 12 }}
                  minTickGap={40}
                  tickLine={false}
                  axisLine={{ stroke: cores.grade }}
                />
                <YAxis
                  tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                  tick={{ fill: cores.eixo, fontSize: 12 }}
                  width={48}
                  tickLine={false}
                  axisLine={false}
                />
                <ReferenceLine y={0} stroke={cores.eixo} strokeOpacity={0.5} />
                <Tooltip
                  contentStyle={cores.tooltip}
                  labelFormatter={(l) => fmtData(String(l))}
                  formatter={(v, n) => [fmtPct(Number(v)), n === "carteira" ? "Carteira" : ROTULO_BENCHMARK[n as Benchmark]]}
                />
                <Legend
                  formatter={(v) => (v === "carteira" ? "Carteira" : ROTULO_BENCHMARK[v as Benchmark])}
                  wrapperStyle={{ fontSize: "0.82rem" }}
                />
                <Line type="monotone" dataKey="carteira" name="carteira" stroke={cores.carteira} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                {benches.map((b) => (
                  <Line
                    key={b}
                    type="monotone"
                    dataKey={b}
                    name={b}
                    stroke={COR_BENCH[b][idx]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Retornos mês a mês */}
      {temEvolucao && evolucao!.retornosMensais.length > 0 && (
        <div className="card">
          <div className="grafico-cab">
            <h3>Retorno mês a mês (%)</h3>
            <span className="muted">variação do patrimônio em cada mês</span>
          </div>
          <div className="grafico-caixa" style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={evolucao!.retornosMensais} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={cores.grade} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="mes"
                  tickFormatter={fmtMes}
                  tick={{ fill: cores.eixo, fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: cores.grade }}
                />
                <YAxis
                  tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                  tick={{ fill: cores.eixo, fontSize: 12 }}
                  width={48}
                  tickLine={false}
                  axisLine={false}
                />
                <ReferenceLine y={0} stroke={cores.eixo} strokeOpacity={0.5} />
                <Tooltip
                  cursor={{ fill: cores.grade, fillOpacity: 0.25 }}
                  contentStyle={cores.tooltip}
                  labelFormatter={(l) => fmtMes(String(l))}
                  formatter={(v) => [fmtPct(Number(v)), "Retorno"]}
                />
                <Bar dataKey="retornoPct" radius={[4, 4, 0, 0]}>
                  {evolucao!.retornosMensais.map((m) => (
                    <Cell key={m.mes} fill={m.retornoPct >= 0 ? (escuro ? "#34d399" : "#0e7a45") : escuro ? "#f87171" : "#b11d1d"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <Positions snapshot={snapshot} />
    </div>
  );
}

function Kpi({
  rotulo,
  valor,
  classe,
  extra,
  extraClasse,
}: {
  rotulo: string;
  valor: string;
  classe?: string;
  extra?: string;
  extraClasse?: string;
}) {
  return (
    <div className="card kpi">
      <div className={`valor ${classe ?? ""}`}>{valor}</div>
      <div className="rotulo">{rotulo}</div>
      {extra && <div className={`extra ${extraClasse ?? ""}`}>{extra}</div>}
    </div>
  );
}

function sinal(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "";
  return v >= 0 ? "pos" : "neg";
}

/** "2026-07-24" -> "24/07". */
function fmtData(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  return m ? `${m[3]}/${m[2]}` : ymd;
}

/** "2026-07" -> "jul/26". */
function fmtMes(ym: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  if (!m) return ym;
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${meses[Number(m[2]) - 1] ?? m[2]}/${m[1].slice(2)}`;
}

/** BRL compacto para o eixo Y (ex.: "R$ 1,2 mi"). */
function fmtBRLCurto(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (abs >= 1_000) return `R$ ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return `R$ ${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}
