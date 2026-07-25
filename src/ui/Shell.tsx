import type { ReactNode } from "react";
import { fmtBRL, fmtPct } from "../engine/report";
import type { PortfolioSnapshot } from "../engine/types";
import { Marca } from "./Marca";
import { sinal } from "./grafico";

export interface ItemNav {
  id: string;
  rotulo: string;
  /** rótulo curto para a barra inferior no celular. */
  curto?: string;
  ico: string;
}

interface Props {
  itens: ItemNav[];
  ativo: string;
  onNavegar: (id: string) => void;
  nomeLiga: string;
  membro: string;
  papel: string;
  snapshot: PortfolioSnapshot | null;
  atualizando: boolean;
  onAtualizar: () => void;
  onSair: () => void;
  children: ReactNode;
}

/**
 * Casca do app: navegação lateral fixa (barra inferior no celular) e um topo
 * pegajoso que mantém patrimônio e variação do dia sempre à vista — os dois
 * números que a pessoa abre o app para ver.
 */
export function Shell(props: Props) {
  const { itens, ativo, onNavegar, snapshot } = props;

  return (
    <div className="app">
      <aside className="lateral no-print">
        <div className="lateral__marca">
          <Marca />
        </div>

        <nav className="lateral__nav">
          {itens.map((i) => (
            <button
              key={i.id}
              className={`lateral__item ${ativo === i.id ? "ativo" : ""}`}
              onClick={() => onNavegar(i.id)}
              aria-current={ativo === i.id ? "page" : undefined}
            >
              <span className="ico" aria-hidden="true">{i.ico}</span>
              {i.rotulo}
            </button>
          ))}
        </nav>

        <div className="lateral__usuario">
          <div>
            <div className="lateral__nome">{props.membro}</div>
            <span className="badge badge--marca" style={{ marginTop: 4 }}>{props.papel}</span>
          </div>
          <button className="secundario" onClick={props.onSair} style={{ width: "100%" }}>
            Sair
          </button>
        </div>
      </aside>

      <div className="principal">
        <header className="topo no-print">
          <div>
            <div className="topo__rot">{props.nomeLiga}</div>
            <div className="topo__titulo">
              {itens.find((i) => i.id === ativo)?.rotulo ?? ""}
            </div>
          </div>

          <div className="spacer" />

          {snapshot && (
            <div className="topo__patrimonio">
              <span className="topo__rot">Patrimônio</span>
              <span className="valor">{fmtBRL(snapshot.patrimonioBRL)}</span>
              {snapshot.variacaoDiaPct != null && (
                <span className={`num ${sinal(snapshot.variacaoDiaPct)}`} style={{ fontSize: "0.86rem", fontWeight: 600 }}>
                  {seta(snapshot.variacaoDiaPct)} {fmtPct(snapshot.variacaoDiaPct)} hoje
                </span>
              )}
            </div>
          )}

          <button className="secundario" onClick={props.onAtualizar} disabled={props.atualizando}>
            {props.atualizando ? "Atualizando…" : "Atualizar"}
          </button>
        </header>

        <main className="conteudo">{props.children}</main>
      </div>

      <nav className="mobile-nav no-print">
        {itens.map((i) => (
          <button
            key={i.id}
            className={ativo === i.id ? "ativo" : ""}
            onClick={() => onNavegar(i.id)}
            aria-current={ativo === i.id ? "page" : undefined}
          >
            <span className="ico" aria-hidden="true">{i.ico}</span>
            {i.curto ?? i.rotulo}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Seta como reforço do sinal — a cor nunca carrega a informação sozinha. */
function seta(v: number): string {
  return v >= 0 ? "▲" : "▼";
}
