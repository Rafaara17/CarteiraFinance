import { fmtBRL, fmtNum } from "../engine/report";
import type { Transacao } from "../engine/types";

const ROTULO_TIPO: Record<string, string> = {
  compra: "Compra",
  venda: "Venda",
  provento: "Provento",
  cupom: "Cupom",
};

export function History({ transacoes }: { transacoes: Transacao[] }) {
  if (transacoes.length === 0) {
    return (
      <div className="card">
        <div className="vazio">
          <span className="vazio__ico" aria-hidden="true">🧾</span>
          <strong>Nenhuma operação registrada</strong>
          O histórico é imutável: toda compra, venda e provento fica gravado aqui para sempre.
        </div>
      </div>
    );
  }

  const ordenadas = [...transacoes].sort((a, b) => b.ts.localeCompare(a.ts));

  return (
    <div className="card">
      <div className="card__cab">
        <h3>Histórico de operações</h3>
        <span className="muted">
          {ordenadas.length} registros · append-only (nada é editado ou apagado)
        </span>
      </div>
      <div className="tabela-scroll">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Operação</th>
              <th>Ativo</th>
              <th className="right">Qtd</th>
              <th className="right">Preço / Valor</th>
              <th className="right">Total</th>
              <th>Por</th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((t) => {
              const ehTrade = t.tipo === "compra" || t.tipo === "venda";
              const total = ehTrade
                ? t.qtd * t.preco * (t.fx || 1)
                : (t as { valor: number }).valor * (t.fx || 1);
              return (
                <tr key={t.id}>
                  <td className="nowrap">
                    {new Date(t.ts).toLocaleDateString("pt-BR")}
                    <div className="td-sub">
                      {new Date(t.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${t.tipo === "compra" ? "badge--marca" : ""}`}>
                      {ROTULO_TIPO[t.tipo] ?? t.tipo}
                    </span>
                  </td>
                  <td className="td-principal">{t.ticker}</td>
                  <td className="right">{ehTrade ? fmtNum(t.qtd, t.qtd % 1 === 0 ? 0 : 4) : "—"}</td>
                  <td className="right">
                    {ehTrade ? fmtNum(t.preco, 2) : fmtNum((t as { valor: number }).valor, 2)}
                    <div className="td-sub">
                      {t.moeda}
                      {t.moeda !== "BRL" ? ` · câmbio ${fmtNum(t.fx, 4)}` : ""}
                    </div>
                  </td>
                  <td className="right td-principal">{fmtBRL(total)}</td>
                  <td className="muted">{t.membro}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
