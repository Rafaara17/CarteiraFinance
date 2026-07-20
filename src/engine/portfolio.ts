import { marcarBond } from "./bonds";
import { cambioParaBRL } from "./fx";
import { replay, type PosicaoBase } from "./ledger";
import type {
  AlocacaoItem,
  Ativo,
  ClasseAtivo,
  Config,
  PortfolioSnapshot,
  Posicao,
  PrecosSnapshot,
  Transacao,
} from "./types";

const RENDA_FIXA: Set<ClasseAtivo> = new Set(["tesouro", "bond"]);

/**
 * Calcula o snapshot completo da carteira: replay do ledger + marcação a
 * mercado (ações via preço oficial × câmbio real; renda fixa via PU/linear),
 * consolidando tudo em BRL.
 */
export function computarPortfolio(
  config: Config,
  transacoes: Transacao[],
  ativos: Ativo[],
  precos: PrecosSnapshot,
  hoje: Date = new Date(),
): PortfolioSnapshot {
  const estado = replay(config, transacoes);
  const mapaAtivos = new Map(ativos.map((a) => [a.ticker, a]));

  const posicoes: Posicao[] = [];
  for (const base of estado.posicoes.values()) {
    if (base.qtd <= 0) continue;
    posicoes.push(marcarPosicao(base, mapaAtivos.get(base.ticker), precos, hoje));
  }

  const valorInvestidoBRL = posicoes.reduce((s, p) => s + (p.valorBRL ?? 0), 0);
  const patrimonioBRL = estado.caixaBRL + valorInvestidoBRL;

  // pesos (% do patrimônio)
  for (const p of posicoes) {
    p.pesoPct = patrimonioBRL > 0 && p.valorBRL != null ? (p.valorBRL / patrimonioBRL) * 100 : null;
  }
  posicoes.sort((a, b) => (b.valorBRL ?? 0) - (a.valorBRL ?? 0));

  return {
    caixaBRL: estado.caixaBRL,
    posicoes,
    valorInvestidoBRL,
    patrimonioBRL,
    capitalInicial: config.capitalInicial,
    plRealizadoBRL: estado.plRealizadoBRL,
    retornoTotalPct:
      config.capitalInicial > 0
        ? ((patrimonioBRL - config.capitalInicial) / config.capitalInicial) * 100
        : 0,
    cambioUSD: cambioParaBRL(precos, "USD"),
    alocacaoPorClasse: alocacao(posicoes, patrimonioBRL, (p) => p.classe),
    alocacaoPorBolsa: alocacao(posicoes, patrimonioBRL, (p) => p.bolsa),
    alocacaoPorMoeda: alocacao(posicoes, patrimonioBRL, (p) => p.moeda),
  };
}

function marcarPosicao(
  base: PosicaoBase,
  ativo: Ativo | undefined,
  precos: PrecosSnapshot,
  hoje: Date,
): Posicao {
  const custoMedioBRL = base.qtd > 0 ? base.custoTotalBRL / base.qtd : 0;
  const classe: ClasseAtivo = ativo?.tipo ?? "acao";
  const moeda = ativo?.moeda ?? "BRL";

  const pos: Posicao = {
    ticker: base.ticker,
    nome: ativo?.nome ?? base.ticker,
    classe,
    bolsa: ativo?.bolsa ?? "OUTRA",
    moeda,
    qtd: base.qtd,
    custoMedioBRL,
    custoTotalBRL: base.custoTotalBRL,
    precoAtual: null,
    fxAtual: 1,
    valorBRL: null,
    plNaoRealizadoBRL: null,
    plNaoRealizadoPct: null,
    pesoPct: null,
    marcacao: "sem-preco",
  };

  if (ativo && RENDA_FIXA.has(classe) && ativo.bond) {
    const { puAtual, marcacao } = marcarBond(ativo, precos, hoje);
    const fx = cambioParaBRL(precos, moeda) ?? 1;
    pos.precoAtual = puAtual;
    pos.fxAtual = fx;
    pos.valorBRL = base.qtd * puAtual * fx;
    pos.marcacao = marcacao;
  } else {
    const preco = precos.acoes?.[base.ticker];
    const fx = cambioParaBRL(precos, moeda);
    if (typeof preco === "number" && preco > 0 && fx != null) {
      pos.precoAtual = preco;
      pos.fxAtual = fx;
      pos.valorBRL = base.qtd * preco * fx;
      pos.marcacao = "mercado";
    }
  }

  if (pos.valorBRL != null) {
    pos.plNaoRealizadoBRL = pos.valorBRL - base.custoTotalBRL;
    pos.plNaoRealizadoPct =
      base.custoTotalBRL > 0 ? (pos.plNaoRealizadoBRL / base.custoTotalBRL) * 100 : null;
  }
  return pos;
}

function alocacao(
  posicoes: Posicao[],
  patrimonioBRL: number,
  chaveDe: (p: Posicao) => string,
): AlocacaoItem[] {
  const soma = new Map<string, number>();
  for (const p of posicoes) {
    if (p.valorBRL == null) continue;
    soma.set(chaveDe(p), (soma.get(chaveDe(p)) ?? 0) + p.valorBRL);
  }
  const itens: AlocacaoItem[] = [];
  for (const [chave, valorBRL] of soma) {
    itens.push({ chave, valorBRL, pesoPct: patrimonioBRL > 0 ? (valorBRL / patrimonioBRL) * 100 : 0 });
  }
  itens.sort((a, b) => b.valorBRL - a.valorBRL);
  return itens;
}
