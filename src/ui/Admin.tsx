import { useState } from "react";
import type { Membro, Papel } from "../data/supabaseClient";
import { semearHistorico } from "../data/cotacoes";
import { invalidarHistorico } from "./useHistorico";

interface Props {
  membros: Membro[];
  meuUserId: string | null;
  atualizarPapelMembro: (userId: string, papel: Papel) => Promise<void>;
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

export function Admin({ membros, meuUserId, atualizarPapelMembro }: Props) {
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
