import { fmtBRL, fmtNum, fmtPct } from "../engine/report";
import type { PortfolioSnapshot, Posicao } from "../engine/types";
import { sinal } from "./grafico";

const ROTULO_CLASSE: Record<string, string> = {
  acao: "Ação",
  etf: "ETF",
  fii: "FII",
  tesouro: "Tesouro",
  bond: "Título",
  futuro: "Futuro",
  cripto: "Cripto",
};

export function Positions({ snapshot }: { snapshot: PortfolioSnapshot }) {
  if (snapshot.posicoes.length === 0) {
    return (
      <div className="card">
        <div className="vazio">
          <span className="vazio__ico" aria-hidden="true">◧</span>
          <strong>Nenhuma posição ainda</strong>
          Vá em <em>Operar</em> para comprar o primeiro ativo. Caixa disponível:{" "}
          {fmtBRL(snapshot.caixaBRL)}.
        </div>
      </div>
    );
  }

  const normais = snapshot.posicoes.filter((p) => !p.derivativo);
  const derivativos = snapshot.posicoes.filter((p) => p.derivativo);
  const investido = normais.reduce((s, p) => s + (p.valorBRL ?? 0), 0);

  return (
    <div className="grid">
      {normais.length > 0 && (
      <div className="card">
        <div className="card__cab">
          <h3>Posições</h3>
          <span className="muted">
            {normais.length} {normais.length === 1 ? "ativo" : "ativos"} · {fmtBRL(investido)} investidos
          </span>
        </div>

        <div className="tabela-scroll">
          <table>
            <thead>
              <tr>
                <th>Ativo</th>
                <th className="right">Qtd</th>
                <th className="right">Preço médio</th>
                <th className="right">Preço atual</th>
                <th className="right">Hoje</th>
                <th className="right">Valor</th>
                <th className="right">P&amp;L</th>
                <th className="right">Peso</th>
              </tr>
            </thead>
            <tbody>
              {normais.map((p) => (
                <Linha key={p.ticker} p={p} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {derivativos.length > 0 && <TabelaDerivativos posicoes={derivativos} snapshot={snapshot} />}

      {snapshot.posicoesSemPreco > 0 && (
        <div className="aviso">
          Posições marcadas <strong>a custo</strong> ainda não têm cotação de mercado. Elas entram no
          patrimônio pelo valor pago (o dinheiro não some), mas não mostram valorização até a
          primeira cotação chegar.
        </div>
      )}
    </div>
  );
}

function Linha({ p }: { p: Posicao }) {
  const ehRF = p.classe === "tesouro" || p.classe === "bond";
  const simbolo = p.moeda === "BRL" ? "R$" : "US$";

  return (
    <tr>
      <td>
        <div className="td-principal">
          {p.ticker}
          {p.marcacao === "custo" && (
            <span className="badge badge--atencao" style={{ marginLeft: 6 }}>a custo</span>
          )}
          {p.marcacao === "linear" && (
            <span className="badge" style={{ marginLeft: 6 }}>linear</span>
          )}
          {/* Só na renda fixa: numa ação, marcar a mercado é o esperado e o selo
              seria ruído. Num título, é a diferença entre PU oficial e reta. */}
          {ehRF && p.marcacao === "mercado" && (
            <span className="badge badge--marca" style={{ marginLeft: 6 }}>PU oficial</span>
          )}
        </div>
        <div className="td-sub">
          {ROTULO_CLASSE[p.classe] ?? p.classe} · {p.bolsa}
          {p.nome && p.nome !== p.ticker ? ` · ${p.nome}` : ""}
        </div>
      </td>
      <td className="right">{fmtNum(p.qtd, p.qtd % 1 === 0 ? 0 : 4)}</td>
      <td className="right">
        {fmtBRL(p.custoMedioBRL)}
        {p.moeda !== "BRL" && <div className="td-sub">em BRL</div>}
      </td>
      <td className="right">
        {p.precoAtual == null ? "—" : `${ehRF ? "PU " : ""}${simbolo} ${fmtNum(p.precoAtual, 2)}`}
        {p.moeda !== "BRL" && p.fxAtual > 1 && <div className="td-sub">× {fmtNum(p.fxAtual, 4)}</div>}
      </td>
      <td className={`right ${sinal(p.variacaoDiaPct)}`}>
        {p.variacaoDiaPct == null ? (
          <span className="fraco">—</span>
        ) : (
          <>
            {fmtPct(p.variacaoDiaPct)}
            <div className="td-sub" style={{ color: "inherit", opacity: 0.75 }}>
              {fmtBRL(p.variacaoDiaBRL)}
            </div>
          </>
        )}
      </td>
      <td className="right td-principal">{fmtBRL(p.valorBRL)}</td>
      <td className={`right ${sinal(p.plNaoRealizadoBRL)}`}>
        {fmtBRL(p.plNaoRealizadoBRL)}
        <div className="td-sub" style={{ color: "inherit", opacity: 0.75 }}>
          {fmtPct(p.plNaoRealizadoPct)}
        </div>
      </td>
      <td className="right">
        <div className="barra-peso">
          <span className="num">{p.pesoPct == null ? "—" : `${p.pesoPct.toFixed(1)}%`}</span>
          <span className="barra-peso__trilho">
            <span
              className="barra-peso__preenchimento"
              style={{ width: `${Math.min(100, Math.max(0, p.pesoPct ?? 0))}%` }}
            />
          </span>
        </div>
      </td>
    </tr>
  );
}

/**
 * Futuros têm leitura própria: o "valor" deles é o P&L acumulado (não há
 * desembolso). O que mede o tamanho da aposta é o nocional, não o peso no
 * patrimônio.
 */
function TabelaDerivativos({ posicoes, snapshot }: { posicoes: Posicao[]; snapshot: PortfolioSnapshot }) {
  const vencidas = posicoes.filter((p) => p.derivativo?.vencido).length;
  return (
    <div className="card">
      <div className="card__cab">
        <h3>Futuros</h3>
        <span className="muted">
          margem exigida {fmtBRL(snapshot.margemRequeridaBRL)} · caixa livre {fmtBRL(snapshot.caixaLivreBRL)}
        </span>
      </div>
      <div className="tabela-scroll">
        <table>
          <thead>
            <tr>
              <th>Contrato</th>
              <th className="right">Posição</th>
              <th className="right">Preço médio</th>
              <th className="right">Preço atual</th>
              <th className="right">Nocional</th>
              <th className="right">Valor</th>
              <th className="right">P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {posicoes.map((p) => {
              const d = p.derivativo!;
              const sim = d.meta.moedaCotacao === "BRL" ? "R$" : "US$";
              return (
                <tr key={p.ticker}>
                  <td>
                    <div className="td-principal">
                      {p.ticker}
                      {d.vencido ? (
                        <span className="badge badge--atencao" style={{ marginLeft: 6 }}>vencido</span>
                      ) : p.marcacao === "b3" ? (
                        <span className="badge badge--marca" style={{ marginLeft: 6 }}>B3</span>
                      ) : p.marcacao === "ajuste" ? (
                        <span className="badge badge--marca" style={{ marginLeft: 6 }}>ajuste B3</span>
                      ) : p.marcacao === "teorico" ? (
                        <span className="badge" style={{ marginLeft: 6 }}>teórico</span>
                      ) : (
                        <span className="badge badge--atencao" style={{ marginLeft: 6 }}>sem preço</span>
                      )}
                    </div>
                    <div className="td-sub">
                      {ROTULO_CLASSE[p.classe]} · {p.nome}
                    </div>
                  </td>
                  <td className="right">
                    {fmtNum(Math.abs(p.qtd), 0)}
                    <div className="td-sub">{d.lado}</div>
                  </td>
                  <td className="right">{sim} {fmtNum(d.precoMedio, 2)}</td>
                  <td className="right">
                    {p.precoAtual == null ? "—" : `${sim} ${fmtNum(p.precoAtual, 2)}`}
                  </td>
                  <td className={`right ${sinal(d.nocionalBRL)}`}>{fmtBRL(d.nocionalBRL)}</td>
                  <td className="right td-principal">{fmtBRL(p.valorBRL)}</td>
                  <td className={`right ${sinal(p.plNaoRealizadoBRL)}`}>
                    {fmtBRL(p.plNaoRealizadoBRL)}
                    <div className="td-sub" style={{ color: "inherit", opacity: 0.75 }}>{fmtPct(p.plNaoRealizadoPct)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {vencidas > 0 && (
        <p className="aviso" style={{ marginBottom: 0, marginTop: "0.9rem" }}>
          {vencidas === 1 ? "Há 1 contrato vencido" : `Há ${vencidas} contratos vencidos`}, já avaliado(s) pelo valor
          final. Liquide em <em>Operar → Futuros</em> para o resultado virar caixa.
        </p>
      )}
    </div>
  );
}
