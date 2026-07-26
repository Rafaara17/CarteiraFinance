import { useEffect, useMemo, useState } from "react";
import { fmtBRL, fmtNum } from "../engine/report";
import { rotuloIndexador, sufixoIndexador, type IndexadorTesouro, type TituloTesouro } from "../engine/tesouro";
import { carregarTitulosTesouro } from "../data/supabaseClient";
import { fmtDataLonga } from "./grafico";

/**
 * Catálogo do Tesouro Direto — a vitrine de títulos, como no site do Tesouro:
 * o que está sendo ofertado, com vencimento, taxa contratada, PU e investimento
 * mínimo. É uma tela de CONSULTA; comprar continua sendo em Operar → Renda fixa.
 *
 * A fonte é a tabela `tesouro_titulos`, escrita só pela Action de preços (service
 * role). O app apenas lê: nenhum número desta tela é digitado por alguém.
 *
 * ATENÇÃO AO SIGNIFICADO DOS PUs — a coluna que importa depende de onde a pessoa
 * está: quem vai COMPRAR olha o PU de compra; quem JÁ TEM o título é marcado a
 * mercado pelo PU de venda (resgate). As duas aparecem, com o papel de cada uma
 * escrito, para ninguém confundir preço de entrada com valor da posição.
 */

/** Famílias na ordem em que o site do Tesouro as apresenta. */
const FAMILIAS: Array<{ id: IndexadorTesouro; rotulo: string; explica: string }> = [
  { id: "SELIC", rotulo: "Selic", explica: "Acompanha a taxa básica de juros. É o de menor oscilação de preço." },
  { id: "PREFIXADO", rotulo: "Prefixado", explica: "Taxa travada na compra. Você sabe hoje quanto recebe no vencimento." },
  { id: "IPCA", rotulo: "IPCA+", explica: "Paga a inflação mais uma taxa fixa: protege o poder de compra." },
  { id: "IGPM", rotulo: "IGP-M+", explica: "Igual ao IPCA+, mas corrigido pelo IGP-M. Só títulos antigos." },
  { id: "RENDA+", rotulo: "Renda+", explica: "Para aposentadoria: acumula e depois paga renda mensal por 20 anos." },
  { id: "EDUCA+", rotulo: "Educa+", explica: "Para os estudos: acumula e depois paga renda mensal por 5 anos." },
  { id: "OUTRO", rotulo: "Outros", explica: "Títulos que não caíram em nenhuma das famílias acima." },
];

type Filtro = IndexadorTesouro | "TODOS";

export function Tesouro() {
  const [titulos, setTitulos] = useState<TituloTesouro[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>("TODOS");

  async function carregar() {
    setCarregando(true);
    setErro(null);
    try {
      setTitulos(await carregarTitulosTesouro());
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  // Só as famílias que realmente têm título viram filtro — nada de chip que
  // devolve lista vazia.
  const familiasPresentes = useMemo(() => {
    const presentes = new Set((titulos ?? []).map((t) => t.indexador));
    return FAMILIAS.filter((f) => presentes.has(f.id));
  }, [titulos]);

  const visiveis = useMemo(
    () => (titulos ?? []).filter((t) => filtro === "TODOS" || t.indexador === filtro),
    [titulos, filtro],
  );

  if (carregando && titulos == null) {
    return (
      <div className="card">
        <div className="vazio">Carregando o catálogo do Tesouro Direto…</div>
      </div>
    );
  }

  if (erro) {
    return (
      <div className="card">
        <div className="alerta" style={{ marginBottom: "0.9rem" }}>
          Não foi possível carregar o catálogo: {erro}
        </div>
        <button className="secundario" onClick={() => void carregar()}>Tentar de novo</button>
      </div>
    );
  }

  if (titulos != null && titulos.length === 0) {
    return (
      <div className="card">
        <div className="vazio">
          <span className="vazio__ico" aria-hidden="true">🏛️</span>
          <strong>Catálogo ainda vazio</strong>
          Os títulos chegam pela rotina de preços, que roda em dias úteis. Se acabou de
          configurar o projeto, verifique se o secret <code>BRAPI_TOKEN</code> está definido na
          GitHub Action “Atualizar preços”.
        </div>
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="secundario" onClick={() => void carregar()}>Atualizar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid">
      <div className="card">
        <div className="card__cab">
          <h3>Tesouro Direto</h3>
          {/* "no catálogo", não "ofertados": a lista não filtra negociabilidade,
              justamente para nenhum título desaparecer da tela sem explicação. */}
          <span className="muted">
            {titulos!.length} {titulos!.length === 1 ? "título" : "títulos"} no catálogo · dados oficiais do Tesouro Nacional
          </span>
          <div className="spacer" />
          <button
            className="secundario no-print"
            onClick={() => void carregar()}
            disabled={carregando}
            style={{ padding: "0.2rem 0.7rem", fontSize: "0.78rem" }}
          >
            {carregando ? "atualizando…" : "atualizar"}
          </button>
        </div>

        <div className="chips no-print" style={{ marginBottom: "0.9rem" }}>
          <button
            className={`chip-toggle ${filtro === "TODOS" ? "ativo" : ""}`}
            onClick={() => setFiltro("TODOS")}
          >
            Todos
          </button>
          {familiasPresentes.map((f) => (
            <button
              key={f.id}
              className={`chip-toggle ${filtro === f.id ? "ativo" : ""}`}
              onClick={() => setFiltro(f.id)}
            >
              {f.rotulo}
            </button>
          ))}
        </div>

        {filtro !== "TODOS" && (
          <p className="aviso" style={{ marginBottom: "0.9rem" }}>
            {FAMILIAS.find((f) => f.id === filtro)?.explica}
          </p>
        )}

        <div className="tabela-scroll">
          <table>
            <thead>
              <tr>
                <th>Título</th>
                <th>Vencimento</th>
                <th className="right">Taxa de compra</th>
                <th className="right">Investimento mínimo</th>
                <th className="right">PU de compra</th>
                <th className="right">PU de venda</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((t) => (
                <Linha key={t.slug} t={t} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

function Linha({ t }: { t: TituloTesouro }) {
  return (
    <tr>
      <td>
        <div className="td-principal">{t.nome}</div>
        <div className="td-sub">{rotuloIndexador(t.indexador)}</div>
      </td>
      <td className="nowrap">
        {fmtDataLonga(t.vencimento)}
        <div className="td-sub">{prazo(t.vencimento)}</div>
      </td>
      <td className="right nowrap">
        {t.taxaCompra == null ? <span className="fraco">—</span> : `${fmtNum(t.taxaCompra, 2)}% a.a.`}
        {/* Num título indexado, a taxa sozinha engana: 0,05% no Selic é o spread
            sobre a Selic, não o rendimento. O sufixo vale para todas as famílias
            indexadas, não só IPCA+. */}
        {t.taxaCompra != null && sufixoIndexador(t.indexador) && (
          <div className="td-sub">{sufixoIndexador(t.indexador)}</div>
        )}
      </td>
      <td className="right">
        {t.investimentoMinimo == null ? <span className="fraco">—</span> : fmtBRL(t.investimentoMinimo)}
      </td>
      <td className="right">{t.puCompra == null ? <span className="fraco">—</span> : fmtBRL(t.puCompra)}</td>
      <td className="right">{t.puVenda == null ? <span className="fraco">—</span> : fmtBRL(t.puVenda)}</td>
    </tr>
  );
}

/** "em 9 anos" / "em 8 meses" — o prazo é a informação que a data esconde. */
function prazo(vencimentoISO: string, hoje: Date = new Date()): string {
  const dias = (new Date(`${vencimentoISO}T12:00:00.000Z`).getTime() - hoje.getTime()) / 86_400_000;
  if (!isFinite(dias) || dias <= 0) return "vencido";
  if (dias < 31) return `em ${Math.round(dias)} dias`;
  const meses = Math.round(dias / 30.44);
  if (meses < 24) return `em ${meses} ${meses === 1 ? "mês" : "meses"}`;
  return `em ${Math.round(dias / 365.25)} anos`;
}
