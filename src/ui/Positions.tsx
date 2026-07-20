import { fmtBRL, fmtNum, fmtPct } from "../engine/report";
import type { PortfolioSnapshot } from "../engine/types";

const ROTULO_MARCACAO: Record<string, string> = {
  mercado: "mercado",
  linear: "linear",
  "sem-preco": "sem preço",
};

export function Positions({ snapshot }: { snapshot: PortfolioSnapshot }) {
  if (snapshot.posicoes.length === 0) {
    return <div className="card aviso">Nenhuma posição ainda. Vá em “Operar” para comprar o primeiro ativo.</div>;
  }
  return (
    <div className="card">
      <div className="tabela-scroll">
        <table>
          <thead>
            <tr>
              <th>Ativo</th>
              <th>Classe</th>
              <th>Bolsa</th>
              <th>Moeda</th>
              <th className="right">Qtd</th>
              <th className="right">Custo médio (BRL)</th>
              <th className="right">Preço/PU</th>
              <th className="right">Câmbio</th>
              <th className="right">Valor (BRL)</th>
              <th className="right">P&L (BRL)</th>
              <th className="right">P&L %</th>
              <th className="right">Peso</th>
              <th>Marcação</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.posicoes.map((p) => (
              <tr key={p.ticker}>
                <td>
                  <strong>{p.ticker}</strong>
                  <div className="muted" style={{ fontSize: "0.75rem" }}>
                    {p.nome}
                  </div>
                </td>
                <td>{p.classe}</td>
                <td>{p.bolsa}</td>
                <td>{p.moeda}</td>
                <td className="right">{fmtNum(p.qtd, p.qtd % 1 === 0 ? 0 : 4)}</td>
                <td className="right">{fmtBRL(p.custoMedioBRL)}</td>
                <td className="right">{p.precoAtual == null ? "—" : fmtNum(p.precoAtual, 2)}</td>
                <td className="right">{p.moeda === "BRL" ? "—" : fmtNum(p.fxAtual, 4)}</td>
                <td className="right">{fmtBRL(p.valorBRL)}</td>
                <td className={`right ${sinalClasse(p.plNaoRealizadoBRL)}`}>{fmtBRL(p.plNaoRealizadoBRL)}</td>
                <td className={`right ${sinalClasse(p.plNaoRealizadoPct)}`}>{fmtPct(p.plNaoRealizadoPct)}</td>
                <td className="right">{fmtPct(p.pesoPct)}</td>
                <td>
                  <span className="badge">{ROTULO_MARCACAO[p.marcacao ?? "sem-preco"]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.75rem" }}>
        Posições “sem preço” aparecem até a Action de preços publicar a cotação oficial do ativo.
      </p>
    </div>
  );
}

function sinalClasse(v: number | null): string {
  if (v == null) return "";
  return v >= 0 ? "pos" : "neg";
}
