import type { ClasseAtivo } from "../engine/types";

/** Classe de ativo no singular, para uma linha de posição ("PETR4 · Ação"). */
export const ROTULO_CLASSE: Record<ClasseAtivo, string> = {
  acao: "Ação",
  etf: "ETF",
  fii: "FII",
  tesouro: "Tesouro",
  bond: "Título",
  futuro: "Futuro",
  cripto: "Cripto",
};

/** Classe como grupo da alocação ("Ações", "FIIs"); inclui o caixa. */
export const ROTULO_GRUPO: Record<string, string> = {
  acao: "Ações",
  etf: "ETFs",
  fii: "FIIs",
  tesouro: "Tesouro Direto",
  bond: "Renda fixa",
  cripto: "Cripto",
  futuro: "Futuros",
  caixa: "Caixa",
};
