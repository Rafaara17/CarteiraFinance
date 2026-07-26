import { useState } from "react";
import { Marca } from "./Marca";

interface Props {
  /** palpite vindo do convite (`user_metadata`); string vazia é o caso normal. */
  sugestao: string;
  onSalvar: (nome: string) => Promise<void>;
  onSair: () => void;
}

const MIN = 2;

/**
 * Cadastro do nome, no primeiro acesso. Nenhuma tela abre antes disto: o nome é
 * o que identifica a pessoa no ranking e nas comparações, e sem ele o app só
 * teria o e-mail para mostrar aos outros membros.
 */
export function PerfilNome({ sugestao, onSalvar, onSair }: Props) {
  const [nome, setNome] = useState(sugestao);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const valido = nome.trim().length >= MIN;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!valido) return;
    setErro(null);
    setOcupado(true);
    try {
      await onSalvar(nome.trim());
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setOcupado(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={salvar}>
        <div className="login-hero">
          <Marca />
          <p>Liga de Mercado Financeiro da ESALQ/USP · Carteira da Liga</p>
        </div>

        <div className="login-body">
          <h3 style={{ margin: "0 0 0.5rem" }}>Como você quer aparecer?</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Este é o nome que os outros membros vão ver no ranking, nos campeões da semana e nas
            comparações entre carteiras. Use seu nome de verdade.
          </p>

          <div className="campo">
            <label htmlFor="perfil-nome">Seu nome</label>
            <input
              id="perfil-nome"
              autoFocus
              autoComplete="name"
              maxLength={40}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Nome Sobrenome"
            />
          </div>

          <button type="submit" style={{ width: "100%" }} disabled={ocupado || !valido}>
            {ocupado ? "Salvando..." : "Entrar na liga"}
          </button>

          {erro && (
            <p className="alerta" style={{ marginBottom: 0, marginTop: "0.9rem" }}>
              {erro}
            </p>
          )}

          <button
            type="button"
            className="secundario"
            onClick={onSair}
            style={{ width: "100%", marginTop: "0.9rem" }}
          >
            Sair
          </button>
        </div>
      </form>
    </div>
  );
}
