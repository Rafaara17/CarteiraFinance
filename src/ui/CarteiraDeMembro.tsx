import { fmtBRL, fmtPct } from "../engine/report";
import type { PortfolioSnapshot } from "../engine/types";
import { BarraAlocacao } from "./Allocation";
import { sinal, usarPaleta, useTemaEscuro } from "./grafico";
import { Positions } from "./Positions";

const ROTULO_CLASSE: Record<string, string> = {
  acao: "Ações",
  etf: "ETFs",
  fii: "FIIs",
  tesouro: "Tesouro Direto",
  bond: "Renda fixa",
};

interface Props {
  nome: string;
  ehLiga: boolean;
  ehMinha: boolean;
  snapshot: PortfolioSnapshot;
  /** retorno da carteira no período escolhido no ranking. */
  retornoPeriodoPct: number;
  /** "do dia" | "da semana" | "do mês". */
  rotuloPeriodo: string;
  onFechar: () => void;
}

/**
 * A carteira de outro membro, aberta a partir do ranking: onde ele está
 * posicionado, quanto deixou em caixa e como isso se distribui.
 *
 * O snapshot já vem calculado do ranking (`computarRanking` guarda o resultado
 * de `computarPortfolio` de cada carteira), então abrir não custa nada.
 */
export function CarteiraDeMembro(props: Props) {
  const { nome, ehLiga, ehMinha, snapshot, retornoPeriodoPct, rotuloPeriodo, onFechar } = props;
  const paleta = usarPaleta(useTemaEscuro());
  const caixaPct =
    snapshot.patrimonioBRL > 0 ? (snapshot.caixaBRL / snapshot.patrimonioBRL) * 100 : 0;

  return (
    <div className="grid" style={{ gap: "1.15rem" }}>
      <div className="card">
        <div className="card__cab">
          <h3>
            {ehMinha ? "Sua carteira" : `Carteira de ${nome}`}
            {ehLiga && <span className="badge" style={{ marginLeft: 8 }}>Liga</span>}
          </h3>
          <div className="spacer" />
          <button
            className="secundario no-print"
            onClick={onFechar}
            style={{ padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}
          >
            Fechar
          </button>
        </div>

        <div className="kpis">
          <Kpi rotulo="Patrimônio" valor={fmtBRL(snapshot.patrimonioBRL)} />
          <Kpi
            rotulo="Caixa"
            valor={fmtBRL(snapshot.caixaBRL)}
            extra={`${caixaPct.toFixed(1)}% do patrimônio`}
          />
          <Kpi
            rotulo="Investido"
            valor={fmtBRL(snapshot.valorInvestidoBRL)}
            extra={`${snapshot.posicoes.length} ${snapshot.posicoes.length === 1 ? "posição" : "posições"}`}
          />
          <Kpi
            rotulo={`Retorno ${rotuloPeriodo}`}
            valor={fmtPct(retornoPeriodoPct)}
            classe={sinal(retornoPeriodoPct)}
          />
          <Kpi
            rotulo="Retorno acumulado"
            valor={fmtPct(snapshot.retornoTotalPct)}
            classe={sinal(snapshot.retornoTotalPct)}
            extra="desde o capital inicial"
          />
        </div>

        {snapshot.valorInvestidoBRL > 0 && (
          <div style={{ marginTop: "1.1rem" }}>
            <div className="controles__rotulo" style={{ marginBottom: "0.55rem" }}>
              Alocação por classe
            </div>
            <BarraAlocacao
              itens={snapshot.alocacaoPorClasse}
              paleta={paleta}
              rotular={(c) => ROTULO_CLASSE[c] ?? c}
            />
          </div>
        )}
      </div>

      {snapshot.posicoes.length === 0 ? (
        <div className="card">
          <div className="vazio">
            <span className="vazio__ico" aria-hidden="true">💵</span>
            <strong>100% em caixa</strong>
            Nenhuma posição aberta — {fmtBRL(snapshot.caixaBRL)} esperando destino.
          </div>
        </div>
      ) : (
        <Positions snapshot={snapshot} />
      )}
    </div>
  );
}

function Kpi({ rotulo, valor, classe, extra }: { rotulo: string; valor: string; classe?: string; extra?: string }) {
  return (
    <div className="kpi">
      <div className="rotulo">{rotulo}</div>
      <div className={`valor ${classe ?? ""}`}>{valor}</div>
      {extra && <div className="extra">{extra}</div>}
    </div>
  );
}
