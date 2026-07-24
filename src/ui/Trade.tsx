import { useMemo, useState } from "react";
import { fmtBRL, fmtNum } from "../engine/report";
import type { Ativo, PortfolioSnapshot, PrecosSnapshot, TxTrade } from "../engine/types";
import { registrarTransacao, upsertAtivo } from "../data/supabaseClient";
import { cotacaoDolar, precoAcaoBR } from "../data/precoProvider";

interface Props {
  snapshot: PortfolioSnapshot;
  ativos: Ativo[];
  precos: PrecosSnapshot;
  membro: string;
  onDone: () => void;
}

type Sub = "acoes" | "vender" | "rendafixa";

export function Trade(props: Props) {
  const [sub, setSub] = useState<Sub>("acoes");
  return (
    <div className="grid">
      <div className="tabs no-print">
        <button className={`tab ${sub === "acoes" ? "ativo" : ""}`} onClick={() => setSub("acoes")}>
          Comprar ação/ETF/FII
        </button>
        <button className={`tab ${sub === "rendafixa" ? "ativo" : ""}`} onClick={() => setSub("rendafixa")}>
          Renda fixa
        </button>
        <button className={`tab ${sub === "vender" ? "ativo" : ""}`} onClick={() => setSub("vender")}>
          Vender
        </button>
      </div>
      <div className="card aviso no-print" style={{ fontSize: "0.85rem" }}>
        Caixa disponível: <strong>{fmtBRL(props.snapshot.caixaBRL)}</strong> · Preços oficiais: B3 ao
        vivo; ativos em USD pelo último snapshot da Action (Yahoo, sem chave); dólar ao vivo. Você não
        digita o preço de ações.
      </div>
      {sub === "acoes" && <ComprarAcao {...props} />}
      {sub === "rendafixa" && <RendaFixa {...props} />}
      {sub === "vender" && <Vender {...props} />}
    </div>
  );
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
}

/** Preço oficial para operar: B3 ao vivo (fallback snapshot); USD sempre do snapshot. */
async function precoOperacao(tk: string, moeda: string, precos: PrecosSnapshot): Promise<number | null> {
  if (moeda === "BRL") {
    try {
      return await precoAcaoBR(tk);
    } catch {
      const s = precos.acoes[tk];
      return typeof s === "number" && s > 0 ? s : null;
    }
  }
  const s = precos.acoes[tk];
  return typeof s === "number" && s > 0 ? s : null;
}

function ComprarAcao({ snapshot, precos, membro, onDone }: Props) {
  const [ticker, setTicker] = useState("");
  const [bolsa, setBolsa] = useState("B3");
  const [classe, setClasse] = useState("acao");
  const [nome, setNome] = useState("");
  const [qtd, setQtd] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const moeda = bolsa === "B3" ? "BRL" : "USD";

  async function comprar() {
    setMsg(null);
    const q = Number(qtd);
    const tk = ticker.trim().toUpperCase();
    if (!tk || !isFinite(q) || q <= 0) {
      setMsg("Informe ticker e quantidade válidos.");
      return;
    }
    setOcupado(true);
    try {
      const ativo: Ativo = { id: tk, tipo: classe as Ativo["tipo"], ticker: tk, bolsa, moeda, nome: nome.trim() || tk };
      const preco = await precoOperacao(tk, moeda, precos);
      if (preco == null) {
        // Sem cotação oficial ainda: registra o ativo para a Action precificar.
        await upsertAtivo(ativo);
        setMsg(
          `Sem cotação oficial de ${tk} ainda. Ativo registrado — rode a Action “Atualizar preços” (ou aguarde o próximo ciclo) e finalize a compra depois.`,
        );
        return;
      }
      const fx = moeda === "BRL" ? 1 : await cotacaoDolar();
      const custoBRL = q * preco * fx;
      if (custoBRL > snapshot.caixaBRL + 1e-6) {
        setMsg(`Caixa insuficiente: custo ${fmtBRL(custoBRL)} > caixa ${fmtBRL(snapshot.caixaBRL)}.`);
        return;
      }
      await upsertAtivo(ativo);
      const tx: TxTrade = { id: uuid(), ts: new Date().toISOString(), tipo: "compra", membro, ticker: tk, qtd: q, preco, moeda, fx };
      await registrarTransacao(tx);
      setMsg(
        `Compra registrada: ${q} ${tk} a ${fmtNum(preco, 2)} ${moeda}${moeda !== "BRL" ? ` (dólar ${fmtNum(fx, 4)})` : ""} = ${fmtBRL(custoBRL)}.`,
      );
      setTicker("");
      setQtd("");
      setNome("");
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="card">
      <h3>Comprar ação / ETF / FII</h3>
      <div className="row">
        <div className="campo" style={{ flex: 1 }}>
          <label>Ticker</label>
          <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="PETR4, AAPL, HGLG11..." />
        </div>
        <div className="campo" style={{ width: 140 }}>
          <label>Bolsa</label>
          <select value={bolsa} onChange={(e) => setBolsa(e.target.value)}>
            <option>B3</option>
            <option>NYSE</option>
            <option>NASDAQ</option>
            <option value="OUTRA">Outra</option>
          </select>
        </div>
        <div className="campo" style={{ width: 120 }}>
          <label>Classe</label>
          <select value={classe} onChange={(e) => setClasse(e.target.value)}>
            <option value="acao">Ação</option>
            <option value="etf">ETF</option>
            <option value="fii">FII</option>
          </select>
        </div>
        <div className="campo" style={{ width: 120 }}>
          <label>Quantidade</label>
          <input value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="decimal" />
        </div>
      </div>
      <div className="campo">
        <label>Nome (opcional)</label>
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Petrobras PN" />
      </div>
      <div className="row">
        <button disabled={ocupado} onClick={comprar}>
          {ocupado ? "Cotando..." : `Cotar e comprar (${moeda})`}
        </button>
        <span className="muted" style={{ fontSize: "0.8rem" }}>
          Ativos em USD são precificados pela Action (Yahoo) — sem chave de API.
        </span>
      </div>
      {msg && <p className="aviso" style={{ marginBottom: 0 }}>{msg}</p>}
    </div>
  );
}

function Vender({ snapshot, precos, membro, onDone }: Props) {
  const posicoes = snapshot.posicoes.filter((p) => p.qtd > 0);
  const [ticker, setTicker] = useState(posicoes[0]?.ticker ?? "");
  const [qtd, setQtd] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const posSel = posicoes.find((p) => p.ticker === ticker);

  async function vender() {
    setMsg(null);
    const q = Number(qtd);
    if (!posSel || !isFinite(q) || q <= 0) {
      setMsg("Selecione um ativo e uma quantidade válida.");
      return;
    }
    if (q > posSel.qtd + 1e-9) {
      setMsg(`Você tem apenas ${fmtNum(posSel.qtd, 4)} unidades.`);
      return;
    }
    setOcupado(true);
    try {
      const ehRF = posSel.classe === "tesouro" || posSel.classe === "bond";
      const moeda = posSel.moeda;
      let preco: number | null;
      let fx = 1;
      if (ehRF) {
        // renda fixa: vende pelo valor marcado atual (PU/linear já no snapshot)
        preco = posSel.precoAtual ?? posSel.custoMedioBRL;
      } else {
        preco = await precoOperacao(ticker, moeda, precos);
        if (preco == null) {
          setMsg(`Sem cotação oficial de ${ticker} para vender. Rode a Action “Atualizar preços” e tente de novo.`);
          setOcupado(false);
          return;
        }
        fx = moeda === "BRL" ? 1 : await cotacaoDolar();
      }
      const tx: TxTrade = { id: uuid(), ts: new Date().toISOString(), tipo: "venda", membro, ticker, qtd: q, preco, moeda, fx };
      await registrarTransacao(tx);
      const receita = q * preco * fx;
      setMsg(`Venda registrada: ${q} ${ticker} a ${fmtNum(preco, 2)} ${moeda} = ${fmtBRL(receita)}.`);
      setQtd("");
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  if (posicoes.length === 0) {
    return <div className="card aviso">Sem posições para vender.</div>;
  }
  return (
    <div className="card">
      <h3>Vender</h3>
      <div className="row">
        <div className="campo" style={{ flex: 1 }}>
          <label>Ativo</label>
          <select value={ticker} onChange={(e) => setTicker(e.target.value)}>
            {posicoes.map((p) => (
              <option key={p.ticker} value={p.ticker}>
                {p.ticker} — {fmtNum(p.qtd, 4)} un. ({p.classe})
              </option>
            ))}
          </select>
        </div>
        <div className="campo" style={{ width: 140 }}>
          <label>Quantidade</label>
          <input value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="decimal" />
        </div>
      </div>
      <div className="row">
        <button disabled={ocupado} onClick={vender}>
          {ocupado ? "Processando..." : "Cotar e vender"}
        </button>
        {posSel?.moeda && posSel.moeda !== "BRL" && (
          <span className="muted" style={{ fontSize: "0.8rem" }}>
            Conversão pelo dólar no momento da venda.
          </span>
        )}
      </div>
      {msg && <p className="aviso" style={{ marginBottom: 0 }}>{msg}</p>}
    </div>
  );
}

function RendaFixa({ snapshot, precos, membro, onDone }: Props) {
  const nomesTesouro = useMemo(() => Object.keys(precos.tesouro ?? {}), [precos]);
  const [isTesouro, setIsTesouro] = useState(true);
  const [ticker, setTicker] = useState("");
  const [nome, setNome] = useState("");
  const [tesouroNome, setTesouroNome] = useState(nomesTesouro[0] ?? "");
  const [indexador, setIndexador] = useState("IPCA");
  const [taxa, setTaxa] = useState("");
  const [dataCompra, setDataCompra] = useState(new Date().toISOString().slice(0, 10));
  const [vencimento, setVencimento] = useState("");
  const [puCompra, setPuCompra] = useState("");
  const [valorVencimento, setValorVencimento] = useState("");
  const [qtd, setQtd] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Para Tesouro com PU oficial no snapshot, usa o PU oficial (não editável).
  const puOficial = isTesouro && tesouroNome ? precos.tesouro?.[tesouroNome] : undefined;
  const puEfetivo = puOficial ?? Number(puCompra);

  async function comprar() {
    setMsg(null);
    const q = Number(qtd);
    const pu = puEfetivo;
    const vv = Number(valorVencimento);
    const tk = (isTesouro ? tesouroNome : ticker.trim().toUpperCase()) || "";
    if (!tk || !isFinite(q) || q <= 0 || !isFinite(pu) || pu <= 0) {
      setMsg("Preencha título, quantidade e PU válidos.");
      return;
    }
    if (!vencimento || !isFinite(vv) || vv <= 0) {
      setMsg("Informe vencimento e valor no vencimento (para a marcação linear).");
      return;
    }
    const custoBRL = q * pu;
    if (custoBRL > snapshot.caixaBRL + 1e-6) {
      setMsg(`Caixa insuficiente: custo ${fmtBRL(custoBRL)} > caixa ${fmtBRL(snapshot.caixaBRL)}.`);
      return;
    }
    setOcupado(true);
    try {
      const ativo: Ativo = {
        id: tk,
        tipo: isTesouro ? "tesouro" : "bond",
        ticker: tk,
        bolsa: isTesouro ? "TESOURO" : "OUTRA",
        moeda: "BRL",
        nome: nome.trim() || tk,
        bond: {
          isTesouro,
          tesouroNome: isTesouro ? tesouroNome : undefined,
          indexador,
          taxaContratada: taxa ? Number(taxa) / 100 : undefined,
          dataCompra,
          vencimento,
          puCompra: pu,
          valorVencimento: vv,
        },
      };
      await upsertAtivo(ativo);
      const tx: TxTrade = { id: uuid(), ts: new Date().toISOString(), tipo: "compra", membro, ticker: tk, qtd: q, preco: pu, moeda: "BRL", fx: 1 };
      await registrarTransacao(tx);
      setMsg(`Compra registrada: ${q} × ${tk} a PU ${fmtNum(pu, 2)} = ${fmtBRL(custoBRL)}.`);
      setQtd("");
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="card">
      <h3>Comprar renda fixa</h3>
      <div className="row">
        <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.75rem" }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={isTesouro}
            onChange={(e) => setIsTesouro(e.target.checked)}
          />
          Tesouro Direto (PU oficial)
        </label>
      </div>

      {isTesouro ? (
        <div className="campo">
          <label>Título do Tesouro</label>
          {nomesTesouro.length > 0 ? (
            <select value={tesouroNome} onChange={(e) => setTesouroNome(e.target.value)}>
              {nomesTesouro.map((n) => (
                <option key={n} value={n}>
                  {n} — PU {fmtNum(precos.tesouro[n], 2)}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input value={tesouroNome} onChange={(e) => setTesouroNome(e.target.value)} placeholder="Tesouro IPCA+ 2035" />
              <p className="muted" style={{ fontSize: "0.78rem" }}>
                Sem PUs oficiais no snapshot ainda — rode a Action de preços. Enquanto isso, informe o PU manualmente abaixo.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="row">
          <div className="campo" style={{ flex: 1 }}>
            <label>Identificador do título</label>
            <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="ex.: CDB-BANCOX-2028" />
          </div>
          <div className="campo" style={{ flex: 1 }}>
            <label>Nome</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: CDB Banco X 120% CDI" />
          </div>
        </div>
      )}

      <div className="row">
        <div className="campo" style={{ width: 140 }}>
          <label>Indexador</label>
          <select value={indexador} onChange={(e) => setIndexador(e.target.value)}>
            <option value="PREFIXADO">Prefixado</option>
            <option value="IPCA">IPCA+</option>
            <option value="SELIC">Selic</option>
            <option value="CDI">CDI</option>
          </select>
        </div>
        <div className="campo" style={{ width: 120 }}>
          <label>Taxa a.a. (%)</label>
          <input value={taxa} onChange={(e) => setTaxa(e.target.value)} inputMode="decimal" placeholder="ex.: 6.2" />
        </div>
        <div className="campo" style={{ width: 160 }}>
          <label>Data da compra</label>
          <input type="date" value={dataCompra} onChange={(e) => setDataCompra(e.target.value)} />
        </div>
        <div className="campo" style={{ width: 160 }}>
          <label>Vencimento</label>
          <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
        </div>
      </div>

      <div className="row">
        <div className="campo" style={{ width: 160 }}>
          <label>PU de compra {puOficial != null ? "(oficial)" : ""}</label>
          <input
            value={puOficial != null ? String(puOficial) : puCompra}
            onChange={(e) => setPuCompra(e.target.value)}
            disabled={puOficial != null}
            inputMode="decimal"
          />
        </div>
        <div className="campo" style={{ width: 180 }}>
          <label>Valor no vencimento (PU)</label>
          <input value={valorVencimento} onChange={(e) => setValorVencimento(e.target.value)} inputMode="decimal" placeholder="ex.: 1000" />
        </div>
        <div className="campo" style={{ width: 120 }}>
          <label>Quantidade</label>
          <input value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="decimal" />
        </div>
      </div>

      <div className="row">
        <button disabled={ocupado} onClick={comprar}>
          {ocupado ? "Processando..." : "Comprar título"}
        </button>
        <span className="muted" style={{ fontSize: "0.8rem" }}>
          Sem MtM oficial, o valor cresce linearmente do PU de compra até o valor de vencimento.
        </span>
      </div>
      {msg && <p className="aviso" style={{ marginBottom: 0 }}>{msg}</p>}
    </div>
  );
}
