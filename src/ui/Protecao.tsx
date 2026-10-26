// Aba PROTEÇÃO: a MESA DE RISCO da carteira.
//
//  Faixa de KPIs  VaR, Expected Shortfall, volatilidade, beta, dólar, margem.
//  Risco          VaR histórico × paramétrico (95/99%, 1/10 dias), com e sem
//                 derivativos; contribuição de cada posição; distribuição do P&L.
//  Stress         cenários históricos e customizado, reavaliando posição a posição.
//  Hedge          beta × mini-índice, exposição cambial e calculadora de hedge
//                 com os contratos reais da B3.
//
// Só leitura: "Montar ordem" leva para Operar → Futuros já preenchido.

import { useEffect, useMemo, useState } from "react";
import {
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
import {
  FUTUROS,
  FUTUROS_INDICE,
  MERCADORIAS,
  REFERENCIAS_YAHOO,
  precoFuturo,
  type CodigoMercadoria,
  type ContratoB3,
} from "../engine/derivativos";
import { computarEvolucao, intervaloDoPreset } from "../engine/evolucao";
import { fmtBRL, fmtNum, fmtPct } from "../engine/report";
import {
  CENARIOS,
  FATORES_STRESS,
  aplicarStress,
  betaDaCarteira,
  betas,
  calcularRisco,
  drawdownMaximo,
  varHorizonte,
  type FatorStress,
  type Risco,
} from "../engine/risco";
import type { Ativo, Config, PortfolioSnapshot, PrecosSnapshot, Transacao } from "../engine/types";
import { cotarFuturosB3, mesclarDiretos } from "../data/mercadoB3";
import { usePrecosComInsumos, type OrdemSugerida } from "./Derivativos";
import { fmtBRLCurto, fmtDataLonga, sinal, usarPaleta, useTemaEscuro } from "./grafico";
import { useHistorico } from "./useHistorico";

interface Props {
  config: Config;
  snapshot: PortfolioSnapshot;
  transacoes: Transacao[];
  ativos: Ativo[];
  precos: PrecosSnapshot;
  /** ausente quando a pessoa não pode operar esta carteira. */
  onOperar?: (ordem: OrdemSugerida) => void;
}

type Aba = "risco" | "stress" | "hedge";

export function Protecao(props: Props) {
  const { snapshot, onOperar } = props;
  const hoje = useMemo(() => new Date(), []);
  const precos = usePrecosComInsumos(props.precos, REFERENCIAS_YAHOO);
  const { historico, carregando: carregandoHist } = useHistorico();
  const [aba, setAba] = useState<Aba>("risco");

  const acoesBR = useMemo(
    () => snapshot.posicoes.filter((p) => !p.derivativo && p.moeda === "BRL" && ["acao", "etf", "fii"].includes(p.classe)).map((p) => p.ticker),
    [snapshot],
  );
  const calc = useMemo(() => {
    if (!historico || historico.length < 30) return null;
    const com = calcularRisco(snapshot, historico, true);
    const sem = calcularRisco(snapshot, historico, false);
    const b = betas(historico, acoesBR);
    const ev = computarEvolucao(props.config, props.transacoes, props.ativos, historico, intervaloDoPreset("tudo", hoje, props.config.dataInicio));
    return { com, sem, b, drawdown: ev.temDados ? drawdownMaximo(ev.serie) : null };
  }, [historico, snapshot, acoesBR, props.config, props.transacoes, props.ativos, hoje]);
  const b = calc?.b ?? {};
  const beta = betaDaCarteira(snapshot, b);

  const dolar = precos.cambio?.USD ?? null;
  const expUSD = snapshot.posicoes.reduce((s, p) => {
    if (p.derivativo) return p.derivativo.meta.subjacente === "USD" || p.derivativo.meta.moedaCotacao === "USD" ? s + p.derivativo.nocionalBRL : s;
    return p.moeda === "USD" ? s + (p.valorBRL ?? 0) : s;
  }, 0);
  const usoMargem = snapshot.caixaBRL > 0 ? (snapshot.margemRequeridaBRL / snapshot.caixaBRL) * 100 : null;
  const pat = snapshot.patrimonioBRL;

  return (
    <div className="grid">
      <div className="kpis">
        <Kpi
          rotulo="VaR 95% · 1 dia"
          valor={calc ? fmtBRL(calc.com.varHist95) : "—"}
          extra={calc ? `${fmtNum((calc.com.varHist95 / pat) * 100, 2)}% do patrimônio · histórico` : carregandoHist ? "carregando série…" : "sem série histórica"}
        />
        <Kpi rotulo="Expected Shortfall 97,5%" valor={calc ? fmtBRL(calc.com.es975) : "—"} extra="perda média nos piores 2,5% dos dias" />
        <Kpi
          rotulo="Volatilidade anual"
          valor={calc ? `${fmtNum(calc.com.volAnualPct, 1)}%` : "—"}
          extra={calc?.drawdown != null ? `drawdown máx. ${fmtNum(calc.drawdown, 1)}%` : undefined}
        />
        <Kpi rotulo="Beta vs Ibovespa" valor={fmtNum(beta.betaPatrimonio, 2)} extra={`ações: β ${fmtNum(beta.betaAcoes, 2)}`} />
        <Kpi
          rotulo="Exposição ao dólar"
          valor={fmtBRL(expUSD)}
          classe={sinal(expUSD)}
          extra={dolar ? `≈ US$ ${fmtNum(expUSD / dolar, 0)} · ${fmtNum((expUSD / pat) * 100, 1)}% PL` : undefined}
        />
        <Kpi
          rotulo="Margem em uso"
          valor={fmtBRL(snapshot.margemRequeridaBRL)}
          classe={snapshot.caixaLivreBRL < 0 ? "neg" : undefined}
          extra={usoMargem != null ? `${fmtNum(usoMargem, 1)}% do caixa · livre ${fmtBRL(snapshot.caixaLivreBRL)}` : undefined}
        />
      </div>

      <div className="row no-print">
        <div className="segmented">
          <button className={aba === "risco" ? "ativo" : ""} onClick={() => setAba("risco")}>Risco (VaR)</button>
          <button className={aba === "stress" ? "ativo" : ""} onClick={() => setAba("stress")}>Stress test</button>
          <button className={aba === "hedge" ? "ativo" : ""} onClick={() => setAba("hedge")}>Hedge</button>
        </div>
      </div>

      {aba === "risco" &&
        (calc ? (
          <PainelRisco com={calc.com} sem={calc.sem} patrimonio={pat} temDerivativos={snapshot.posicoes.some((p) => p.derivativo)} />
        ) : (
          <SemHistorico carregando={carregandoHist} />
        ))}
      {aba === "stress" && <PainelStress snapshot={snapshot} betas={b} />}
      {aba === "hedge" && (
        <>
          <HedgeBeta snapshot={snapshot} betas={b} beta={beta} precos={precos} onOperar={onOperar} temHistorico={calc != null} />
          <ExposicaoCambial snapshot={snapshot} precos={precos} onOperar={onOperar} />
          <CalculadoraHedge precos={precos} onOperar={onOperar} />
        </>
      )}

      <Metodologia />
    </div>
  );
}

function SemHistorico({ carregando }: { carregando: boolean }) {
  return (
    <div className="card">
      <div className="vazio">
        <span className="vazio__ico" aria-hidden="true">⛨</span>
        <strong>{carregando ? "Carregando a série histórica…" : "Sem série histórica suficiente"}</strong>
        {!carregando && "O VaR usa 252 pregões de prices_history. Um admin pode gerá-la em Admin → Série histórica."}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Risco (VaR)
// ---------------------------------------------------------------------------

function PainelRisco({ com, sem, patrimonio, temDerivativos }: { com: Risco; sem: Risco; patrimonio: number; temDerivativos: boolean }) {
  const paleta = usarPaleta(useTemaEscuro());
  const linhas: Array<{ rotulo: string; v: (r: Risco) => number }> = [
    { rotulo: "VaR histórico 95% · 1 dia", v: (r) => r.varHist95 },
    { rotulo: "VaR histórico 99% · 1 dia", v: (r) => r.varHist99 },
    { rotulo: "VaR histórico 95% · 10 dias", v: (r) => varHorizonte(r.varHist95, 10) },
    { rotulo: "VaR paramétrico 95% · 1 dia", v: (r) => r.varParam95 },
    { rotulo: "VaR paramétrico 99% · 1 dia", v: (r) => r.varParam99 },
    { rotulo: "VaR paramétrico 99% · 10 dias", v: (r) => varHorizonte(r.varParam99, 10) },
    { rotulo: "Expected Shortfall 97,5% · 1 dia", v: (r) => r.es975 },
  ];

  // Histograma do P&L simulado (30 classes).
  const histograma = useMemo(() => {
    const pl = com.plSimulado;
    if (pl.length === 0) return [];
    const min = Math.min(...pl), max = Math.max(...pl);
    const n = 30, w = (max - min) / n || 1;
    const bins = Array.from({ length: n }, (_, i) => ({ x: min + w * (i + 0.5), n: 0 }));
    for (const v of pl) bins[Math.min(n - 1, Math.floor((v - min) / w))].n++;
    return bins;
  }, [com.plSimulado]);

  return (
    <>
      <div className="card">
        <div className="card__cab">
          <h3>Value at Risk</h3>
          <span className="muted">carteira de hoje × {com.dias} pregões de retornos</span>
        </div>
        <div className="tabela-scroll">
          <table>
            <thead>
              <tr>
                <th>Medida</th>
                {temDerivativos && <th className="right">Sem derivativos</th>}
                <th className="right">{temDerivativos ? "Com derivativos" : "Carteira"}</th>
                <th className="right">% do patrimônio</th>
                {temDerivativos && <th className="right">Redução</th>}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const a = l.v(sem), c = l.v(com);
                return (
                  <tr key={l.rotulo}>
                    <td>{l.rotulo}</td>
                    {temDerivativos && <td className="right">{fmtBRL(a)}</td>}
                    <td className="right td-principal">{fmtBRL(c)}</td>
                    <td className="right">{patrimonio > 0 ? `${fmtNum((c / patrimonio) * 100, 2)}%` : "—"}</td>
                    {temDerivativos && <td className={`right ${sinal(a - c)}`}>{a > 0 ? fmtPct(((c - a) / a) * 100) : "—"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {com.fatoresSemHistorico.length > 0 && (
          <p className="muted" style={{ fontSize: "0.82rem", margin: "0.7rem 0 0" }}>
            Sem série histórica: {com.fatoresSemHistorico.join(", ")} — entram só no paramétrico, com volatilidade padrão e
            correlação zero.
          </p>
        )}
      </div>

      <div className="card">
        <div className="card__cab">
          <h3>Distribuição do P&amp;L diário simulado</h3>
          <span className="muted">a linha marca o VaR 95%</span>
        </div>
        <div className="grafico" style={{ height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={histograma} margin={{ top: 6, right: 10, bottom: 0, left: 4 }}>
              <CartesianGrid stroke={paleta.grade} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tickFormatter={fmtBRLCurto} tick={{ fill: paleta.eixo, fontSize: 11 }} tickLine={false} axisLine={{ stroke: paleta.grade }} />
              <YAxis tick={{ fill: paleta.eixo, fontSize: 11 }} width={34} tickLine={false} axisLine={false} allowDecimals={false} />
              <ReferenceLine x={-com.varHist95} stroke={paleta.neg} strokeDasharray="4 4" />
              <Tooltip content={<DicaSimples formatarRotulo={(v) => `P&L ≈ ${fmtBRL(Number(v))}`} formatar={(v) => `${v} dias`} />} />
              <Bar dataKey="n" name="Dias">
                {histograma.map((h, i) => (
                  <Cell key={i} fill={h.x < -com.varHist95 ? paleta.neg : paleta.carteira} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {com.contribuicoes.length > 0 && (
        <div className="card">
          <div className="card__cab">
            <h3>Contribuição ao VaR</h3>
            <span className="muted">VaR componente (paramétrico 95%) — negativo = posição que reduz o risco</span>
          </div>
          <div className="tabela-scroll">
            <table>
              <thead>
                <tr>
                  <th>Posição</th>
                  <th className="right">VaR componente</th>
                  <th className="right">% do VaR</th>
                </tr>
              </thead>
              <tbody>
                {com.contribuicoes.map((c) => (
                  <tr key={c.ticker}>
                    <td className="td-principal">{c.ticker}</td>
                    <td className={`right ${c.varBRL < 0 ? "pos" : ""}`}>{fmtBRL(c.varBRL)}</td>
                    <td className="right">
                      <div className="barra-peso">
                        <span className="num">{fmtNum(c.pct, 1)}%</span>
                        <span className="barra-peso__trilho">
                          <span className="barra-peso__preenchimento" style={{ width: `${Math.min(100, Math.max(0, c.pct))}%` }} />
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Stress test
// ---------------------------------------------------------------------------

function PainelStress({ snapshot, betas: b }: { snapshot: PortfolioSnapshot; betas: Record<string, number> }) {
  const paleta = usarPaleta(useTemaEscuro());
  const [selId, setSelId] = useState(CENARIOS[0].id);
  const [custom, setCustom] = useState<Partial<Record<FatorStress, number>>>({ IBOV: -15, USD: 10 });
  const todos = useMemo(
    () => CENARIOS.map((c) => ({ c, r: aplicarStress(snapshot, c.choques, b) })),
    [snapshot, b],
  );
  const choques = selId === "custom" ? custom : CENARIOS.find((c) => c.id === selId)!.choques;
  const r = useMemo(() => aplicarStress(snapshot, choques, b), [snapshot, choques, b]);
  const temDeriv = snapshot.posicoes.some((p) => p.derivativo);
  const pat = snapshot.patrimonioBRL;

  return (
    <>
      <div className="card">
        <div className="card__cab">
          <h3>Cenários de estresse</h3>
          <span className="muted">choque instantâneo, reavaliando posição a posição</span>
        </div>
        <div className="tabela-scroll">
          <table>
            <thead>
              <tr>
                <th>Cenário</th>
                <th>Choques</th>
                {temDeriv && <th className="right">Sem derivativos</th>}
                <th className="right">{temDeriv ? "Com derivativos" : "P&L"}</th>
                <th className="right">% PL</th>
              </tr>
            </thead>
            <tbody>
              {todos.map(({ c, r: x }) => (
                <tr key={c.id} onClick={() => setSelId(c.id)} style={{ cursor: "pointer", background: c.id === selId ? "var(--superficie-2)" : undefined }}>
                  <td>
                    <div className="td-principal">{c.nome}</div>
                    <div className="td-sub">{c.descricao}</div>
                  </td>
                  <td className="td-sub">{rotuloChoques(c.choques)}</td>
                  {temDeriv && <td className={`right ${sinal(x.semDerivativosBRL)}`}>{fmtBRL(x.semDerivativosBRL)}</td>}
                  <td className={`right td-principal ${sinal(x.totalBRL)}`}>{fmtBRL(x.totalBRL)}</td>
                  <td className={`right ${sinal(x.totalPct)}`}>{fmtPct(x.totalPct)}</td>
                </tr>
              ))}
              <tr onClick={() => setSelId("custom")} style={{ cursor: "pointer", background: selId === "custom" ? "var(--superficie-2)" : undefined }}>
                <td>
                  <div className="td-principal">Customizado</div>
                  <div className="td-sub">defina os choques abaixo</div>
                </td>
                <td className="td-sub">{rotuloChoques(custom)}</td>
                {temDeriv && <td />}
                <td />
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        {selId === "custom" && (
          <div className="row" style={{ marginTop: "1rem" }}>
            {FATORES_STRESS.map((f) => (
              <div className="campo" key={f.id} style={{ flex: "1 1 110px" }}>
                <label htmlFor={`st-${f.id}`}>{f.rotulo} (%)</label>
                <input
                  id={`st-${f.id}`}
                  inputMode="decimal"
                  value={custom[f.id] ?? ""}
                  onChange={(e) => {
                    const v = Number(e.target.value.replace(",", "."));
                    setCustom((c) => ({ ...c, [f.id]: e.target.value === "" || !isFinite(v) ? undefined : v }));
                  }}
                  placeholder="0"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card__cab">
          <h3>{selId === "custom" ? "Customizado" : CENARIOS.find((c) => c.id === selId)?.nome} — por posição</h3>
          <span className={`num ${sinal(r.totalBRL)}`} style={{ fontWeight: 700 }}>
            {fmtBRL(r.totalBRL)} ({fmtPct(r.totalPct)})
          </span>
        </div>
        {temDeriv && (
          <p className="muted" style={{ marginTop: 0 }}>
            Sem os derivativos a carteira faria {fmtBRL(r.semDerivativosBRL)} ({fmtPct(pat > 0 ? (r.semDerivativosBRL / pat) * 100 : 0)}); o hedge
            responde por <strong className={sinal(r.totalBRL - r.semDerivativosBRL)}>{fmtBRL(r.totalBRL - r.semDerivativosBRL)}</strong>.
          </p>
        )}
        <div className="grafico" style={{ height: Math.max(160, r.posicoes.length * 28) }}>
          <ResponsiveContainer>
            <BarChart data={r.posicoes} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid stroke={paleta.grade} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={fmtBRLCurto} tick={{ fill: paleta.eixo, fontSize: 11 }} tickLine={false} axisLine={{ stroke: paleta.grade }} />
              <YAxis type="category" dataKey="ticker" width={120} tick={{ fill: paleta.eixo, fontSize: 11 }} tickLine={false} axisLine={false} />
              <ReferenceLine x={0} stroke={paleta.eixo} />
              <Tooltip content={<DicaSimples formatarRotulo={(v) => String(v)} formatar={(v) => fmtBRL(v)} />} />
              <Bar dataKey="plBRL" name="P&L">
                {r.posicoes.map((p, i) => (
                  <Cell key={i} fill={p.plBRL < 0 ? paleta.neg : paleta.pos} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}

function rotuloChoques(ch: Partial<Record<FatorStress, number>>): string {
  const partes = FATORES_STRESS.filter((f) => ch[f.id]).map((f) => `${f.rotulo} ${ch[f.id]! > 0 ? "+" : ""}${ch[f.id]}%`);
  return partes.length ? partes.join(" · ") : "—";
}

// ---------------------------------------------------------------------------
// Hedge: beta × mini-índice
// ---------------------------------------------------------------------------

/** Contratos reais da B3 de uma mercadoria (para preço e vencimento das sugestões). */
function useContratos(mercadoria: CodigoMercadoria): ContratoB3[] {
  const [lista, setLista] = useState<ContratoB3[]>([]);
  useEffect(() => {
    let vivo = true;
    void cotarFuturosB3(mercadoria).then((c) => vivo && setLista(c));
    return () => {
      vivo = false;
    };
  }, [mercadoria]);
  return lista;
}

/** Contrato mais negociado (maior número de contratos em aberto) ainda não vencido. */
function maisLiquido(lista: ContratoB3[]): ContratoB3 | null {
  const hoje = new Date().toISOString().slice(0, 10);
  return [...lista].filter((c) => c.vencimento >= hoje).sort((a, b) => (b.contratosAbertos ?? 0) - (a.contratosAbertos ?? 0))[0] ?? null;
}

function HedgeBeta({
  snapshot,
  betas: b,
  beta,
  precos,
  onOperar,
  temHistorico,
}: {
  snapshot: PortfolioSnapshot;
  betas: Record<string, number>;
  beta: ReturnType<typeof betaDaCarteira>;
  precos: PrecosSnapshot;
  onOperar?: (o: OrdemSugerida) => void;
  temHistorico: boolean;
}) {
  const hoje = useMemo(() => new Date(), []);
  const listaWin = useContratos("WIN");
  const win = maisLiquido(listaWin);
  const p = useMemo(() => mesclarDiretos(precos, {
    acoes: Object.fromEntries(listaWin.filter((c) => c.ultimo).map((c) => [c.codigo, c.ultimo!])),
    ajustes: Object.fromEntries(listaWin.filter((c) => c.ajuste).map((c) => [c.codigo, { ajuste: c.ajuste!, data: hoje.toISOString().slice(0, 10) }])),
  }), [precos, listaWin, hoje]);
  const cot = win ? precoFuturo(win.codigo, FUTUROS.WIN, win.vencimento, p, hoje) : null;
  const valorContrato = cot ? cot.preco * FUTUROS.WIN.multiplicador : null;
  const contratos = valorContrato ? Math.round(Math.abs(beta.liquidaBRL) / valorContrato) : 0;
  const linhas = snapshot.posicoes.filter((x) => !x.derivativo && x.moeda === "BRL" && ["acao", "etf", "fii"].includes(x.classe));

  return (
    <div className="card">
      <div className="card__cab">
        <h3>Beta e hedge de bolsa</h3>
        <span className="muted">regressão de 252 pregões contra o Ibovespa</span>
      </div>
      {linhas.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>Sem ações brasileiras na carteira.</p>
      ) : (
        <>
          <div className="tabela-scroll">
            <table>
              <thead>
                <tr>
                  <th>Ação</th>
                  <th className="right">Valor</th>
                  <th className="right">Beta</th>
                  <th className="right">Exposição ao Ibovespa</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((x) => {
                  const bx = b[x.ticker];
                  return (
                    <tr key={x.ticker}>
                      <td className="td-principal">{x.ticker}</td>
                      <td className="right">{fmtBRL(x.valorBRL)}</td>
                      <td className="right">{bx == null ? <span className="fraco">1,00*</span> : fmtNum(bx, 2)}</td>
                      <td className="right">{fmtBRL((x.valorBRL ?? 0) * (bx ?? 1))}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="td-principal">Futuros de índice</td>
                  <td />
                  <td />
                  <td className={`right ${sinal(beta.futurosIndiceBRL)}`}>{fmtBRL(beta.futurosIndiceBRL)}</td>
                </tr>
                <tr>
                  <td className="td-principal">Exposição líquida</td>
                  <td className="right">{fmtBRL(beta.acoesBRL)}</td>
                  <td className="right">{fmtNum(beta.betaAcoes, 2)}</td>
                  <td className="right td-principal">{fmtBRL(beta.liquidaBRL)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {!temHistorico && <p className="muted" style={{ fontSize: "0.8rem" }}>* sem série histórica: beta 1 assumido.</p>}
          <div className="aviso" style={{ marginTop: "0.9rem", marginBottom: 0 }}>
            {win && cot ? (
              <>
                {win.codigo} a {fmtNum(cot.preco, 0)} pontos = <strong>{fmtBRL(valorContrato)}</strong> por contrato. Zerar o beta
                exige <strong>{beta.liquidaBRL > 0 ? "vender" : "comprar"} {contratos} {win.codigo}</strong> — a carteira passa a
                render o <em>alfa</em> das ações (o que elas fazem além do índice) mais o CDI implícito no futuro.
                {onOperar && contratos > 0 && (
                  <div style={{ marginTop: "0.6rem" }}>
                    <button onClick={() => onOperar({ codigo: win.codigo, lado: beta.liquidaBRL > 0 ? "venda" : "compra", contratos })}>
                      Montar ordem: {beta.liquidaBRL > 0 ? "vender" : "comprar"} {contratos} {win.codigo}
                    </button>
                  </div>
                )}
              </>
            ) : (
              "Consultando o mini-índice na B3…"
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hedge: dólar
// ---------------------------------------------------------------------------

function ExposicaoCambial({ snapshot, precos, onOperar }: { snapshot: PortfolioSnapshot; precos: PrecosSnapshot; onOperar?: (o: OrdemSugerida) => void }) {
  const wdo = maisLiquido(useContratos("WDO"));
  const dolar = precos.cambio?.USD ?? null;
  const ativosUSD = snapshot.posicoes.filter((p) => !p.derivativo && p.moeda === "USD").reduce((s, p) => s + (p.valorBRL ?? 0), 0);
  const hedge = snapshot.posicoes.filter((p) => p.derivativo?.meta.subjacente === "USD").reduce((s, p) => s + (p.derivativo?.nocionalBRL ?? 0), 0);
  const liquida = ativosUSD + hedge;
  const protegido = ativosUSD > 0 ? Math.max(0, Math.min(100, (-hedge / ativosUSD) * 100)) : null;
  const contratos = dolar ? Math.round(Math.abs(liquida) / dolar / FUTUROS.WDO.quantidadeFisica!) : 0;

  return (
    <div className="card">
      <div className="card__cab">
        <h3>Exposição cambial</h3>
        <span className="muted">dólar {dolar ? `R$ ${fmtNum(dolar, 4)}` : "—"}</span>
      </div>
      <div className="tabela-scroll">
        <table>
          <tbody>
            <tr><td>Ativos em dólar</td><td className="right">{fmtBRL(ativosUSD)}</td></tr>
            <tr><td>Futuros de dólar (WDO/DOL)</td><td className={`right ${sinal(hedge)}`}>{fmtBRL(hedge)}</td></tr>
            <tr><td className="td-principal">Exposição líquida</td><td className="right td-principal">{fmtBRL(liquida)}{dolar ? ` (US$ ${fmtNum(liquida / dolar, 0)})` : ""}</td></tr>
            <tr><td>Protegido</td><td className="right">{protegido == null ? "—" : `${fmtNum(protegido, 0)}%`}</td></tr>
          </tbody>
        </table>
      </div>
      {onOperar && wdo && contratos > 0 && (
        <div className="row" style={{ marginTop: "0.9rem" }}>
          <button className="secundario" onClick={() => onOperar({ codigo: wdo.codigo, lado: liquida > 0 ? "venda" : "compra", contratos })}>
            {liquida > 0 ? "Vender" : "Comprar"} {contratos} {wdo.codigo} para zerar a exposição
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calculadora de hedge (exposição física)
// ---------------------------------------------------------------------------

const CENARIOS_CALC = [-20, -10, -5, 0, 5, 10, 20];
const MERCADORIAS_FISICAS = MERCADORIAS.filter((m) => !FUTUROS_INDICE.includes(m));

function CalculadoraHedge({ precos, onOperar }: { precos: PrecosSnapshot; onOperar?: (o: OrdemSugerida) => void }) {
  const hoje = useMemo(() => new Date(), []);
  const paleta = usarPaleta(useTemaEscuro());
  const [mercadoria, setMercadoria] = useState<CodigoMercadoria>("WDO");
  const [direcao, setDirecao] = useState<"pagar" | "receber">("pagar");
  const [quantidade, setQuantidade] = useState("500000");
  const [codigoSel, setCodigoSel] = useState("");
  const spec = FUTUROS[mercadoria];
  const lista = useContratos(mercadoria).filter((c) => c.vencimento >= hoje.toISOString().slice(0, 10)).slice(0, 8);
  const venc = lista.find((v) => v.codigo === codigoSel) ?? maisLiquido(lista);
  const p = useMemo(() => mesclarDiretos(precos, {
    acoes: Object.fromEntries(lista.filter((c) => c.ultimo).map((c) => [c.codigo, c.ultimo!])),
    ajustes: Object.fromEntries(lista.filter((c) => c.ajuste).map((c) => [c.codigo, { ajuste: c.ajuste!, data: hoje.toISOString().slice(0, 10) }])),
  }), [precos, lista, hoje]);
  const cot = venc ? precoFuturo(venc.codigo, spec, venc.vencimento, p, hoje) : null;

  const Q = Number(quantidade.replace(/\./g, "").replace(",", "."));
  const qValido = isFinite(Q) && Q > 0;
  const tamanho = spec.quantidadeFisica ?? spec.multiplicador;
  const contratos = qValido ? Math.max(1, Math.round(Q / tamanho)) : 0;
  const cobertura = qValido ? (contratos * tamanho) / Q : 0;
  const divisor = spec.referencia === "USD" ? 1000 : 1;
  const fxCot = spec.moedaCotacao === "BRL" ? 1 : precos.cambio?.USD ?? 0;
  const lado = direcao === "pagar" ? "compra" : "venda";
  const sinalHedge = direcao === "pagar" ? 1 : -1;
  const unidadeFisica = spec.unidadeFisica ?? "unidades";
  const simbolo = spec.moedaCotacao === "BRL" ? "R$" : "US$";
  const rotuloValor = direcao === "pagar" ? "Custo" : "Receita";

  const cenarios = useMemo(() => {
    if (!cot || !qValido) return [];
    const F0 = cot.preco;
    return CENARIOS_CALC.map((x) => {
      const FT = F0 * (1 + x / 100);
      const fisico = Q * (FT / divisor) * fxCot;
      const ganho = sinalHedge * contratos * spec.multiplicador * (FT - F0) * fxCot;
      const comHedge = direcao === "pagar" ? fisico - ganho : fisico + ganho;
      return { x, preco: FT, semHedge: fisico, comHedge, ganho };
    });
  }, [cot, qValido, Q, divisor, fxCot, sinalHedge, contratos, spec.multiplicador, direcao]);

  return (
    <div className="card">
      <div className="card__cab">
        <h3>Calculadora de hedge</h3>
        <span className="muted">trava o preço de uma exposição real (empresa, produtor, importador)</span>
      </div>

      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="campo" style={{ flex: "2 1 190px" }}>
          <label htmlFor="hm">Exposição a</label>
          <select
            id="hm"
            value={mercadoria}
            onChange={(e) => {
              const m = e.target.value as CodigoMercadoria;
              setMercadoria(m);
              setCodigoSel("");
              setQuantidade(String((FUTUROS[m].quantidadeFisica ?? 1) * (m === "WDO" ? 50 : 10)));
            }}
          >
            {MERCADORIAS_FISICAS.map((m) => (
              <option key={m} value={m}>{FUTUROS[m].nome} ({m})</option>
            ))}
          </select>
        </div>
        <div className="campo" style={{ flex: "0 0 auto" }}>
          <label>Situação</label>
          <div className="segmented">
            <button className={direcao === "pagar" ? "ativo" : ""} onClick={() => setDirecao("pagar")}>Vou pagar/comprar</button>
            <button className={direcao === "receber" ? "ativo" : ""} onClick={() => setDirecao("receber")}>Vou receber/vender</button>
          </div>
        </div>
        <div className="campo" style={{ flex: "1 1 150px" }}>
          <label htmlFor="hq">Quantidade ({unidadeFisica})</label>
          <input id="hq" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} inputMode="decimal" />
        </div>
        <div className="campo" style={{ flex: "1 1 170px" }}>
          <label htmlFor="hv">Contrato</label>
          <select id="hv" value={venc?.codigo ?? ""} onChange={(e) => setCodigoSel(e.target.value)}>
            {lista.map((v) => (
              <option key={v.codigo} value={v.codigo}>{v.codigo} — {fmtDataLonga(v.vencimento)}</option>
            ))}
          </select>
        </div>
      </div>

      {!cot ? (
        <p className="aviso" style={{ margin: 0 }}>{lista.length === 0 ? "Consultando a B3…" : `${spec.nome} sem preço agora.`}</p>
      ) : !qValido ? (
        <p className="aviso" style={{ margin: 0 }}>Informe a quantidade exposta.</p>
      ) : (
        <>
          <div className="aviso" style={{ marginBottom: "0.9rem" }}>
            {direcao === "pagar"
              ? "Quem vai PAGAR fica exposto à ALTA: a proteção é COMPRAR futuro."
              : "Quem vai RECEBER fica exposto à QUEDA: a proteção é VENDER futuro."}{" "}
            <strong>{lado === "compra" ? "Comprar" : "Vender"} {contratos} {venc!.codigo}</strong> ({spec.tamanho} cada) trava{" "}
            <strong>{simbolo} {fmtNum(cot.preco / divisor, divisor > 1 ? 4 : 2)}</strong> por {divisor > 1 ? "US$" : unidadeFisica.replace(/s$/, "")} —
            cobertura de {fmtNum(cobertura * 100, 0)}%{cobertura !== 1 ? " (contratos são inteiros)" : ""}.
            {onOperar && (
              <div style={{ marginTop: "0.6rem" }}>
                <button onClick={() => onOperar({ codigo: venc!.codigo, lado, contratos })}>Montar esta ordem</button>
              </div>
            )}
          </div>

          <div className="tabela-scroll">
            <table>
              <thead>
                <tr>
                  <th>Cenário no vencimento</th>
                  <th className="right">Preço</th>
                  <th className="right">{rotuloValor} sem hedge</th>
                  <th className="right">Resultado do futuro</th>
                  <th className="right">{rotuloValor} com hedge</th>
                </tr>
              </thead>
              <tbody>
                {cenarios.map((c) => (
                  <tr key={c.x}>
                    <td>{c.x === 0 ? "estável" : `${c.x > 0 ? "alta" : "queda"} de ${Math.abs(c.x)}%`}</td>
                    <td className="right">{simbolo} {fmtNum(c.preco, spec.casas)}</td>
                    <td className="right">{fmtBRL(c.semHedge)}</td>
                    <td className={`right ${sinal(c.ganho)}`}>{fmtBRL(c.ganho)}</td>
                    <td className="right td-principal">{fmtBRL(c.comHedge)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grafico" style={{ height: 240, marginTop: "1rem" }}>
            <ResponsiveContainer>
              <LineChart data={cenarios} margin={{ top: 6, right: 10, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={paleta.grade} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="x" tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`} tick={{ fill: paleta.eixo, fontSize: 12 }} tickLine={false} axisLine={{ stroke: paleta.grade }} />
                <YAxis tickFormatter={fmtBRLCurto} tick={{ fill: paleta.eixo, fontSize: 12 }} width={80} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
                <Tooltip content={<DicaSimples formatarRotulo={(v) => `Variação de ${v}%`} formatar={(v) => fmtBRL(v)} />} />
                <Legend />
                <Line type="monotone" dataKey="semHedge" name={`${rotuloValor} sem hedge`} stroke={paleta.series[1]} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="comHedge" name={`${rotuloValor} com hedge`} stroke={paleta.carteira} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="muted" style={{ fontSize: "0.82rem", margin: "0.6rem 0 0" }}>
            A linha com hedge fica reta: é o preço travado. Fica de fora o <em>risco de base</em> (o preço local pode descolar do
            contrato) e o custo de carregar a margem.
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metodologia
// ---------------------------------------------------------------------------

function Metodologia() {
  return (
    <details className="card">
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Metodologia e premissas</summary>
      <ul className="muted" style={{ margin: "0.8rem 0 0", paddingLeft: "1.1rem", lineHeight: 1.6, fontSize: "0.88rem" }}>
        <li>
          <strong>VaR histórico</strong>: carteira de hoje reavaliada com os retornos diários dos últimos 252 pregões
          (prices_history). <strong>Paramétrico</strong>: delta-normal, z × √(eᵀΣe) com a covariância dos mesmos retornos.
          10 dias pela regra da raiz do tempo. ES 97,5% = média das perdas além do quantil.
        </li>
        <li>
          <strong>Fatores</strong>: cada ação/cripto é o próprio fator; ativo no exterior soma o dólar; futuros entram pelo
          nocional no objeto (dólar, Ibovespa, commodity). Renda fixa fica fora do VaR de curto prazo.
          Commodities sem série usam volatilidade padrão (boi 18%, milho 25%, café 35%, soja 25% a.a.).
        </li>
        <li>
          <strong>Stress</strong>: choques instantâneos de magnitude aproximada aos episódios. Ações via beta; futuros pelo
          nocional.
        </li>
        <li>
          <strong>Preços</strong>: futuros pela API de cotações da B3 (15 min de atraso) — último negócio, senão o ajuste
          do pregão anterior. Margem simplificada: 10–15% do nocional.
        </li>
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------------------

function Kpi({ rotulo, valor, classe, extra }: { rotulo: string; valor: string; classe?: string; extra?: string }) {
  return (
    <div className="kpi">
      <div className="rotulo">{rotulo}</div>
      <div className={`valor ${classe ?? ""}`}>{valor}</div>
      {extra && <div className="extra">{extra}</div>}
    </div>
  );
}

/** Tooltip no estilo do app para eixos que não são datas. */
function DicaSimples({
  active,
  payload,
  label,
  formatarRotulo,
  formatar,
}: {
  active?: boolean;
  payload?: Array<{ name?: string | number; value?: number | string; color?: string; payload?: { fill?: string } }>;
  label?: string | number;
  formatarRotulo: (v: string | number) => string;
  formatar: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="dica">
      <div className="dica__data">{formatarRotulo(label ?? "")}</div>
      {payload.map((p, i) => (
        <div className="dica__linha" key={i}>
          <span style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
            <span className="ponto" style={{ background: p.color ?? p.payload?.fill }} />
            {p.name}
          </span>
          <b>{formatar(Number(p.value))}</b>
        </div>
      ))}
    </div>
  );
}
