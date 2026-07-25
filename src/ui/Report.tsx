import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
  comPontoDeHoje,
  computarEvolucao,
  intervaloDoPreset,
  type Benchmark,
  type Intervalo,
  type PresetPeriodo,
} from "../engine/evolucao";
import type { Ativo, Config, PortfolioSnapshot, Transacao } from "../engine/types";
import { salvarRelatorio } from "../data/supabaseClient";
import { Dica, fmtData, fmtMes, sinal, usarPaleta, useTemaEscuro } from "./grafico";
import { useHistorico } from "./useHistorico";
import { Positions } from "./Positions";

interface Props {
  config: Config;
  snapshot: PortfolioSnapshot;
  transacoes: Transacao[];
  ativos: Ativo[];
  precoAtualizadoEm: string | null;
  membro: string;
}

const PRESETS: Array<{ id: PresetPeriodo; rotulo: string }> = [
  { id: "mes", rotulo: "Este mês" },
  { id: "3m", rotulo: "3 meses" },
  { id: "12m", rotulo: "12 meses" },
  { id: "tudo", rotulo: "Tudo" },
  { id: "custom", rotulo: "Personalizado" },
];

export function Report({ config, snapshot, transacoes, ativos, precoAtualizadoEm, membro }: Props) {
  const escuro = useTemaEscuro();
  const paleta = usarPaleta(escuro);
  const { historico, carregando, erro } = useHistorico();

  const [status, setStatus] = useState<string | null>(null);
  const [preset, setPreset] = useState<PresetPeriodo>("12m");
  const hoje = useMemo(() => new Date(), []);
  const [custom, setCustom] = useState<Intervalo>(() => intervaloDoPreset("3m", hoje, config.dataInicio));
  const [benches, setBenches] = useState<Benchmark[]>(["IBOV", "CDI"]);

  const intervalo = useMemo<Intervalo>(
    () => (preset === "custom" ? custom : intervaloDoPreset(preset, hoje, config.dataInicio)),
    [preset, custom, hoje, config.dataInicio],
  );

  const evolucao = useMemo(() => {
    if (!historico) return null;
    const ev = computarEvolucao(config, transacoes, ativos, historico, intervalo);
    return comPontoDeHoje(ev, snapshot.patrimonioBRL, hoje);
  }, [historico, config, transacoes, ativos, intervalo, snapshot.patrimonioBRL, hoje]);

  const temEvolucao = evolucao?.temDados ?? false;
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

  const salvar = async () => {
    setStatus("Salvando snapshot na nuvem…");
    try {
      await salvarRelatorio(html(), membro);
      setStatus("Snapshot salvo na nuvem (tabela reports).");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="grid">
      <div className="card no-print">
        <div className="row">
          <div>
            <h3 style={{ margin: 0 }}>{config.nomeLiga}</h3>
            <span className="muted" style={{ fontSize: "0.85rem" }}>
              Capital inicial {fmtBRL(config.capitalInicial)} ·{" "}
              {temEvolucao
                ? `período ${fmtData(evolucao!.intervalo.de)} → ${fmtData(evolucao!.intervalo.ate)}`
                : "análise por período"}
            </span>
          </div>
          <div className="spacer" />
          <button className="secundario" onClick={() => window.print()}>Imprimir / PDF</button>
          <button className="secundario" onClick={baixar}>Baixar HTML</button>
          <button onClick={salvar}>Salvar snapshot</button>
        </div>
        {status && <p className="muted" style={{ marginBottom: 0, marginTop: "0.6rem" }}>{status}</p>}
      </div>

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
                  aria-pressed={benches.includes(b)}
                  onClick={() => setBenches((a) => (a.includes(b) ? a.filter((x) => x !== b) : [...a, b]))}
                >
                  <span className="ponto" style={{ background: paleta.benchmark[b] }} />
                  {ROTULO_BENCHMARK[b]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

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

      {temEvolucao && benches.length > 0 && (
        <div className="card">
          <div className="card__cab">
            <h3>Rentabilidade no período</h3>
            <span className="muted">carteira vs. índices</span>
          </div>
          <div className="row" style={{ gap: "0.5rem" }}>
            <span className="pill">
              <span className="ponto" style={{ background: paleta.carteira }} />
              <span className="rot">Carteira</span>
              <b className={sinal(evolucao!.valorizacaoPct)}>{fmtPct(evolucao!.valorizacaoPct)}</b>
            </span>
            {benches.map((b) => {
              const v = evolucao!.benchmarks[b];
              const delta = v == null ? null : evolucao!.valorizacaoPct - v;
              return (
                <span className="pill" key={b}>
                  <span className="ponto" style={{ background: paleta.benchmark[b] }} />
                  <span className="rot">{ROTULO_BENCHMARK[b]}</span>
                  <b className={sinal(v)}>{fmtPct(v)}</b>
                  {delta != null && (
                    <span className="fraco" style={{ fontSize: "0.76rem" }}>
                      ({delta >= 0 ? "+" : ""}{delta.toFixed(2)} p.p.)
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {carregando && <div className="card muted">Carregando série histórica…</div>}
      {erro && <div className="alerta">Erro ao carregar histórico: {erro}</div>}
      {!carregando && !erro && evolucao && !temEvolucao && (
        <div className="card aviso">
          Ainda não há série histórica para este período. Um admin pode gerá-la em{" "}
          <strong>Admin → Série histórica</strong>; os indicadores acima e as posições abaixo já estão
          atualizados.
        </div>
      )}

      {temEvolucao && (
        <div className="card">
          <div className="card__cab">
            <h3>Rentabilidade acumulada (%)</h3>
            <span className="muted">rebase a 0% no início do período</span>
          </div>
          <div className="grafico" style={{ height: 300 }}>
            <ResponsiveContainer>
              <LineChart data={evolucao!.serieRentabilidade} margin={{ top: 6, right: 10, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={paleta.grade} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="data" tickFormatter={fmtData} tick={{ fill: paleta.eixo, fontSize: 12 }} minTickGap={44} tickLine={false} axisLine={{ stroke: paleta.grade }} />
                <YAxis tickFormatter={(v) => `${Number(v).toFixed(0)}%`} tick={{ fill: paleta.eixo, fontSize: 12 }} width={52} tickLine={false} axisLine={false} />
                <ReferenceLine y={0} stroke={paleta.eixo} strokeOpacity={0.5} />
                <Tooltip
                  content={
                    <Dica
                      rotulo={(n) => (n === "carteira" ? "Carteira" : ROTULO_BENCHMARK[n as Benchmark] ?? n)}
                      formatar={fmtPct}
                    />
                  }
                />
                <Line type="monotone" dataKey="carteira" name="carteira" stroke={paleta.carteira} strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--superficie)" }} />
                {benches.map((b) => (
                  <Line key={b} type="monotone" dataKey={b} name={b} stroke={paleta.benchmark[b]} strokeWidth={2} dot={false} connectNulls activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--superficie)" }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {temEvolucao && evolucao!.retornosMensais.length > 0 && (
        <div className="card">
          <div className="card__cab">
            <h3>Retorno mês a mês (%)</h3>
            <span className="muted">variação do patrimônio em cada mês — acima/abaixo da linha zero</span>
          </div>
          <div className="grafico" style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={evolucao!.retornosMensais} margin={{ top: 6, right: 10, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={paleta.grade} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="mes" tickFormatter={fmtMes} tick={{ fill: paleta.eixo, fontSize: 12 }} tickLine={false} axisLine={{ stroke: paleta.grade }} />
                <YAxis tickFormatter={(v) => `${Number(v).toFixed(0)}%`} tick={{ fill: paleta.eixo, fontSize: 12 }} width={52} tickLine={false} axisLine={false} />
                <ReferenceLine y={0} stroke={paleta.eixo} strokeOpacity={0.6} />
                <Tooltip
                  cursor={{ fill: paleta.grade, fillOpacity: 0.3 }}
                  content={<Dica rotulo={() => "Retorno"} formatar={fmtPct} />}
                />
                <Bar dataKey="retornoPct" radius={[4, 4, 0, 0]} name="retorno">
                  {evolucao!.retornosMensais.map((m) => (
                    <Cell key={m.mes} fill={m.retornoPct >= 0 ? paleta.pos : paleta.neg} />
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
  rotulo, valor, classe, extra, extraClasse,
}: {
  rotulo: string; valor: string; classe?: string; extra?: string; extraClasse?: string;
}) {
  return (
    <div className="kpi">
      <div className="rotulo">{rotulo}</div>
      <div className={`valor ${classe ?? ""}`}>{valor}</div>
      {extra && <div className={`extra ${extraClasse ?? ""}`}>{extra}</div>}
    </div>
  );
}
