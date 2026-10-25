// Operação de FUTUROS (dólar, índice e commodities da B3). Fica fora do
// Trade.tsx para não inchar o arquivo — o Trade só ganha a aba e delega para cá.
//
// Mesma regra das ações: o preço NÃO é digitado. A lista é a REAL de contratos
// da B3 (vencimento oficial, último negócio, ajuste, ofertas, contratos em
// aberto); preço = último → ajuste → teórico.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FUTUROS,
  MERCADORIAS,
  REFERENCIAS_YAHOO,
  ativoFuturo,
  lerCodigoFuturo,
  margemPosicao,
  metaFuturo,
  precoFuturo,
  proximosVencimentos,
  taxa,
  type CodigoMercadoria,
  type ContratoB3,
  type PrecoDerivativo,
} from "../engine/derivativos";
import { fmtBRL, fmtNum, fmtPct } from "../engine/report";
import type { Ativo, PortfolioSnapshot, Posicao, PrecosSnapshot, TxTrade } from "../engine/types";
import { buscarCotacoes, mesclarPrecos } from "../data/cotacoes";
import { cdiAoVivo, cotarFuturosB3, mesclarDiretos } from "../data/mercadoB3";
import { cotacaoDolarOuSnapshot } from "../data/precoProvider";
import { registrarTransacao, upsertAtivo } from "../data/supabaseClient";
import { fmtDataLonga } from "./grafico";

export interface PropsDerivativos {
  snapshot: PortfolioSnapshot;
  ativos: Ativo[];
  precos: PrecosSnapshot;
  membro: string;
  carteiraId: string;
  onDone: () => void;
}

/** Ordem pré-montada pela mesa de risco (aba Proteção). */
export interface OrdemSugerida {
  codigo: string;
  lado: "compra" | "venda";
  contratos: number;
}

type Msg = { tipo: "ok" | "erro"; texto: string } | null;

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
}

export const ROTULO_ORIGEM: Record<PrecoDerivativo["origem"], string> = {
  b3: "B3 · último",
  ajuste: "ajuste B3",
  teorico: "teórico",
};

/**
 * Busca os insumos que o snapshot da carteira pode não ter (CDI direto do BCB;
 * pela Edge Function: referências do café/soja e juro americano) e devolve os
 * preços mesclados.
 */
export function usePrecosComInsumos(precos: PrecosSnapshot, tickers: string[]): PrecosSnapshot {
  const [extra, setExtra] = useState<Awaited<ReturnType<typeof buscarCotacoes>>>(null);
  const [cdi, setCdi] = useState<number | null>(null);
  const chave = tickers.join(",");
  useEffect(() => {
    let vivo = true;
    void buscarCotacoes(tickers, { taxas: true }).then((c) => {
      if (vivo && c) setExtra(c);
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  useEffect(() => {
    void cdiAoVivo().then(setCdi);
  }, []);
  return useMemo(() => {
    const m = mesclarPrecos(precos, extra);
    return cdi != null ? { ...m, taxas: { ...(m.taxas ?? {}), CDI: cdi } } : m;
  }, [precos, extra, cdi]);
}

/** Contratos reais da B3 de uma mercadoria, recarregados a cada minuto. */
function useContratosB3(mercadoria: CodigoMercadoria): { contratos: ContratoB3[] | null; erro: boolean } {
  const [estado, setEstado] = useState<{ m: CodigoMercadoria; contratos: ContratoB3[] } | null>(null);
  useEffect(() => {
    let vivo = true;
    const buscar = () =>
      void cotarFuturosB3(mercadoria).then((c) => {
        if (vivo) setEstado({ m: mercadoria, contratos: c });
      });
    buscar();
    const id = setInterval(buscar, 60_000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [mercadoria]);
  if (!estado || estado.m !== mercadoria) return { contratos: null, erro: false };
  return { contratos: estado.contratos, erro: estado.contratos.length === 0 };
}

// ---------------------------------------------------------------------------
// Futuros
// ---------------------------------------------------------------------------

export function OperarFuturo(props: PropsDerivativos & { ordemInicial?: OrdemSugerida | null }) {
  const { snapshot, membro, carteiraId, onDone, ordemInicial } = props;
  const hoje = useMemo(() => new Date(), []);
  const hojeYMD = hoje.toISOString().slice(0, 10);
  const inicial = ordemInicial ? lerCodigoFuturo(ordemInicial.codigo) : null;
  const [mercadoria, setMercadoria] = useState<CodigoMercadoria>(inicial?.mercadoria ?? "WDO");
  const [codigo, setCodigo] = useState<string>(inicial?.codigo ?? "");
  const [lado, setLado] = useState<"compra" | "venda">(ordemInicial?.lado ?? "compra");
  const [contratos, setContratos] = useState(ordemInicial ? String(ordemInicial.contratos) : "");
  const [verTodos, setVerTodos] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [ocupado, setOcupado] = useState(false);

  const spec = FUTUROS[mercadoria];
  const comInsumos = usePrecosComInsumos(props.precos, REFERENCIAS_YAHOO);
  const { contratos: listaB3, erro: b3Fora } = useContratosB3(mercadoria);

  // Lista real da B3 (vencidos fora); sem B3, os vencimentos pela regra de calendário.
  const lista: ContratoB3[] = useMemo(() => {
    if (listaB3 && listaB3.length > 0) return listaB3.filter((c) => c.vencimento >= hojeYMD);
    return proximosVencimentos(mercadoria, hoje, 4).map((v) => ({
      codigo: v.codigo,
      mercadoria,
      vencimento: v.vencimento,
      ajuste: null,
      ultimo: null,
      compra: null,
      venda: null,
      contratosAbertos: null,
    }));
  }, [listaB3, mercadoria, hoje, hojeYMD]);

  // O "vencimento cheio" (mais negociado) primeiro; os demais sob "ver todos".
  const ordenada = useMemo(() => {
    const comLiquidez = [...lista].sort((a, b) => (b.contratosAbertos ?? 0) - (a.contratosAbertos ?? 0));
    const principal = comLiquidez[0]?.codigo;
    return { principal, visiveis: verTodos ? lista : lista.slice(0, 5) };
  }, [lista, verTodos]);

  useEffect(() => {
    if (!lista.some((c) => c.codigo === codigo)) setCodigo(ordenada.principal ?? lista[0]?.codigo ?? "");
  }, [lista, codigo, ordenada.principal]);

  const contrato = lista.find((c) => c.codigo === codigo) ?? null;
  // Os dados da B3 entram no snapshot local para o engine precificar igual à carteira.
  const precos = useMemo(
    () =>
      mesclarDiretos(comInsumos, {
        acoes: Object.fromEntries(lista.filter((c) => c.ultimo != null).map((c) => [c.codigo, c.ultimo!])),
        ajustes: Object.fromEntries(
          lista.filter((c) => c.ajuste != null).map((c) => [c.codigo, { ajuste: c.ajuste!, data: hojeYMD }]),
        ),
      }),
    [comInsumos, lista, hojeYMD],
  );

  const cot = contrato ? precoFuturo(contrato.codigo, spec, contrato.vencimento, precos, hoje) : null;
  const fx = spec.moedaCotacao === "BRL" ? 1 : precos.cambio?.USD ?? 0;
  const simbolo = spec.moedaCotacao === "BRL" ? "R$" : "US$";
  const pos = snapshot.posicoes.find((p) => p.ticker === codigo) ?? null;
  const qtdAtual = pos?.qtd ?? 0;

  const n = Number(contratos);
  const nValido = Number.isInteger(n) && n > 0;
  const precoOrdem = cot ? arred(cot.preco, Math.max(spec.casas, 1)) : null;
  const qtdDepois = qtdAtual + (lado === "compra" ? 1 : -1) * (nValido ? n : 0);
  const meta = contrato ? metaFuturo(contrato.codigo, contrato.vencimento) : null;
  const margemAntes = pos?.derivativo?.margemBRL ?? 0;
  const margemDepois = meta && precoOrdem != null ? margemPosicao(meta, qtdDepois, precoOrdem, fx) : 0;
  const caixaLivreDepois = snapshot.caixaLivreBRL - (margemDepois - margemAntes);
  const aumentaRisco = Math.abs(qtdDepois) > Math.abs(qtdAtual);
  const semMargem = nValido && aumentaRisco && caixaLivreDepois < 0;
  const nocional = precoOrdem != null && nValido ? n * precoOrdem * spec.multiplicador * fx : null;
  const valorPonto = spec.multiplicador * (fx || 1);

  async function enviar() {
    setMsg(null);
    if (!contrato || !nValido) {
      setMsg({ tipo: "erro", texto: "Escolha o contrato e um número inteiro de contratos." });
      return;
    }
    if (precoOrdem == null) {
      setMsg({ tipo: "erro", texto: `Sem preço para ${contrato.codigo}: a B3 não informou negócio nem ajuste.` });
      return;
    }
    if (semMargem) {
      setMsg({ tipo: "erro", texto: `Margem insuficiente: faltariam ${fmtBRL(-caixaLivreDepois)} de caixa livre.` });
      return;
    }
    setOcupado(true);
    try {
      await upsertAtivo(ativoFuturo(contrato.codigo, contrato.vencimento)!);
      const fxOrdem = spec.moedaCotacao === "BRL" ? 1 : await cotacaoDolarOuSnapshot(precos);
      const tx: TxTrade = {
        id: uuid(),
        ts: new Date().toISOString(),
        tipo: lado,
        membro,
        ticker: contrato.codigo,
        qtd: n,
        preco: precoOrdem,
        moeda: spec.moedaCotacao,
        fx: fxOrdem,
      };
      await registrarTransacao(tx, carteiraId);
      setMsg({
        tipo: "ok",
        texto: `${lado === "compra" ? "Compra" : "Venda"} de ${n} ${contrato.codigo} a ${simbolo} ${fmtNum(precoOrdem, spec.casas)} registrada.`,
      });
      setContratos("");
      onDone();
    } catch (e) {
      setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <div className="card__cab">
          <h3>Contratos futuros</h3>
          <span className="muted">B3 · 15 min de atraso · sem desembolso, só margem</span>
        </div>

        <div className="campo">
          <label htmlFor="fm">Mercadoria</label>
          <select id="fm" value={mercadoria} onChange={(e) => setMercadoria(e.target.value as CodigoMercadoria)}>
            {MERCADORIAS.map((m) => (
              <option key={m} value={m}>
                {m} — {FUTUROS[m].nome} ({FUTUROS[m].tamanho})
              </option>
            ))}
          </select>
        </div>

        {listaB3 == null ? (
          <p className="muted">Consultando a B3…</p>
        ) : (
          <>
            {b3Fora && (
              <p className="aviso" style={{ marginTop: 0 }}>
                A B3 não respondeu agora. Mostrando vencimentos pela regra do contrato e preço teórico.
              </p>
            )}
            <div className="tabela-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Contrato</th>
                    <th className="right">Vencimento</th>
                    <th className="right">Último</th>
                    <th className="right">Ajuste ant.</th>
                    <th className="right">Compra / Venda</th>
                    <th className="right">Em aberto</th>
                  </tr>
                </thead>
                <tbody>
                  {ordenada.visiveis.map((c) => (
                    <tr
                      key={c.codigo}
                      onClick={() => setCodigo(c.codigo)}
                      style={{ cursor: "pointer", background: c.codigo === codigo ? "var(--superficie-2)" : undefined }}
                      aria-selected={c.codigo === codigo}
                    >
                      <td className="td-principal">
                        <input type="radio" readOnly checked={c.codigo === codigo} style={{ width: "auto", marginRight: 6 }} />
                        {c.codigo}
                        {c.codigo === ordenada.principal && <span className="badge badge--marca" style={{ marginLeft: 6 }}>mais líquido</span>}
                      </td>
                      <td className="right">{fmtDataLonga(c.vencimento)}</td>
                      <td className="right">{c.ultimo == null ? "—" : fmtNum(c.ultimo, spec.casas)}</td>
                      <td className="right">{c.ajuste == null ? "—" : fmtNum(c.ajuste, spec.casas)}</td>
                      <td className="right">
                        {c.compra == null && c.venda == null ? "—" : `${fmtNum(c.compra, spec.casas)} / ${fmtNum(c.venda, spec.casas)}`}
                      </td>
                      <td className="right">{c.contratosAbertos == null ? "—" : fmtNum(c.contratosAbertos, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {lista.length > 5 && (
              <button className="secundario" style={{ marginTop: "0.5rem", padding: "0.2rem 0.7rem", fontSize: "0.8rem" }} onClick={() => setVerTodos((v) => !v)}>
                {verTodos ? "Ver menos" : `Ver todos os ${lista.length} vencimentos`}
              </button>
            )}
          </>
        )}

        <div className="row" style={{ alignItems: "flex-end", marginTop: "1rem" }}>
          <div className="campo" style={{ flex: "0 0 auto" }}>
            <label>Lado</label>
            <div className="segmented">
              <button className={lado === "compra" ? "ativo" : ""} onClick={() => setLado("compra")}>Comprar</button>
              <button className={lado === "venda" ? "ativo" : ""} onClick={() => setLado("venda")}>Vender</button>
            </div>
          </div>
          <div className="campo" style={{ flex: "1 1 120px" }}>
            <label htmlFor="fc">Contratos</label>
            <input id="fc" value={contratos} onChange={(e) => setContratos(e.target.value)} inputMode="numeric" placeholder="1" />
          </div>
          <div className="campo" style={{ flex: "1 1 170px" }}>
            <label>Preço ({spec.unidade})</label>
            <input value={precoOrdem != null ? `${simbolo} ${fmtNum(precoOrdem, spec.casas)}` : "sem preço"} disabled />
          </div>
        </div>

        <div className="aviso" style={{ marginBottom: "0.9rem" }}>
          {cot ? (
            <>
              <span className={`badge ${cot.origem !== "teorico" ? "badge--marca" : ""}`}>{ROTULO_ORIGEM[cot.origem]}</span>{" "}
              {cot.origem === "b3"
                ? "Último negócio na B3."
                : cot.origem === "ajuste"
                  ? `Ajuste do pregão anterior${spec.referencia && precos.ajustes?.[codigo]?.spotRef ? ", movido pela variação do objeto hoje" : ""} (o contrato ainda não negociou hoje).`
                  : spec.referencia === "USD"
                    ? `Custo de carregamento: dólar × CDI (${fmtPct(taxa(precos, "CDI") * 100)}) ÷ juro americano (${fmtPct(taxa(precos, "USD") * 100)}).`
                    : spec.referencia === "^BVSP"
                      ? `Ibovespa × CDI (${fmtPct(taxa(precos, "CDI") * 100)}) até o vencimento.`
                      : `Futuro internacional (${spec.referencia}) convertido para ${spec.unidade}.`}
              <br />
              1 ponto = <strong>{fmtBRL(valorPonto)}</strong> por contrato.{" "}
              {lado === "compra"
                ? `Comprado: ganha se ${spec.nome.toLowerCase()} subir.`
                : `Vendido: ganha se ${spec.nome.toLowerCase()} cair.`}
            </>
          ) : (
            <span className="muted">Sem preço para este contrato agora.</span>
          )}
        </div>

        {nocional != null && (
          <div className="row" style={{ marginBottom: "0.9rem", gap: "1.5rem" }}>
            <Numero rotulo="Nocional" valor={fmtBRL(nocional)} />
            <Numero rotulo="Margem da posição depois" valor={fmtBRL(margemDepois)} />
            <Numero rotulo="Caixa livre depois" valor={fmtBRL(caixaLivreDepois)} classe={caixaLivreDepois < 0 ? "neg" : ""} />
          </div>
        )}

        {pos && (
          <p className="muted" style={{ margin: "0 0 0.9rem" }}>
            Posição em {codigo}: <strong>{fmtNum(Math.abs(qtdAtual), 0)} {qtdAtual > 0 ? "comprado(s)" : "vendido(s)"}</strong>{" "}
            a {simbolo} {fmtNum(pos.derivativo?.precoMedio, spec.casas)} · P&amp;L {fmtBRL(pos.plNaoRealizadoBRL)}{" "}
            <button
              className="secundario"
              style={{ marginLeft: 6, padding: "0.15rem 0.6rem", fontSize: "0.78rem" }}
              onClick={() => {
                setLado(qtdAtual > 0 ? "venda" : "compra");
                setContratos(String(Math.abs(qtdAtual)));
              }}
            >
              zerar
            </button>
          </p>
        )}

        <div className="row">
          <button disabled={ocupado || semMargem || precoOrdem == null} onClick={enviar}>
            {ocupado ? "Registrando…" : lado === "compra" ? "Registrar compra" : "Registrar venda"}
          </button>
          {semMargem && <span className="neg" style={{ fontSize: "0.85rem" }}>Caixa livre insuficiente para a margem.</span>}
        </div>

        {msg && (
          <p className={msg.tipo === "erro" ? "alerta" : "aviso"} style={{ marginBottom: 0, marginTop: "0.9rem" }}>
            {msg.texto}
          </p>
        )}
      </div>

      <PosicoesFuturos {...props} precos={precos} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Posições abertas: zerar e liquidar vencidos
// ---------------------------------------------------------------------------

function PosicoesFuturos(props: PropsDerivativos) {
  const { snapshot, membro, carteiraId, onDone } = props;
  const posicoes = snapshot.posicoes.filter((p) => p.derivativo);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const precosRef = useRef(props.precos);
  precosRef.current = props.precos;
  if (posicoes.length === 0) return null;
  const vencidas = posicoes.filter((p) => p.derivativo?.vencido);

  /**
   * Encerra a posição pelo preço de agora. No vencimento esse preço já é o valor
   * final (a referência do contrato) — é a liquidação financeira.
   */
  async function encerrar(lista: Posicao[]) {
    const nomes = lista.map((p) => p.ticker);
    if (!window.confirm(`Encerrar ${nomes.join(", ")} pelo preço de agora?`)) return;
    setMsg(null);
    setOcupado(lista.length === 1 ? lista[0].ticker : "*");
    try {
      for (const p of lista) {
        const d = p.derivativo!;
        // Sem preço, encerra pelo preço médio (resultado zero) em vez de inventar um.
        const preco = p.precoAtual ?? d.precoMedio;
        const fx = d.meta.moedaCotacao === "BRL" ? 1 : await cotacaoDolarOuSnapshot(precosRef.current);
        await registrarTransacao(
          {
            id: uuid(),
            ts: new Date().toISOString(),
            tipo: p.qtd > 0 ? "venda" : "compra",
            membro,
            ticker: p.ticker,
            qtd: Math.abs(p.qtd),
            preco: arred(preco, 4),
            moeda: d.meta.moedaCotacao,
            fx,
          },
          carteiraId,
        );
      }
      setMsg({ tipo: "ok", texto: `${lista.length} ${lista.length === 1 ? "posição encerrada" : "posições encerradas"}.` });
      onDone();
    } catch (e) {
      setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="card">
      <div className="card__cab">
        <h3>Futuros em aberto</h3>
        {vencidas.length > 0 && (
          <button disabled={ocupado != null} onClick={() => void encerrar(vencidas)}>
            Liquidar {vencidas.length} vencida{vencidas.length === 1 ? "" : "s"}
          </button>
        )}
      </div>
      <div className="tabela-scroll">
        <table>
          <thead>
            <tr>
              <th>Contrato</th>
              <th className="right">Posição</th>
              <th className="right">Preço médio</th>
              <th className="right">Atual</th>
              <th className="right">P&amp;L</th>
              <th className="right">Margem</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {posicoes.map((p) => {
              const d = p.derivativo!;
              const sim = d.meta.moedaCotacao === "BRL" ? "R$" : "US$";
              return (
                <tr key={p.ticker}>
                  <td>
                    <div className="td-principal">
                      {p.ticker}
                      {d.vencido && <span className="badge badge--atencao" style={{ marginLeft: 6 }}>vencido</span>}
                    </div>
                    <div className="td-sub">{p.nome}</div>
                  </td>
                  <td className="right">
                    {fmtNum(Math.abs(p.qtd), 0)} {d.lado === "comprado" ? "C" : "V"}
                  </td>
                  <td className="right">{sim} {fmtNum(d.precoMedio, 2)}</td>
                  <td className="right">{p.precoAtual == null ? "—" : `${sim} ${fmtNum(p.precoAtual, 2)}`}</td>
                  <td className={`right ${(p.plNaoRealizadoBRL ?? 0) >= 0 ? "pos" : "neg"}`}>{fmtBRL(p.plNaoRealizadoBRL)}</td>
                  <td className="right">{fmtBRL(d.margemBRL)}</td>
                  <td className="right">
                    <button
                      className="secundario"
                      disabled={ocupado != null}
                      style={{ padding: "0.15rem 0.6rem", fontSize: "0.78rem" }}
                      onClick={() => void encerrar([p])}
                    >
                      {ocupado === p.ticker ? "…" : d.vencido ? "liquidar" : "zerar"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {msg && (
        <p className={msg.tipo === "erro" ? "alerta" : "aviso"} style={{ marginBottom: 0, marginTop: "0.9rem" }}>
          {msg.texto}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Numero({ rotulo, valor, classe }: { rotulo: string; valor: string; classe?: string }) {
  return (
    <span>
      <span className="topo__rot">{rotulo}</span>
      <div className={`num ${classe ?? ""}`} style={{ fontWeight: 700 }}>{valor}</div>
    </span>
  );
}

function arred(v: number, casas: number): number {
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}
