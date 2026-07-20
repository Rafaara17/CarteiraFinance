import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { fmtBRL, fmtPct } from "../engine/report";
import type { AlocacaoItem, PortfolioSnapshot } from "../engine/types";

const CORES = ["#1f3a5f", "#2f7d6e", "#c08a2d", "#7a5195", "#ef5675", "#3b8ea5", "#8fbf5f", "#bc5090"];

export function Allocation({ snapshot }: { snapshot: PortfolioSnapshot }) {
  if (snapshot.valorInvestidoBRL <= 0) {
    return <div className="card aviso">Sem valor investido com preço para gerar os gráficos de alocação.</div>;
  }
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
      <Grafico titulo="Por classe" itens={snapshot.alocacaoPorClasse} />
      <Grafico titulo="Por bolsa" itens={snapshot.alocacaoPorBolsa} />
      <Grafico titulo="Por moeda" itens={snapshot.alocacaoPorMoeda} />
    </div>
  );
}

function Grafico({ titulo, itens }: { titulo: string; itens: AlocacaoItem[] }) {
  return (
    <div className="card">
      <h3>{titulo}</h3>
      <div style={{ width: "100%", height: 240 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={itens} dataKey="valorBRL" nameKey="chave" outerRadius={80} label={(e: { chave?: string }) => e.chave ?? ""}>
              {itens.map((_, i) => (
                <Cell key={i} fill={CORES[i % CORES.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => fmtBRL(Number(v))} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <table>
        <tbody>
          {itens.map((it) => (
            <tr key={it.chave}>
              <td>{it.chave}</td>
              <td className="right">{fmtBRL(it.valorBRL)}</td>
              <td className="right muted">{fmtPct(it.pesoPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
