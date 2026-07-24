import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { fmtBRL, fmtPct } from "../engine/report";
import type { AlocacaoItem, PortfolioSnapshot } from "../engine/types";

// Paleta categórica da marca ESALQ Finance (marinho + vermelho na frente).
const CORES = ["#17416b", "#9b1313", "#c99a2e", "#2f8f83", "#4f86c0", "#7a5195", "#8a9b3a", "#b0742f"];

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
