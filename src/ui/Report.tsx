import { useState } from "react";
import { fmtBRL, fmtPct, renderReportHtml } from "../engine/report";
import type { Config, PortfolioSnapshot } from "../engine/types";
import { salvarRelatorio } from "../data/supabaseClient";
import { Positions } from "./Positions";

interface Props {
  config: Config;
  snapshot: PortfolioSnapshot;
  precoAtualizadoEm: string | null;
  membro: string;
}

export function Report({ config, snapshot, precoAtualizadoEm, membro }: Props) {
  const [status, setStatus] = useState<string | null>(null);

  const html = () => renderReportHtml(config, snapshot, precoAtualizadoEm);

  const baixar = () => {
    const blob = new Blob([html()], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const commitarSnapshot = async () => {
    setStatus("Salvando snapshot na nuvem...");
    try {
      await salvarRelatorio(html(), membro);
      setStatus("Snapshot salvo na nuvem (tabela reports).");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="grid">
      <div className="card no-print">
        <div className="row">
          <h3 style={{ margin: 0 }}>Relatório da carteira</h3>
          <div className="spacer" />
          <button className="secundario" onClick={() => window.print()}>
            Imprimir / PDF
          </button>
          <button className="secundario" onClick={baixar}>
            Baixar HTML
          </button>
          <button onClick={commitarSnapshot}>Salvar snapshot na nuvem</button>
        </div>
        {status && (
          <p className="muted" style={{ marginBottom: 0 }}>
            {status}
          </p>
        )}
      </div>

      <div className="card">
        <h2>{config.nomeLiga}</h2>
        <p className="muted">Capital inicial {fmtBRL(config.capitalInicial)} (fixo)</p>
        <div className="row">
          <span>
            Patrimônio: <strong>{fmtBRL(snapshot.patrimonioBRL)}</strong>
          </span>
          <span>
            Retorno:{" "}
            <strong className={snapshot.retornoTotalPct >= 0 ? "pos" : "neg"}>
              {fmtPct(snapshot.retornoTotalPct)}
            </strong>
          </span>
          <span>
            Caixa: <strong>{fmtBRL(snapshot.caixaBRL)}</strong>
          </span>
        </div>
      </div>

      <Positions snapshot={snapshot} />
    </div>
  );
}
