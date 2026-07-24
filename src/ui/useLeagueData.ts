import { useCallback, useEffect, useRef, useState } from "react";
import { computarPortfolio } from "../engine/portfolio";
import type { Ativo, Config, PortfolioSnapshot, PrecosSnapshot, Transacao } from "../engine/types";
import { assinarRealtime, carregarDados, type UltimaAtualizacao } from "../data/supabaseClient";

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

/**
 * Carrega config/ativos/ledger/preços do Supabase, computa o snapshot da
 * carteira e mantém tudo sincronizado: recarrega ao focar a janela e, via
 * Realtime, sempre que qualquer máquina altera transações/ativos/preços.
 * Só carrega quando `logado` é true (a RLS exige autenticação).
 */
export function useLeagueData(logado: boolean): DadosLiga {
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
    if (!logado) {
      setConfig(null);
      setSnapshot(null);
      return;
    }
    let cancelado = false;
    setCarregando(true);
    setErro(null);

    (async () => {
      try {
        const d = await carregarDados();
        if (cancelado) return;
        const snap = computarPortfolio(d.config, d.transacoes, d.ativos, d.precos);
        setConfig(d.config);
        setAtivos(d.ativos);
        setTransacoes(d.transacoes);
        setPrecos(d.precos);
        setSnapshot(snap);
        setUltima(d.ultimaAtualizacao);
      } catch (e) {
        if (!cancelado) setErro(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [logado, nonce]);

  // Realtime: qualquer mudança no banco dispara um recarregar (com debounce
  // curto para agrupar rajadas de eventos). Só ativo enquanto logado.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!logado) return;
    const off = assinarRealtime(() => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(recarregar, 400);
    });
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
      off();
    };
  }, [logado, recarregar]);

  // Sempre o último dado: recarrega ao voltar o foco para a aba.
  useEffect(() => {
    if (!logado) return;
    const onFocus = () => recarregar();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [logado, recarregar]);

  return { config, ativos, transacoes, precos, snapshot, ultimaAtualizacao, carregando, erro, recarregar };
}
