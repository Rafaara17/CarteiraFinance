import { marcarBond } from "./bonds";
import { estaVencido, mapaDerivativos, margemPosicao, precoDerivativo } from "./derivativos";
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
 *
 * INVARIANTE: toda posição aberta entra no patrimônio. Sem cotação disponível,
 * ela é avaliada pelo CUSTO (marcacao "custo") em vez de virar `null` — porque
 * uma posição sem preço não significa que o dinheiro sumiu, e mostrar
 * patrimônio = caixa é pior do que mostrar o custo com a ressalva.
 */
export function computarPortfolio(
  config: Config,
  transacoes: Transacao[],
  ativos: Ativo[],
  precos: PrecosSnapshot,
  hoje: Date = new Date(),
): PortfolioSnapshot {
  const estado = replay(config, transacoes, mapaDerivativos(ativos));
  const mapaAtivos = new Map(ativos.map((a) => [a.ticker, a]));

  const posicoes: Posicao[] = [];
  for (const base of estado.posicoes.values()) {
    const ativo = mapaAtivos.get(base.ticker);
    if (ativo?.derivativo) {
      if (Math.abs(base.qtd) > 1e-9) posicoes.push(marcarDerivativo(base, ativo, precos, hoje));
      continue;
    }
    if (base.qtd <= 0) continue;
    posicoes.push(marcarPosicao(base, ativo, precos, hoje));
  }

  const valorInvestidoBRL = posicoes.reduce((s, p) => s + (p.valorBRL ?? 0), 0);
  const patrimonioBRL = estado.caixaBRL + valorInvestidoBRL;
  const plNaoRealizadoBRL = posicoes.reduce((s, p) => s + (p.plNaoRealizadoBRL ?? 0), 0);
  const variacaoDiaBRL = posicoes.reduce((s, p) => s + (p.variacaoDiaBRL ?? 0), 0);
  const patrimonioOntem = patrimonioBRL - variacaoDiaBRL;

  const margemRequeridaBRL = posicoes.reduce((s, p) => s + (p.derivativo?.margemBRL ?? 0), 0);

  // pesos (% do patrimônio). Futuro não tem "peso": o valor dele é P&L (pode ser
  // negativo) — a exposição real está em derivativo.nocionalBRL.
  for (const p of posicoes) {
    p.pesoPct =
      !p.derivativo && patrimonioBRL > 0 && p.valorBRL != null ? (p.valorBRL / patrimonioBRL) * 100 : null;
  }
  posicoes.sort((a, b) => (b.valorBRL ?? 0) - (a.valorBRL ?? 0));
  // As pizzas de alocação só fazem sentido com valores positivos.
  const alocaveis = posicoes.filter((p) => !p.derivativo);

  return {
    caixaBRL: estado.caixaBRL,
    posicoes,
    valorInvestidoBRL,
    patrimonioBRL,
    capitalInicial: config.capitalInicial,
    plRealizadoBRL: estado.plRealizadoBRL,
    plNaoRealizadoBRL,
    retornoTotalPct:
      config.capitalInicial > 0
        ? ((patrimonioBRL - config.capitalInicial) / config.capitalInicial) * 100
        : 0,
    variacaoDiaBRL,
    variacaoDiaPct: patrimonioOntem > 0 ? (variacaoDiaBRL / patrimonioOntem) * 100 : null,
    posicoesSemPreco: posicoes.filter((p) => p.marcacao === "custo").length,
    cambioUSD: cambioParaBRL(precos, "USD"),
    alocacaoPorClasse: alocacao(alocaveis, patrimonioBRL, (p) => p.classe),
    alocacaoPorBolsa: alocacao(alocaveis, patrimonioBRL, (p) => p.bolsa),
    alocacaoPorMoeda: alocacao(alocaveis, patrimonioBRL, (p) => p.moeda),
    margemRequeridaBRL,
    caixaLivreBRL: estado.caixaBRL - margemRequeridaBRL,
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
    precoAnterior: null,
    variacaoDiaPct: null,
    variacaoDiaBRL: null,
    marcacao: "custo",
  };

  if (ativo && RENDA_FIXA.has(classe) && ativo.bond) {
    const { puAtual, marcacao } = marcarBond(ativo, precos, hoje);
    const fx = cambioParaBRL(precos, moeda) ?? 1;
    pos.precoAtual = puAtual;
    pos.fxAtual = fx;
    pos.valorBRL = base.qtd * puAtual * fx;
    pos.marcacao = marcacao; // marcarBond só devolve "mercado" | "linear"
  } else {
    const preco = precos.acoes?.[base.ticker];
    const fx = cambioParaBRL(precos, moeda);
    if (typeof preco === "number" && preco > 0 && fx != null) {
      pos.precoAtual = preco;
      pos.fxAtual = fx;
      pos.valorBRL = base.qtd * preco * fx;
      pos.marcacao = "mercado";

      // Variação do dia: precisa do fechamento anterior do ativo. Quando o ativo
      // é estrangeiro, o câmbio de ontem também conta — sem ele, a variação em
      // BRL misturaria efeito de preço com efeito de dólar.
      const anterior = precos.fechamentoAnterior?.[base.ticker];
      if (typeof anterior === "number" && anterior > 0) {
        const fxAnterior =
          moeda === "BRL" ? 1 : precos.fechamentoAnterior?.[moeda] ?? fx;
        pos.precoAnterior = anterior;
        pos.variacaoDiaPct = (preco / anterior - 1) * 100;
        pos.variacaoDiaBRL = base.qtd * (preco * fx - anterior * fxAnterior);
      }
    }
  }

  // Sem cotação: avalia pelo custo em vez de deixar `null`, senão a posição
  // sumiria do patrimônio e o app mostraria só o caixa.
  if (pos.valorBRL == null) {
    pos.valorBRL = base.custoTotalBRL;
    pos.fxAtual = cambioParaBRL(precos, moeda) ?? 1;
    pos.marcacao = "custo";
  }

  pos.plNaoRealizadoBRL = pos.valorBRL - base.custoTotalBRL;
  pos.plNaoRealizadoPct =
    base.custoTotalBRL > 0 ? (pos.plNaoRealizadoBRL / base.custoTotalBRL) * 100 : null;
  return pos;
}

/**
 * Futuro (qtd COM SINAL): valor = P&L não realizado
 * (preço atual − preço médio) × qtd × multiplicador × câmbio. Sem preço, vale
 * zero (P&L neutro) — o dinheiro não some.
 */
function marcarDerivativo(base: PosicaoBase, ativo: Ativo, precos: PrecosSnapshot, hoje: Date): Posicao {
  const meta = ativo.derivativo!;
  const qtd = base.qtd;
  const pm = base.precoMedio ?? 0;
  const fx = cambioParaBRL(precos, meta.moedaCotacao) ?? 1;
  const cot = precoDerivativo(base.ticker, meta, precos, hoje);
  const preco = cot?.preco ?? null;
  const mult = meta.multiplicador;
  const ref = preco ?? pm;
  const valorBRL = preco == null ? 0 : (preco - pm) * qtd * mult * fx;
  const nocionalBRL = qtd * ref * mult * fx;
  // Base do % de P&L: o nocional de entrada.
  const baseRetorno = Math.abs(qtd) * pm * mult * fx;
  const vencido = estaVencido(meta, hoje);

  return {
    ticker: base.ticker,
    nome: ativo.nome,
    classe: ativo.tipo,
    bolsa: ativo.bolsa,
    moeda: meta.moedaCotacao,
    qtd,
    custoMedioBRL: 0,
    custoTotalBRL: 0,
    precoAtual: preco,
    fxAtual: fx,
    valorBRL,
    plNaoRealizadoBRL: valorBRL,
    plNaoRealizadoPct: baseRetorno > 0 ? (valorBRL / baseRetorno) * 100 : null,
    pesoPct: null,
    precoAnterior: null,
    variacaoDiaPct: null,
    variacaoDiaBRL: null,
    marcacao: cot == null ? "custo" : cot.origem,
    derivativo: {
      meta,
      lado: qtd > 0 ? "comprado" : "vendido",
      precoMedio: pm,
      nocionalBRL,
      margemBRL: vencido ? 0 : margemPosicao(meta, qtd, ref, fx),
      vencido,
    },
  };
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
