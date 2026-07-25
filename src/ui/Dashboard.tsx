import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BENCHMARKS,
  ROTULO_BENCHMARK,
  comPontoDeHoje,
  computarEvolucao,
  intervaloDoPreset,
  type Benchmark,
  type PresetPeriodo,
} from "../engine/evolucao";
import { fmtBRL, fmtPct } from "../engine/report";
import type { Ativo, Config, PortfolioSnapshot, Transacao } from "../engine/types";
import type { UltimaAtualizacao } from "../data/supabaseClient";
import { Dica, fmtBRLCurto, fmtData, sinal, usarPaleta, useTemaEscuro } from "./grafico";
import { useHistorico } from "./useHistorico";
import { BarraAlocacao } from "./Allocation";

interface Props {
  config: Config;
  snapshot: PortfolioSnapshot;
  transacoes: Transacao[];
  ativos: Ativo[];
  ultimaAtualizacao: UltimaAtualizacao | null;
  precoAtualizadoEm: string | null;
  precosDesatualizados: boolean;
  onIrPara: (aba: string) => void;
}

const PRESETS: Array<{ id: PresetPeriodo; rotulo: string }> = [
  { id: "mes", rotulo: "Mês" },
  { id: "3m", rotulo: "3 meses" },
  { id: "12m", rotulo: "12 meses" },
  { id: "tudo", rotulo: "Tudo" },
];

export function Dashboard(props: Props) {
  const { config, snapshot, transacoes, ativos } = props;
  const escuro = useTemaEscuro();
  const paleta = usarPaleta(escuro);

  return (
    <div className="grid" style={{ gap: "1.15rem" }}>
      {props.precosDesatualizados && (
        <div className="aviso no-print">
          As cotações ao vivo não responderam agora — os valores abaixo usam o último preço oficial
          gravado. Posições marcadas <strong>a custo</strong> ainda não têm cotação.
        </div>
      )}

      <Cabecalho snapshot={snapshot} config={config} />

      <div className="kpis">
        <Kpi rotulo="Caixa disponível" valor={fmtBRL(snapshot.caixaBRL)} />
        <Kpi rotulo="Investido" valor={fmtBRL(snapshot.valorInvestidoBRL)} extra={`${snapshot.posicoes.length} ${snapshot.posicoes.length === 1 ? "posição" : "posições"}`} />
        <Kpi
          rotulo="P&L não realizado"
          valor={fmtBRL(snapshot.plNaoRealizadoBRL)}
          classe={sinal(snapshot.plNaoRealizadoBRL)}
        />
        <Kpi
          rotulo="P&L realizado"
          valor={fmtBRL(snapshot.plRealizadoBRL)}
          classe={sinal(snapshot.plRealizadoBRL)}
          extra="vendas e proventos"
        />
      </div>

      <Evolucao
        config={config}
        transacoes={transacoes}
        ativos={ativos}
        snapshot={snapshot}
        paleta={paleta}
      />

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))" }}>
        <MaioresPosicoes snapshot={snapshot} onIrPara={props.onIrPara} />
        <div className="card">
          <div className="card__cab">
            <h3>Alocação por classe</h3>
            <span className="muted">% do patrimônio investido</span>
          </div>
          {snapshot.valorInvestidoBRL > 0 ? (
            <BarraAlocacao itens={snapshot.alocacaoPorClasse} paleta={paleta} />
          ) : (
            <p className="muted" style={{ margin: 0 }}>Sem posições ainda.</p>
          )}
        </div>
      </div>

      <Rodape {...props} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Cabecalho({ snapshot, config }: { snapshot: PortfolioSnapshot; config: Config }) {
  const v = snapshot.variacaoDiaPct;
  return (
    <div className="card">
      <div className="heroi">
        <div className="topo__rot">Patrimônio total</div>
        <div className="valor">{fmtBRL(snapshot.patrimonioBRL)}</div>
        <div className="sub">
          {v != null && (
            <span className={`num ${sinal(v)}`} style={{ fontWeight: 600 }}>
              {v >= 0 ? "▲" : "▼"} {fmtBRL(Math.abs(snapshot.variacaoDiaBRL))} ({fmtPct(v)}) hoje
            </span>
          )}
          <span className={`num ${sinal(snapshot.retornoTotalPct)}`} style={{ fontWeight: 600 }}>
            {fmtPct(snapshot.retornoTotalPct)} desde o início
          </span>
          <span className="muted">
            capital inicial {fmtBRL(config.capitalInicial)} (fixo)
          </span>
        </div>
      </div>
      {snapshot.posicoesSemPreco > 0 && (
        <p className="muted" style={{ margin: "0.85rem 0 0", fontSize: "0.82rem" }}>
          {snapshot.posicoesSemPreco === 1
            ? "1 posição está avaliada pelo custo"
            : `${snapshot.posicoesSemPreco} posições estão avaliadas pelo custo`}{" "}
          por ainda não ter cotação — o valor entra no patrimônio, mas sem valorização.
        </p>
      )}
    </div>
  );
}

function Kpi({ rotulo, valor, classe, extra }: { rotulo: string; valor: string; classe?: string; extra?: string }) {
  return (
    <div className="kpi">
      <div className="rotulo">{rotulo}</div>
      <div className={`valor ${classe ?? ""}`}>{valor}</div>
      {extra && <div className="extra">{extra}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface EvoProps {
  config: Config;
  transacoes: Transacao[];
  ativos: Ativo[];
  snapshot: PortfolioSnapshot;
  paleta: ReturnType<typeof usarPaleta>;
}

/**
 * Evolução do patrimônio + rentabilidade contra os índices. É a resposta para
 * "como a carteira está indo" — antes só existia enterrada na aba Relatório.
 */
function Evolucao({ config, transacoes, ativos, snapshot, paleta }: EvoProps) {
  const { historico, carregando, erro } = useHistorico();
  const [preset, setPreset] = useState<PresetPeriodo>("12m");
  const [benches, setBenches] = useState<Benchmark[]>(["IBOV", "CDI"]);
  const [vista, setVista] = useState<"patrimonio" | "rentabilidade">("patrimonio");
  const hoje = useMemo(() => new Date(), []);

  const evolucao = useMemo(() => {
    if (!historico) return null;
    const intervalo = intervaloDoPreset(preset, hoje, config.dataInicio);
    const ev = computarEvolucao(config, transacoes, ativos, historico, intervalo);
    return comPontoDeHoje(ev, snapshot.patrimonioBRL, hoje);
  }, [historico, config, transacoes, ativos, preset, hoje, snapshot.patrimonioBRL]);

  const temDados = evolucao?.temDados ?? false;

  return (
    <div className="card">
      <div className="card__cab">
        <h3>{vista === "patrimonio" ? "Evolução do patrimônio" : "Rentabilidade acumulada"}</h3>
        <span className="muted">
          {vista === "patrimonio" ? "valor de mercado consolidado em BRL" : "carteira vs. índices, rebase 0% no início"}
        </span>
        <div className="spacer" />
        <div className="segmented no-print">
          <button className={vista === "patrimonio" ? "ativo" : ""} onClick={() => setVista("patrimonio")}>R$</button>
          <button className={vista === "rentabilidade" ? "ativo" : ""} onClick={() => setVista("rentabilidade")}>%</button>
        </div>
      </div>

      <div className="controles no-print" style={{ marginBottom: "0.9rem" }}>
        <div className="controles__linha">
          <span className="controles__rotulo">Período</span>
          <div className="segmented">
            {PRESETS.map((p) => (
              <button key={p.id} className={preset === p.id ? "ativo" : ""} onClick={() => setPreset(p.id)}>
                {p.rotulo}
              </button>
            ))}
          </div>
          {vista === "rentabilidade" && (
            <>
              <span className="controles__rotulo" style={{ marginLeft: "0.5rem" }}>Comparar</span>
              <div className="chips">
                {BENCHMARKS.map((b) => (
                  <button
                    key={b}
                    className={`chip-toggle ${benches.includes(b) ? "ativo" : ""}`}
                    aria-pressed={benches.includes(b)}
                    onClick={() =>
                      setBenches((a) => (a.includes(b) ? a.filter((x) => x !== b) : [...a, b]))
                    }
                  >
                    <span className="ponto" style={{ background: paleta.benchmark[b] }} />
                    {ROTULO_BENCHMARK[b]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Rótulos diretos: a cor não é o único identificador da série. */}
      {temDados && vista === "rentabilidade" && (
        <div className="row" style={{ marginBottom: "0.9rem", gap: "0.5rem" }}>
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
      )}

      {carregando && <p className="muted" style={{ margin: 0 }}>Carregando série histórica…</p>}
      {erro && <div className="alerta">Erro ao carregar histórico: {erro}</div>}
      {!carregando && !erro && !temDados && <SemHistorico />}

      {temDados && vista === "patrimonio" && (
        <div className="grafico" style={{ height: 300 }}>
          <ResponsiveContainer>
            <AreaChart data={evolucao!.serie} margin={{ top: 6, right: 10, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="gradPatrimonio" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={paleta.carteira} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={paleta.carteira} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={paleta.grade} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="data" tickFormatter={fmtData} tick={{ fill: paleta.eixo, fontSize: 12 }} minTickGap={44} tickLine={false} axisLine={{ stroke: paleta.grade }} />
              <YAxis tickFormatter={(v) => fmtBRLCurto(Number(v))} tick={{ fill: paleta.eixo, fontSize: 12 }} width={72} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
              <Tooltip content={<Dica rotulo={() => "Patrimônio"} formatar={fmtBRL} />} />
              <Area type="monotone" dataKey="patrimonioBRL" stroke={paleta.carteira} strokeWidth={2} fill="url(#gradPatrimonio)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--superficie)" }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {temDados && vista === "rentabilidade" && (
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
      )}
    </div>
  );
}

function SemHistorico() {
  return (
    <div className="aviso">
      A série histórica ainda não foi gerada. Um <strong>admin</strong> pode criá-la agora em{" "}
      <strong>Admin → Série histórica</strong> (leva alguns segundos e traz ~2 anos de dados); depois
      disso ela se atualiza sozinha todo dia após o fechamento.
    </div>
  );
}

// ---------------------------------------------------------------------------

function MaioresPosicoes({ snapshot, onIrPara }: { snapshot: PortfolioSnapshot; onIrPara: (a: string) => void }) {
  const top = snapshot.posicoes.slice(0, 6);
  return (
    <div className="card">
      <div className="card__cab">
        <h3>Maiores posições</h3>
        <div className="spacer" />
        <button className="secundario no-print" onClick={() => onIrPara("posicoes")} style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}>
          Ver todas
        </button>
      </div>
      {top.length === 0 ? (
        <div className="vazio">
          <span className="vazio__ico" aria-hidden="true">📈</span>
          <strong>Nenhuma posição ainda</strong>
          A carteira está 100% em caixa.
        </div>
      ) : (
        <div className="tabela-scroll">
          <table>
            <thead>
              <tr>
                <th>Ativo</th>
                <th className="right">Valor</th>
                <th className="right">Hoje</th>
                <th className="right">Peso</th>
              </tr>
            </thead>
            <tbody>
              {top.map((p) => (
                <tr key={p.ticker}>
                  <td className="td-principal">
                    {p.ticker}
                    <div className="td-sub">{p.nome}</div>
                  </td>
                  <td className="right">{fmtBRL(p.valorBRL)}</td>
                  <td className={`right ${sinal(p.variacaoDiaPct)}`}>
                    {p.variacaoDiaPct == null ? "—" : fmtPct(p.variacaoDiaPct)}
                  </td>
                  <td className="right">{fmtPct(p.pesoPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Rodape({ precoAtualizadoEm, ultimaAtualizacao, snapshot }: Props) {
  return (
    <div className="row muted" style={{ fontSize: "0.8rem", gap: "1.2rem" }}>
      <span>
        Preços: {precoAtualizadoEm ? new Date(precoAtualizadoEm).toLocaleString("pt-BR") : "—"}
      </span>
      {snapshot.cambioUSD != null && <span>Dólar: R$ {snapshot.cambioUSD.toFixed(4)}</span>}
      {ultimaAtualizacao && (
        <span>
          Última operação: {new Date(ultimaAtualizacao.data).toLocaleString("pt-BR")} — {ultimaAtualizacao.autor}
        </span>
      )}
    </div>
  );
}
