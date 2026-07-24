import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computarRanking, type ItemRanking } from "../engine/comparacao";
import { computarPortfolio } from "../engine/portfolio";
import type { Ativo, Config, PortfolioSnapshot, PrecosSnapshot, Transacao } from "../engine/types";
import {
  assinarRealtime,
  atualizarPapel,
  carregarDados,
  forkCarteiraPessoal,
  garantirMembro,
  LIGA_WALLET_ID,
  ultimaAtualizacaoDe,
  type DadosCarregados,
  type Membro,
  type Papel,
  type UltimaAtualizacao,
  type Wallet,
} from "../data/supabaseClient";

export interface DadosLiga {
  config: Config | null;
  ativos: Ativo[];
  precos: PrecosSnapshot | null;
  wallets: Wallet[];
  membros: Membro[];
  // papel do usuário logado (sistema de privilégios)
  meuPapel: Papel;
  podeGerirLiga: boolean; // gestor ou admin -> opera a carteira da liga
  ehAdmin: boolean;
  // carteira central da liga
  carteiraLiga: Wallet | null;
  transacoesLiga: Transacao[];
  snapshotLiga: PortfolioSnapshot | null;
  ultimaLiga: UltimaAtualizacao | null;
  // carteira pessoal do usuário
  minhaCarteira: Wallet | null;
  transacoesMinha: Transacao[];
  snapshotMinha: PortfolioSnapshot | null;
  ultimaMinha: UltimaAtualizacao | null;
  // ranking (liga + todas as pessoais)
  ranking: ItemRanking[];
  // estado + ações
  carregando: boolean;
  erro: string | null;
  recarregar: () => void;
  ativarMinhaCarteira: () => Promise<void>;
  atualizarPapelMembro: (userId: string, papel: Papel) => Promise<void>;
}

const VAZIO: Transacao[] = [];

/**
 * Carrega config/ativos/preços + carteiras/membros + ledger (agrupado por
 * carteira) do Supabase e computa: snapshot da liga, snapshot da carteira pessoal
 * e o ranking. Mantém tudo sincronizado (Realtime + foco). Só carrega logado.
 */
export function useLeagueData(userId: string | null, nome: string): DadosLiga {
  const [dados, setDados] = useState<DadosCarregados | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const logado = userId != null;
  const recarregar = useCallback(() => setNonce((n) => n + 1), []);

  // Garante a linha em `membros` (idempotente) uma vez por usuário.
  const membroGarantido = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    if (membroGarantido.current === userId) return;
    membroGarantido.current = userId;
    void garantirMembro(userId, nome).then(recarregar).catch(() => {});
  }, [userId, nome, recarregar]);

  useEffect(() => {
    if (!logado) {
      setDados(null);
      return;
    }
    let cancelado = false;
    setCarregando(true);
    setErro(null);

    (async () => {
      try {
        const d = await carregarDados();
        if (!cancelado) setDados(d);
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

  // Realtime: qualquer mudança no banco dispara um recarregar (com debounce curto).
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

  const ativarMinhaCarteira = useCallback(async () => {
    await forkCarteiraPessoal();
    recarregar();
  }, [recarregar]);

  const atualizarPapelMembro = useCallback(
    async (uid: string, papel: Papel) => {
      await atualizarPapel(uid, papel);
      recarregar();
    },
    [recarregar],
  );

  // --- derivados (memoizados) -----------------------------------------------
  return useMemo<DadosLiga>(() => {
    const base = {
      carregando,
      erro,
      recarregar,
      ativarMinhaCarteira,
      atualizarPapelMembro,
    };

    if (!dados) {
      return {
        ...base,
        config: null,
        ativos: [],
        precos: null,
        wallets: [],
        membros: [],
        meuPapel: "membro",
        podeGerirLiga: false,
        ehAdmin: false,
        carteiraLiga: null,
        transacoesLiga: VAZIO,
        snapshotLiga: null,
        ultimaLiga: null,
        minhaCarteira: null,
        transacoesMinha: VAZIO,
        snapshotMinha: null,
        ultimaMinha: null,
        ranking: [],
      };
    }

    const { config, ativos, precos, wallets, membros, transacoesPorCarteira } = dados;

    const meuPapel: Papel = (membros.find((m) => m.userId === userId)?.papel ?? "membro") as Papel;
    const podeGerirLiga = meuPapel === "gestor" || meuPapel === "admin";
    const ehAdmin = meuPapel === "admin";

    const carteiraLiga = wallets.find((w) => w.tipo === "liga") ?? null;
    const ligaId = carteiraLiga?.id ?? LIGA_WALLET_ID;
    const transacoesLiga = transacoesPorCarteira.get(ligaId) ?? VAZIO;
    const snapshotLiga = computarPortfolio(config, transacoesLiga, ativos, precos);

    const minhaCarteira = wallets.find((w) => w.tipo === "pessoal" && w.dono === userId) ?? null;
    const transacoesMinha = minhaCarteira ? transacoesPorCarteira.get(minhaCarteira.id) ?? VAZIO : VAZIO;
    const snapshotMinha = minhaCarteira ? computarPortfolio(config, transacoesMinha, ativos, precos) : null;

    const ranking = computarRanking(config, ativos, precos, wallets, transacoesPorCarteira, minhaCarteira?.id ?? null);

    return {
      ...base,
      config,
      ativos,
      precos,
      wallets,
      membros,
      meuPapel,
      podeGerirLiga,
      ehAdmin,
      carteiraLiga,
      transacoesLiga,
      snapshotLiga,
      ultimaLiga: ultimaAtualizacaoDe(transacoesLiga),
      minhaCarteira,
      transacoesMinha,
      snapshotMinha,
      ultimaMinha: ultimaAtualizacaoDe(transacoesMinha),
      ranking,
    };
  }, [dados, userId, carregando, erro, recarregar, ativarMinhaCarteira, atualizarPapelMembro]);
}
