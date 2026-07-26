import { useEffect, useRef, useState } from "react";
import { fmtBRL, fmtNum } from "../engine/report";
import { rotuloIndexador, sufixoIndexador, type TituloTesouro } from "../engine/tesouro";
import type { Ativo, ClasseAtivo, PortfolioSnapshot, PrecosSnapshot, TxTrade } from "../engine/types";
import { carregarTitulosTesouro, registrarTransacao, upsertAtivo } from "../data/supabaseClient";
import { classificarAtivo, cotacaoDolarOuSnapshot, precoDeMercado } from "../data/precoProvider";
import type { AtivoClassificado } from "../data/precoProvider";
import { fmtDataLonga, sinal } from "./grafico";

interface Props {
  snapshot: PortfolioSnapshot;
  ativos: Ativo[];
  precos: PrecosSnapshot;
  membro: string;
  carteiraId: string;
  onDone: () => void;
}

type Sub = "acoes" | "vender" | "rendafixa";

const ROTULO_CLASSE: Record<ClasseAtivo, string> = {
  acao: "Ação",
  etf: "ETF",
  fii: "FII",
  tesouro: "Tesouro",
  bond: "Título",
};

export function Trade(props: Props) {
  const [sub, setSub] = useState<Sub>("acoes");
  return (
    <div className="grid">
      <div className="row no-print">
        <div className="segmented">
          <button className={sub === "acoes" ? "ativo" : ""} onClick={() => setSub("acoes")}>Comprar</button>
          <button className={sub === "vender" ? "ativo" : ""} onClick={() => setSub("vender")}>Vender</button>
          <button className={sub === "rendafixa" ? "ativo" : ""} onClick={() => setSub("rendafixa")}>Renda fixa</button>
        </div>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          Caixa disponível: <strong className="num">{fmtBRL(props.snapshot.caixaBRL)}</strong>
        </span>
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

// ---------------------------------------------------------------------------

/** Espera (ms) entre a última tecla e a consulta à bolsa. */
const DEBOUNCE_BUSCA = 450;

function ComprarAcao({ snapshot, membro, precos, carteiraId, onDone }: Props) {
  const [ticker, setTicker] = useState("");
  const [preco, setPreco] = useState("");
  const [qtd, setQtd] = useState("");
  /** Só entra em jogo quando a bolsa NÃO devolve o nome (ticker exótico/gateway fora). */
  const [nomeManual, setNomeManual] = useState("");
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [det, setDet] = useState<AtivoClassificado | null>(null);
  const [detectando, setDetectando] = useState(false);
  /** true enquanto o campo de preço ainda tem o valor de mercado que preenchemos. */
  const [precoAutomatico, setPrecoAutomatico] = useState(true);

  // Lidos DENTRO do efeito de busca. Ficam em ref para não entrarem na lista de
  // dependências: `precos` troca a cada recarga de cotações e dispararia uma
  // consulta nova sem o usuário ter digitado nada.
  const precosRef = useRef(precos);
  const precoAutoRef = useRef(precoAutomatico);
  const precoDigitadoRef = useRef(preco);
  precosRef.current = precos;
  precoAutoRef.current = precoAutomatico;
  precoDigitadoRef.current = preco;

  /**
   * Consulta a bolsa enquanto o usuário digita: nome, tipo, bolsa, moeda e
   * preço saem todos daqui. O cleanup cancela o timer e marca a resposta como
   * obsoleta, então uma consulta lenta de "AAP" nunca sobrescreve "AAPL".
   */
  useEffect(() => {
    const tk = ticker.trim().toUpperCase();
    if (!tk) {
      setDetectando(false);
      return;
    }
    let vivo = true;
    setDetectando(true);
    const timer = setTimeout(async () => {
      try {
        const info = await classificarAtivo(tk, precosRef.current);
        if (!vivo) return;
        setDet(info);
        if (info.precoRef != null && (precoAutoRef.current || !precoDigitadoRef.current)) {
          setPreco(String(info.precoRef));
          setPrecoAutomatico(true);
        }
      } catch {
        if (vivo) setDet(null);
      } finally {
        if (vivo) setDetectando(false);
      }
    }, DEBOUNCE_BUSCA);
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [ticker]);

  /** Razão social vinda da bolsa — é ela que vai para o registro de ativos. */
  const nomeBolsa = det?.nome?.trim() ?? "";
  const moeda = det?.moeda ?? "BRL";
  const simbolo = moeda === "BRL" ? "R$" : "US$";
  const fxEstimado = moeda === "BRL" ? 1 : precos.cambio?.USD ?? 1;

  const q = Number(qtd);
  const p = Number(preco);
  const custoEstimado = isFinite(q) && isFinite(p) && q > 0 && p > 0 ? q * p * fxEstimado : null;
  const caixaRestante = custoEstimado == null ? null : snapshot.caixaBRL - custoEstimado;
  const semCaixa = caixaRestante != null && caixaRestante < 0;

  async function comprar() {
    setMsg(null);
    const digitado = ticker.trim().toUpperCase();
    if (!digitado || !isFinite(q) || q <= 0) {
      setMsg({ tipo: "erro", texto: "Informe ticker e quantidade válidos." });
      return;
    }
    if (!isFinite(p) || p <= 0) {
      setMsg({ tipo: "erro", texto: "Informe o preço por unidade." });
      return;
    }
    setOcupado(true);
    try {
      // Se o usuário submeteu antes do debounce rodar, resolve na hora.
      const info = det ?? (await classificarAtivo(digitado, precos));
      // Vale o ticker que a bolsa confirmou (ver AtivoClassificado.ticker).
      const tk = info.ticker || digitado;
      const fx = info.moeda === "BRL" ? 1 : await cotacaoDolarOuSnapshot(precos);
      const custoBRL = q * p * fx;
      if (custoBRL > snapshot.caixaBRL + 1e-6) {
        setMsg({
          tipo: "erro",
          texto: `Caixa insuficiente: a compra custa ${fmtBRL(custoBRL)} e há ${fmtBRL(snapshot.caixaBRL)} disponíveis.`,
        });
        return;
      }

      await upsertAtivo({
        id: tk,
        tipo: info.tipo,
        ticker: tk,
        bolsa: info.bolsa,
        moeda: info.moeda,
        // O nome vem da bolsa; o manual só existe como rede de segurança para
        // quando ela não devolve nenhum (ver o campo "Nome" no formulário).
        nome: info.nome?.trim() || nomeManual.trim() || tk,
      });

      const tx: TxTrade = {
        id: uuid(),
        ts: new Date().toISOString(),
        tipo: "compra",
        membro,
        ticker: tk,
        qtd: q,
        preco: p,
        moeda: info.moeda,
        fx,
      };
      await registrarTransacao(tx, carteiraId);

      setMsg({
        tipo: "ok",
        texto:
          `Compra registrada: ${fmtNum(q, q % 1 === 0 ? 0 : 4)} ${tk}` +
          `${info.nome ? ` (${info.nome})` : ""} a ${fmtNum(p, 2)} ${info.moeda}` +
          `${info.moeda !== "BRL" ? ` (dólar ${fmtNum(fx, 4)})` : ""} = ${fmtBRL(custoBRL)}.`,
      });
      setTicker("");
      setQtd("");
      setPreco("");
      setNomeManual("");
      setDet(null);
      setPrecoAutomatico(true);
      onDone();
    } catch (e) {
      setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setOcupado(false);
    }
  }

  const variacao =
    det?.precoRef != null && p > 0 && precoAutomatico === false
      ? ((p - det.precoRef) / det.precoRef) * 100
      : null;

  return (
    <div className="card">
      <div className="card__cab">
        <h3>Comprar ação, ETF ou FII</h3>
        <span className="muted">nome, bolsa, moeda e tipo vêm da bolsa pelo ticker</span>
      </div>

      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="campo" style={{ flex: "2 1 180px" }}>
          <label htmlFor="tk">Ticker</label>
          <input
            id="tk"
            value={ticker}
            onChange={(e) => {
              setTicker(e.target.value);
              // Zera a identificação anterior: enquanto a nova não chega, nada
              // de mostrar o nome da empresa errada ao lado do ticker novo.
              setDet(null);
              setPrecoAutomatico(true);
            }}
            placeholder="PETR4, AAPL, HGLG11…"
            autoCapitalize="characters"
          />
        </div>
        <div className="campo" style={{ flex: "1 1 130px" }}>
          <label htmlFor="qt">Quantidade</label>
          <input id="qt" value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="decimal" placeholder="100" />
        </div>
        <div className="campo" style={{ flex: "1 1 150px" }}>
          <label htmlFor="pr">Preço por unidade ({simbolo})</label>
          <input
            id="pr"
            value={preco}
            onChange={(e) => {
              setPreco(e.target.value);
              setPrecoAutomatico(false);
            }}
            inputMode="decimal"
            placeholder="0,00"
          />
        </div>
      </div>

      <div className="aviso" style={{ marginBottom: "0.9rem" }}>
        {detectando ? (
          "Consultando a bolsa…"
        ) : det ? (
          <>
            <strong>{det.ticker}</strong> · {ROTULO_CLASSE[det.tipo]} · {det.bolsa} · {det.moeda}
            {nomeBolsa ? ` · ${nomeBolsa}` : ""}
            {det.ticker !== ticker.trim().toUpperCase() && (
              <span className="muted"> — será registrado com este código, não com “{ticker.trim().toUpperCase()}”.</span>
            )}
            <br />
            {det.precoRef != null ? (
              <>
                Mercado agora: <strong className="num">{simbolo} {fmtNum(det.precoRef, 2)}</strong>
                {precoAutomatico ? (
                  <span className="muted"> — já preenchido no campo de preço; você pode alterar.</span>
                ) : variacao != null && Math.abs(variacao) > 0.01 ? (
                  <span className={sinal(variacao)}>
                    {" "}— você está registrando {variacao >= 0 ? "acima" : "abaixo"} do mercado
                    ({variacao >= 0 ? "+" : ""}{variacao.toFixed(2)}%).
                  </span>
                ) : null}
              </>
            ) : (
              <span className="muted">Sem cotação de mercado agora — informe o preço manualmente.</span>
            )}
          </>
        ) : (
          "Digite o ticker — nome, tipo, bolsa e cotação são buscados automaticamente."
        )}
      </div>

      <div className="campo">
        <label htmlFor="nm">Nome {nomeBolsa ? "(cadastrado na bolsa)" : ""}</label>
        <input
          id="nm"
          value={nomeBolsa || nomeManual}
          onChange={(e) => setNomeManual(e.target.value)}
          disabled={nomeBolsa !== "" || det == null}
          placeholder={detectando ? "Consultando a bolsa…" : "vem da bolsa ao digitar o ticker"}
        />
        {det != null && !nomeBolsa && (
          <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.3rem" }}>
            A bolsa não devolveu o nome deste ticker. Informe manualmente ou deixe em branco para
            usar o próprio código.
          </p>
        )}
      </div>

      {custoEstimado != null && (
        <div className="row" style={{ marginBottom: "0.9rem", gap: "1.5rem" }}>
          <span>
            <span className="topo__rot">Custo total</span>
            <div className="num" style={{ fontWeight: 700 }}>{fmtBRL(custoEstimado)}</div>
          </span>
          <span>
            <span className="topo__rot">Caixa depois</span>
            <div className={`num ${semCaixa ? "neg" : ""}`} style={{ fontWeight: 700 }}>
              {fmtBRL(caixaRestante)}
            </div>
          </span>
        </div>
      )}

      <div className="row">
        <button disabled={ocupado || semCaixa} onClick={comprar}>
          {ocupado ? "Registrando…" : "Registrar compra"}
        </button>
        {semCaixa && <span className="neg" style={{ fontSize: "0.85rem" }}>Caixa insuficiente para esta compra.</span>}
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

function Vender({ snapshot, precos, membro, carteiraId, onDone }: Props) {
  const posicoes = snapshot.posicoes.filter((p) => p.qtd > 0);
  const [ticker, setTicker] = useState(posicoes[0]?.ticker ?? "");
  const [qtd, setQtd] = useState("");
  const [preco, setPreco] = useState("");
  const [precoAutomatico, setPrecoAutomatico] = useState(true);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [cotando, setCotando] = useState(false);

  const posSel = posicoes.find((p) => p.ticker === ticker);
  const ehRF = posSel?.classe === "tesouro" || posSel?.classe === "bond";
  const simbolo = posSel?.moeda === "BRL" || !posSel ? "R$" : "US$";

  // Preço sugerido: o de mercado que já temos no snapshot da carteira.
  const sugerido = posSel?.precoAtual ?? null;
  const precoEfetivo = precoAutomatico ? sugerido : Number(preco);

  async function cotarAgora() {
    if (!posSel || ehRF) return;
    setCotando(true);
    try {
      const p = await precoDeMercado(posSel.ticker, precos);
      if (p != null) {
        setPreco(String(p));
        setPrecoAutomatico(false);
      }
    } finally {
      setCotando(false);
    }
  }

  async function vender() {
    setMsg(null);
    const q = Number(qtd);
    if (!posSel || !isFinite(q) || q <= 0) {
      setMsg({ tipo: "erro", texto: "Selecione um ativo e uma quantidade válida." });
      return;
    }
    if (q > posSel.qtd + 1e-9) {
      setMsg({ tipo: "erro", texto: `Você tem apenas ${fmtNum(posSel.qtd, 4)} unidades de ${posSel.ticker}.` });
      return;
    }
    setOcupado(true);
    try {
      let p = precoEfetivo;
      if (p == null || !isFinite(p) || p <= 0) {
        // Última tentativa: cotar na hora antes de desistir.
        p = ehRF ? posSel.custoMedioBRL : await precoDeMercado(posSel.ticker, precos);
      }
      if (p == null || !isFinite(p) || p <= 0) {
        setMsg({ tipo: "erro", texto: `Sem cotação para ${posSel.ticker}. Informe o preço de venda manualmente.` });
        return;
      }
      const fx = posSel.moeda === "BRL" ? 1 : await cotacaoDolarOuSnapshot(precos);
      const tx: TxTrade = {
        id: uuid(),
        ts: new Date().toISOString(),
        tipo: "venda",
        membro,
        ticker: posSel.ticker,
        qtd: q,
        preco: p,
        moeda: posSel.moeda,
        fx,
      };
      await registrarTransacao(tx, carteiraId);
      setMsg({
        tipo: "ok",
        texto: `Venda registrada: ${fmtNum(q, q % 1 === 0 ? 0 : 4)} ${posSel.ticker} a ${fmtNum(p, 2)} ${posSel.moeda} = ${fmtBRL(q * p * fx)}.`,
      });
      setQtd("");
      setPreco("");
      setPrecoAutomatico(true);
      onDone();
    } catch (e) {
      setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setOcupado(false);
    }
  }

  if (posicoes.length === 0) {
    return (
      <div className="card">
        <div className="vazio">
          <span className="vazio__ico" aria-hidden="true">📭</span>
          <strong>Nada para vender</strong>
          A carteira não tem posições abertas.
        </div>
      </div>
    );
  }

  const q = Number(qtd);
  const receita =
    posSel && precoEfetivo != null && isFinite(q) && q > 0
      ? q * precoEfetivo * (posSel.moeda === "BRL" ? 1 : posSel.fxAtual)
      : null;

  return (
    <div className="card">
      <div className="card__cab">
        <h3>Vender</h3>
        <span className="muted">o preço vem cotado; você pode ajustar</span>
      </div>

      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="campo" style={{ flex: "2 1 220px" }}>
          <label htmlFor="at">Ativo</label>
          <select
            id="at"
            value={ticker}
            onChange={(e) => {
              setTicker(e.target.value);
              setPreco("");
              setPrecoAutomatico(true);
            }}
          >
            {posicoes.map((p) => (
              <option key={p.ticker} value={p.ticker}>
                {p.ticker} — {fmtNum(p.qtd, p.qtd % 1 === 0 ? 0 : 4)} un. ({ROTULO_CLASSE[p.classe]})
              </option>
            ))}
          </select>
        </div>
        <div className="campo" style={{ flex: "1 1 130px" }}>
          <label htmlFor="qv">Quantidade</label>
          <input id="qv" value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="decimal" placeholder={posSel ? fmtNum(posSel.qtd, 0) : ""} />
        </div>
        <div className="campo" style={{ flex: "1 1 150px" }}>
          <label htmlFor="pv">Preço ({simbolo})</label>
          <input
            id="pv"
            value={precoAutomatico ? (sugerido != null ? fmtNum(sugerido, 2) : "") : preco}
            onChange={(e) => {
              setPreco(e.target.value);
              setPrecoAutomatico(false);
            }}
            inputMode="decimal"
            placeholder="0,00"
          />
        </div>
      </div>

      {posSel && (
        <div className="aviso" style={{ marginBottom: "0.9rem" }}>
          Posição: <strong>{fmtNum(posSel.qtd, posSel.qtd % 1 === 0 ? 0 : 4)}</strong> un. ·
          preço médio {fmtBRL(posSel.custoMedioBRL)} ·{" "}
          {sugerido != null ? (
            <>
              mercado {simbolo} {fmtNum(sugerido, 2)}
              {!ehRF && (
                <button
                  className="secundario no-print"
                  onClick={cotarAgora}
                  disabled={cotando}
                  style={{ marginLeft: 8, padding: "0.15rem 0.6rem", fontSize: "0.78rem" }}
                >
                  {cotando ? "cotando…" : "recotar"}
                </button>
              )}
            </>
          ) : (
            <span className="muted">sem cotação — informe o preço</span>
          )}
          {receita != null && (
            <>
              <br />
              Receita estimada: <strong className="num">{fmtBRL(receita)}</strong>
            </>
          )}
        </div>
      )}

      <div className="row">
        <button disabled={ocupado} onClick={vender}>
          {ocupado ? "Processando…" : "Registrar venda"}
        </button>
        {posSel && posSel.moeda !== "BRL" && (
          <span className="muted" style={{ fontSize: "0.82rem" }}>Convertida pelo dólar do momento da venda.</span>
        )}
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

function RendaFixa({ snapshot, membro, carteiraId, onDone }: Props) {
  /** Catálogo oficial. null = ainda carregando; [] = Action nunca rodou. */
  const [catalogo, setCatalogo] = useState<TituloTesouro[] | null>(null);
  const [isTesouro, setIsTesouro] = useState(true);
  const [ticker, setTicker] = useState("");
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  /** Só usado quando o catálogo está vazio e a pessoa digita o nome à mão. */
  const [tesouroNomeManual, setTesouroNomeManual] = useState("");
  const [indexador, setIndexador] = useState("IPCA");
  const [taxa, setTaxa] = useState("");
  const [dataCompra, setDataCompra] = useState(new Date().toISOString().slice(0, 10));
  const [vencimento, setVencimento] = useState("");
  const [puCompra, setPuCompra] = useState("");
  const [valorVencimento, setValorVencimento] = useState("");
  const [qtd, setQtd] = useState("");
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // O catálogo vem da tabela `tesouro_titulos`, escrita só pela Action. Falha
  // silenciosa de propósito: sem catálogo a tela degrada para entrada manual, que
  // é melhor do que um erro vermelho impedindo a compra.
  useEffect(() => {
    let vivo = true;
    carregarTitulosTesouro()
      .then((ts) => vivo && setCatalogo(ts))
      .catch(() => vivo && setCatalogo([]));
    return () => {
      vivo = false;
    };
  }, []);

  const titulos = catalogo ?? [];
  const selecionado = titulos.find((t) => t.slug === slug) ?? null;

  /**
   * Preenche o formulário com os dados oficiais do título escolhido. O PU aqui é
   * o de COMPRA (o que se paga), não o de resgate — o de resgate é o que marca a
   * posição depois, e confundir os dois inflaria o custo registrado.
   */
  function escolherTitulo(novoSlug: string) {
    setSlug(novoSlug);
    const t = titulos.find((x) => x.slug === novoSlug);
    if (!t) return;
    setVencimento(t.vencimento);
    setIndexador(t.indexador === "IGPM" ? "IGPM" : t.indexador);
    setTaxa(t.taxaCompra != null ? String(t.taxaCompra) : "");
    setPuCompra(t.puCompra != null ? String(t.puCompra) : "");
    setNome(t.nome);
  }

  // Nome que identifica o título: do catálogo, ou o digitado na degradação.
  const nomeTesouro = selecionado?.nome ?? tesouroNomeManual.trim();
  /**
   * O título oficial em vigor no formulário — null quando é CDB/título genérico
   * ou quando ninguém escolheu nada ainda. É o que trava os campos que vêm da
   * fonte. Guardar o objeto (e não um booleano) é o que deixa o TypeScript
   * estreitar o tipo dentro dos ternários do JSX.
   */
  const oficial = isTesouro ? selecionado : null;
  /** Só trava o PU se a fonte realmente informou um. */
  const puTravado = oficial?.puCompra != null;
  const puEfetivo = Number(puCompra);
  const q = Number(qtd);
  const custo = isFinite(q) && isFinite(puEfetivo) && q > 0 && puEfetivo > 0 ? q * puEfetivo : null;

  async function comprar() {
    setMsg(null);
    const pu = puEfetivo;
    const tk = (isTesouro ? nomeTesouro : ticker.trim().toUpperCase()) || "";
    if (!tk || !isFinite(q) || q <= 0 || !isFinite(pu) || pu <= 0) {
      setMsg({ tipo: "erro", texto: "Preencha título, quantidade e PU válidos." });
      return;
    }
    if (!vencimento) {
      setMsg({ tipo: "erro", texto: "Informe o vencimento do título." });
      return;
    }
    // O valor no vencimento só alimenta o crescimento linear — a rede de segurança
    // de quem não tem PU oficial. No Tesouro ele não é pedido: a marcação vem do
    // PU oficial diário e, em IPCA+/Selic, não existe valor de face fixo para
    // informar. Nos demais títulos continua obrigatório: sem ele o CDB não teria
    // como crescer.
    const vvEfetivo = isTesouro ? pu : Number(valorVencimento);
    if (!isFinite(vvEfetivo) || vvEfetivo <= 0) {
      setMsg({ tipo: "erro", texto: "Informe o valor no vencimento (base da marcação linear)." });
      return;
    }
    if (q * pu > snapshot.caixaBRL + 1e-6) {
      setMsg({ tipo: "erro", texto: `Caixa insuficiente: custo ${fmtBRL(q * pu)} > caixa ${fmtBRL(snapshot.caixaBRL)}.` });
      return;
    }
    setOcupado(true);
    try {
      await upsertAtivo({
        id: tk,
        tipo: isTesouro ? "tesouro" : "bond",
        ticker: tk,
        bolsa: isTesouro ? "TESOURO" : "OUTRA",
        moeda: "BRL",
        nome: nome.trim() || tk,
        bond: {
          isTesouro,
          tesouroNome: isTesouro ? nomeTesouro : undefined,
          // O slug é a chave estável do PU oficial; só existe se veio do catálogo.
          tesouroSlug: isTesouro ? selecionado?.slug : undefined,
          indexador,
          taxaContratada: taxa ? Number(taxa) / 100 : undefined,
          dataCompra,
          vencimento,
          puCompra: pu,
          valorVencimento: vvEfetivo,
        },
      });
      const tx: TxTrade = {
        id: uuid(), ts: new Date().toISOString(), tipo: "compra", membro,
        ticker: tk, qtd: q, preco: pu, moeda: "BRL", fx: 1,
      };
      await registrarTransacao(tx, carteiraId);
      setMsg({ tipo: "ok", texto: `Compra registrada: ${fmtNum(q, 0)} × ${tk} a PU ${fmtNum(pu, 2)} = ${fmtBRL(q * pu)}.` });
      setQtd("");
      onDone();
    } catch (e) {
      setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="card">
      <div className="card__cab">
        <h3>Comprar renda fixa</h3>
        <span className="muted">Tesouro Direto usa PU oficial; os demais crescem linearmente até o vencimento</span>
      </div>

      <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.9rem" }}>
        <input type="checkbox" style={{ width: "auto" }} checked={isTesouro} onChange={(e) => setIsTesouro(e.target.checked)} />
        Tesouro Direto (PU oficial)
      </label>

      {isTesouro ? (
        <div className="campo">
          <label htmlFor="td">Título do Tesouro</label>
          {titulos.length > 0 ? (
            <>
              <select id="td" value={slug} onChange={(e) => escolherTitulo(e.target.value)}>
                <option value="">Escolha um título oficial…</option>
                {titulos.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.nome} — vence {fmtDataLonga(t.vencimento)}
                    {t.taxaCompra != null
                      ? ` — ${fmtNum(t.taxaCompra, 2)}% a.a. ${sufixoIndexador(t.indexador) ?? ""}`.trimEnd()
                      : ""}
                    {t.puCompra != null ? ` — PU ${fmtNum(t.puCompra, 2)}` : ""}
                  </option>
                ))}
              </select>
              {selecionado && (
                <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.3rem" }}>
                  Vencimento, indexador, taxa e PU vieram do catálogo oficial. A marcação a
                  mercado usará o PU de resgate
                  {selecionado.puVenda != null ? ` (hoje ${fmtBRL(selecionado.puVenda)})` : ""},
                  atualizado a cada dia útil.
                </p>
              )}
            </>
          ) : (
            <>
              <input
                id="td"
                value={tesouroNomeManual}
                onChange={(e) => setTesouroNomeManual(e.target.value)}
                placeholder="Tesouro IPCA+ 2035"
              />
              <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.3rem" }}>
                {catalogo == null
                  ? "Carregando o catálogo oficial…"
                  : "Catálogo oficial vazio — ele chega com a rotina de preços. Enquanto isso, informe nome, vencimento e PU manualmente (a posição ficará com marcação linear até o título casar com o catálogo)."}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="row">
          <div className="campo" style={{ flex: 1 }}>
            <label htmlFor="idt">Identificador</label>
            <input id="idt" value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="CDB-BANCOX-2028" />
          </div>
          <div className="campo" style={{ flex: 1 }}>
            <label htmlFor="nmt">Nome</label>
            <input id="nmt" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="CDB Banco X 120% CDI" />
          </div>
        </div>
      )}

      <div className="row">
        <div className="campo" style={{ flex: "1 1 130px" }}>
          <label htmlFor="ix">Indexador {oficial ? "(oficial)" : ""}</label>
          {oficial ? (
            // Não é um <select> porque o catálogo tem famílias que não cabem nas
            // opções abaixo (Renda+, Educa+, IGP-M): um select mostraria vazio.
            <input id="ix" value={rotuloIndexador(oficial.indexador)} disabled />
          ) : (
            <select id="ix" value={indexador} onChange={(e) => setIndexador(e.target.value)}>
              <option value="PREFIXADO">Prefixado</option>
              <option value="IPCA">IPCA+</option>
              <option value="SELIC">Selic</option>
              <option value="CDI">CDI</option>
            </select>
          )}
        </div>
        <div className="campo" style={{ flex: "1 1 110px" }}>
          <label htmlFor="tx">Taxa a.a. (%) {oficial ? "(oficial)" : ""}</label>
          <input
            id="tx"
            value={taxa}
            onChange={(e) => setTaxa(e.target.value)}
            disabled={oficial != null}
            inputMode="decimal"
            placeholder="6,2"
          />
        </div>
        <div className="campo" style={{ flex: "1 1 150px" }}>
          <label htmlFor="dc">Data da compra</label>
          <input id="dc" type="date" value={dataCompra} onChange={(e) => setDataCompra(e.target.value)} />
        </div>
        <div className="campo" style={{ flex: "1 1 150px" }}>
          <label htmlFor="vc">Vencimento {oficial ? "(oficial)" : ""}</label>
          <input
            id="vc"
            type="date"
            value={vencimento}
            onChange={(e) => setVencimento(e.target.value)}
            disabled={oficial != null}
          />
        </div>
      </div>

      <div className="row">
        <div className="campo" style={{ flex: "1 1 150px" }}>
          <label htmlFor="pu">PU de compra {puTravado ? "(oficial)" : ""}</label>
          <input
            id="pu"
            value={puCompra}
            onChange={(e) => setPuCompra(e.target.value)}
            disabled={puTravado}
            inputMode="decimal"
          />
        </div>
        {/* Só na renda fixa genérica: é ela que cresce em linha reta até um valor
            de face. No Tesouro a marcação vem do PU oficial diário. */}
        {!isTesouro && (
          <div className="campo" style={{ flex: "1 1 170px" }}>
            <label htmlFor="vv">Valor no vencimento (PU)</label>
            <input
              id="vv"
              value={valorVencimento}
              onChange={(e) => setValorVencimento(e.target.value)}
              inputMode="decimal"
              placeholder="1000"
            />
          </div>
        )}
        <div className="campo" style={{ flex: "1 1 120px" }}>
          <label htmlFor="qr">Quantidade</label>
          <input id="qr" value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="decimal" />
        </div>
      </div>

      {custo != null && (
        <p className="muted" style={{ margin: "0 0 0.9rem" }}>
          Custo total: <strong className="num">{fmtBRL(custo)}</strong> · caixa depois:{" "}
          <strong className={`num ${snapshot.caixaBRL - custo < 0 ? "neg" : ""}`}>
            {fmtBRL(snapshot.caixaBRL - custo)}
          </strong>
        </p>
      )}

      <button disabled={ocupado} onClick={comprar}>
        {ocupado ? "Processando…" : "Comprar título"}
      </button>

      {msg && (
        <p className={msg.tipo === "erro" ? "alerta" : "aviso"} style={{ marginBottom: 0, marginTop: "0.9rem" }}>
          {msg.texto}
        </p>
      )}
    </div>
  );
}
