import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSession, membroAtual, onAuthChange, signOut, usuarioId } from "./data/session";
import { LIGA_WALLET_ID } from "./data/supabaseClient";
import { Admin } from "./ui/Admin";
import { Allocation } from "./ui/Allocation";
import { Dashboard } from "./ui/Dashboard";
import { History } from "./ui/History";
import { Login } from "./ui/Login";
import { Positions } from "./ui/Positions";
import { Report } from "./ui/Report";
import { Shell, type ItemNav } from "./ui/Shell";
import { Trade } from "./ui/Trade";
import { useLeagueData } from "./ui/useLeagueData";

const ROTULO_PAPEL = { admin: "Admin", gestor: "Gestor", membro: "Membro" } as const;

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [carregandoSessao, setCarregandoSessao] = useState(true);
  const [aba, setAba] = useState("visao");

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

  const uid = usuarioId(session);
  const membro = membroAtual(session);
  const dados = useLeagueData(uid, membro);

  const itens: ItemNav[] = [
    { id: "visao", rotulo: "Visão geral", curto: "Visão", ico: "◧" },
    ...(dados.podeGerirLiga ? [{ id: "operar", rotulo: "Operar", ico: "⇄" }] : []),
    { id: "posicoes", rotulo: "Posições", curto: "Posições", ico: "☰" },
    { id: "alocacao", rotulo: "Alocação", ico: "◔" },
    { id: "relatorio", rotulo: "Relatório", curto: "Relat.", ico: "▤" },
    { id: "historico", rotulo: "Histórico", curto: "Hist.", ico: "↻" },
    ...(dados.ehAdmin ? [{ id: "admin", rotulo: "Admin", ico: "⚙" }] : []),
  ];

  // Se a aba atual deixou de existir (mudança de papel), volta para a Visão.
  useEffect(() => {
    if (!itens.some((i) => i.id === aba)) setAba("visao");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados.podeGerirLiga, dados.ehAdmin]);

  if (carregandoSessao) {
    return (
      <div className="login-wrap">
        <div className="card">Carregando…</div>
      </div>
    );
  }

  if (!session) return <Login />;

  const { config, precos, snapshot } = dados;

  return (
    <Shell
      itens={itens}
      ativo={aba}
      onNavegar={setAba}
      nomeLiga={config?.nomeLiga ?? "Carteira da Liga"}
      membro={membro}
      papel={ROTULO_PAPEL[dados.meuPapel]}
      snapshot={snapshot}
      atualizando={dados.carregando}
      onAtualizar={dados.recarregar}
      onSair={() => void signOut()}
    >
      {dados.erro && <div className="alerta" style={{ marginBottom: "1rem" }}>Erro: {dados.erro}</div>}

      {aba === "admin" && dados.ehAdmin ? (
        <Admin membros={dados.membros} meuUserId={uid} atualizarPapelMembro={dados.atualizarPapelMembro} />
      ) : !config || !precos || !snapshot ? (
        <div className="card">
          <div className="vazio">
            {dados.carregando ? "Carregando carteira…" : "Sem dados para exibir."}
          </div>
        </div>
      ) : (
        <>
          {aba === "visao" && (
            <Dashboard
              config={config}
              snapshot={snapshot}
              transacoes={dados.transacoes}
              ativos={dados.ativos}
              ultimaAtualizacao={dados.ultimaAtualizacao}
              precoAtualizadoEm={precos.atualizadoEm}
              precosDesatualizados={dados.precosDesatualizados}
              onIrPara={setAba}
            />
          )}
          {aba === "operar" && dados.podeGerirLiga && (
            <Trade
              snapshot={snapshot}
              ativos={dados.ativos}
              precos={precos}
              membro={membro}
              carteiraId={dados.carteiraLiga?.id ?? LIGA_WALLET_ID}
              onDone={dados.recarregar}
            />
          )}
          {aba === "posicoes" && <Positions snapshot={snapshot} />}
          {aba === "alocacao" && <Allocation snapshot={snapshot} />}
          {aba === "relatorio" && (
            <Report
              config={config}
              snapshot={snapshot}
              transacoes={dados.transacoes}
              ativos={dados.ativos}
              precoAtualizadoEm={precos.atualizadoEm}
              membro={membro}
            />
          )}
          {aba === "historico" && <History transacoes={dados.transacoes} />}
        </>
      )}

      <footer className="muted" style={{ textAlign: "center", fontSize: "0.76rem", marginTop: "2.5rem", paddingTop: "1.25rem", borderTop: "1px solid var(--borda)" }}>
        <strong>ESALQ Finance</strong> · Liga de Mercado Financeiro da ESALQ/USP
        <br />
        Carteira simulada · capital inicial fixo e imutável · preços oficiais · sincronizada em tempo real.
      </footer>
    </Shell>
  );
}
