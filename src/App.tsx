import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSession, membroAtual, onAuthChange, signOut, usuarioId } from "./data/session";
import { LIGA_WALLET_ID } from "./data/supabaseClient";
import { Admin } from "./ui/Admin";
import { Allocation } from "./ui/Allocation";
import { Comparacao } from "./ui/Comparacao";
import { History } from "./ui/History";
import { Login } from "./ui/Login";
import { Marca } from "./ui/Marca";
import { Overview } from "./ui/Overview";
import { Positions } from "./ui/Positions";
import { Report } from "./ui/Report";
import { Trade } from "./ui/Trade";
import { useLeagueData } from "./ui/useLeagueData";

type Aba = "visao" | "operar" | "posicoes" | "alocacao" | "relatorio" | "historico" | "comparacao" | "admin";
type CarteiraSel = "liga" | "pessoal";

const ROTULO_PAPEL = { admin: "Admin", gestor: "Gestor", membro: "Membro" } as const;

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [carregandoSessao, setCarregandoSessao] = useState(true);
  const [aba, setAba] = useState<Aba>("visao");
  const [carteiraSel, setCarteiraSel] = useState<CarteiraSel>("liga");

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

  const naLiga = carteiraSel === "liga";
  const snapshotAtivo = naLiga ? dados.snapshotLiga : dados.snapshotMinha;
  const transacoesAtivas = naLiga ? dados.transacoesLiga : dados.transacoesMinha;
  const ultimaAtiva = naLiga ? dados.ultimaLiga : dados.ultimaMinha;
  const carteiraIdAtiva = naLiga ? dados.carteiraLiga?.id ?? LIGA_WALLET_ID : dados.minhaCarteira?.id ?? null;
  const podeOperarAtiva = naLiga ? dados.podeGerirLiga : true; // o dono sempre opera a sua
  const precisaAtivarPessoal = !naLiga && !dados.minhaCarteira;

  const abas: Array<{ id: Aba; rotulo: string }> = [
    { id: "visao", rotulo: "Visão geral" },
    ...(podeOperarAtiva && !precisaAtivarPessoal ? [{ id: "operar" as const, rotulo: "Operar" }] : []),
    { id: "posicoes", rotulo: "Posições" },
    { id: "alocacao", rotulo: "Alocação" },
    { id: "relatorio", rotulo: "Relatório" },
    { id: "historico", rotulo: "Histórico" },
    { id: "comparacao", rotulo: "Comparação" },
    ...(dados.ehAdmin ? [{ id: "admin" as const, rotulo: "Admin" }] : []),
  ];

  // Se a aba atual deixou de existir (troca de carteira/papel), volta para a Visão.
  useEffect(() => {
    if (!abas.some((a) => a.id === aba)) setAba("visao");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carteiraSel, dados.podeGerirLiga, dados.ehAdmin, precisaAtivarPessoal]);

  if (carregandoSessao) {
    return (
      <div className="container">
        <div className="card" style={{ maxWidth: 420, margin: "3rem auto" }}>Carregando...</div>
      </div>
    );
  }

  if (!session) return <Login />;

  const nomeLiga = dados.config?.nomeLiga ?? "Carteira da Liga";
  const conteudoDeCarteira = aba !== "comparacao" && aba !== "admin";

  return (
    <>
      <header className="topbar no-print">
        <div className="container">
          <div className="marca">
            <Marca />
          </div>
          <span className="topbar__sub">
            {nomeLiga}{" "}
            <span className="membro">
              · {membro} <span className="pill" style={{ fontSize: "0.7rem" }}>{ROTULO_PAPEL[dados.meuPapel]}</span>
            </span>
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

        {/* Seletor de carteira: central da liga × pessoal */}
        <div className="carteira-switch no-print" style={{ display: "flex", gap: "0.5rem", alignItems: "center", margin: "1rem 0 0.25rem", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: "0.82rem" }}>Carteira:</span>
          <div className="segmented">
            <button className={naLiga ? "ativo" : ""} onClick={() => setCarteiraSel("liga")}>
              {dados.carteiraLiga?.nome ?? "Carteira da Liga"}
            </button>
            <button className={!naLiga ? "ativo" : ""} onClick={() => setCarteiraSel("pessoal")}>
              Minha carteira
            </button>
          </div>
          {conteudoDeCarteira && naLiga && !dados.podeGerirLiga && (
            <span className="muted" style={{ fontSize: "0.8rem" }}>
              (somente leitura — apenas o gestor opera a carteira central)
            </span>
          )}
          {conteudoDeCarteira && !naLiga && dados.minhaCarteira && (
            <span className="muted" style={{ fontSize: "0.8rem" }}>(sua carteira paralela — opere à vontade)</span>
          )}
        </div>

        <div className="tabs no-print">
          {abas.map((a) => (
            <button key={a.id} className={`tab ${aba === a.id ? "ativo" : ""}`} onClick={() => setAba(a.id)}>
              {a.rotulo}
            </button>
          ))}
        </div>

        {!dados.config || !dados.precos ? (
          <div className="card">{dados.carregando ? "Carregando carteira..." : "Sem dados."}</div>
        ) : aba === "comparacao" ? (
          <Comparacao
            config={dados.config}
            ativos={dados.ativos}
            snapshotLiga={dados.snapshotLiga!}
            snapshotMinha={dados.snapshotMinha}
            transacoesLiga={dados.transacoesLiga}
            transacoesMinha={dados.transacoesMinha}
            ranking={dados.ranking}
            ativarMinhaCarteira={dados.ativarMinhaCarteira}
          />
        ) : aba === "admin" ? (
          dados.ehAdmin ? (
            <Admin membros={dados.membros} meuUserId={uid} atualizarPapelMembro={dados.atualizarPapelMembro} />
          ) : null
        ) : precisaAtivarPessoal ? (
          <AtivarCarteira config={dados.config} ativar={dados.ativarMinhaCarteira} />
        ) : !snapshotAtivo ? (
          <div className="card">{dados.carregando ? "Carregando carteira..." : "Sem dados."}</div>
        ) : (
          <>
            {aba === "visao" && (
              <Overview
                snapshot={snapshotAtivo}
                ultimaAtualizacao={ultimaAtiva}
                precoAtualizadoEm={dados.precos.atualizadoEm}
              />
            )}
            {aba === "operar" && podeOperarAtiva && carteiraIdAtiva && (
              <Trade
                snapshot={snapshotAtivo}
                ativos={dados.ativos}
                precos={dados.precos}
                membro={membro}
                carteiraId={carteiraIdAtiva}
                onDone={dados.recarregar}
              />
            )}
            {aba === "posicoes" && <Positions snapshot={snapshotAtivo} />}
            {aba === "alocacao" && <Allocation snapshot={snapshotAtivo} />}
            {aba === "relatorio" && (
              <Report
                config={dados.config}
                snapshot={snapshotAtivo}
                transacoes={transacoesAtivas}
                ativos={dados.ativos}
                precoAtualizadoEm={dados.precos.atualizadoEm}
                membro={membro}
              />
            )}
            {aba === "historico" && <History transacoes={transacoesAtivas} />}
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

/** Card de ativação da carteira pessoal (fork da liga). */
function AtivarCarteira({ config, ativar }: { config: { capitalInicial: number }; ativar: () => Promise<void> }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function onClick() {
    setErro(null);
    setOcupado(true);
    try {
      await ativar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="card aviso">
      <h3 style={{ marginTop: 0 }}>Criar minha carteira pessoal</h3>
      <p>
        Sua carteira pessoal nasce como uma <strong>cópia da carteira da liga</strong> neste momento (mesmas
        posições e caixa). A partir daí ela é independente: você opera livremente para divergir do que não
        concordar, e compara o seu desempenho com o da liga. As decisões futuras da liga não entram sozinhas.
      </p>
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Mesmo capital inicial fixo da liga ({config.capitalInicial.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).
      </p>
      <button onClick={onClick} disabled={ocupado}>
        {ocupado ? "Criando..." : "Criar minha carteira a partir da liga"}
      </button>
      {erro && <p className="alerta" style={{ marginBottom: 0 }}>{erro}</p>}
    </div>
  );
}
