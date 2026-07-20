import { fmtBRL, fmtNum, fmtPct } from "../engine/report";
import type { PortfolioSnapshot } from "../engine/types";
import type { UltimaAtualizacao } from "../data/githubClient";

interface Props {
  snapshot: PortfolioSnapshot;
  ultimaAtualizacao: UltimaAtualizacao | null;
  precoAtualizadoEm: string | null;
}

export function Overview({ snapshot, ultimaAtualizacao, precoAtualizadoEm }: Props) {
  return (
    <div className="grid">
      <div className="kpis">
        <Kpi rotulo="Patrimônio" valor={fmtBRL(snapshot.patrimonioBRL)} />
        <Kpi
          rotulo="Retorno total"
          valor={fmtPct(snapshot.retornoTotalPct)}
          classe={snapshot.retornoTotalPct >= 0 ? "pos" : "neg"}
        />
        <Kpi rotulo="Caixa" valor={fmtBRL(snapshot.caixaBRL)} />
        <Kpi rotulo="Investido" valor={fmtBRL(snapshot.valorInvestidoBRL)} />
        <Kpi
          rotulo="P&L realizado"
          valor={fmtBRL(snapshot.plRealizadoBRL)}
          classe={snapshot.plRealizadoBRL >= 0 ? "pos" : "neg"}
        />
        <Kpi
          rotulo="Dólar usado"
          valor={snapshot.cambioUSD == null ? "—" : "R$ " + fmtNum(snapshot.cambioUSD, 4)}
        />
      </div>

      <div className="card">
        <div className="row">
          <div>
            <div className="rotulo muted" style={{ fontSize: "0.8rem" }}>
              CAPITAL INICIAL (FIXO)
            </div>
            <strong>{fmtBRL(snapshot.capitalInicial)}</strong>
          </div>
          <div className="spacer" />
          <div className="right">
            <div className="muted" style={{ fontSize: "0.82rem" }}>
              Preços atualizados em:{" "}
              {precoAtualizadoEm ? new Date(precoAtualizadoEm).toLocaleString("pt-BR") : "— (rode a Action de preços)"}
            </div>
            {ultimaAtualizacao && (
              <div className="muted" style={{ fontSize: "0.82rem" }}>
                Última alteração: {new Date(ultimaAtualizacao.data).toLocaleString("pt-BR")} — {ultimaAtualizacao.autor}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ rotulo, valor, classe }: { rotulo: string; valor: string; classe?: string }) {
  return (
    <div className="card kpi">
      <div className={`valor ${classe ?? ""}`}>{valor}</div>
      <div className="rotulo">{rotulo}</div>
    </div>
  );
}
