# CarteiraFinance — Simulador de Carteira da Liga

Carteira de investimentos **fictícia e compartilhada** para a liga de mercado financeiro colocar em
prática o que estuda. Começa com um capital fixo de **R$ 1.000.000**, permite alocar em ações de
**B3 / NYSE / NASDAQ** (e outras bolsas) e em **renda fixa** (Tesouro Direto e títulos genéricos) com
**marcação a mercado**, e devolve um **relatório**.

O diferencial: **sincroniza entre várias máquinas sem manter um servidor**. O próprio repositório do
GitHub é o banco de dados e o mecanismo de sincronização.

## Como funciona (sem servidor)

- **Repositório = banco de dados.** Os dados vivem versionados em `data/`. Abrir o app **lê o HEAD**
  do branch (sempre o último estado); operar **grava um commit** via API do GitHub.
- **GitHub Pages** hospeda o site estático (SPA em React/Vite).
- **GitHub Actions** faz o compute recorrente: uma rotina agendada busca **preços/câmbio oficiais** e
  commita os snapshots; outra publica o site. Nada roda 24/7.

```
Navegador (GitHub Pages)  ──lê HEAD / grava commit──►  Repositório (data/*.json + ledger.jsonl)
GitHub Actions (cron)     ──preços oficiais──────────►  data/prices/latest.json
```

## Regras do jogo (integridade)

- **Capital inicial fixo em R$ 1.000.000, imutável.** Não existe função de depósito; nenhuma operação
  altera o valor inicial (garantido no `config.json` e no motor de replay).
- **Preços sempre oficiais.** O usuário nunca digita o preço de uma ação — a cotação é obtida ao vivo
  no momento da operação e a avaliação contínua usa os snapshots oficiais da Action.
- **Dólar real e momentâneo.** Ativos em USD são convertidos para BRL pela cotação real do dólar, tanto
  na compra quanto na avaliação (base consolidada em BRL).
- **Renda fixa:** Tesouro Direto marca pelo **PU oficial**; sem MtM disponível, o valor cresce
  **linearmente** do PU de compra até o valor de vencimento.

## Setup (uma vez)

1. **GitHub Pages:** em *Settings → Pages*, defina *Source = GitHub Actions*. O deploy publica a cada
   push no branch `main`.
2. **Token de acesso (por membro):** crie um **fine-grained PAT** (*Settings → Developer settings →
   Fine-grained tokens*) com escopo **apenas neste repositório** e permissão **Contents: Read and
   write**. É esse token que cada membro cola no app para operar.
3. **Secrets da Action (opcionais):** em *Settings → Secrets and variables → Actions*:
   - `FINNHUB_KEY` — chave grátis do [Finnhub](https://finnhub.io) para ações US (NYSE/NASDAQ).
   - `BRAPI_TOKEN` — token do [brapi.dev](https://brapi.dev) se sua conta exigir (B3).
4. **Acesse** a URL do Pages, informe seu nome e o token. Pronto para operar.

> Segurança: o token fica **só no seu navegador** (localStorage) e é enviado apenas à API do GitHub.
> Use um token fine-grained restrito a este repo. É um tradeoff consciente para uma liga pequena e
> confiável; uma evolução futura seria login OAuth (device flow) para não compartilhar PAT.

## Uso

- **Operar → Comprar ação/ETF/FII:** informe ticker, bolsa e quantidade. O preço oficial é cotado na
  hora (B3 via brapi; USD via Finnhub) e o dólar real é aplicado.
- **Operar → Renda fixa:** Tesouro Direto (PU oficial do snapshot) ou título genérico (define
  vencimento e valor no vencimento para o crescimento linear).
- **Operar → Vender:** escolhe a posição e a quantidade; cota e registra a venda.
- **Posições / Alocação:** carteira marcada a mercado, consolidada em BRL, com quebras por classe,
  bolsa e moeda.
- **Relatório:** visão consolidada, com **Imprimir/PDF**, **baixar HTML** ou **salvar snapshot** em
  `reports/` no repositório.

## Desenvolvimento local

```bash
npm install
npm run dev            # http://localhost:5173/CarteiraFinance/
npm test               # testes do motor (Vitest)
npm run build          # typecheck + build de produção
npm run fetch-prices   # roda o buscador de preços (o que a Action executa)
```

## Estrutura

```
data/
  config.json          # capital inicial (R$1M, imutável), moeda base, benchmarks
  assets.json          # registro de ativos negociados (cresce sob demanda)
  ledger.jsonl         # transações append-only (amigável a merge multi-máquina)
  prices/latest.json   # snapshot de preços/câmbio oficiais (gerado pela Action)
src/
  engine/              # motor puro e testado: ledger, fx, bonds, portfolio, report
  data/                # cliente do GitHub (repo-como-DB), cotações ao vivo, settings
  ui/                  # dashboard React (visão, operar, posições, alocação, relatório, histórico)
scripts/fetch-prices.ts    # busca preços/câmbio oficiais (server-side, sem CORS)
.github/workflows/         # prices.yml (cron) e deploy.yml (GitHub Pages)
```

## Fontes de preço

| Ativo                | Fonte                                   |
| -------------------- | --------------------------------------- |
| Ações/ETF/FII da B3  | brapi.dev                               |
| Ações NYSE/NASDAQ    | Finnhub (requer `FINNHUB_KEY`)          |
| Câmbio USD/BRL       | AwesomeAPI (cotação real momentânea)    |
| Tesouro Direto (PU)  | API oficial do Tesouro Direto           |
