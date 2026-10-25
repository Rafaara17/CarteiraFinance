// Operar CRIPTO à vista (Bitcoin, Ethereum...). Preço em reais, ao vivo, pela
// AwesomeAPI (CORS liberado — funciona sem a Edge Function). Mercado 24/7, então
// não há "fechado": a cotação é a do momento da ordem.

import { useEffect, useState } from "react";
import { fmtBRL, fmtNum, fmtPct } from "../engine/report";
import type { TxTrade } from "../engine/types";
import { CRIPTOS, cotarCripto, type CotacaoCripto } from "../data/mercadoB3";
import { registrarTransacao, upsertAtivo } from "../data/supabaseClient";
import { Numero, type PropsDerivativos } from "./Derivativos";
import { sinal } from "./grafico";

/** Cripto é fracionado: 8 casas, como o satoshi. */
const CASAS = 8;

export function OperarCripto({ snapshot, membro, carteiraId, onDone }: PropsDerivativos) {
  const [simbolo, setSimbolo] = useState("BTC");
  const [lado, setLado] = useState<"compra" | "venda">("compra");
  const [modo, setModo] = useState<"reais" | "unidades">("reais");
  const [valor, setValor] = useState("");
  const [cotacoes, setCotacoes] = useState<Record<string, CotacaoCripto>>({});
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Painel de todas as moedas, atualizado a cada 30 s.
  useEffect(() => {
    let vivo = true;
    const buscar = () =>
      void cotarCripto(CRIPTOS.map((c) => c.simbolo)).then((c) => {
        if (vivo && Object.keys(c).length > 0) setCotacoes(c);
      });
    buscar();
    const id = setInterval(buscar, 30_000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, []);

  const cot = cotacoes[simbolo] ?? null;
  const nome = CRIPTOS.find((c) => c.simbolo === simbolo)?.nome ?? simbolo;
  const pos = snapshot.posicoes.find((p) => p.ticker === simbolo && p.classe === "cripto") ?? null;
  const v = Number(valor.replace(",", "."));
  const qtd = cot && isFinite(v) && v > 0 ? (modo === "reais" ? arred(v / cot.preco, CASAS) : arred(v, CASAS)) : 0;
  const total = cot ? qtd * cot.preco : 0;
  const semCaixa = lado === "compra" && total > snapshot.caixaLivreBRL + 1e-6;
  const semSaldo = lado === "venda" && qtd > (pos?.qtd ?? 0) + 1e-12;

  async function enviar() {
    setMsg(null);
    if (!cot) {
      setMsg({ tipo: "erro", texto: "Sem cotação agora — tente em instantes." });
      return;
    }
    if (!(qtd > 0)) {
      setMsg({ tipo: "erro", texto: "Informe um valor maior que zero." });
      return;
    }
    if (semCaixa || semSaldo) return;
    setOcupado(true);
    try {
      // Recota no clique: cripto anda rápido, a ordem sai pelo preço deste instante.
      const agora = (await cotarCripto([simbolo]))[simbolo] ?? cot;
      await upsertAtivo({ id: simbolo, tipo: "cripto", ticker: simbolo, bolsa: "CRIPTO", moeda: "BRL", nome });
      const tx: TxTrade = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        ts: new Date().toISOString(),
        tipo: lado,
        membro,
        ticker: simbolo,
        qtd,
        preco: agora.preco,
        moeda: "BRL",
        fx: 1,
      };
      await registrarTransacao(tx, carteiraId);
      setMsg({
        tipo: "ok",
        texto: `${lado === "compra" ? "Compra" : "Venda"} de ${fmtNum(qtd, CASAS)} ${simbolo} a ${fmtBRL(agora.preco)} = ${fmtBRL(qtd * agora.preco)}.`,
      });
      setValor("");
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
          <h3>Criptoativos</h3>
          <span className="muted">à vista, em reais · mercado 24/7 · fonte AwesomeAPI</span>
        </div>
        <div className="tabela-scroll">
          <table>
            <thead>
              <tr>
                <th>Ativo</th>
                <th className="right">Preço (R$)</th>
                <th className="right">24 h</th>
                <th className="right">Na carteira</th>
              </tr>
            </thead>
            <tbody>
              {CRIPTOS.map((c) => {
                const q = cotacoes[c.simbolo];
                const p = snapshot.posicoes.find((x) => x.ticker === c.simbolo && x.classe === "cripto");
                return (
                  <tr
                    key={c.simbolo}
                    onClick={() => setSimbolo(c.simbolo)}
                    style={{ cursor: "pointer", background: c.simbolo === simbolo ? "var(--superficie-2)" : undefined }}
                  >
                    <td className="td-principal">
                      <input type="radio" readOnly checked={c.simbolo === simbolo} style={{ width: "auto", marginRight: 6 }} />
                      {c.simbolo} <span className="td-sub" style={{ marginLeft: 4 }}>{c.nome}</span>
                    </td>
                    <td className="right">{q ? fmtBRL(q.preco) : "—"}</td>
                    <td className={`right ${sinal(q?.variacaoPct)}`}>{q?.variacaoPct == null ? "—" : fmtPct(q.variacaoPct)}</td>
                    <td className="right">{p ? `${fmtNum(p.qtd, 6)} · ${fmtBRL(p.valorBRL)}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="row" style={{ alignItems: "flex-end", marginTop: "1rem" }}>
          <div className="campo" style={{ flex: "0 0 auto" }}>
            <label>Lado</label>
            <div className="segmented">
              <button className={lado === "compra" ? "ativo" : ""} onClick={() => setLado("compra")}>Comprar</button>
              <button className={lado === "venda" ? "ativo" : ""} onClick={() => setLado("venda")}>Vender</button>
            </div>
          </div>
          <div className="campo" style={{ flex: "0 0 auto" }}>
            <label>Informar em</label>
            <div className="segmented">
              <button className={modo === "reais" ? "ativo" : ""} onClick={() => setModo("reais")}>R$</button>
              <button className={modo === "unidades" ? "ativo" : ""} onClick={() => setModo("unidades")}>{simbolo}</button>
            </div>
          </div>
          <div className="campo" style={{ flex: "1 1 150px" }}>
            <label htmlFor="cv">{modo === "reais" ? "Valor (R$)" : `Quantidade (${simbolo})`}</label>
            <input id="cv" value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder={modo === "reais" ? "10000" : "0,01"} />
          </div>
          {pos && lado === "venda" && (
            <button
              className="secundario"
              onClick={() => {
                setModo("unidades");
                setValor(String(pos.qtd));
              }}
            >
              Vender tudo
            </button>
          )}
        </div>

        {qtd > 0 && cot && (
          <div className="row" style={{ marginBottom: "0.9rem", gap: "1.5rem" }}>
            <Numero rotulo="Quantidade" valor={`${fmtNum(qtd, CASAS)} ${simbolo}`} />
            <Numero rotulo="Preço agora" valor={fmtBRL(cot.preco)} />
            <Numero rotulo={lado === "compra" ? "Total a pagar" : "Total a receber"} valor={fmtBRL(total)} />
            {lado === "compra" && (
              <Numero rotulo="Caixa livre depois" valor={fmtBRL(snapshot.caixaLivreBRL - total)} classe={semCaixa ? "neg" : ""} />
            )}
          </div>
        )}

        <div className="row">
          <button disabled={ocupado || !cot || semCaixa || semSaldo || !(qtd > 0)} onClick={enviar}>
            {ocupado ? "Registrando…" : lado === "compra" ? `Comprar ${simbolo}` : `Vender ${simbolo}`}
          </button>
          {semCaixa && <span className="neg" style={{ fontSize: "0.85rem" }}>Caixa livre insuficiente.</span>}
          {semSaldo && <span className="neg" style={{ fontSize: "0.85rem" }}>Você tem {fmtNum(pos?.qtd ?? 0, CASAS)} {simbolo}.</span>}
        </div>

        {msg && (
          <p className={msg.tipo === "erro" ? "alerta" : "aviso"} style={{ marginBottom: 0, marginTop: "0.9rem" }}>
            {msg.texto}
          </p>
        )}
      </div>
    </div>
  );
}

function arred(v: number, casas: number): number {
  const f = 10 ** casas;
  return Math.floor(v * f) / f;
}
