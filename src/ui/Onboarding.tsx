import { useState } from "react";
import type { Settings } from "../data/settings";
import { SETTINGS_PADRAO } from "../data/settings";

interface Props {
  inicial: Settings;
  onSalvar: (s: Settings) => void;
}

/** Tela inicial: identidade do membro, coordenadas do repo e token do GitHub. */
export function Onboarding({ inicial, onSalvar }: Props) {
  const [s, setS] = useState<Settings>({ ...SETTINGS_PADRAO, ...inicial });

  const set = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setS((cur) => ({ ...cur, [k]: e.target.value }));

  const podeSalvar = s.owner && s.repo && s.branch && s.membro.trim() && s.token.trim();

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 560, margin: "2rem auto" }}>
        <h2>Entrar na Carteira da Liga</h2>
        <p className="muted">
          Seus dados ficam só neste navegador (localStorage). O token nunca é enviado a lugar nenhum
          além da API do GitHub.
        </p>

        <div className="campo">
          <label>Seu nome (membro)</label>
          <input value={s.membro} onChange={set("membro")} placeholder="ex.: Ana Souza" />
        </div>

        <div className="row">
          <div className="campo" style={{ flex: 1 }}>
            <label>Owner</label>
            <input value={s.owner} onChange={set("owner")} />
          </div>
          <div className="campo" style={{ flex: 1 }}>
            <label>Repositório</label>
            <input value={s.repo} onChange={set("repo")} />
          </div>
          <div className="campo" style={{ width: 120 }}>
            <label>Branch</label>
            <input value={s.branch} onChange={set("branch")} />
          </div>
        </div>

        <div className="campo">
          <label>Token do GitHub (fine-grained, Contents: read/write neste repo)</label>
          <input type="password" value={s.token} onChange={set("token")} placeholder="github_pat_..." />
        </div>

        <div className="campo">
          <label>Chave Finnhub (opcional — cotação ao vivo de ativos em USD)</label>
          <input value={s.finnhubKey ?? ""} onChange={set("finnhubKey")} placeholder="opcional" />
        </div>

        <div className="row">
          <button disabled={!podeSalvar} onClick={() => onSalvar(s)}>
            Entrar
          </button>
          <span className="muted" style={{ fontSize: "0.8rem" }}>
            Precisa de um token com permissão de escrita para operar.
          </span>
        </div>
      </div>
    </div>
  );
}
