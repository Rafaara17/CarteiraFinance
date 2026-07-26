import { useState } from "react";
import { forkCarteiraPessoal } from "../data/supabaseClient";
import { fmtBRL } from "../engine/report";
import type { Config, PortfolioSnapshot } from "../engine/types";

interface Props {
  config: Config;
  /** null enquanto a liga não tem snapshot — a opção de cópia some. */
  snapshotLiga: PortfolioSnapshot | null;
  onPronto: () => void;
}

type Modo = "copia" | "zero";

/**
 * Ativação da carteira pessoal. A escolha entre copiar a liga e começar do zero
 * vale uma vez só, então as duas opções aparecem lado a lado com o que cada uma
 * produz de fato — e não escondidas atrás de um botão único.
 */
export function AtivarCarteira({ config, snapshotLiga, onPronto }: Props) {
  const [criando, setCriando] = useState<Modo | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function ativar(modo: Modo) {
    setErro(null);
    setCriando(modo);
    try {
      await forkCarteiraPessoal(modo === "copia");
      onPronto();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setCriando(null);
    }
  }

  const ocupado = criando != null;
  const posicoes = snapshotLiga?.posicoes.length ?? 0;

  return (
    <div className="grid" style={{ gap: "1.15rem" }}>
      <div className="card">
        <div className="heroi">
          <div className="topo__rot">Carteira individual</div>
          <h2 style={{ margin: "0.1rem 0 0" }}>Ative a sua carteira individual</h2>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Ela parte do mesmo capital inicial fixo da liga ({fmtBRL(config.capitalInicial)}), o que torna os
          retornos diretamente comparáveis. Daí em diante você opera do seu jeito.
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <div className="card">
          <div className="card__cab">
            <h3>Copiar a carteira da liga</h3>
          </div>
          <p className="muted">
            Você começa exatamente de onde a liga está agora
            {snapshotLiga && (
              <>
                {" "}— {posicoes === 1 ? "1 posição" : `${posicoes} posições`} e{" "}
                {fmtBRL(snapshotLiga.caixaBRL)} em caixa
              </>
            )}
            . Serve para discordar de um ponto específico sem refazer tudo.
          </p>
          <button onClick={() => void ativar("copia")} disabled={ocupado || !snapshotLiga}>
            {criando === "copia" ? "Criando…" : "Copiar a liga e começar"}
          </button>
        </div>

        <div className="card">
          <div className="card__cab">
            <h3>Começar do zero</h3>
          </div>
          <p className="muted">
            Sua carteira nasce com {fmtBRL(config.capitalInicial)} em caixa e nenhuma posição. Serve para
            montar a sua tese do início, sem salvar nada da liga.
          </p>
          <button onClick={() => void ativar("zero")} disabled={ocupado}>
            {criando === "zero" ? "Criando…" : "Começar com o caixa cheio"}
          </button>
        </div>
      </div>

      {erro && <div className="alerta">Não deu para criar a carteira: {erro}</div>}

      <p className="muted" style={{ fontSize: "0.82rem", margin: 0 }}>
        A escolha só vale na ativação: depois disso a carteira é sua e só muda pelas operações que você
        registrar. Todos os membros veem o desempenho de todas as carteiras no ranking.
      </p>
    </div>
  );
}
