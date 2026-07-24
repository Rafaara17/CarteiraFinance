import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSession, membroAtual, onAuthChange, signOut } from "./data/session";
import { Allocation } from "./ui/Allocation";
import { History } from "./ui/History";
import { Login } from "./ui/Login";
import { Marca } from "./ui/Marca";
import { Overview } from "./ui/Overview";
import { Positions } from "./ui/Positions";
import { Report } from "./ui/Report";
import { Trade } from "./ui/Trade";
import { useLeagueData } from "./ui/useLeagueData";

type Aba = "visao" | "operar" | "posicoes" | "alocacao" | "relatorio" | "historico";

const ABAS: Array<{ id: Aba; rotulo: string }> = [
  { id: "visao", rotulo: "Visão geral" },
  { id: "operar", rotulo: "Operar" },
  { id: "posicoes", rotulo: "Posições" },
  { id: "alocacao", rotulo: "Alocação" },
  { id: "relatorio", rotulo: "Relatório" },
  { id: "historico", rotulo: "Histórico" },
];

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [carregandoSessao, setCarregandoSessao] = useState(true);
  const [aba, setAba] = useState<Aba>("visao");

  // Sessão inicial + assinatura de mudanças de autenticação (login/logout).
  useEffect(() => {
    let vivo = true;
    getSession().then((s) => {
      if (!vivo) return;
      setSession(s);
      setCarregandoSessao(false);
    });
    const off = onAuthChange((s) => setSession(s));
    return () => {
      vivo = false;
      off();
    };
  }, []);

  const logado = Boolean(session);
  const dados = useLeagueData(logado);

  if (carregandoSessao) {
    return (
      <div className="container">
        <div className="card" style={{ maxWidth: 420, margin: "3rem auto" }}>Carregando...</div>
      </div>
    );
  }

  if (!logado) return <Login />;

  const membro = membroAtual(session);
  const nomeLiga = dados.config?.nomeLiga ?? "Carteira da Liga";

  return (
    <>
      <header className="topbar no-print">
        <div className="container">
          <div className="marca">
            <Marca />
          </div>
          <span className="topbar__sub">
            {nomeLiga} <span className="membro">· {membro}</span>
          </span>
          <div className="spacer" />
          <button className="secundario" onClick={dados.recarregar}>
            {dados.carregando ? "Atualizando..." : "Atualizar"}
          </button>
          <button className="secundario" onClick={() => void signOut()}>
            Sair
          </button>
        </div>
      </header>

      <div className="container">
        {dados.erro && (
          <div className="alerta" style={{ marginTop: "1rem" }}>
            Erro: {dados.erro}
          </div>
        )}

        <div className="tabs no-print">
          {ABAS.map((a) => (
            <button key={a.id} className={`tab ${aba === a.id ? "ativo" : ""}`} onClick={() => setAba(a.id)}>
              {a.rotulo}
            </button>
          ))}
        </div>

        {!dados.snapshot || !dados.config || !dados.precos ? (
          <div className="card">{dados.carregando ? "Carregando carteira..." : "Sem dados."}</div>
        ) : (
          <>
            {aba === "visao" && (
              <Overview
                snapshot={dados.snapshot}
                ultimaAtualizacao={dados.ultimaAtualizacao}
                precoAtualizadoEm={dados.precos.atualizadoEm}
              />
            )}
            {aba === "operar" && (
              <Trade
                snapshot={dados.snapshot}
                ativos={dados.ativos}
                precos={dados.precos}
                membro={membro}
                onDone={dados.recarregar}
              />
            )}
            {aba === "posicoes" && <Positions snapshot={dados.snapshot} />}
            {aba === "alocacao" && <Allocation snapshot={dados.snapshot} />}
            {aba === "relatorio" && (
              <Report
                config={dados.config}
                snapshot={dados.snapshot}
                precoAtualizadoEm={dados.precos.atualizadoEm}
                membro={membro}
              />
            )}
            {aba === "historico" && <History transacoes={dados.transacoes} />}
          </>
        )}

        <footer className="rodape">
          <strong>ESALQ Finance</strong> · Liga de Mercado Financeiro da ESALQ/USP
          <br />
          Carteira simulada · capital inicial fixo e imutável · preços oficiais · sincronizada na nuvem em tempo real.
        </footer>
      </div>
    </>
  );
}
