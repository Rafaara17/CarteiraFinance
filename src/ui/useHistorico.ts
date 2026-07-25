import { useEffect, useState } from "react";
import type { HistoricoPrecos } from "../engine/types";
import { carregarHistorico } from "../data/supabaseClient";

export interface EstadoHistorico {
  historico: HistoricoPrecos | null;
  carregando: boolean;
  erro: string | null;
}

/**
 * Carrega `prices_history` UMA vez por sessão e compartilha entre as telas.
 *
 * A série muda no máximo uma vez por dia (fechamento), então cachear em memória
 * evita que Visão geral e Relatório busquem a mesma tabela em duplicidade a cada
 * troca de aba.
 */
let cache: HistoricoPrecos | null = null;
let emVoo: Promise<HistoricoPrecos> | null = null;

export function useHistorico(): EstadoHistorico {
  const [historico, setHistorico] = useState<HistoricoPrecos | null>(cache);
  const [carregando, setCarregando] = useState(cache == null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (cache) return;
    let vivo = true;
    setCarregando(true);
    emVoo ??= carregarHistorico();
    emVoo
      .then((h) => {
        cache = h;
        if (vivo) setHistorico(h);
      })
      .catch((e) => {
        emVoo = null; // deixa tentar de novo na próxima montagem
        if (vivo) setErro(e instanceof Error ? e.message : String(e));
      })
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, []);

  return { historico, carregando, erro };
}

/** Invalida o cache — usar depois de semear a série pela aba Admin. */
export function invalidarHistorico(): void {
  cache = null;
  emVoo = null;
}
