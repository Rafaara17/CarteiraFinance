import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computarPortfolio } from "../engine/portfolio";
import type { Ativo, Config, PortfolioSnapshot, PrecosSnapshot, Transacao } from "../engine/types";
import { buscarCotacoes, mesclarPrecos, type CotacoesVivas } from "../data/cotacoes";
import {
  assinarRealtime,
  atualizarPapel,
  carregarDados,
  garantirMembro,
  LIGA_WALLET_ID,
  ultimaAtualizacaoDe,
  type DadosCarregados,
  type Membro,
  type Papel,
  type UltimaAtualizacao,
  type Wallet,
} from "../data/supabaseClient";

/** De quanto em quanto tempo repetimos a cotação ao vivo (aba visível). */
const INTERVALO_COTACAO_MS = 60_000;

export interface DadosLiga {
  config: Config | null;
  ativos: Ativo[];
  precos: PrecosSnapshot | null;
  membros: Membro[];
  // papel do usuário logado (sistema de privilégios)
  meuPapel: Papel;
  podeGerirLiga: boolean; // gestor ou admin -> opera a carteira da liga
  ehAdmin: boolean;
  // carteira central da liga
  carteiraLiga: Wallet | null;
  transacoesLiga: Transacao[];
  snapshotLiga: PortfolioSnapshot | null;
  ultimaAtualizacaoLiga: UltimaAtualizacao | null;
  // carteira pessoal do usuário logado (null enquanto não ativada)
  carteiraMinha: Wallet | null;
  transacoesMinha: Transacao[];
  snapshotMinha: PortfolioSnapshot | null;
  ultimaAtualizacaoMinha: UltimaAtualizacao | null;
  // cru, para o ranking entre todas as carteiras
  wallets: Wallet[];
  transacoesPorCarteira: Map<string, Transacao[]>;
  // estado + ações
  carregando: boolean;
  erro: string | null;
  /** true quando o gateway de cotações não respondeu (usando só o snapshot do cron). */
  precosDesatualizados: boolean;
  recarregar: () => void;
  atualizarPapelMembro: (userId: string, papel: Papel) => Promise<void>;
}

const VAZIO: Transacao[] = [];
const SEM_CARTEIRAS = new Map<string, Transacao[]>();

/**
 * Carrega config/ativos/preços/membros + o ledger de TODAS as carteiras e computa
 * os snapshots da liga e da carteira pessoal. Mantém tudo sincronizado (Realtime
 * + foco da aba).
 *
 * Ponto importante: além do snapshot de `prices_latest` (escrito pelo cron), o
 * hook busca COTAÇÃO AO VIVO pela Edge Function e mescla por cima, repetindo a
 * cada minuto. É isso que garante que o patrimônio apareça completo assim que o
 * app abre, sem esperar a Action de preços rodar.
 */
export function useLeagueData(userId: string | null, nome: string): DadosLiga {
  const [dados, setDados] = useState<DadosCarregados | null>(null);
  const [vivas, setVivas] = useState<CotacoesVivas | null>(null);
  const [gatewayOk, setGatewayOk] = useState(true);
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
        if (cancelado) return;
        setDados(d);

        // Cotação ao vivo dos ativos em carteira, por cima do snapshot do banco.
        const tickers = d.ativos.filter((a) => ehRendaVariavel(a)).map((a) => a.ticker);
        const cot = await buscarCotacoes(tickers);
        if (cancelado) return;
        if (cot) setVivas(cot);
        setGatewayOk(cot != null || tickers.length === 0);
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

  // Repique da cotação ao vivo enquanto a aba está visível (não gasta chamada
  // com a aba em segundo plano).
  const tickers = useMemo(
    () => (dados?.ativos ?? []).filter(ehRendaVariavel).map((a) => a.ticker),
    [dados],
  );
  const tickersChave = tickers.join(",");
  useEffect(() => {
    if (!logado || tickers.length === 0) return;
    let cancelado = false;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void buscarCotacoes(tickers).then((cot) => {
        if (cancelado) return;
        if (cot) setVivas(cot);
        setGatewayOk(cot != null);
      });
    }, INTERVALO_COTACAO_MS);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logado, tickersChave]);

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

  const atualizarPapelMembro = useCallback(
    async (uid: string, papel: Papel) => {
      await atualizarPapel(uid, papel);
      recarregar();
    },
    [recarregar],
  );

  // --- derivados (memoizados) -----------------------------------------------
  return useMemo<DadosLiga>(() => {
    const base = { carregando, erro, recarregar, atualizarPapelMembro };

    if (!dados) {
      return {
        ...base,
        config: null,
        ativos: [],
        precos: null,
        membros: [],
        meuPapel: "membro",
        podeGerirLiga: false,
        ehAdmin: false,
        carteiraLiga: null,
        transacoesLiga: VAZIO,
        snapshotLiga: null,
        ultimaAtualizacaoLiga: null,
        carteiraMinha: null,
        transacoesMinha: VAZIO,
        snapshotMinha: null,
        ultimaAtualizacaoMinha: null,
        wallets: [],
        transacoesPorCarteira: SEM_CARTEIRAS,
        precosDesatualizados: false,
      };
    }

    const { config, ativos, precos: doBanco, wallets, membros, transacoesPorCarteira } = dados;
    const precos = mesclarPrecos(doBanco, vivas);

    const meuPapel: Papel = (membros.find((m) => m.userId === userId)?.papel ?? "membro") as Papel;

    const carteiraLiga = wallets.find((w) => w.tipo === "liga") ?? null;
    const transacoesLiga = transacoesPorCarteira.get(carteiraLiga?.id ?? LIGA_WALLET_ID) ?? VAZIO;

    // Carteira pessoal: `null` enquanto o membro não ativou. Não inventamos uma
    // carteira vazia aqui — isso se confundiria com uma carteira ativada e zerada.
    const carteiraMinha = wallets.find((w) => w.tipo === "pessoal" && w.dono === userId) ?? null;
    const transacoesMinha = carteiraMinha ? transacoesPorCarteira.get(carteiraMinha.id) ?? VAZIO : VAZIO;

    return {
      ...base,
      config,
      ativos,
      precos,
      membros,
      meuPapel,
      podeGerirLiga: meuPapel === "gestor" || meuPapel === "admin",
      ehAdmin: meuPapel === "admin",
      carteiraLiga,
      transacoesLiga,
      snapshotLiga: computarPortfolio(config, transacoesLiga, ativos, precos),
      ultimaAtualizacaoLiga: ultimaAtualizacaoDe(transacoesLiga),
      carteiraMinha,
      transacoesMinha,
      snapshotMinha: carteiraMinha ? computarPortfolio(config, transacoesMinha, ativos, precos) : null,
      ultimaAtualizacaoMinha: ultimaAtualizacaoDe(transacoesMinha),
      wallets,
      transacoesPorCarteira,
      precosDesatualizados: !gatewayOk,
    };
  }, [dados, vivas, gatewayOk, userId, carregando, erro, recarregar, atualizarPapelMembro]);
}

function ehRendaVariavel(a: Ativo): boolean {
  return a.tipo === "acao" || a.tipo === "etf" || a.tipo === "fii";
}
