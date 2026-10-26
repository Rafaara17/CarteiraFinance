import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { comPontoDeHoje, computarEvolucao, ymd } from "../engine/evolucao";
import { ROTULO_JANELA, computarLamina, pctDoCDI, type Lamina as DadosLamina } from "../engine/lamina";
import { fmtBRL } from "../engine/report";
import type { Ativo, Config, PortfolioSnapshot, Transacao } from "../engine/types";
import { fmtData, fmtMes } from "./grafico";
import { Marca } from "./Marca";
import { useHistorico } from "./useHistorico";

interface Props {
  config: Config;
  snapshot: PortfolioSnapshot;
  transacoes: Transacao[];
  ativos: Ativo[];
}

// A lâmina é um DOCUMENTO: sai sempre em papel branco, com as cores da marca,
// mesmo com o app no tema escuro. Por isso as cores dos gráficos são fixas aqui
// em vez de virem de `usarPaleta` (que segue o tema). CDI e IBOV mantêm os
// matizes dos slots de benchmark do app (--serie-4 / --serie-2, tema claro).
const COR = {
  carteira: "#17416b",
  CDI: "#c98a00",
  IBOV: "#eb6834",
  grade: "#e4e0d8",
  eixo: "#80858c",
};

const ROTULO_CLASSE: Record<string, string> = {
  acao: "Ações",
  etf: "ETFs",
  fii: "FIIs",
  tesouro: "Tesouro Direto",
  bond: "Renda fixa",
  cripto: "Cripto",
  futuro: "Futuros",
  caixa: "Caixa",
};

const COR_CLASSE: Record<string, string> = {
  acao: "#17416b",
  etf: "#2a78d6",
  fii: "#1baf7a",
  tesouro: "#c98a00",
  bond: "#e87ba4",
  cripto: "#4a3aa7",
  caixa: "#b9b3a8",
};

const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MESES_LONGOS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** Anos mostrados na grade mensal: o resto não cabe numa folha. */
const ANOS_NA_GRADE = 3;
const TOP_POSICOES = 10;
/** Diâmetro da pizza de alocação: 30 mm a 96 dpi (tamanho fixo, igual na tela e no papel). */
const PIZZA_PX = Math.round((30 / 25.4) * 96);

export function Lamina({ config, snapshot, transacoes, ativos }: Props) {
  const { historico, carregando, erro } = useHistorico();
  const hoje = useMemo(() => new Date(), []);

  const lamina = useMemo<DadosLamina | null>(() => {
    if (!historico) return null;
    // A lâmina começa na PRIMEIRA operação: antes dela a carteira é só caixa
    // parado (caso da carteira individual ativada depois do início da liga), e
    // esse trecho achataria volatilidade, Sharpe e a grade mensal.
    const primeira = transacoes.reduce<string | null>((m, t) => (m == null || t.ts < m ? t.ts : m), null);
    const inicio = config.dataInicio.slice(0, 10);
    const de = primeira && primeira.slice(0, 10) > inicio ? primeira.slice(0, 10) : inicio;
    const intervalo = { de, ate: ymd(hoje) };
    const ev = comPontoDeHoje(computarEvolucao(config, transacoes, ativos, historico, intervalo), snapshot.patrimonioBRL, hoje);
    const pregoes = new Set(historico.filter((p) => typeof p.indices.IBOV === "number").map((p) => p.data));
    return computarLamina(ev, pregoes);
  }, [historico, config, transacoes, ativos, snapshot.patrimonioBRL, hoje]);

  const [gerando, setGerando] = useState(false);
  const [erroPdf, setErroPdf] = useState<string | null>(null);
  const salvar = async () => {
    const folha = document.querySelector<HTMLElement>(".lamina");
    if (!folha || !lamina) return;
    setGerando(true);
    setErroPdf(null);
    try {
      await salvarPdf(folha, `lamina-${slug(config.nomeLiga)}-${lamina.dataBase}.pdf`);
    } catch (e) {
      setErroPdf(e instanceof Error ? e.message : String(e));
    } finally {
      setGerando(false);
    }
  };

  const [comentario, setComentario] = useComentario(config.nomeLiga, ymd(hoje).slice(0, 7));

  return (
    <div className="lamina-tela grid">
      <div className="card no-print">
        <div className="row">
          <div>
            <h3 style={{ margin: 0 }}>Lâmina de resultados</h3>
            <span className="muted" style={{ fontSize: "0.85rem" }}>
              Salve em PDF para divulgar
            </span>
          </div>
          <div className="spacer" />
          <button onClick={salvar} disabled={gerando || !lamina?.temDados || transacoes.length === 0}>
            {gerando ? "Gerando PDF…" : "Salvar PDF"}
          </button>
        </div>
        <div className="campo" style={{ margin: "0.9rem 0 0" }}>
          <label htmlFor="lamina-comentario">Comentário de gestão</label>
          <textarea
            id="lamina-comentario"
            className="lamina-comentario"
            rows={3}
            maxLength={700}
            placeholder="Ex.: No mês, a carteira se beneficiou da alta de commodities…"
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
          />
        </div>
      </div>

      {erroPdf && <div className="alerta">Não foi possível gerar o PDF: {erroPdf}</div>}
      {carregando && <div className="card muted">Carregando série histórica…</div>}
      {erro && <div className="alerta">Erro ao carregar histórico: {erro}</div>}
      {lamina && transacoes.length === 0 && (
        <div className="card aviso">
          Esta carteira ainda não fez nenhuma operação — a lâmina passa a existir a partir da primeira compra.
        </div>
      )}
      {lamina && transacoes.length > 0 && !lamina.temDados && (
        <div className="card aviso">
          Ainda não há série histórica para montar a lâmina. Um admin pode gerá-la em{" "}
          <strong>Admin → Série histórica</strong>.
        </div>
      )}

      {lamina?.temDados && transacoes.length > 0 && (
        <Folha config={config} snapshot={snapshot} lamina={lamina} comentario={comentario.trim()} />
      )}
    </div>
  );
}

/**
 * Gera o PDF A4 da folha e baixa direto, sem passar pela janela de impressão.
 * As bibliotecas só são carregadas no clique: quem nunca exporta não as baixa.
 * A captura simula uma tela larga (`windowWidth`), para o PDF sair sempre no
 * layout de duas colunas, mesmo quando gerado no celular.
 */
async function salvarPdf(folha: HTMLElement, nome: string): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);
  const canvas = await html2canvas(folha, {
    scale: 3,
    backgroundColor: "#ffffff",
    windowWidth: 1400,
    useCORS: true,
    logging: false,
  });
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const largura = 210;
  const altura = (canvas.height / canvas.width) * largura;
  // Conteúdo mais alto que o A4 (muitas posições, vários anos na grade) é
  // reduzido para caber numa página, em vez de cortado.
  const escala = Math.min(1, 297 / altura);
  const w = largura * escala;
  pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (largura - w) / 2, 0, w, altura * escala);
  pdf.save(nome);
}

/** "Carteira individual — Rafael" -> "carteira-individual-rafael". */
function slug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Comentário salvo no navegador, por carteira e mês: é rascunho de quem imprime. */
function useComentario(carteira: string, mes: string): [string, (v: string) => void] {
  const chave = `lamina-comentario:${carteira}:${mes}`;
  const [texto, setTexto] = useState(() => {
    try {
      return localStorage.getItem(chave) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      if (texto) localStorage.setItem(chave, texto);
      else localStorage.removeItem(chave);
    } catch {
      // armazenamento bloqueado: o comentário só vive nesta sessão
    }
  }, [chave, texto]);
  return [texto, setTexto];
}

// ---------------------------------------------------------------------------

function Folha({
  config, snapshot, lamina, comentario,
}: {
  config: Config; snapshot: PortfolioSnapshot; lamina: DadosLamina; comentario: string;
}) {
  const r = Object.fromEntries(lamina.rentabilidades.map((x) => [x.janela, x]));
  const [ano, mes] = lamina.dataBase.split("-");
  const pl = snapshot.patrimonioBRL;
  const folha = useCaberNumaFolha();

  return (
    <article className="lamina" aria-label="Lâmina de resultados" ref={folha}>
      <header className="lamina__topo">
        <div className="lamina__logo-area">
          <Marca variante="branca" className="lamina__logo" />
        </div>
        <div className="lamina__titulo">
          <span className="lamina__eyebrow">Lâmina mensal · {MESES_LONGOS[Number(mes) - 1]} de {ano}</span>
          <h1>{config.nomeLiga}</h1>
        </div>
        <div className="lamina__database">
          <span>Data-base</span>
          <b>{dataBR(lamina.dataBase)}</b>
        </div>
      </header>

      <section className="lamina__faixa">
        <Destaque rotulo="Patrimônio" valor={fmtBRL(pl)} />
        <Destaque rotulo="No mês" valor={pct(r.mes?.carteira, true)} sinal={r.mes?.carteira} extra={cdiDe(r.mes)} />
        <Destaque rotulo="No ano" valor={pct(r.ano?.carteira, true)} sinal={r.ano?.carteira} extra={cdiDe(r.ano)} />
        <Destaque rotulo="12 meses" valor={pct(r["12m"]?.carteira, true)} sinal={r["12m"]?.carteira} extra={cdiDe(r["12m"])} />
        <Destaque rotulo="Desde o início" valor={pct(r.inicio?.carteira, true)} sinal={r.inicio?.carteira} extra={cdiDe(r.inicio)} />
      </section>

      <div className="lamina__corpo">
        <aside className="lamina__lateral">
          <Secao titulo="Sobre a carteira">
            <p className="lamina__texto">
              Carteira de investimentos da ESALQ Finance, gerida pelos membros da liga.
            </p>
          </Secao>

          <Secao titulo="Características">
            <Lista
              itens={[
                ["Início", dataBR(lamina.inicio)],
                ["Capital inicial", fmtBRL(config.capitalInicial)],
                ["Patrimônio atual", fmtBRL(pl)],
                ["Benchmark", "CDI"],
                ["Referência de mercado", "Ibovespa"],
                ["Nº de ativos", String(snapshot.posicoes.filter((p) => !p.derivativo).length)],
                ["Caixa", `${fmtBRL(snapshot.caixaBRL)} (${pct(pl > 0 ? (snapshot.caixaBRL / pl) * 100 : null)})`],
                ...nocionalFuturos(snapshot),
                ["Moeda", config.moedaBase],
                ["Gestão", "ESALQ Finance"],
              ]}
            />
          </Secao>

          <Secao titulo="Risco e retorno">
            <Indicadores lamina={lamina} />
          </Secao>

          {comentario && (
            <Secao titulo="Comentário da gestão">
              <p className="lamina__texto lamina__comentario">{comentario}</p>
            </Secao>
          )}
        </aside>

        <main className="lamina__principal">
          <Secao titulo="Rentabilidade acumulada" nota="desde o início, em %">
            <Grafico lamina={lamina} />
          </Secao>

          <Secao titulo="Rentabilidade por período">
            <table className="lamina__tabela">
              <thead>
                <tr>
                  <th />
                  {lamina.rentabilidades.map((x) => <th key={x.janela} className="r">{ROTULO_JANELA[x.janela]}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr className="lamina__linha-carteira">
                  <td>Carteira</td>
                  {lamina.rentabilidades.map((x) => <td key={x.janela} className={`r ${cor(x.carteira)}`}>{pct(x.carteira)}</td>)}
                </tr>
                <tr>
                  <td>CDI</td>
                  {lamina.rentabilidades.map((x) => <td key={x.janela} className="r">{pct(x.CDI)}</td>)}
                </tr>
                <tr>
                  <td>Ibovespa</td>
                  {lamina.rentabilidades.map((x) => <td key={x.janela} className="r">{pct(x.IBOV)}</td>)}
                </tr>
                <tr>
                  <td>% do CDI</td>
                  {lamina.rentabilidades.map((x) => <td key={x.janela} className="r">{pct(x.pctCDI, false, 0)}</td>)}
                </tr>
              </tbody>
            </table>
          </Secao>

          <Secao titulo="Rentabilidade mensal" nota="em %">
            <GradeMensal lamina={lamina} />
          </Secao>

          <Secao titulo={`Principais posições`} nota={`top ${TOP_POSICOES}, % do patrimônio`}>
            <Posicoes snapshot={snapshot} />
          </Secao>

          <Secao titulo="Alocação por classe" nota="% do patrimônio">
            <Alocacao snapshot={snapshot} />
          </Secao>
        </main>
      </div>

      <footer className="lamina__rodape">
        <p>
          <b>Carteira com fins exclusivamente educacionais.</b> Não
          capta recursos e não constitui oferta ou recomendação. Rentabilidade passada não representa garantia
          de rentabilidade futura.
        </p>
        <p className="lamina__rodape-marca">
          <span>ESALQ Finance · Liga de Mercado Financeiro da ESALQ/USP</span>
          <span>Gerado em {new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
        </p>
      </footer>
    </article>
  );
}

/** Altura de uma folha A4 em px CSS (96 dpi). */
const A4_PX = (297 / 25.4) * 96;

/**
 * Garante UMA página: na hora de imprimir (botão ou Ctrl+P), se o conteúdo
 * passar do A4 — muitas posições, vários anos na grade —, o corpo é reduzido na
 * proporção exata que falta, em vez de a folha ser cortada no rodapé.
 */
function useCaberNumaFolha() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const antes = () => {
      const el = ref.current;
      const corpo = el?.querySelector<HTMLElement>(".lamina__corpo");
      if (!el || !corpo) return;
      corpo.style.zoom = "";
      const total = [...el.children].reduce((s, c) => s + c.getBoundingClientRect().height, 0);
      if (total <= A4_PX) return;
      const altura = corpo.getBoundingClientRect().height;
      corpo.style.zoom = String(Math.max(0.6, (altura - (total - A4_PX) - 4) / altura));
    };
    const depois = () => {
      const corpo = ref.current?.querySelector<HTMLElement>(".lamina__corpo");
      if (corpo) corpo.style.zoom = "";
    };
    window.addEventListener("beforeprint", antes);
    window.addEventListener("afterprint", depois);
    return () => {
      window.removeEventListener("beforeprint", antes);
      window.removeEventListener("afterprint", depois);
    };
  }, []);
  return ref;
}

// ---------------------------------------------------------------------------

function Secao({ titulo, nota, children }: { titulo: string; nota?: string; children: ReactNode }) {
  return (
    <section className="lamina__secao">
      <h2>
        {titulo}
        {nota && <span>{nota}</span>}
      </h2>
      {children}
    </section>
  );
}

function Destaque({ rotulo, valor, sinal, extra }: { rotulo: string; valor: string; sinal?: number | null; extra?: string }) {
  return (
    <div className="lamina__destaque">
      <span className="lamina__destaque-rot">{rotulo}</span>
      <b className={cor(sinal)}>{valor}</b>
      {extra && <span className="lamina__destaque-extra">{extra}</span>}
    </div>
  );
}

function Lista({ itens }: { itens: Array<[string, string, string?]> }) {
  return (
    <dl className="lamina__lista">
      {itens.map(([k, v, classe]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className={classe}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Indicadores({ lamina }: { lamina: DadosLamina }) {
  const i = lamina.indicadores;
  const meses = i.mesesPositivos + i.mesesNegativos;
  return (
    <Lista
      itens={[
        ["Retorno anualizado", i.retornoAnualizado == null ? "—" : pct(i.retornoAnualizado), cor(i.retornoAnualizado)],
        ["Volatilidade anualizada", pct(i.volAnual)],
        ["Índice de Sharpe", num(i.sharpe)],
        ["Índice de Sortino", num(i.sortino)],
        ["Drawdown máximo", pct(i.drawdownMax), cor(i.drawdownMax < 0 ? -1 : null)],
        ["VaR 95% (1 dia)", i.var95 == null ? "—" : `${i.var95 > 0 ? "−" : ""}${pct(i.var95)}`],
        ["Beta (Ibovespa)", num(i.beta)],
        ["Correlação (Ibovespa)", num(i.correlacao)],
        ["Tracking error", pct(i.trackingError)],
        ["Information ratio", num(i.informationRatio)],
        ["Meses positivos", meses ? `${i.mesesPositivos} de ${meses}` : "—"],
        ["Meses acima do CDI", meses ? `${i.mesesAcimaCDI} de ${meses}` : "—"],
        ["Melhor mês", i.melhorMes ? `${pct(i.melhorMes.pct, true)} (${fmtMes(i.melhorMes.mes)})` : "—", cor(i.melhorMes?.pct)],
        ["Pior mês", i.piorMes ? `${pct(i.piorMes.pct, true)} (${fmtMes(i.piorMes.mes)})` : "—", cor(i.piorMes?.pct)],
      ]}
    />
  );
}

function Grafico({ lamina }: { lamina: DadosLamina }) {
  const ultimo = lamina.serie[lamina.serie.length - 1];
  const fim = (k: "carteira" | "CDI" | "IBOV") => {
    for (let i = lamina.serie.length - 1; i >= 0; i--) {
      const v = lamina.serie[i][k];
      if (typeof v === "number") return v;
    }
    return null;
  };
  // Série curta (carteira nova): o eixo mostra dias, não meses repetidos.
  const curta = Date.parse(ultimo.data) - Date.parse(lamina.serie[0].data) < 90 * 86_400_000;
  return (
    <>
      <div className="lamina__legenda">
        <span><i style={{ background: COR.carteira }} />Carteira <b>{pct(ultimo.carteira, true)}</b></span>
        <span><i style={{ background: COR.CDI }} />CDI <b>{pct(fim("CDI"), true)}</b></span>
        <span><i style={{ background: COR.IBOV }} />Ibovespa <b>{pct(fim("IBOV"), true)}</b></span>
      </div>
      <div className="lamina__grafico">
        <ResponsiveContainer>
          <LineChart data={lamina.serie} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={COR.grade} vertical={false} />
            <XAxis
              dataKey="data"
              tickFormatter={(d: string) => (curta ? fmtData(d) : fmtMes(d))}
              tick={{ fill: COR.eixo, fontSize: 9 }}
              minTickGap={36}
              tickLine={false}
              axisLine={{ stroke: COR.grade }}
            />
            <YAxis
              tickFormatter={(v) => `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
              tick={{ fill: COR.eixo, fontSize: 9 }}
              width={34}
              tickLine={false}
              axisLine={false}
            />
            <ReferenceLine y={0} stroke={COR.eixo} strokeOpacity={0.5} />
            <Line dataKey="IBOV" stroke={COR.IBOV} strokeWidth={1.25} dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="CDI" stroke={COR.CDI} strokeWidth={1.25} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
            <Line dataKey="carteira" stroke={COR.carteira} strokeWidth={2.25} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function GradeMensal({ lamina }: { lamina: DadosLamina }) {
  const anos = lamina.grade.slice(-ANOS_NA_GRADE).reverse();
  return (
    <div className="lamina__rolagem">
      <table className="lamina__tabela lamina__tabela--grade">
        <thead>
          <tr>
            <th>Ano</th>
            <th />
            {MESES_CURTOS.map((m) => <th key={m} className="r">{m}</th>)}
            <th className="r">Ano</th>
            <th className="r">Acum.</th>
          </tr>
        </thead>
        {anos.map((g) => (
          <tbody key={g.ano} className="lamina__ano">
            <tr className="lamina__linha-carteira">
              <td rowSpan={2} className="lamina__ano-rot">{g.ano}</td>
              <td>Carteira</td>
              {g.carteira.map((v, i) => <td key={i} className={`r ${cor(v)}`}>{pct(v, false, 2, false)}</td>)}
              <td className={`r forte ${cor(g.totalCarteira)}`}>{pct(g.totalCarteira, false, 2, false)}</td>
              <td className={`r forte ${cor(g.acumulado)}`}>{pct(g.acumulado, false, 2, false)}</td>
            </tr>
            <tr>
              <td>% CDI</td>
              {g.carteira.map((v, i) => <td key={i} className="r">{pct(pctDoCDI(v, g.CDI[i]), false, 0, false)}</td>)}
              <td className="r">{pct(pctDoCDI(g.totalCarteira, g.totalCDI), false, 0, false)}</td>
              <td />
            </tr>
          </tbody>
        ))}
      </table>
    </div>
  );
}

function Alocacao({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const pl = snapshot.patrimonioBRL;
  // Sobre o PATRIMÔNIO (com caixa): é o que soma 100% na lâmina. Futuros ficam
  // fora — o valor deles é o P&L do ajuste, não exposição (ver Características).
  const itens = [
    ...snapshot.alocacaoPorClasse.map((a) => ({ chave: a.chave, valor: a.valorBRL })),
    ...(snapshot.caixaBRL > 0 ? [{ chave: "caixa", valor: snapshot.caixaBRL }] : []),
  ]
    .filter((a) => a.valor > 0)
    .sort((a, b) => b.valor - a.valor);
  const total = itens.reduce((s, a) => s + a.valor, 0) || pl;
  if (!itens.length) return <p className="lamina__texto">Sem posições.</p>;
  return (
    <div className="lamina__aloc">
      <div className="lamina__pizza" role="img" aria-label="Alocação por classe">
        <PieChart width={PIZZA_PX} height={PIZZA_PX}>
          <Pie
            data={itens}
            dataKey="valor"
            nameKey="chave"
            innerRadius="52%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            stroke="#fff"
            strokeWidth={1.5}
            isAnimationActive={false}
          >
            {itens.map((a) => <Cell key={a.chave} fill={COR_CLASSE[a.chave] ?? "#8a8f96"} />)}
          </Pie>
        </PieChart>
      </div>
      <dl className="lamina__lista lamina__lista--aloc">
        {itens.map((a) => (
          <div key={a.chave}>
            <dt><i style={{ background: COR_CLASSE[a.chave] ?? "#8a8f96" }} />{ROTULO_CLASSE[a.chave] ?? a.chave}</dt>
            <dd>{pct((a.valor / total) * 100)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Posicoes({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const pl = snapshot.patrimonioBRL;
  const fisicas = snapshot.posicoes
    .filter((p) => !p.derivativo && (p.valorBRL ?? 0) > 0)
    .sort((a, b) => (b.valorBRL ?? 0) - (a.valorBRL ?? 0));
  const top = fisicas.slice(0, TOP_POSICOES);
  const maior = top[0]?.valorBRL ?? 0;
  if (!top.length) return <p className="lamina__texto">Sem posições.</p>;
  return (
    <table className="lamina__tabela">
      <thead>
        <tr>
          <th>Ativo</th>
          <th>Classe</th>
          <th className="r">Resultado</th>
          <th className="r" colSpan={2}>% PL</th>
        </tr>
      </thead>
      <tbody>
        {top.map((p) => (
          <tr key={p.ticker}>
            <td>
              <b>{p.ticker}</b> <span className="lamina__nome">{p.nome !== p.ticker ? p.nome : ""}</span>
            </td>
            <td>{ROTULO_CLASSE[p.classe] ?? p.classe}</td>
            <td className={`r ${cor(p.plNaoRealizadoPct)}`}>{pct(p.plNaoRealizadoPct, true)}</td>
            {/* barra e número em colunas próprias: toda barra parte do mesmo ponto */}
            <td className="lamina__peso-cel">
              <span className="lamina__peso">
                <span style={{ width: `${maior > 0 ? ((p.valorBRL ?? 0) / maior) * 100 : 0}%` }} />
              </span>
            </td>
            <td className="r">{pct(pl > 0 ? ((p.valorBRL ?? 0) / pl) * 100 : null)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------

function nocionalFuturos(snapshot: PortfolioSnapshot): Array<[string, string]> {
  const futuros = snapshot.posicoes.filter((p) => p.derivativo);
  if (!futuros.length) return [];
  const liquido = futuros.reduce((s, p) => s + (p.derivativo?.nocionalBRL ?? 0), 0);
  const pl = snapshot.patrimonioBRL;
  return [["Futuros (nocional líq.)", `${fmtBRL(liquido)} (${pct(pl > 0 ? (liquido / pl) * 100 : null)})`]];
}

/** Linha de apoio dos destaques: "% do CDI" com retorno positivo; senão, o CDI do período. */
function cdiDe(x?: { carteira: number | null; CDI: number | null; pctCDI: number | null }): string | undefined {
  if (!x || x.CDI == null) return undefined;
  if (x.pctCDI != null && x.carteira != null && x.carteira > 0) return `${pct(x.pctCDI, false, 0)} do CDI`;
  return `CDI ${pct(x.CDI)}`;
}

/** Percentual no padrão das lâminas: "1,23%" (com `sinal`, "+1,23%"). */
function pct(v: number | null | undefined, sinal = false, casas = 2, simbolo = true): string {
  if (v == null || !isFinite(v)) return "—";
  const s = v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  return `${sinal && v > 0 ? "+" : ""}${s.replace("-", "−")}${simbolo ? "%" : ""}`;
}

function num(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace("-", "−");
}

function cor(v: number | null | undefined): string {
  if (v == null || !isFinite(v) || v === 0) return "";
  return v > 0 ? "pos" : "neg";
}

/** "2026-10-26" -> "26/10/2026". */
function dataBR(ymdStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymdStr);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymdStr;
}
