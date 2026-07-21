import type { Ativo, Transacao } from "../engine/types";
import { decodeBase64, encodeBase64 } from "./base64";
import type { Settings } from "./settings";

const API = "https://api.github.com";

/** Autor/committer neutro — desacopla o histórico de qualquer pessoa. */
const IDENTIDADE_LIGA = {
  name: "Carteira da Liga",
  email: "carteira-da-liga@users.noreply.github.com",
} as const;

export interface ArquivoLido {
  conteudo: string;
  sha: string;
}

export interface UltimaAtualizacao {
  autor: string;
  data: string; // ISO
  mensagem: string;
}

/**
 * Cliente que usa o repositório do GitHub como banco de dados:
 * - LEITURA sempre no HEAD do branch (reflete o último commit, sem cache de CDN).
 * - ESCRITA via Contents API com o `sha` base (concorrência otimista); em 409
 *   (outra máquina alterou), refaz o fetch e retenta.
 */
export class GitHubClient {
  constructor(private s: Settings) {}

  private get base() {
    return `${API}/repos/${this.s.owner}/${this.s.repo}`;
  }

  private headers(): HeadersInit {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.s.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  /** Lê um arquivo no HEAD do branch. Retorna null se não existir (404). */
  async lerArquivo(path: string): Promise<ArquivoLido | null> {
    const url = `${this.base}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(this.s.branch)}`;
    const resp = await fetch(url, { headers: this.headers(), cache: "no-store" });
    if (resp.status === 404) return null;
    if (!resp.ok) throw await erro(resp, `ler ${path}`);
    const json = (await resp.json()) as { content?: string; sha: string };
    return { conteudo: json.content ? decodeBase64(json.content) : "", sha: json.sha };
  }

  async lerJson<T>(path: string, padrao: T): Promise<T> {
    const a = await this.lerArquivo(path);
    if (!a || !a.conteudo.trim()) return padrao;
    return JSON.parse(a.conteudo) as T;
  }

  /** Grava (cria/atualiza) um arquivo. Passe `sha` para atualizar existente. */
  async gravarArquivo(path: string, conteudo: string, mensagem: string, sha?: string): Promise<void> {
    const url = `${this.base}/contents/${encodeURIComponent(path)}`;
    // Identidade NEUTRA da liga: o histórico não fica atrelado a nenhuma pessoa,
    // então a carteira sobrevive à saída de qualquer membro. Quem operou fica
    // registrado apenas como rótulo dentro da própria transação (campo `membro`).
    const body = {
      message: mensagem,
      content: encodeBase64(conteudo),
      branch: this.s.branch,
      sha,
      author: IDENTIDADE_LIGA,
      committer: IDENTIDADE_LIGA,
    };
    const resp = await fetch(url, { method: "PUT", headers: this.headers(), body: JSON.stringify(body) });
    if (!resp.ok) throw await erro(resp, `gravar ${path}`);
  }

  /**
   * Acrescenta uma linha ao ledger (append-only) com retry em conflito (409).
   * Reaplica o append sobre o HEAD mais recente — operação comutativa.
   */
  async appendTransacao(tx: Transacao, tentativas = 5): Promise<void> {
    const path = "data/ledger.jsonl";
    const linha = JSON.stringify(tx);
    for (let i = 0; i < tentativas; i++) {
      const atual = await this.lerArquivo(path);
      const base = atual?.conteudo ?? "";
      const novo = base.endsWith("\n") || base === "" ? base + linha + "\n" : base + "\n" + linha + "\n";
      try {
        await this.gravarArquivo(path, novo, `carteira: ${tx.tipo} ${tx.ticker} (${this.s.membro})`, atual?.sha);
        return;
      } catch (e) {
        if (e instanceof ConflitoError && i < tentativas - 1) {
          await espera(200 * (i + 1));
          continue;
        }
        throw e;
      }
    }
  }

  /** Insere/atualiza um ativo no registro data/assets.json (com retry em 409). */
  async upsertAtivo(ativo: Ativo, tentativas = 5): Promise<void> {
    const path = "data/assets.json";
    for (let i = 0; i < tentativas; i++) {
      const atual = await this.lerArquivo(path);
      const lista: Ativo[] = atual?.conteudo?.trim() ? (JSON.parse(atual.conteudo) as Ativo[]) : [];
      const idx = lista.findIndex((a) => a.ticker === ativo.ticker);
      if (idx >= 0) lista[idx] = { ...lista[idx], ...ativo };
      else lista.push(ativo);
      try {
        await this.gravarArquivo(path, JSON.stringify(lista, null, 2) + "\n", `carteira: registra ${ativo.ticker}`, atual?.sha);
        return;
      } catch (e) {
        if (e instanceof ConflitoError && i < tentativas - 1) {
          await espera(200 * (i + 1));
          continue;
        }
        throw e;
      }
    }
  }

  /** Último commit que tocou os dados — para o indicador de frescor. */
  async ultimaAtualizacao(): Promise<UltimaAtualizacao | null> {
    const url = `${this.base}/commits?path=data&sha=${encodeURIComponent(this.s.branch)}&per_page=1`;
    const resp = await fetch(url, { headers: this.headers(), cache: "no-store" });
    if (!resp.ok) return null;
    const arr = (await resp.json()) as Array<{
      commit: { author: { name: string; date: string }; message: string };
    }>;
    if (!arr.length) return null;
    const c = arr[0].commit;
    return { autor: c.author.name, data: c.author.date, mensagem: c.message };
  }
}

export class ConflitoError extends Error {}

async function erro(resp: Response, ctx: string): Promise<Error> {
  let detalhe = "";
  try {
    detalhe = (await resp.json())?.message ?? "";
  } catch {
    /* ignora */
  }
  const msg = `Falha ao ${ctx}: HTTP ${resp.status} ${detalhe}`;
  if (resp.status === 409) return new ConflitoError(msg);
  return new Error(msg);
}

function espera(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
