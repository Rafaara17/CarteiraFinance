import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Membro, Wallet } from "../data/supabaseClient";
import { diffCarteiras } from "../engine/comparacao";
import {
  BENCHMARKS,
  ROTULO_BENCHMARK,
  computarEvolucao,
  intervaloDoPreset,
  type Benchmark,
  type PresetPeriodo,
} from "../engine/evolucao";
import { fmtBRL, fmtPct } from "../engine/report";
import type { LinhaSemanal, RankingSemanal } from "../engine/semanal";
import type { Ativo, Config, PortfolioSnapshot, PrecosSnapshot, Transacao } from "../engine/types";
import { Dica, fmtData, fmtDataLonga, sinal, usarPaleta, useTemaEscuro } from "./grafico";
import { useHistorico } from "./useHistorico";
import { useRankingSemanal } from "./useRankingSemanal";

interface Props {
  config: Config;
  ativos: Ativo[];
  precos: PrecosSnapshot;
  snapshotLiga: PortfolioSnapshot | null;
  snapshotMinha: PortfolioSnapshot | null;
  transacoesLiga: Transacao[];
  transacoesMinha: Transacao[];
  wallets: Wallet[];
  membros: Membro[];
  transacoesPorCarteira: Map<string, Transacao[]>;
  minhaCarteiraId: string | null;
  onAtivar: () => void;
}

const PRESETS: Array<{ id: PresetPeriodo; rotulo: string }> = [
  { id: "3m", rotulo: "3 meses" },
  { id: "12m", rotulo: "12 meses" },
  { id: "tudo", rotulo: "Tudo" },
];

/**
 * Placar da liga. A disputa que vale é a SEMANAL — cada semana tem um vencedor e
 * o placar fecha no domingo —, então ela abre a tela; o acumulado desde o início
 * fica ao lado, na mesma tabela, para não virar um segundo ranking concorrente.
 */
export function Comparar(props: Props) {
  const escuro = useTemaEscuro();
  const paleta = usarPaleta(escuro);
  const { ranking, carregando, erro } = useRankingSemanal(props);

  return (
    <div className="grid" style={{ gap: "1.15rem" }}>
      {carregando && <div className="card"><div className="vazio">Carregando a série histórica…</div></div>}
      {erro && <div className="alerta">Erro ao carregar o histórico: {erro}</div>}

      {ranking && <Semana ranking={ranking} />}
      {ranking && <Tabela ranking={ranking} />}

      {props.snapshotMinha && props.snapshotLiga ? (
        <>
          <MinhaVsLiga minha={props.snapshotMinha} liga={props.snapshotLiga} />
          <Overlay
            config={props.config}
            ativos={props.ativos}
            transacoesLiga={props.transacoesLiga}
            transacoesMinha={props.transacoesMinha}
            paleta={paleta}
          />
        </>
      ) : (
        <Convite onAtivar={props.onAtivar} />
      )}

      {ranking && <Campeoes ranking={ranking} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Líder da semana corrente, sempre marcado como parcial: só domingo vale. */
function Semana({ ranking }: { ranking: RankingSemanal }) {
  const lider = ranking.linhas[0];
  return (
    <div className="card">
      <div className="card__cab">
        <h3>Disputa da semana</h3>
        <span className="muted">
          {fmtDataLonga(ranking.inicioSemanaAtual)} → {fmtDataLonga(ranking.semanaAtual)}
        </span>
        <div className="spacer" />
        <span className="badge badge--atencao">parcial · fecha domingo</span>
      </div>

      {!lider ? (
        <div className="vazio">Nenhuma carteira na disputa ainda.</div>
      ) : (
        <div className="heroi">
          <div className="topo__rot">Liderando a semana</div>
          <div className="valor" style={{ fontSize: "1.7rem" }}>
            {lider.nome}
            {lider.ehMinha && <span className="badge badge--marca" style={{ marginLeft: 8, verticalAlign: "middle" }}>você</span>}
          </div>
          <div className="sub">
            <span className={`num ${sinal(lider.retornoSemanaPct)}`} style={{ fontWeight: 700 }}>
              {fmtPct(lider.retornoSemanaPct)} na semana
            </span>
            <span className="muted">{fmtPct(lider.retornoAcumuladoPct)} desde o início</span>
          </div>
        </div>
      )}

      {!ranking.temHistorico && (
        <div className="aviso" style={{ marginTop: "0.9rem" }}>
          A série histórica ainda não cobre nenhuma semana, então o retorno semanal aparece zerado. Um
          <strong> admin</strong> pode gerá-la em <strong>Admin → Série histórica</strong>.
        </div>
      )}
    </div>
  );
}

function Tabela({ ranking }: { ranking: RankingSemanal }) {
  return (
    <div className="card">
      <div className="card__cab">
        <h3>Ranking</h3>
        <span className="muted">ordenado pelo retorno da semana</span>
      </div>
      <div className="tabela-scroll">
        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Carteira</th>
              <th className="right">Semana</th>
              <th className="right">Acumulado</th>
              <th className="right">Patrimônio</th>
            </tr>
          </thead>
          <tbody>
            {ranking.linhas.map((l, i) => (
              <Linha key={l.carteiraId} linha={l} posicao={i + 1} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: "0.8rem", margin: "0.8rem 0 0" }}>
        Todas as carteiras partem do mesmo capital inicial fixo, então os retornos são diretamente
        comparáveis. Carteira parada em caixa marca 0% na semana.
      </p>
    </div>
  );
}

function Linha({ linha, posicao }: { linha: LinhaSemanal; posicao: number }) {
  return (
    <tr style={linha.ehMinha ? { fontWeight: 600 } : undefined}>
      <td>{posicao}</td>
      <td className="td-principal">
        {linha.nome}
        {linha.ehLiga && <span className="badge" style={{ marginLeft: 6 }}>Liga</span>}
        {linha.ehMinha && <span className="badge badge--marca" style={{ marginLeft: 6 }}>você</span>}
      </td>
      <td className={`right num ${sinal(linha.retornoSemanaPct)}`}>{fmtPct(linha.retornoSemanaPct)}</td>
      <td className={`right num ${sinal(linha.retornoAcumuladoPct)}`}>{fmtPct(linha.retornoAcumuladoPct)}</td>
      <td className="right num">{fmtBRL(linha.patrimonioBRL)}</td>
    </tr>
  );
}

function Campeoes({ ranking }: { ranking: RankingSemanal }) {
  if (ranking.campeoes.length === 0) {
    return (
      <div className="card">
        <div className="card__cab">
          <h3>Campeões por semana</h3>
          <span className="muted">uma vencedora a cada domingo</span>
        </div>
        <div className="vazio">
          <span className="vazio__ico" aria-hidden="true">🏆</span>
          <strong>Nenhuma semana fechada ainda</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
      <div className="card">
        <div className="card__cab">
          <h3>Campeões por semana</h3>
          <span className="muted">semanas já fechadas</span>
        </div>
        <div className="tabela-scroll">
          <table>
            <thead>
              <tr>
                <th>Semana</th>
                <th>Campeã</th>
                <th className="right">Retorno</th>
              </tr>
            </thead>
            <tbody>
              {ranking.campeoes.map((c) => (
                <tr key={c.semana}>
                  <td className="nowrap">{fmtDataLonga(c.semana)}</td>
                  <td className="td-principal">{c.nome}</td>
                  <td className={`right num ${sinal(c.retornoPct)}`}>{fmtPct(c.retornoPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card__cab">
          <h3>Títulos</h3>
          <span className="muted">semanas vencidas por carteira</span>
        </div>
        <div className="tabela-scroll">
          <table>
            <thead>
              <tr>
                <th>Carteira</th>
                <th className="right">Títulos</th>
              </tr>
            </thead>
            <tbody>
              {ranking.titulos.map((t) => (
                <tr key={t.carteiraId}>
                  <td className="td-principal">{t.nome}</td>
                  <td className="right num">{t.titulos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MinhaVsLiga({ minha, liga }: { minha: PortfolioSnapshot; liga: PortfolioSnapshot }) {
  const d = diffCarteiras(minha, liga);
  const ganhando = d.deltaPct >= 0;
  return (
    <div className="card">
      <div className="card__cab">
        <h3>Individual × Liga</h3>
        <span className="muted">desde o início</span>
      </div>
      <p style={{ margin: "0 0 0.9rem", fontSize: "1.02rem" }}>
        <strong className={sinal(d.deltaPct)}>
          {ganhando
            ? `Você está ${d.deltaPct.toFixed(2)} p.p. à frente da liga.`
            : `Você está ${Math.abs(d.deltaPct).toFixed(2)} p.p. atrás da liga.`}
        </strong>{" "}
        <span className="muted">
          Diferença de patrimônio: {d.deltaPatrimonioBRL >= 0 ? "+" : "−"}
          {fmtBRL(Math.abs(d.deltaPatrimonioBRL))}
        </span>
      </p>
      <div className="kpis">
        <Kpi rotulo="Patrimônio (individual)" valor={fmtBRL(minha.patrimonioBRL)} />
        <Kpi rotulo="Patrimônio (liga)" valor={fmtBRL(liga.patrimonioBRL)} />
        <Kpi rotulo="Retorno (individual)" valor={fmtPct(minha.retornoTotalPct)} classe={sinal(minha.retornoTotalPct)} />
        <Kpi rotulo="Retorno (liga)" valor={fmtPct(liga.retornoTotalPct)} classe={sinal(liga.retornoTotalPct)} />
      </div>
    </div>
  );
}

function Kpi({ rotulo, valor, classe }: { rotulo: string; valor: string; classe?: string }) {
  return (
    <div className="kpi">
      <div className="rotulo">{rotulo}</div>
      <div className={`valor ${classe ?? ""}`}>{valor}</div>
    </div>
  );
}

function Convite({ onAtivar }: { onAtivar: () => void }) {
  return (
    <div className="card">
      <div className="card__cab">
        <h3>Entre na disputa</h3>
      </div>
      <p className="muted">
        Você ainda não ativou a sua carteira individual. Com ela dá para discordar da liga e medir a sua tese
        com o mesmo capital inicial — e disputar a semana com todo mundo.
      </p>
      <button onClick={onAtivar}>Ativar minha carteira individual</button>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface OverlayProps {
  config: Config;
  ativos: Ativo[];
  transacoesLiga: Transacao[];
  transacoesMinha: Transacao[];
  paleta: ReturnType<typeof usarPaleta>;
}

/** Rentabilidade acumulada da minha carteira sobreposta à da liga e aos índices. */
function Overlay({ config, ativos, transacoesLiga, transacoesMinha, paleta }: OverlayProps) {
  const { historico, carregando, erro } = useHistorico();
  const [preset, setPreset] = useState<PresetPeriodo>("12m");
  const [benches, setBenches] = useState<Benchmark[]>(["IBOV"]);
  const hoje = useMemo(() => new Date(), []);

  const corMinha = paleta.series[6];
  const corLiga = paleta.series[0];

  const dados = useMemo(() => {
    if (!historico) return [];
    const intervalo = intervaloDoPreset(preset, hoje, config.dataInicio);
    const evLiga = computarEvolucao(config, transacoesLiga, ativos, historico, intervalo);
    const evMinha = computarEvolucao(config, transacoesMinha, ativos, historico, intervalo);
    if (!evLiga.temDados && !evMinha.temDados) return [];

    const porData = new Map<string, Record<string, number | string>>();
    for (const p of evLiga.serieRentabilidade) {
      const linha: Record<string, number | string> = { data: p.data, liga: p.carteira };
      for (const b of BENCHMARKS) if (typeof p[b] === "number") linha[b] = p[b] as number;
      porData.set(p.data, linha);
    }
    for (const p of evMinha.serieRentabilidade) {
      const linha = porData.get(p.data) ?? { data: p.data };
      linha.minha = p.carteira;
      porData.set(p.data, linha);
    }
    return [...porData.values()].sort((a, b) => String(a.data).localeCompare(String(b.data)));
  }, [historico, config, transacoesLiga, transacoesMinha, ativos, preset, hoje]);

  const rotulo = (n: string) =>
    n === "minha" ? "Individual" : n === "liga" ? "Liga" : ROTULO_BENCHMARK[n as Benchmark] ?? n;

  return (
    <div className="card">
      <div className="card__cab">
        <h3>Rentabilidade acumulada</h3>
        <span className="muted">individual vs. liga · rebase 0% no início do período</span>
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
          <span className="controles__rotulo" style={{ marginLeft: "0.5rem" }}>Comparar</span>
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

      {/* Rótulos diretos: a cor não identifica a série sozinha. */}
      <div className="row" style={{ marginBottom: "0.9rem", gap: "0.5rem" }}>
        <span className="pill">
          <span className="ponto" style={{ background: corMinha }} />
          <span className="rot">Individual</span>
        </span>
        <span className="pill">
          <span className="ponto" style={{ background: corLiga }} />
          <span className="rot">Liga</span>
        </span>
      </div>

      {carregando && <p className="muted" style={{ margin: 0 }}>Carregando série histórica…</p>}
      {erro && <div className="alerta">Erro ao carregar histórico: {erro}</div>}
      {!carregando && !erro && dados.length === 0 && (
        <div className="aviso">Ainda não há série histórica neste período para desenhar a comparação.</div>
      )}

      {dados.length > 0 && (
        <div className="grafico" style={{ height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={dados} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid stroke={paleta.grade} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="data" tickFormatter={fmtData} tick={{ fill: paleta.eixo, fontSize: 12 }} minTickGap={44} tickLine={false} axisLine={{ stroke: paleta.grade }} />
              <YAxis tickFormatter={(v) => `${Number(v).toFixed(0)}%`} tick={{ fill: paleta.eixo, fontSize: 12 }} width={52} tickLine={false} axisLine={false} />
              <ReferenceLine y={0} stroke={paleta.eixo} strokeOpacity={0.5} />
              <Tooltip content={<Dica rotulo={rotulo} formatar={fmtPct} />} />
              <Line type="monotone" dataKey="minha" name="minha" stroke={corMinha} strokeWidth={2.5} dot={false} connectNulls activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--superficie)" }} />
              <Line type="monotone" dataKey="liga" name="liga" stroke={corLiga} strokeWidth={2.5} dot={false} connectNulls activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--superficie)" }} />
              {benches.map((b) => (
                <Line key={b} type="monotone" dataKey={b} name={b} stroke={paleta.benchmark[b]} strokeWidth={1.8} dot={false} connectNulls activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--superficie)" }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
