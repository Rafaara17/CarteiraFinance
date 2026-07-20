import { useMemo, useState } from "react";
import { GitHubClient } from "./data/githubClient";
import { carregarSettings, salvarSettings, settingsCompletas, type Settings } from "./data/settings";
import { Allocation } from "./ui/Allocation";
import { History } from "./ui/History";
import { Onboarding } from "./ui/Onboarding";
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
  const [settings, setSettings] = useState<Settings>(() => carregarSettings());
  const [aba, setAba] = useState<Aba>("visao");

  const pronto = settingsCompletas(settings);
  const client = useMemo(() => (pronto ? new GitHubClient(settings) : null), [settings, pronto]);
  const dados = useLeagueData(client);

  if (!pronto) {
    return (
      <Onboarding
        inicial={settings}
        onSalvar={(s) => {
          salvarSettings(s);
          setSettings(s);
        }}
      />
    );
  }

  const nomeLiga = dados.config?.nomeLiga ?? "Carteira da Liga";

  return (
    <>
      <header className="topbar no-print">
        <div className="container">
          <h1>{nomeLiga}</h1>
          <span className="muted">· {settings.membro}</span>
          <div className="spacer" />
          <button className="secundario" style={{ color: "#fff", borderColor: "rgba(255,255,255,.4)" }} onClick={dados.recarregar}>
            {dados.carregando ? "Atualizando..." : "Atualizar"}
          </button>
          <button
            className="secundario"
            style={{ color: "#fff", borderColor: "rgba(255,255,255,.4)" }}
            onClick={() => {
              const s = { ...settings, token: "" };
              salvarSettings(s);
              setSettings(s);
            }}
          >
            Sair
          </button>
        </div>
      </header>

      <div className="container">
        {dados.erro && <div className="alerta" style={{ marginTop: "1rem" }}>Erro: {dados.erro}</div>}

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
            {aba === "operar" && client && (
              <Trade
                client={client}
                snapshot={dados.snapshot}
                ativos={dados.ativos}
                precos={dados.precos}
                membro={settings.membro}
                finnhubKey={settings.finnhubKey}
                onDone={dados.recarregar}
              />
            )}
            {aba === "posicoes" && <Positions snapshot={dados.snapshot} />}
            {aba === "alocacao" && <Allocation snapshot={dados.snapshot} />}
            {aba === "relatorio" && client && (
              <Report
                config={dados.config}
                snapshot={dados.snapshot}
                precoAtualizadoEm={dados.precos.atualizadoEm}
                client={client}
              />
            )}
            {aba === "historico" && <History transacoes={dados.transacoes} />}
          </>
        )}

        <p className="muted" style={{ fontSize: "0.75rem", marginTop: "2rem" }}>
          Dados sincronizados via Git (repositório = banco de dados). Capital inicial fixo e imutável;
          preços oficiais. Sempre que você abre ou volta o foco, os dados são recarregados no último estado.
        </p>
      </div>
    </>
  );
}
