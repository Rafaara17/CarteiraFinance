import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSession, nomeSugerido, onAuthChange, signOut, usuarioId } from "./data/session";
import { LIGA_WALLET_ID } from "./data/supabaseClient";
import { Admin } from "./ui/Admin";
import { Allocation } from "./ui/Allocation";
import { AtivarCarteira } from "./ui/AtivarCarteira";
import { Comparar } from "./ui/Comparar";
import { Dashboard } from "./ui/Dashboard";
import { History } from "./ui/History";
import { Login } from "./ui/Login";
import { PerfilNome } from "./ui/PerfilNome";
import { Positions } from "./ui/Positions";
import { Report } from "./ui/Report";
import { useEscopo } from "./ui/SeletorCarteira";
import { Shell, type ItemNav } from "./ui/Shell";
import { Trade } from "./ui/Trade";
import { useLeagueData } from "./ui/useLeagueData";

const ROTULO_PAPEL = { admin: "Admin", gestor: "Gestor", membro: "Membro" } as const;

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [carregandoSessao, setCarregandoSessao] = useState(true);
  const [aba, setAba] = useState("visao");
  const [escopo, trocarEscopo] = useEscopo();

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
  const dados = useLeagueData(uid);
  // Só chega às telas depois do cadastro do nome, então aqui ele sempre existe.
  const membro = dados.meuNome ?? "—";

  // A carteira em uso. Todas as telas leem daqui — nenhuma sabe qual escopo está
  // ativo, o que impede uma tela mostrar uma carteira e o topo outra.
  const pessoal = escopo === "pessoal";
  const ativada = dados.carteiraMinha != null;
  const carteiraId = pessoal ? dados.carteiraMinha?.id ?? null : dados.carteiraLiga?.id ?? LIGA_WALLET_ID;
  const transacoes = pessoal ? dados.transacoesMinha : dados.transacoesLiga;
  const snapshot = pessoal ? dados.snapshotMinha : dados.snapshotLiga;
  const ultimaAtualizacao = pessoal ? dados.ultimaAtualizacaoMinha : dados.ultimaAtualizacaoLiga;
  const podeOperar = pessoal ? ativada : dados.podeGerirLiga;

  const itens: ItemNav[] = [
    { id: "visao", rotulo: "Visão geral", curto: "Visão", ico: "◧" },
    ...(podeOperar ? [{ id: "operar", rotulo: "Operar", ico: "⇄" }] : []),
    { id: "posicoes", rotulo: "Posições", curto: "Posições", ico: "☰" },
    { id: "alocacao", rotulo: "Alocação", ico: "◔" },
    { id: "relatorio", rotulo: "Relatório", curto: "Relat.", ico: "▤" },
    { id: "historico", rotulo: "Histórico", curto: "Hist.", ico: "↻" },
    { id: "comparar", rotulo: "Comparar", ico: "⚖" },
    ...(dados.ehAdmin ? [{ id: "admin", rotulo: "Admin", ico: "⚙" }] : []),
  ];

  // Se a aba atual deixou de existir (mudança de papel ou de escopo), volta para
  // a Visão em vez de deixar a tela em branco.
  useEffect(() => {
    if (!itens.some((i) => i.id === aba)) setAba("visao");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados.podeGerirLiga, dados.ehAdmin, podeOperar, escopo]);

  if (carregandoSessao) {
    return (
      <div className="login-wrap">
        <div className="card">Carregando…</div>
      </div>
    );
  }

  if (!session) return <Login />;

  // Sem a primeira carga não se sabe nem quem é a pessoa (o nome mora no banco).
  if (!dados.pronto) {
    return (
      <div className="login-wrap">
        <div className="card">
          {dados.erro ? (
            <>
              <div className="alerta">Erro ao carregar: {dados.erro}</div>
              <button className="secundario" onClick={() => void signOut()}>Sair</button>
            </>
          ) : (
            "Carregando…"
          )}
        </div>
      </div>
    );
  }

  // Primeiro acesso: a pessoa cadastra o próprio nome antes de qualquer tela.
  if (!dados.meuNome) {
    return (
      <PerfilNome
        sugestao={nomeSugerido(session)}
        onSalvar={dados.definirNome}
        onSair={() => void signOut()}
      />
    );
  }

  const { config, precos } = dados;
  const rotuloCarteira = pessoal ? "Carteira individual" : config?.nomeLiga ?? "Carteira da Liga";

  function conteudo() {
    if (aba === "admin" && dados.ehAdmin) {
      return <Admin membros={dados.membros} meuUserId={uid} atualizarPapelMembro={dados.atualizarPapelMembro} />;
    }

    if (!config || !precos) {
      return (
        <div className="card">
          <div className="vazio">{dados.carregando ? "Carregando carteira…" : "Sem dados para exibir."}</div>
        </div>
      );
    }

    // A comparação existe mesmo sem carteira pessoal: é lá que está o ranking da
    // liga e o convite para entrar na disputa.
    if (aba === "comparar") {
      return (
        <Comparar
          config={config}
          ativos={dados.ativos}
          precos={precos}
          snapshotLiga={dados.snapshotLiga}
          snapshotMinha={dados.snapshotMinha}
          transacoesLiga={dados.transacoesLiga}
          transacoesMinha={dados.transacoesMinha}
          wallets={dados.wallets}
          membros={dados.membros}
          transacoesPorCarteira={dados.transacoesPorCarteira}
          minhaCarteiraId={dados.carteiraMinha?.id ?? null}
          onAtivar={() => {
            dados.recarregar();
            trocarEscopo("pessoal");
          }}
        />
      );
    }

    if (pessoal && !ativada) {
      return (
        <AtivarCarteira
          config={config}
          snapshotLiga={dados.snapshotLiga}
          onPronto={() => {
            dados.recarregar();
            setAba("visao");
          }}
        />
      );
    }

    if (!snapshot) {
      return (
        <div className="card">
          <div className="vazio">{dados.carregando ? "Carregando carteira…" : "Sem dados para exibir."}</div>
        </div>
      );
    }

    return (
      <>
        {aba === "visao" && (
          <Dashboard
            config={config}
            snapshot={snapshot}
            transacoes={transacoes}
            ativos={dados.ativos}
            ultimaAtualizacao={ultimaAtualizacao}
            precoAtualizadoEm={precos.atualizadoEm}
            precosDesatualizados={dados.precosDesatualizados}
            onIrPara={setAba}
          />
        )}
        {/* sem carteiraId não se opera: escrever na carteira errada seria pior
            que não escrever. */}
        {aba === "operar" && podeOperar && carteiraId && (
          <Trade
            snapshot={snapshot}
            ativos={dados.ativos}
            precos={precos}
            membro={membro}
            carteiraId={carteiraId}
            onDone={dados.recarregar}
          />
        )}
        {aba === "posicoes" && <Positions snapshot={snapshot} />}
        {aba === "alocacao" && <Allocation snapshot={snapshot} />}
        {aba === "relatorio" && (
          <Report
            config={pessoal ? { ...config, nomeLiga: `Carteira individual — ${membro}` } : config}
            snapshot={snapshot}
            transacoes={transacoes}
            ativos={dados.ativos}
            precoAtualizadoEm={precos.atualizadoEm}
            membro={membro}
          />
        )}
        {aba === "historico" && <History transacoes={transacoes} />}
      </>
    );
  }

  return (
    <Shell
      itens={itens}
      ativo={aba}
      onNavegar={setAba}
      escopo={escopo}
      onTrocarEscopo={trocarEscopo}
      carteiraAtivada={ativada}
      rotuloCarteira={rotuloCarteira}
      membro={membro}
      papel={ROTULO_PAPEL[dados.meuPapel]}
      snapshot={snapshot}
      onSair={() => void signOut()}
    >
      {dados.erro && <div className="alerta" style={{ marginBottom: "1rem" }}>Erro: {dados.erro}</div>}

      {conteudo()}

      <footer className="muted" style={{ textAlign: "center", fontSize: "0.76rem", marginTop: "2.5rem", paddingTop: "1.25rem", borderTop: "1px solid var(--borda)" }}>
        <strong>ESALQ Finance</strong> · Liga de Mercado Financeiro da ESALQ/USP
        <br />
        Carteira simulada · capital inicial fixo e imutável · preços oficiais · sincronizada em tempo real.
      </footer>
    </Shell>
  );
}
