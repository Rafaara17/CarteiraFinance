import { useEffect, useState } from "react";
import {
  carregarAjustesB3,
  registrarAjusteB3,
  reiniciarCarteirasPessoais,
  type LinhaAjusteB3,
  type Membro,
  type Papel,
  type Wallet,
} from "../data/supabaseClient";
import { FUTUROS, MERCADORIAS, proximosVencimentos, type CodigoMercadoria } from "../engine/derivativos";
import { fmtNum } from "../engine/report";
import { fmtDataLonga } from "./grafico";
import { semearHistorico } from "../data/cotacoes";
import { invalidarHistorico } from "./useHistorico";

interface Props {
  membros: Membro[];
  wallets: Wallet[];
  meuUserId: string | null;
  atualizarPapelMembro: (userId: string, papel: Papel) => Promise<void>;
  recarregar: () => void;
}

const PAPEIS: Array<{ id: Papel; rotulo: string; desc: string }> = [
  { id: "membro", rotulo: "Membro", desc: "Vê tudo — posições, alocação, relatório e histórico. Não opera." },
  { id: "gestor", rotulo: "Gestor", desc: "Tudo do membro + compra e vende na carteira da liga." },
  { id: "admin", rotulo: "Admin", desc: "Tudo do gestor + define os papéis dos outros e administra o sistema." },
];

const ROTULO_PAPEL: Record<Papel, string> = { membro: "Membro", gestor: "Gestor", admin: "Admin" };

const SQL_PRIMEIRO_ADMIN = `insert into public.membros (user_id, papel)
select id, 'admin' from auth.users where email = 'SEU-EMAIL@exemplo.com'
on conflict (user_id) do update set papel = 'admin';`;

export function Admin({ membros, wallets, meuUserId, atualizarPapelMembro, recarregar }: Props) {
  const [salvando, setSalvando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  async function mudar(userId: string, papel: Papel) {
    setMsg(null);
    setSalvando(userId);
    try {
      await atualizarPapelMembro(userId, papel);
      setMsg({ tipo: "ok", texto: "Papel atualizado — vale imediatamente para essa pessoa." });
    } catch (e) {
      setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setSalvando(null);
    }
  }

  // Quem ainda não cadastrou o nome vai para o fim da lista.
  const ordenados = [...membros].sort((a, b) =>
    (a.nome ?? "￿").localeCompare(b.nome ?? "￿"),
  );
  const gestores = ordenados.filter((m) => m.papel === "gestor" || m.papel === "admin");

  return (
    <div className="grid">
      <div className="card">
        <div className="card__cab">
          <h3>Papéis e permissões</h3>
          <span className="muted">quem pode operar a carteira da liga</span>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Todo mundo que entra vira <strong>Membro</strong> automaticamente no primeiro login. Para
          alguém poder <strong>comprar e vender</strong>, promova a <strong>Gestor</strong> na tabela
          abaixo — a mudança vale na hora, sem a pessoa precisar sair e entrar de novo.
        </p>
        <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.1rem", fontSize: "0.88rem" }}>
          {PAPEIS.map((p) => (
            <li key={p.id} style={{ marginBottom: "0.25rem" }}>
              <strong>{p.rotulo}</strong> <span className="muted">— {p.desc}</span>
            </li>
          ))}
        </ul>
        <p className="muted" style={{ marginBottom: 0, fontSize: "0.84rem" }}>
          A permissão é imposta pelo banco (RLS), não pela tela: mesmo que alguém mexesse no site, o
          Postgres recusaria a operação de quem não é gestor. O histórico também é imutável — não há
          como editar ou apagar uma operação já registrada.
        </p>
      </div>

      <div className="card">
        <div className="card__cab">
          <h3>Membros</h3>
          <span className="muted">
            {ordenados.length} {ordenados.length === 1 ? "pessoa" : "pessoas"} ·{" "}
            {gestores.length} {gestores.length === 1 ? "pode operar" : "podem operar"}
          </span>
        </div>
        <div className="tabela-scroll">
          <table>
            <thead>
              <tr>
                <th>Membro</th>
                <th style={{ width: 170 }}>Papel</th>
                <th>Pode operar?</th>
              </tr>
            </thead>
            <tbody>
              {ordenados.map((m) => (
                <tr key={m.userId}>
                  <td className="td-principal">
                    {m.nome ?? <span className="muted">Ainda não cadastrou o nome</span>}
                    {m.userId === meuUserId && <span className="badge badge--marca" style={{ marginLeft: 6 }}>você</span>}
                  </td>
                  <td>
                    <select
                      value={m.papel}
                      disabled={salvando === m.userId}
                      onChange={(e) => void mudar(m.userId, e.target.value as Papel)}
                      aria-label={`Papel de ${m.nome ?? "membro sem nome"}`}
                    >
                      {PAPEIS.map((p) => (
                        <option key={p.id} value={p.id}>{ROTULO_PAPEL[p.id]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="muted">
                    {m.papel === "membro" ? "Não — só visualiza" : "Sim — compra e vende na liga"}
                  </td>
                </tr>
              ))}
              {ordenados.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    Ninguém registrado ainda. Os membros aparecem aqui depois do primeiro login.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {msg && (
          <p className={msg.tipo === "erro" ? "alerta" : "aviso"} style={{ marginBottom: 0, marginTop: "0.9rem" }}>
            {msg.texto}
          </p>
        )}
      </div>

      <SerieHistorica />
      <AjustesB3 recarregar={recarregar} />

      <ReiniciarCarteiras membros={membros} wallets={wallets} recarregar={recarregar} />

      <details className="card">
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          Como criar o primeiro admin (só uma vez, no Supabase)
        </summary>
        <p className="muted" style={{ fontSize: "0.88rem" }}>
          Ninguém consegue se autopromover — é uma trava de segurança do banco. Então o{" "}
          <strong>primeiro</strong> admin precisa ser criado direto no Supabase:{" "}
          <strong>SQL Editor → New query</strong>, cole o comando abaixo trocando o e-mail e rode.
          Depois disso, esse admin promove todo mundo por esta tela.
        </p>
        <pre
          style={{
            background: "var(--superficie-2)", padding: "0.9rem", borderRadius: "var(--raio-sm)",
            overflowX: "auto", fontSize: "0.78rem", margin: 0,
          }}
        >
          <code>{SQL_PRIMEIRO_ADMIN}</code>
        </pre>
      </details>
    </div>
  );
}

/**
 * Reinício das carteiras individuais — o recomeço de temporada.
 *
 * É a única ação do app que APAGA transação, e por isso ela é deliberadamente
 * chata: escolher o alvo, escolher o modo e digitar a palavra. O ledger segue
 * append-only para todos os outros caminhos (ver supabase/schema.sql); aqui a
 * exceção é explícita, restrita a admin pelo banco e registrada em
 * `carteiras_reinicios`.
 */
const PALAVRA_CHAVE = "REINICIAR";

type ModoReinicio = "apagar" | "zerar";

function ReiniciarCarteiras({
  membros,
  wallets,
  recarregar,
}: {
  membros: Membro[];
  wallets: Wallet[];
  recarregar: () => void;
}) {
  const [alvo, setAlvo] = useState("todas");
  const [modo, setModo] = useState<ModoReinicio>("apagar");
  const [confirmacao, setConfirmacao] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const pessoais = wallets.filter((w) => w.tipo === "pessoal");
  const nomeDoDono = (dono: string | null) =>
    membros.find((m) => m.userId === dono)?.nome ?? "sem nome";
  const quantas = alvo === "todas" ? pessoais.length : pessoais.filter((w) => w.dono === alvo).length;
  const liberado = confirmacao.trim().toUpperCase() === PALAVRA_CHAVE && quantas > 0;

  async function reiniciar() {
    setMsg(null);
    setOcupado(true);
    try {
      const r = await reiniciarCarteirasPessoais({
        manterCarteiras: modo === "zerar",
        dono: alvo === "todas" ? null : alvo,
      });
      setConfirmacao("");
      recarregar();
      setMsg({
        tipo: "ok",
        texto:
          `Pronto: ${r.carteiras} ${r.carteiras === 1 ? "carteira" : "carteiras"} e ` +
          `${r.operacoes} ${r.operacoes === 1 ? "operação" : "operações"} ` +
          (modo === "apagar"
            ? "removidas. Cada membro volta à tela de ativação no próximo acesso."
            : "zeradas. As carteiras continuam ativas, com o capital inicial em caixa."),
      });
    } catch (e) {
      setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="card">
      <div className="card__cab">
        <h3>Reiniciar carteiras individuais</h3>
        <span className="muted">
          {pessoais.length} {pessoais.length === 1 ? "carteira ativa" : "carteiras ativas"}
        </span>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Apaga o histórico de operações das carteiras <strong>individuais</strong> para começar uma nova
        temporada. A <strong>carteira da liga não é tocada</strong> — o histórico oficial dela continua
        intacto, assim como o registro de ativos e a série histórica de preços.
      </p>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0.9rem" }}>
        <label>
          <span className="muted" style={{ display: "block", fontSize: "0.84rem", marginBottom: "0.3rem" }}>
            Quais carteiras
          </span>
          <select value={alvo} onChange={(e) => setAlvo(e.target.value)} disabled={ocupado} style={{ width: "100%" }}>
            <option value="todas">Todas as carteiras individuais</option>
            {pessoais.map((w) => (
              <option key={w.id} value={w.dono ?? w.id}>
                Só a de {nomeDoDono(w.dono)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="muted" style={{ display: "block", fontSize: "0.84rem", marginBottom: "0.3rem" }}>
            Como reiniciar
          </span>
          <select
            value={modo}
            onChange={(e) => setModo(e.target.value as ModoReinicio)}
            disabled={ocupado}
            style={{ width: "100%" }}
          >
            <option value="apagar">Apagar a carteira — a pessoa reativa e reescolhe</option>
            <option value="zerar">Zerar o histórico — a carteira fica com o caixa cheio</option>
          </select>
        </label>
      </div>

      <p className="muted" style={{ fontSize: "0.84rem", marginBottom: "0.6rem" }}>
        {modo === "apagar" ? (
          <>
            A carteira deixa de existir. No próximo acesso cada membro vê de novo a tela de ativação e
            escolhe entre copiar a liga e começar do zero. Como a data de criação é nova, ninguém aparece
            vencendo períodos anteriores ao recomeço.
          </>
        ) : (
          <>
            A carteira continua ativa e volta ao capital inicial em caixa, sem nenhuma posição. A data de
            ativação original é mantida — ela segue disputando os períodos desde então, agora com a série
            recalculada a partir do caixa.
          </>
        )}
      </p>

      <label style={{ display: "block", marginBottom: "0.7rem" }}>
        <span className="muted" style={{ display: "block", fontSize: "0.84rem", marginBottom: "0.3rem" }}>
          Não tem desfazer. Digite <strong>{PALAVRA_CHAVE}</strong> para liberar o botão.
        </span>
        <input
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          disabled={ocupado || quantas === 0}
          placeholder={PALAVRA_CHAVE}
          aria-label={`Digite ${PALAVRA_CHAVE} para confirmar`}
        />
      </label>

      <button className="perigo" onClick={() => void reiniciar()} disabled={!liberado || ocupado}>
        {ocupado
          ? "Reiniciando…"
          : quantas === 0
            ? "Nenhuma carteira individual para reiniciar"
            : `Reiniciar ${quantas} ${quantas === 1 ? "carteira" : "carteiras"}`}
      </button>

      {msg && (
        <p className={msg.tipo === "erro" ? "alerta" : "aviso"} style={{ marginBottom: 0, marginTop: "0.9rem" }}>
          {msg.texto}
        </p>
      )}
    </div>
  );
}

/**
 * Semeadura da série histórica sob demanda.
 *
 * Sem isso o admin teria de ir ao GitHub disparar a Action à mão para os
 * gráficos de evolução aparecerem — fricção demais para entregar o app pronto.
 */
function SerieHistorica() {
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  async function semear() {
    setMsg(null);
    setOcupado(true);
    try {
      const r = await semearHistorico();
      invalidarHistorico();
      setMsg(
        r.dias > 0
          ? { tipo: "ok", texto: `Pronto: ${r.dias} dias gravados (${r.de} → ${r.ate}). Abra a Visão geral para ver os gráficos.` }
          : { tipo: "erro", texto: "Nenhum dado retornado — verifique se há ativos cadastrados na carteira." },
      );
    } catch (e) {
      setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="card">
      <div className="card__cab">
        <h3>Série histórica</h3>
        <span className="muted">base dos gráficos de evolução e da comparação com índices</span>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Busca ~2 anos de fechamentos dos ativos da carteira, do dólar e dos índices (IBOV, S&amp;P 500,
        CDI e IPCA). Rode uma vez ao montar a carteira — depois disso a atualização diária é
        automática. Pode rodar de novo quando quiser: os dados são reescritos, nunca apagados.
      </p>
      <button onClick={semear} disabled={ocupado}>
        {ocupado ? "Buscando… (pode levar até 1 min)" : "Gerar série histórica agora"}
      </button>
      {msg && (
        <p className={msg.tipo === "erro" ? "alerta" : "aviso"} style={{ marginBottom: 0, marginTop: "0.9rem" }}>
          {msg.texto}
        </p>
      )}
    </div>
  );
}

/**
 * Ajuste manual dos futuros. A Action "Ajustes B3" tenta baixar o boletim oficial
 * todo dia, mas a B3 às vezes bloqueia download automático. Boi, milho e etanol
 * não têm outra fonte grátis — sem ajuste, não dá para negociá-los. Aqui o admin
 * copia o ajuste do site da B3 (Market data → Ajustes do pregão).
 */
function AjustesB3({ recarregar }: { recarregar: () => void }) {
  const hojeYMD = new Date().toISOString().slice(0, 10);
  const [lista, setLista] = useState<LinhaAjusteB3[] | null>(null);
  const [mercadoria, setMercadoria] = useState<CodigoMercadoria>("BGI");
  const vencs = proximosVencimentos(mercadoria, new Date(), 6);
  const [codigo, setCodigo] = useState("");
  const [ajuste, setAjuste] = useState("");
  const [data, setData] = useState(hojeYMD);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const venc = vencs.find((v) => v.codigo === codigo) ?? vencs[0];

  async function carregar() {
    setLista(await carregarAjustesB3());
  }
  useEffect(() => {
    void carregar();
  }, []);

  async function salvar() {
    setMsg(null);
    // "5.512,50" (pt-BR) ou "5512.50": com vírgula, o ponto é separador de milhar.
    const t = ajuste.trim();
    const v = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
    if (!venc || !isFinite(v) || v <= 0) {
      setMsg({ tipo: "erro", texto: "Informe um ajuste válido." });
      return;
    }
    setOcupado(true);
    try {
      await registrarAjusteB3(venc.codigo, v, data, venc.vencimento);
      setMsg({ tipo: "ok", texto: `Ajuste de ${venc.codigo} registrado: ${fmtNum(v, FUTUROS[mercadoria].casas)}.` });
      setAjuste("");
      await carregar();
      recarregar();
    } catch (e) {
      setMsg({ tipo: "erro", texto: e instanceof Error ? e.message : String(e) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="card">
      <div className="card__cab">
        <h3>Ajustes dos futuros (B3)</h3>
        <span className="muted">preço oficial do pregão — automático pela Action, ou manual aqui</span>
      </div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="campo" style={{ flex: "2 1 180px" }}>
          <label htmlFor="am">Mercadoria</label>
          <select id="am" value={mercadoria} onChange={(e) => { setMercadoria(e.target.value as CodigoMercadoria); setCodigo(""); }}>
            {MERCADORIAS.map((m) => (
              <option key={m} value={m}>{m} — {FUTUROS[m].nome}</option>
            ))}
          </select>
        </div>
        <div className="campo" style={{ flex: "1 1 160px" }}>
          <label htmlFor="av">Vencimento</label>
          <select id="av" value={venc?.codigo ?? ""} onChange={(e) => setCodigo(e.target.value)}>
            {vencs.map((v) => (
              <option key={v.codigo} value={v.codigo}>{v.codigo} — {fmtDataLonga(v.vencimento)}</option>
            ))}
          </select>
        </div>
        <div className="campo" style={{ flex: "1 1 130px" }}>
          <label htmlFor="aa">Ajuste ({FUTUROS[mercadoria].unidade})</label>
          <input id="aa" value={ajuste} onChange={(e) => setAjuste(e.target.value)} inputMode="decimal" placeholder="310,25" />
        </div>
        <div className="campo" style={{ flex: "1 1 140px" }}>
          <label htmlFor="ad">Pregão</label>
          <input id="ad" type="date" value={data} max={hojeYMD} onChange={(e) => setData(e.target.value)} />
        </div>
      </div>
      <button onClick={salvar} disabled={ocupado}>{ocupado ? "Salvando…" : "Registrar ajuste"}</button>
      {msg && (
        <p className={msg.tipo === "erro" ? "alerta" : "aviso"} style={{ marginBottom: 0, marginTop: "0.9rem" }}>
          {msg.texto}
        </p>
      )}
      {lista && lista.length > 0 && (
        <div className="tabela-scroll" style={{ marginTop: "1rem" }}>
          <table>
            <thead>
              <tr>
                <th>Contrato</th>
                <th className="right">Ajuste</th>
                <th className="right">Pregão</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((l) => (
                <tr key={l.codigo}>
                  <td>{l.codigo}</td>
                  <td className="right">{fmtNum(l.ajuste, 2)}</td>
                  <td className="right">{fmtDataLonga(l.dataPregao)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lista && lista.length === 0 && (
        <p className="muted" style={{ marginBottom: 0, marginTop: "0.9rem", fontSize: "0.85rem" }}>
          Nenhum ajuste gravado ainda. Dólar, café e soja funcionam pelo preço teórico mesmo assim.
        </p>
      )}
    </div>
  );
}
