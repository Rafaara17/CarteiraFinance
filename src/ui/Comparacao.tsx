import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { diffCarteiras, type ItemRanking } from "../engine/comparacao";
import {
  BENCHMARKS,
  ROTULO_BENCHMARK,
  computarEvolucao,
  intervaloDoPreset,
  type Benchmark,
  type Intervalo,
  type PresetPeriodo,
} from "../engine/evolucao";
import { fmtBRL, fmtPct } from "../engine/report";
import type { Ativo, Config, HistoricoPrecos, PortfolioSnapshot, Transacao } from "../engine/types";
import { carregarHistorico } from "../data/supabaseClient";

interface Props {
  config: Config;
  ativos: Ativo[];
  snapshotLiga: PortfolioSnapshot;
  snapshotMinha: PortfolioSnapshot | null;
  transacoesLiga: Transacao[];
  transacoesMinha: Transacao[];
  ranking: ItemRanking[];
  ativarMinhaCarteira: () => Promise<void>;
}

const COR_MINHA: [string, string] = ["#2a78d6", "#3987e5"];
const COR_LIGA: [string, string] = ["#eb6834", "#d95926"];
const COR_BENCH: Record<Benchmark, [string, string]> = {
  IBOV: ["#1baf7a", "#199e70"],
  SP500: ["#8b5cf6", "#a78bfa"],
  CDI: ["#eda100", "#c98500"],
  IPCA: ["#e87ba4", "#d55181"],
};

const PRESETS: Array<{ id: PresetPeriodo; rotulo: string }> = [
  { id: "3m", rotulo: "3 meses" },
  { id: "12m", rotulo: "12 meses" },
  { id: "tudo", rotulo: "Tudo" },
];

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

export function Comparacao(props: Props) {
  const { config, ativos, snapshotLiga, snapshotMinha, transacoesLiga, transacoesMinha } = props;
  const escuro = useTemaEscuro();
  const idx = escuro ? 1 : 0;

  const [ativando, setAtivando] = useState(false);
  const [erroAtivar, setErroAtivar] = useState<string | null>(null);

  async function ativar() {
    setErroAtivar(null);
    setAtivando(true);
    try {
      await props.ativarMinhaCarteira();
    } catch (e) {
      setErroAtivar(e instanceof Error ? e.message : String(e));
    } finally {
      setAtivando(false);
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <h2 style={{ marginBottom: "0.25rem" }}>Minha carteira × Carteira da Liga</h2>
        <p className="muted" style={{ margin: 0 }}>
          Ambas partem do mesmo capital inicial fixo ({fmtBRL(config.capitalInicial)}) e da mesma data —
          então o retorno é diretamente comparável.
        </p>
      </div>

      {snapshotMinha ? (
        <ComparativoKpis minha={snapshotMinha} liga={snapshotLiga} />
      ) : (
        <div className="card aviso">
          <p style={{ marginTop: 0 }}>
            Você ainda não ativou sua <strong>carteira pessoal</strong>. Ao criar, ela nasce como uma cópia
            da carteira da liga neste momento; a partir daí você opera livremente para divergir do que não
            concordar. As decisões futuras da liga não entram sozinhas.
          </p>
          <button onClick={ativar} disabled={ativando}>
            {ativando ? "Criando..." : "Criar minha carteira a partir da liga"}
          </button>
          {erroAtivar && <p className="alerta" style={{ marginBottom: 0 }}>{erroAtivar}</p>}
        </div>
      )}

      {snapshotMinha && (
        <OverlayRentabilidade
          config={config}
          ativos={ativos}
          transacoesLiga={transacoesLiga}
          transacoesMinha={transacoesMinha}
          idx={idx}
          escuro={escuro}
        />
      )}

      <RankingTabela ranking={props.ranking} />
    </div>
  );
}

function ComparativoKpis({ minha, liga }: { minha: PortfolioSnapshot; liga: PortfolioSnapshot }) {
  const d = diffCarteiras(minha, liga);
  const ganhando = d.deltaPct >= 0;
  return (
    <>
      <div className="card" style={{ borderLeft: `4px solid ${ganhando ? "var(--pos, #0e7a45)" : "var(--neg, #b11d1d)"}` }}>
        <strong style={{ fontSize: "1.05rem" }}>
          {ganhando
            ? `Você está ganhando da liga por ${fmtPct(d.deltaPct)}.`
            : `Você está atrás da liga em ${fmtPct(Math.abs(d.deltaPct))}.`}
        </strong>
        <div className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>
          Diferença de patrimônio: {d.deltaPatrimonioBRL >= 0 ? "+" : ""}
          {fmtBRL(d.deltaPatrimonioBRL)}
        </div>
      </div>
      <div className="kpis">
        <Kpi rotulo="Patrimônio (minha)" valor={fmtBRL(minha.patrimonioBRL)} />
        <Kpi rotulo="Patrimônio (liga)" valor={fmtBRL(liga.patrimonioBRL)} />
        <Kpi rotulo="Retorno total (minha)" valor={fmtPct(minha.retornoTotalPct)} classe={sinal(minha.retornoTotalPct)} />
        <Kpi rotulo="Retorno total (liga)" valor={fmtPct(liga.retornoTotalPct)} classe={sinal(liga.retornoTotalPct)} />
        <Kpi rotulo="Diferença (minha − liga)" valor={`${d.deltaPct >= 0 ? "+" : ""}${d.deltaPct.toFixed(2)} p.p.`} classe={sinal(d.deltaPct)} />
        <Kpi rotulo="P&L realizado (minha)" valor={fmtBRL(minha.plRealizadoBRL)} classe={sinal(minha.plRealizadoBRL)} />
      </div>
    </>
  );
}

interface OverlayProps {
  config: Config;
  ativos: Ativo[];
  transacoesLiga: Transacao[];
  transacoesMinha: Transacao[];
  idx: number;
  escuro: boolean;
}

function OverlayRentabilidade({ config, ativos, transacoesLiga, transacoesMinha, idx, escuro }: OverlayProps) {
  const [historico, setHistorico] = useState<HistoricoPrecos | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [preset, setPreset] = useState<PresetPeriodo>("12m");
  const [benches, setBenches] = useState<Benchmark[]>([]);
  const hoje = useMemo(() => new Date(), []);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    carregarHistorico()
      .then((h) => vivo && setHistorico(h))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : String(e)))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, []);

  const intervalo = useMemo<Intervalo>(() => intervaloDoPreset(preset, hoje, config.dataInicio), [preset, hoje, config.dataInicio]);

  const { dados, temDados } = useMemo(() => {
    if (!historico) return { dados: [] as Array<Record<string, number | string>>, temDados: false };
    const evoLiga = computarEvolucao(config, transacoesLiga, ativos, historico, intervalo);
    const evoMinha = computarEvolucao(config, transacoesMinha, ativos, historico, intervalo);
    if (!evoLiga.temDados && !evoMinha.temDados) return { dados: [], temDados: false };

    const porData = new Map<string, Record<string, number | string>>();
    for (const p of evoLiga.serieRentabilidade) {
      const linha = porData.get(p.data) ?? { data: p.data };
      linha.liga = p.carteira;
      for (const b of BENCHMARKS) if (typeof p[b] === "number") linha[b] = p[b] as number;
      porData.set(p.data, linha);
    }
    for (const p of evoMinha.serieRentabilidade) {
      const linha = porData.get(p.data) ?? { data: p.data };
      linha.minha = p.carteira;
      porData.set(p.data, linha);
    }
    const dados = [...porData.values()].sort((a, b) => String(a.data).localeCompare(String(b.data)));
    return { dados, temDados: true };
  }, [historico, config, transacoesLiga, transacoesMinha, ativos, intervalo]);

  const cores = {
    eixo: escuro ? "#97a3b2" : "#6c6558",
    grade: escuro ? "#263544" : "#e4ddd0",
    minha: COR_MINHA[idx],
    liga: COR_LIGA[idx],
    tooltip: {
      background: "var(--superficie)",
      border: "1px solid var(--borda)",
      borderRadius: 8,
      color: "var(--texto)",
      fontSize: "0.85rem",
    } as const,
  };

  const toggleBench = (b: Benchmark) =>
    setBenches((atual) => (atual.includes(b) ? atual.filter((x) => x !== b) : [...atual, b]));

  const rotulo = (n: string) =>
    n === "minha" ? "Minha" : n === "liga" ? "Liga" : ROTULO_BENCHMARK[n as Benchmark];

  return (
    <div className="card">
      <div className="grafico-cab">
        <h3>Rentabilidade acumulada (%)</h3>
        <span className="muted">minha vs. liga · rebase a 0% no início do período</span>
      </div>

      <div className="controles no-print" style={{ marginBottom: "0.5rem" }}>
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

      {carregando && <div className="muted">Carregando série histórica...</div>}
      {erro && <div className="alerta">Erro ao carregar histórico: {erro}</div>}
      {!carregando && !erro && !temDados && (
        <div className="aviso">
          A série histórica é montada automaticamente uma vez por dia, após o fechamento — a comparação aparece no
          próximo pregão. Os indicadores acima já comparam sua carteira com a da liga.
        </div>
      )}

      {temDados && (
        <div className="grafico-caixa" style={{ height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={dados} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
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
                formatter={(v, n) => [fmtPct(Number(v)), rotulo(String(n))]}
              />
              <Legend formatter={(v) => rotulo(String(v))} wrapperStyle={{ fontSize: "0.82rem" }} />
              <Line type="monotone" dataKey="minha" name="minha" stroke={cores.minha} strokeWidth={2.5} dot={false} connectNulls activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="liga" name="liga" stroke={cores.liga} strokeWidth={2.5} dot={false} connectNulls activeDot={{ r: 4 }} />
              {benches.map((b) => (
                <Line key={b} type="monotone" dataKey={b} name={b} stroke={COR_BENCH[b][idx]} strokeWidth={1.8} dot={false} connectNulls activeDot={{ r: 4 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function RankingTabela({ ranking }: { ranking: ItemRanking[] }) {
  if (ranking.length === 0) return null;
  return (
    <div className="card">
      <div className="grafico-cab">
        <h3>Ranking das carteiras</h3>
        <span className="muted">por retorno total desde o início</span>
      </div>
      <div className="tabela-scroll">
        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Carteira</th>
              <th className="right">Patrimônio</th>
              <th className="right">Retorno total</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((r, i) => (
              <tr key={r.carteiraId} style={r.ehMinha ? { fontWeight: 600 } : undefined}>
                <td>{i + 1}</td>
                <td>
                  {r.nome}
                  {r.ehLiga && <span className="pill" style={{ marginLeft: 6, fontSize: "0.72rem" }}>Liga</span>}
                  {r.ehMinha && <span className="pill" style={{ marginLeft: 6, fontSize: "0.72rem" }}>você</span>}
                </td>
                <td className="right">{fmtBRL(r.patrimonioBRL)}</td>
                <td className={`right ${sinal(r.retornoTotalPct)}`}>{fmtPct(r.retornoTotalPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ rotulo, valor, classe }: { rotulo: string; valor: string; classe?: string }) {
  return (
    <div className="card kpi">
      <div className={`valor ${classe ?? ""}`}>{valor}</div>
      <div className="rotulo">{rotulo}</div>
    </div>
  );
}

function sinal(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "";
  return v >= 0 ? "pos" : "neg";
}

function fmtData(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  return m ? `${m[3]}/${m[2]}` : ymd;
}
