import { fmtNum } from "../engine/report";
import type { Transacao } from "../engine/types";

export function History({ transacoes }: { transacoes: Transacao[] }) {
  if (transacoes.length === 0) {
    return <div className="card aviso">Sem transações registradas ainda.</div>;
  }
  const ordenadas = [...transacoes].sort((a, b) => b.ts.localeCompare(a.ts));
  return (
    <div className="card">
      <div className="tabela-scroll">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Tipo</th>
              <th>Ativo</th>
              <th className="right">Qtd</th>
              <th className="right">Preço/Valor</th>
              <th>Moeda</th>
              <th className="right">Câmbio</th>
              <th>Membro</th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((t) => (
              <tr key={t.id}>
                <td className="nowrap">{new Date(t.ts).toLocaleString("pt-BR")}</td>
                <td>{t.tipo}</td>
                <td>{t.ticker}</td>
                <td className="right">{"qtd" in t ? fmtNum(t.qtd, t.qtd % 1 === 0 ? 0 : 4) : "—"}</td>
                <td className="right">{"preco" in t ? fmtNum(t.preco, 2) : fmtNum((t as { valor: number }).valor, 2)}</td>
                <td>{t.moeda}</td>
                <td className="right">{t.moeda === "BRL" ? "—" : fmtNum(t.fx, 4)}</td>
                <td>{t.membro}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
