import { useCallback, useEffect, useState } from "react";
import { computarPortfolio } from "../engine/portfolio";
import { parseLedger } from "../engine/ledger";
import type { Ativo, Config, PortfolioSnapshot, PrecosSnapshot, Transacao } from "../engine/types";
import { GitHubClient, type UltimaAtualizacao } from "../data/githubClient";

export interface DadosLiga {
  config: Config | null;
  ativos: Ativo[];
  transacoes: Transacao[];
  precos: PrecosSnapshot | null;
  snapshot: PortfolioSnapshot | null;
  ultimaAtualizacao: UltimaAtualizacao | null;
  carregando: boolean;
  erro: string | null;
  recarregar: () => void;
}

const CONFIG_PADRAO: Config = {
  nomeLiga: "Carteira da Liga",
  capitalInicial: 1_000_000,
  moedaBase: "BRL",
  dataInicio: "2026-01-01",
};

const PRECOS_PADRAO: PrecosSnapshot = { atualizadoEm: null, cambio: { USD: 1 }, acoes: {}, tesouro: {} };

/**
 * Carrega config/ativos/ledger/preços do repositório (sempre no HEAD),
 * computa o snapshot da carteira e expõe uma função de recarregar.
 * Recarrega ao focar a janela — garante "o último momento de alteração".
 */
export function useLeagueData(client: GitHubClient | null): DadosLiga {
  const [config, setConfig] = useState<Config | null>(null);
  const [ativos, setAtivos] = useState<Ativo[]>([]);
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [precos, setPrecos] = useState<PrecosSnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [ultimaAtualizacao, setUltima] = useState<UltimaAtualizacao | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const recarregar = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!client) return;
    let cancelado = false;
    setCarregando(true);
    setErro(null);

    (async () => {
      try {
        const [cfg, ats, ledger, prc, ult] = await Promise.all([
          client.lerJson<Config>("data/config.json", CONFIG_PADRAO),
          client.lerJson<Ativo[]>("data/assets.json", []),
          client.lerArquivo("data/ledger.jsonl"),
          client.lerJson<PrecosSnapshot>("data/prices/latest.json", PRECOS_PADRAO),
          client.ultimaAtualizacao(),
        ]);
        if (cancelado) return;
        const txs = parseLedger(ledger?.conteudo ?? "");
        const snap = computarPortfolio(cfg, txs, ats, prc);
        setConfig(cfg);
        setAtivos(ats);
        setTransacoes(txs);
        setPrecos(prc);
        setSnapshot(snap);
        setUltima(ult);
      } catch (e) {
        if (!cancelado) setErro(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [client, nonce]);

  // Sempre o último dado: recarrega ao voltar o foco para a aba.
  useEffect(() => {
    const onFocus = () => recarregar();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [recarregar]);

  return { config, ativos, transacoes, precos, snapshot, ultimaAtualizacao, carregando, erro, recarregar };
}
