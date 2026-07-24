import { useState } from "react";
import { signIn } from "../data/session";

/** Tela de entrada: login por e-mail/senha (acesso específico da liga). */
export function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      await signIn(email, senha);
      // A sessão é observada pelo App (onAuthChange); nada mais a fazer aqui.
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="container">
      <form className="card" style={{ maxWidth: 420, margin: "3rem auto" }} onSubmit={entrar}>
        <h2>Entrar na Carteira da Liga</h2>
        <p className="muted">
          Acesso restrito aos membros da liga. Use o e-mail e a senha que o administrador cadastrou para você.
        </p>

        <div className="campo">
          <label>E-mail</label>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@exemplo.com"
          />
        </div>

        <div className="campo">
          <label>Senha</label>
          <input
            type="password"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        <div className="row">
          <button type="submit" disabled={ocupado || !email.trim() || !senha}>
            {ocupado ? "Entrando..." : "Entrar"}
          </button>
        </div>

        {erro && (
          <p className="alerta" style={{ marginBottom: 0 }}>
            {erro}
          </p>
        )}
      </form>
    </div>
  );
}
