import type { Config, Transacao } from "./types";

/** Tipos de transação aceitos. Qualquer outro é rejeitado (integridade). */
const TIPOS_VALIDOS = new Set(["compra", "venda", "provento", "cupom"]);

/**
 * Faz o parse do ledger em JSONL (uma transação JSON por linha).
 * Linhas em branco são ignoradas. Linhas inválidas são descartadas com aviso
 * (o console ajuda no diagnóstico, mas não quebra o replay).
 */
export function parseLedger(texto: string): Transacao[] {
  const out: Transacao[] = [];
  const linhas = texto.split("\n");
  for (const linha of linhas) {
    const t = linha.trim();
    if (!t) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(t);
    } catch {
      console.warn("Ledger: linha JSON inválida ignorada:", t.slice(0, 120));
      continue;
    }
    if (isTransacao(obj)) out.push(obj);
    else console.warn("Ledger: transação inválida ignorada:", t.slice(0, 120));
  }
  // Ordena por timestamp para um replay determinístico independente da ordem
  // com que máquinas diferentes fizeram append.
  out.sort((a, b) => a.ts.localeCompare(b.ts));
  return out;
}

function isTransacao(o: unknown): o is Transacao {
  if (!o || typeof o !== "object") return false;
  const r = o as Record<string, unknown>;
  if (typeof r.tipo !== "string" || !TIPOS_VALIDOS.has(r.tipo)) return false;
  if (typeof r.ts !== "string" || typeof r.ticker !== "string") return false;
  if (typeof r.moeda !== "string" || typeof r.fx !== "number") return false;
  if (r.tipo === "compra" || r.tipo === "venda") {
    return typeof r.qtd === "number" && typeof r.preco === "number";
  }
  return typeof r.valor === "number"; // provento/cupom
}

/** Posição básica acumulada durante o replay (antes da marcação a mercado). */
export interface PosicaoBase {
  ticker: string;
  qtd: number;
  custoTotalBRL: number; // custo total em BRL das unidades ainda em carteira
}

export interface EstadoReplay {
  caixaBRL: number;
  posicoes: Map<string, PosicaoBase>;
  plRealizadoBRL: number;
}

const EPS = 1e-9;

/**
 * Reproduz o ledger sobre o capital inicial (imutável) para obter caixa,
 * posições (com custo médio) e P&L realizado — tudo consolidado em BRL.
 *
 * Custo médio: método padrão. Na venda, o custo baixado é proporcional ao
 * custo médio corrente; o resultado (receita - custo baixado) vira P&L realizado.
 * Proventos/cupons entram como caixa e contam como resultado realizado.
 */
export function replay(config: Config, transacoes: Transacao[]): EstadoReplay {
  const estado: EstadoReplay = {
    caixaBRL: config.capitalInicial, // gênese fixa — nada no ledger a altera
    posicoes: new Map(),
    plRealizadoBRL: 0,
  };

  for (const tx of transacoes) {
    const fx = tx.fx || 1;
    if (tx.tipo === "compra") {
      const custoBRL = tx.qtd * tx.preco * fx + (tx.taxa ?? 0);
      const pos = pegar(estado.posicoes, tx.ticker);
      pos.qtd += tx.qtd;
      pos.custoTotalBRL += custoBRL;
      estado.caixaBRL -= custoBRL;
    } else if (tx.tipo === "venda") {
      const pos = pegar(estado.posicoes, tx.ticker);
      const qtdVenda = Math.min(tx.qtd, pos.qtd);
      const custoMedio = pos.qtd > EPS ? pos.custoTotalBRL / pos.qtd : 0;
      const custoBaixado = custoMedio * qtdVenda;
      const receitaBRL = qtdVenda * tx.preco * fx - (tx.taxa ?? 0);
      estado.plRealizadoBRL += receitaBRL - custoBaixado;
      estado.caixaBRL += receitaBRL;
      pos.qtd -= qtdVenda;
      pos.custoTotalBRL -= custoBaixado;
      if (pos.qtd <= EPS) {
        pos.qtd = 0;
        pos.custoTotalBRL = 0;
      }
    } else if (tx.tipo === "provento" || tx.tipo === "cupom") {
      const valorBRL = tx.valor * fx;
      estado.caixaBRL += valorBRL;
      estado.plRealizadoBRL += valorBRL;
    }
  }

  return estado;
}

function pegar(m: Map<string, PosicaoBase>, ticker: string): PosicaoBase {
  let p = m.get(ticker);
  if (!p) {
    p = { ticker, qtd: 0, custoTotalBRL: 0 };
    m.set(ticker, p);
  }
  return p;
}
