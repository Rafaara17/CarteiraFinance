import { useState } from "react";
import type { Membro, Papel } from "../data/supabaseClient";

interface Props {
  membros: Membro[];
  meuUserId: string | null;
  atualizarPapelMembro: (userId: string, papel: Papel) => Promise<void>;
}

const PAPEIS: Array<{ id: Papel; rotulo: string; desc: string }> = [
  { id: "membro", rotulo: "Membro", desc: "Vê a liga e opera só a própria carteira pessoal." },
  { id: "gestor", rotulo: "Gestor", desc: "Pode operar (comprar/vender) a carteira central da liga." },
  { id: "admin", rotulo: "Admin", desc: "Gestor + gerencia os papéis dos membros." },
];

const ROTULO_PAPEL: Record<Papel, string> = { membro: "Membro", gestor: "Gestor", admin: "Admin" };

export function Admin({ membros, meuUserId, atualizarPapelMembro }: Props) {
  const [salvando, setSalvando] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function mudar(userId: string, papel: Papel) {
    setMsg(null);
    setSalvando(userId);
    try {
      await atualizarPapelMembro(userId, papel);
      setMsg("Papel atualizado.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(null);
    }
  }

  const ordenados = [...membros].sort((a, b) => a.nome.localeCompare(b.nome));

  return (
    <div className="grid">
      <div className="card">
        <h2 style={{ marginBottom: "0.25rem" }}>Administração — papéis e permissões</h2>
        <p className="muted" style={{ margin: 0 }}>
          Defina quem pode <strong>operar a carteira central da liga</strong> (papel <em>Gestor</em>).
          Todos os membros continuam vendo a carteira da liga e têm a própria carteira pessoal.
        </p>
      </div>

      <div className="card">
        <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.85rem" }} className="muted">
          {PAPEIS.map((p) => (
            <li key={p.id}>
              <strong>{p.rotulo}</strong> — {p.desc}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <div className="tabela-scroll">
          <table>
            <thead>
              <tr>
                <th>Membro</th>
                <th style={{ width: 200 }}>Papel</th>
              </tr>
            </thead>
            <tbody>
              {ordenados.map((m) => (
                <tr key={m.userId}>
                  <td>
                    {m.nome}
                    {m.userId === meuUserId && <span className="pill" style={{ marginLeft: 6, fontSize: "0.72rem" }}>você</span>}
                  </td>
                  <td>
                    <select
                      value={m.papel}
                      disabled={salvando === m.userId}
                      onChange={(e) => void mudar(m.userId, e.target.value as Papel)}
                    >
                      {PAPEIS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {ROTULO_PAPEL[p.id]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {ordenados.length === 0 && (
                <tr>
                  <td colSpan={2} className="muted">
                    Nenhum membro registrado ainda. Os membros aparecem aqui após o primeiro login.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {msg && <p className="aviso" style={{ marginBottom: 0 }}>{msg}</p>}
      </div>
    </div>
  );
}
