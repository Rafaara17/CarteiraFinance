import { fmtBRL, fmtPct } from "../engine/report";
import type { AlocacaoItem, PortfolioSnapshot } from "../engine/types";
import { usarPaleta, useTemaEscuro } from "./grafico";

const ROTULO_CLASSE: Record<string, string> = {
  acao: "Ações",
  etf: "ETFs",
  fii: "FIIs",
  tesouro: "Tesouro Direto",
  bond: "Renda fixa",
};

export function Allocation({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const paleta = usarPaleta(useTemaEscuro());

  if (snapshot.valorInvestidoBRL <= 0) {
    return (
      <div className="card">
        <div className="vazio">
          <span className="vazio__ico" aria-hidden="true">🥧</span>
          <strong>Nada alocado ainda</strong>
          A carteira está 100% em caixa — compre um ativo em “Operar” para ver a distribuição.
        </div>
      </div>
    );
  }

  return (
    <div className="grid">
      <Bloco titulo="Por classe de ativo" itens={snapshot.alocacaoPorClasse} paleta={paleta} rotular={(c) => ROTULO_CLASSE[c] ?? c} />
      <Bloco titulo="Por bolsa" itens={snapshot.alocacaoPorBolsa} paleta={paleta} />
      <Bloco titulo="Por moeda" itens={snapshot.alocacaoPorMoeda} paleta={paleta} />
    </div>
  );
}

function Bloco({
  titulo,
  itens,
  paleta,
  rotular,
}: {
  titulo: string;
  itens: AlocacaoItem[];
  paleta: ReturnType<typeof usarPaleta>;
  rotular?: (c: string) => string;
}) {
  return (
    <div className="card">
      <div className="card__cab">
        <h3>{titulo}</h3>
        <span className="muted">{itens.length} {itens.length === 1 ? "categoria" : "categorias"}</span>
      </div>
      <BarraAlocacao itens={itens} paleta={paleta} rotular={rotular} />
      <div className="tabela-scroll" style={{ marginTop: "1rem" }}>
        <table>
          <thead>
            <tr>
              <th>Categoria</th>
              <th className="right">Valor</th>
              <th className="right">Peso</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((it, i) => (
              <tr key={it.chave}>
                <td>
                  <span
                    style={{
                      display: "inline-block", width: 10, height: 10, borderRadius: 3,
                      background: paleta.series[i % paleta.series.length], marginRight: 8,
                    }}
                  />
                  {rotular?.(it.chave) ?? it.chave}
                </td>
                <td className="right">{fmtBRL(it.valorBRL)}</td>
                <td className="right">{fmtPct(it.pesoPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Parte-do-todo como barra empilhada horizontal, não pizza: compara fatias muito
 * melhor, cabe em qualquer largura e não sofre com rótulos girando em volta.
 * Um vão de 2px separa os segmentos e a legenda nomeia cada um — a cor nunca
 * identifica sozinha.
 */
export function BarraAlocacao({
  itens,
  paleta,
  rotular,
}: {
  itens: AlocacaoItem[];
  paleta: ReturnType<typeof usarPaleta>;
  rotular?: (c: string) => string;
}) {
  const total = itens.reduce((s, i) => s + i.valorBRL, 0);
  if (total <= 0) return null;
  const nome = (c: string) => rotular?.(c) ?? c;

  return (
    <div>
      <div
        className="aloc-barra"
        role="img"
        aria-label={`Alocação: ${itens.map((i) => `${nome(i.chave)} ${i.pesoPct.toFixed(1)}%`).join(", ")}`}
      >
        {itens.map((it, i) => (
          <div
            key={it.chave}
            className="aloc-barra__seg"
            style={{
              width: `${(it.valorBRL / total) * 100}%`,
              background: paleta.series[i % paleta.series.length],
            }}
            title={`${nome(it.chave)}: ${fmtBRL(it.valorBRL)} (${it.pesoPct.toFixed(1)}%)`}
          />
        ))}
      </div>
      <div className="aloc-legenda">
        {itens.map((it, i) => (
          <span className="aloc-legenda__item" key={it.chave}>
            <span className="ponto" style={{ background: paleta.series[i % paleta.series.length] }} />
            {nome(it.chave)}
            <span className="val">{it.pesoPct.toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
