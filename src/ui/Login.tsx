import { useState } from "react";
import { signIn } from "../data/session";
import { Marca } from "./Marca";

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
    <div className="login-wrap">
      <form className="login-card" onSubmit={entrar}>
        <div className="login-hero">
          <Marca />
          <p>Liga de Mercado Financeiro da ESALQ/USP · Carteira da Liga</p>
        </div>

        <div className="login-body">
          <p className="muted" style={{ marginTop: 0 }}>
            Acesso restrito aos membros. Use o e-mail e a senha cadastrados pelo administrador.
          </p>

          <div className="campo">
            <label>E-mail</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@usp.br"
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

          <button
            type="submit"
            style={{ width: "100%" }}
            disabled={ocupado || !email.trim() || !senha}
          >
            {ocupado ? "Entrando..." : "Entrar"}
          </button>

          {erro && (
            <p className="alerta" style={{ marginBottom: 0, marginTop: "0.9rem" }}>
              {erro}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
