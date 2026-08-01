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
  PERIODOS,
  ROTULO_PERIODO,
  ROTULO_PERIODO_DE,
  ROTULO_PERIODO_PLURAL,
  ROTULO_PERIODO_POR,
  type LinhaRanking,
  type PeriodoRanking,
  type RankingPeriodo,
} from "../engine/disputa";
import {
  BENCHMARKS,
  ROTULO_BENCHMARK,
  computarEvolucao,
  intervaloDoPreset,
  rentabilidadeDaSerie,
  type Benchmark,
  type PontoSerie,
  type PresetPeriodo,
} from "../engine/evolucao";
import { fmtBRL, fmtPct } from "../engine/report";
import type { Ativo, Config, PortfolioSnapshot, PrecosSnapshot, Transacao } from "../engine/types";
import { CarteiraDeMembro } from "./CarteiraDeMembro";
import { Dica, fmtData, fmtDataLonga, sinal, usarPaleta, useTemaEscuro } from "./grafico";
import { useHistorico } from "./useHistorico";
import { useRankingCarteiras } from "./useRankingCarteiras";

interface Props {
  config: Config;
  ativos: Ativo[];
  precos: PrecosSnapshot;
  snapshotLiga: PortfolioSnapshot | null;
  snapshotMinha: PortfolioSnapshot | null;
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

/** Quantos períodos fechados o mural mostra — por dia a lista seria interminável. */
const MAX_CAMPEOES = 12;

/**
 * Placar da liga. O ranking pode ser lido por dia, semana ou mês: o seletor fica
 * no cabeçalho da própria coluna medida, que é onde se lê o que está sendo
 * comparado. O acumulado desde o início fica ao lado, na mesma tabela, para não
 * virar um segundo ranking concorrente.
 */
export function Comparar(props: Props) {
  const escuro = useTemaEscuro();
  const paleta = usarPaleta(escuro);
  const [periodo, setPeriodo] = useState<PeriodoRanking>("semana");
  const [aberta, setAberta] = useState<string | null>(null);
  const { ranking, series, snapshots, nomes, carregando, erro } = useRankingCarteiras({
    ...props,
    periodo,
  });

  const linhaAberta = ranking?.linhas.find((l) => l.carteiraId === aberta) ?? null;
  const snapshotAberto = aberta ? snapshots.get(aberta) ?? null : null;

  return (
    <div className="grid" style={{ gap: "1.15rem" }}>
      {carregando && <div className="card"><div className="vazio">Carregando a série histórica…</div></div>}
      {erro && <div className="alerta">Erro ao carregar o histórico: {erro}</div>}

      {ranking && <Destaque ranking={ranking} />}
      {ranking && (
        <Tabela
          ranking={ranking}
          periodo={periodo}
          onPeriodo={setPeriodo}
          aberta={aberta}
          onAbrir={(id) => setAberta((a) => (a === id ? null : id))}
        />
      )}

      {linhaAberta && snapshotAberto && (
        <CarteiraDeMembro
          nome={linhaAberta.nome}
          ehLiga={linhaAberta.ehLiga}
          ehMinha={linhaAberta.ehMinha}
          snapshot={snapshotAberto}
          retornoPeriodoPct={linhaAberta.retornoPeriodoPct}
          rotuloPeriodo={ROTULO_PERIODO_DE[periodo]}
          onFechar={() => setAberta(null)}
        />
      )}

      {props.snapshotMinha && props.snapshotLiga && (
        <MinhaVsLiga minha={props.snapshotMinha} liga={props.snapshotLiga} />
      )}
      {!props.snapshotMinha && <Convite onAtivar={props.onAtivar} />}

      <Overlay
        config={props.config}
        ativos={props.ativos}
        wallets={props.wallets}
        minhaCarteiraId={props.minhaCarteiraId}
        series={series}
        nomes={nomes}
        paleta={paleta}
      />

      {ranking && <Campeoes ranking={ranking} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Como o período corrente fecha — o placar só vale de verdade no fim dele. */
const FECHAMENTO: Record<PeriodoRanking, string> = {
  dia: "fecha hoje",
  semana: "fecha domingo",
  mes: "fecha no fim do mês",
};

/** Líder do período corrente, marcado como parcial enquanto ele não fecha. */
function Destaque({ ranking }: { ranking: RankingPeriodo }) {
  const lider = ranking.linhas[0];
  const janela =
    ranking.inicioPeriodoAtual === ranking.fimPeriodoAtual
      ? fmtDataLonga(ranking.fimPeriodoAtual)
      : `${fmtDataLonga(ranking.inicioPeriodoAtual)} → ${fmtDataLonga(ranking.fimPeriodoAtual)}`;

  return (
    <div className="card">
      <div className="card__cab">
        <h3>Disputa {ROTULO_PERIODO_DE[ranking.periodo]}</h3>
        <span className="muted">{janela}</span>
        <div className="spacer" />
        {ranking.parcial ? (
          <span className="badge badge--atencao">parcial · {FECHAMENTO[ranking.periodo]}</span>
        ) : (
          <span className="badge">fechado</span>
        )}
      </div>

      {!lider ? (
        <div className="vazio">Nenhuma carteira na disputa ainda.</div>
      ) : (
        <div className="heroi">
          <div className="topo__rot">Liderando {ROTULO_PERIODO_DE[ranking.periodo]}</div>
          <div className="valor" style={{ fontSize: "1.7rem" }}>
            {lider.nome}
            {lider.ehMinha && <span className="badge badge--marca" style={{ marginLeft: 8, verticalAlign: "middle" }}>você</span>}
          </div>
          <div className="sub">
            <span className={`num ${sinal(lider.retornoPeriodoPct)}`} style={{ fontWeight: 700 }}>
              {fmtPct(lider.retornoPeriodoPct)} {ROTULO_PERIODO_DE[ranking.periodo]}
            </span>
            <span className="muted">{fmtPct(lider.retornoAcumuladoPct)} desde o início</span>
          </div>
        </div>
      )}

      {!ranking.temHistorico && (
        <div className="aviso" style={{ marginTop: "0.9rem" }}>
          A série histórica ainda não cobre nenhum período, então o retorno aparece zerado. Um
          <strong> admin</strong> pode gerá-la em <strong>Admin → Série histórica</strong>.
        </div>
      )}
    </div>
  );
}

interface TabelaProps {
  ranking: RankingPeriodo;
  periodo: PeriodoRanking;
  onPeriodo: (p: PeriodoRanking) => void;
  aberta: string | null;
  onAbrir: (id: string) => void;
}

function Tabela({ ranking, periodo, onPeriodo, aberta, onAbrir }: TabelaProps) {
  return (
    <div className="card">
      <div className="card__cab">
        <h3>Ranking</h3>
        <span className="muted">ordenado pelo retorno {ROTULO_PERIODO_DE[periodo]}</span>
      </div>
      <div className="tabela-scroll">
        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Carteira</th>
              <th className="right">
                {/* O seletor mora aqui: é a coluna que diz o que está sendo
                    comparado, então é onde se espera poder trocar. */}
                <select
                  className="th-seletor"
                  value={periodo}
                  onChange={(e) => onPeriodo(e.target.value as PeriodoRanking)}
                  aria-label="Período comparado no ranking"
                >
                  {PERIODOS.map((p) => (
                    <option key={p} value={p}>{ROTULO_PERIODO[p]}</option>
                  ))}
                </select>
              </th>
              <th className="right">Acumulado</th>
              <th className="right">Patrimônio</th>
            </tr>
          </thead>
          <tbody>
            {ranking.linhas.map((l, i) => (
              <Linha
                key={l.carteiraId}
                linha={l}
                posicao={i + 1}
                aberta={aberta === l.carteiraId}
                onAbrir={() => onAbrir(l.carteiraId)}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: "0.8rem", margin: "0.8rem 0 0" }}>
        Todas as carteiras partem do mesmo capital inicial fixo, então os retornos são diretamente
        comparáveis. Carteira parada em caixa marca 0%. Clique no nome para ver as posições dela.
      </p>
    </div>
  );
}

function Linha({
  linha,
  posicao,
  aberta,
  onAbrir,
}: {
  linha: LinhaRanking;
  posicao: number;
  aberta: boolean;
  onAbrir: () => void;
}) {
  return (
    <tr style={linha.ehMinha ? { fontWeight: 600 } : undefined}>
      <td>{posicao}</td>
      <td>
        <button className="link-carteira" onClick={onAbrir} aria-expanded={aberta}>
          {linha.nome}
        </button>
        {linha.ehLiga && <span className="badge" style={{ marginLeft: 6 }}>Liga</span>}
        {linha.ehMinha && <span className="badge badge--marca" style={{ marginLeft: 6 }}>você</span>}
      </td>
      <td className={`right num ${sinal(linha.retornoPeriodoPct)}`}>{fmtPct(linha.retornoPeriodoPct)}</td>
      <td className={`right num ${sinal(linha.retornoAcumuladoPct)}`}>{fmtPct(linha.retornoAcumuladoPct)}</td>
      <td className="right num">{fmtBRL(linha.patrimonioBRL)}</td>
    </tr>
  );
}

function Campeoes({ ranking }: { ranking: RankingPeriodo }) {
  const unidade = ROTULO_PERIODO_POR[ranking.periodo];
  const titulo = `Campeões por ${unidade}`;

  if (ranking.campeoes.length === 0) {
    return (
      <div className="card">
        <div className="card__cab">
          <h3>{titulo}</h3>
          <span className="muted">uma vencedora a cada {unidade}</span>
        </div>
        <div className="vazio">
          <span className="vazio__ico" aria-hidden="true">🏆</span>
          <strong>Nenhum{ranking.periodo === "semana" ? "a semana fechada" : ` ${unidade} fechado`} ainda</strong>
        </div>
      </div>
    );
  }

  const mostrados = ranking.campeoes.slice(0, MAX_CAMPEOES);

  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
      <div className="card">
        <div className="card__cab">
          <h3>{titulo}</h3>
          <span className="muted">períodos já fechados</span>
        </div>
        <div className="tabela-scroll">
          <table>
            <thead>
              <tr>
                <th>{ROTULO_PERIODO[ranking.periodo]}</th>
                <th>Campeã</th>
                <th className="right">Retorno</th>
              </tr>
            </thead>
            <tbody>
              {mostrados.map((c) => (
                <tr key={c.chave}>
                  <td className="nowrap">{fmtDataLonga(c.chave)}</td>
                  <td className="td-principal">{c.nome}</td>
                  <td className={`right num ${sinal(c.retornoPct)}`}>{fmtPct(c.retornoPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ranking.campeoes.length > mostrados.length && (
          <p className="muted" style={{ fontSize: "0.8rem", margin: "0.8rem 0 0" }}>
            Mostrando os {mostrados.length} mais recentes de {ranking.campeoes.length}. Os títulos ao
            lado contam todos.
          </p>
        )}
      </div>

      <div className="card">
        <div className="card__cab">
          <h3>Títulos</h3>
          <span className="muted">
            {ROTULO_PERIODO_PLURAL[ranking.periodo]} vencid{ranking.periodo === "semana" ? "a" : "o"}s por carteira
          </span>
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
        com o mesmo capital inicial — e disputar o período com todo mundo.
      </p>
      <button onClick={onAtivar}>Ativar minha carteira individual</button>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface OverlayProps {
  config: Config;
  ativos: Ativo[];
  wallets: Wallet[];
  minhaCarteiraId: string | null;
  series: Map<string, PontoSerie[]>;
  nomes: Map<string, string>;
  paleta: ReturnType<typeof usarPaleta>;
}

/** Por que o gráfico está vazio — cada motivo pede uma saída diferente. */
function Vazio({
  semSeries,
  semSelecao,
  semPontos,
}: {
  semSeries: boolean;
  semSelecao: boolean;
  semPontos: boolean;
}) {
  if (semSeries) {
    return (
      <div className="aviso">
        A série histórica ainda não foi gerada. Um <strong>admin</strong> pode criá-la em{" "}
        <strong>Admin → Série histórica</strong>.
      </div>
    );
  }
  if (semSelecao) return <div className="aviso">Marque ao menos uma carteira para comparar.</div>;
  if (semPontos) {
    return <div className="aviso">Ainda não há série histórica neste período para desenhar a comparação.</div>;
  }
  return null;
}

/** Slots de cor livres (0 é a liga, 6 é a minha, 1–4 são dos benchmarks). */
const CORES_RIVAIS = [5, 7, 2, 3, 1, 4];

const SEM_TRANSACOES: Transacao[] = [];

/**
 * Rentabilidade acumulada de várias carteiras sobrepostas, mais os índices.
 *
 * As séries vêm prontas do ranking: rebasear um recorte delas dá exatamente o
 * mesmo número que recalcular a evolução no período (ver `rentabilidadeDaSerie`),
 * então marcar mais uma carteira no gráfico não custa nenhum replay de ledger.
 */
function Overlay({ config, ativos, wallets, minhaCarteiraId, series, nomes, paleta }: OverlayProps) {
  const { historico, carregando, erro } = useHistorico();
  const [preset, setPreset] = useState<PresetPeriodo>("12m");
  const [benches, setBenches] = useState<Benchmark[]>(["IBOV"]);
  const [escolhidas, setEscolhidas] = useState<string[] | null>(null);
  const hoje = useMemo(() => new Date(), []);

  // Liga primeiro, minha em seguida, o resto em ordem alfabética. A cor segue a
  // carteira, não a posição no gráfico: marcar outra pessoa não repinta ninguém.
  const carteiras = useMemo(() => {
    const rotulo = (w: Wallet) =>
      w.tipo === "liga" ? "Liga" : w.id === minhaCarteiraId ? "Individual" : nomes.get(w.id) ?? w.nome;
    const ordem = (w: Wallet) => (w.tipo === "liga" ? 0 : w.id === minhaCarteiraId ? 1 : 2);
    let rival = 0;
    return [...wallets]
      .sort((a, b) => ordem(a) - ordem(b) || rotulo(a).localeCompare(rotulo(b)))
      .map((w) => ({
        id: w.id,
        rotulo: rotulo(w),
        ehLiga: w.tipo === "liga",
        cor:
          w.tipo === "liga"
            ? paleta.series[0]
            : w.id === minhaCarteiraId
              ? paleta.series[6]
              : paleta.series[CORES_RIVAIS[rival++ % CORES_RIVAIS.length]],
      }));
  }, [wallets, minhaCarteiraId, nomes, paleta]);

  // Padrão: o duelo de sempre, individual contra a liga.
  const padrao = useMemo(
    () => carteiras.filter((c) => c.ehLiga || c.id === minhaCarteiraId).map((c) => c.id),
    [carteiras, minhaCarteiraId],
  );
  const selecionadas = escolhidas ?? padrao;
  const alternar = (id: string) =>
    setEscolhidas((atual) => {
      const base = atual ?? padrao;
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    });

  const desenhadas = carteiras.filter((c) => selecionadas.includes(c.id) && series.has(c.id));

  const dados = useMemo(() => {
    if (!historico) return [];
    const intervalo = intervaloDoPreset(preset, hoje, config.dataInicio);
    const porData = new Map<string, Record<string, number | string>>();
    const anexar = (data: string, campo: string, v: number) => {
      const linha = porData.get(data) ?? { data };
      linha[campo] = v;
      porData.set(data, linha);
    };

    for (const id of selecionadas) {
      const serie = series.get(id);
      if (!serie) continue;
      for (const p of rentabilidadeDaSerie(serie, intervalo)) anexar(p.data, `w_${id}`, p.pct);
    }

    // As curvas dos índices não dependem do ledger — um ledger vazio evita um
    // replay inútil. Todos os benchmarks entram sempre: ligar/desligar um chip
    // então só muda quais linhas são desenhadas, sem recalcular nada.
    const ev = computarEvolucao(config, SEM_TRANSACOES, ativos, historico, intervalo);
    for (const p of ev.serieRentabilidade) {
      for (const b of BENCHMARKS) if (typeof p[b] === "number") anexar(p.data, b, p[b] as number);
    }

    return [...porData.values()].sort((a, b) => String(a.data).localeCompare(String(b.data)));
  }, [historico, config, ativos, series, selecionadas, preset, hoje]);

  const rotulos = useMemo(() => new Map(carteiras.map((c) => [c.id, c.rotulo])), [carteiras]);
  const rotulo = (n: string) =>
    n.startsWith("w_")
      ? rotulos.get(n.slice(2)) ?? "Carteira"
      : ROTULO_BENCHMARK[n as Benchmark] ?? n;

  return (
    <div className="card">
      <div className="card__cab">
        <h3>Rentabilidade acumulada</h3>
        <span className="muted">carteiras lado a lado · rebase 0% no início do período</span>
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
        </div>

        <div className="controles__linha">
          <span className="controles__rotulo">Carteiras</span>
          <div className="chips">
            {carteiras.map((c) => (
              <button
                key={c.id}
                className={`chip-toggle ${selecionadas.includes(c.id) ? "ativo" : ""}`}
                aria-pressed={selecionadas.includes(c.id)}
                onClick={() => alternar(c.id)}
              >
                <span className="ponto" style={{ background: c.cor }} />
                {c.rotulo}
              </button>
            ))}
          </div>
        </div>

        <div className="controles__linha">
          <span className="controles__rotulo">Índices</span>
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

      {carregando && <p className="muted" style={{ margin: 0 }}>Carregando série histórica…</p>}
      {erro && <div className="alerta">Erro ao carregar histórico: {erro}</div>}
      {!carregando && !erro && (
        <Vazio
          semSeries={series.size === 0}
          semSelecao={selecionadas.length === 0}
          semPontos={desenhadas.length > 0 && dados.length === 0}
        />
      )}

      {desenhadas.length > 0 && dados.length > 0 && (
        <div className="grafico" style={{ height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={dados} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid stroke={paleta.grade} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="data" tickFormatter={fmtData} tick={{ fill: paleta.eixo, fontSize: 12 }} minTickGap={44} tickLine={false} axisLine={{ stroke: paleta.grade }} />
              <YAxis tickFormatter={(v) => `${Number(v).toFixed(0)}%`} tick={{ fill: paleta.eixo, fontSize: 12 }} width={52} tickLine={false} axisLine={false} />
              <ReferenceLine y={0} stroke={paleta.eixo} strokeOpacity={0.5} />
              <Tooltip content={<Dica rotulo={rotulo} formatar={fmtPct} />} />
              {desenhadas.map((c) => (
                <Line key={c.id} type="monotone" dataKey={`w_${c.id}`} name={`w_${c.id}`} stroke={c.cor} strokeWidth={2.5} dot={false} connectNulls activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--superficie)" }} />
              ))}
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
