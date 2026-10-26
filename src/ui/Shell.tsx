import { useEffect, useState, type ReactNode } from "react";
import { fmtBRL, fmtPct } from "../engine/report";
import type { PortfolioSnapshot } from "../engine/types";
import { Marca } from "./Marca";
import { SeletorCarteira, type EscopoCarteira } from "./SeletorCarteira";
import { sinal } from "./grafico";

export interface ItemNav {
  id: string;
  rotulo: string;
  /** título da página quando difere do rótulo da navegação. */
  titulo?: string;
  /** rótulo curto para a barra inferior no celular. */
  curto?: string;
  ico: string;
}

interface Props {
  /** navegação da área MINHA CARTEIRA (escopo pessoal). */
  itensIndividual: ItemNav[];
  /** navegação da área LIGA. */
  itensLiga: ItemNav[];
  ativo: string;
  onNavegar: (id: string) => void;
  escopo: EscopoCarteira;
  onTrocarEscopo: (e: EscopoCarteira) => void;
  /** false enquanto o membro não criou a carteira pessoal. */
  carteiraAtivada: boolean;
  membro: string;
  papel: string;
  /** snapshot da carteira ATIVA (não necessariamente o da liga). */
  snapshot: PortfolioSnapshot | null;
  onSair: () => void;
  children: ReactNode;
}

/** Quantos itens cabem na barra inferior antes do "Mais". */
const NO_CELULAR = 4;

/**
 * Casca do app: lateral com as duas áreas (MINHA CARTEIRA e LIGA), topo que
 * mantém patrimônio e variação do dia sempre à vista e, no celular, barra
 * inferior com controle segmentado de área no topo.
 *
 * Tudo aqui é relativo à carteira ATIVA. Como liga e carteira individual usam
 * as mesmas telas, a área ativa aparece expandida na lateral, o `data-escopo`
 * pinta a faixa do topo, o eyebrow e o seletor, e a identidade (logo da liga ×
 * avatar do membro) acompanha o rótulo: nenhuma tela pode ser lida sem que se
 * saiba de qual carteira ela fala.
 */
export function Shell(props: Props) {
  const { ativo, onNavegar, snapshot, escopo, membro } = props;
  const [maisAberto, setMaisAberto] = useState(false);

  const pessoal = escopo === "pessoal";
  const itens = pessoal ? props.itensIndividual : props.itensLiga;
  const atual = itens.find((i) => i.id === ativo);
  const inicial = membro.trim().charAt(0).toUpperCase() || "?";
  const rotuloCarteira = pessoal ? `Carteira de ${membro}` : "Carteira da liga";

  // Trocar de tela fecha o menu "Mais" do celular.
  useEffect(() => setMaisAberto(false), [ativo, escopo]);

  function irParaLiga(id: string) {
    props.onTrocarEscopo("liga");
    onNavegar(id);
  }

  const avatar = (cls = "") => (
    <span className={`avatar ${cls}`} aria-hidden="true">{inicial}</span>
  );

  const listaItens = (lista: ItemNav[]) =>
    lista.map((i) => (
      <button
        key={i.id}
        className={`lateral__item ${ativo === i.id ? "ativo" : ""}`}
        onClick={() => onNavegar(i.id)}
        aria-current={ativo === i.id ? "page" : undefined}
      >
        <span className="ico" aria-hidden="true">{i.ico}</span>
        {i.rotulo}
      </button>
    ));

  const noCelular = itens.slice(0, NO_CELULAR);
  const noMais = itens.slice(NO_CELULAR);
  const maisAtivo = noMais.some((i) => i.id === ativo);

  return (
    <div className="app" data-escopo={escopo}>
      <aside className="lateral no-print">
        <div className="lateral__marca">
          <Marca variante="branca" />
        </div>

        <nav className="lateral__nav" aria-label="Minha carteira">
          <div className="lateral__secao">Minha carteira</div>
          {pessoal ? (
            listaItens(props.itensIndividual)
          ) : (
            <button className="lateral__area" onClick={() => props.onTrocarEscopo("pessoal")}>
              {avatar()}
              {props.carteiraAtivada ? `Carteira de ${membro}` : "Ativar minha carteira"}
              <span className="seta" aria-hidden="true">›</span>
            </button>
          )}
        </nav>

        <nav className="lateral__nav" aria-label="Liga">
          <div className="lateral__secao">Liga</div>
          {pessoal ? (
            <>
              <button className="lateral__area" onClick={() => props.onTrocarEscopo("liga")}>
                <span className="marca-mini" aria-hidden="true">EF</span>
                Carteira da liga
                <span className="seta" aria-hidden="true">›</span>
              </button>
              <button className="lateral__item" onClick={() => irParaLiga("comparar")}>
                <span className="ico" aria-hidden="true">⚖</span>
                Ranking
              </button>
            </>
          ) : (
            listaItens(props.itensLiga)
          )}
        </nav>

        <div className="lateral__usuario">
          <div className="lateral__perfil">
            {avatar()}
            <div>
              <div className="lateral__nome">{membro}</div>
              <div className="lateral__papel">{props.papel}</div>
            </div>
          </div>
          <button className="secundario lateral__sair" onClick={props.onSair}>
            Sair
          </button>
        </div>
      </aside>

      <div className="principal">
        <header className="topo no-print">
          {/* No celular a lateral some: logo, avatar e a troca de área moram aqui. */}
          <div className="topo__celular">
            <Marca className="topo__logo" />
            <span className="spacer" />
            <span className="avatar" aria-label={membro}>{inicial}</span>
          </div>
          <div className="seletor-mobile">
            <SeletorCarteira escopo={escopo} onTrocar={props.onTrocarEscopo} ativada={props.carteiraAtivada} />
          </div>

          <div className="topo__carteira">
            {pessoal ? avatar("avatar--sm") : <Marca className="topo__logo-mini" />}
            {rotuloCarteira}
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
        </header>

        <main className="conteudo">
          {atual && (
            <div className="cab no-print">
              <p className="eyebrow">
                {pessoal ? avatar("avatar--sm") : null}
                {rotuloCarteira}
              </p>
              <h1 className="titulo-pagina">{atual.titulo ?? atual.rotulo}</h1>
            </div>
          )}
          {props.children}
        </main>
      </div>

      {maisAberto && (
        <div className="mais-menu no-print" role="menu" aria-label="Mais">
          {noMais.map((i) => (
            <button
              key={i.id}
              role="menuitem"
              className={ativo === i.id ? "ativo" : ""}
              onClick={() => onNavegar(i.id)}
            >
              <span className="ico" aria-hidden="true">{i.ico}</span>
              {i.titulo ?? i.rotulo}
            </button>
          ))}
          {pessoal && (
            <button role="menuitem" onClick={() => irParaLiga("comparar")}>
              <span className="ico" aria-hidden="true">⚖</span>
              Ranking da liga
            </button>
          )}
          <button role="menuitem" onClick={props.onSair}>
            <span className="ico" aria-hidden="true">⏻</span>
            Sair
          </button>
        </div>
      )}

      <nav className="mobile-nav no-print" aria-label={pessoal ? "Minha carteira" : "Liga"}>
        {noCelular.map((i) => (
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
        <button
          className={maisAtivo || maisAberto ? "ativo" : ""}
          onClick={() => setMaisAberto((v) => !v)}
          aria-expanded={maisAberto}
        >
          <span className="ico" aria-hidden="true">⋯</span>
          Mais
        </button>
      </nav>
    </div>
  );
}

/** Seta como reforço do sinal — a cor nunca carrega a informação sozinha. */
function seta(v: number): string {
  return v >= 0 ? "▲" : "▼";
}
