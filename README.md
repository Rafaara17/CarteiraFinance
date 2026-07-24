# CarteiraFinance — Simulador de Carteira da Liga

Carteira de investimentos **fictícia e compartilhada** para a liga de mercado financeiro colocar em
prática o que estuda. Começa com um capital fixo de **R$ 1.000.000**, permite alocar em ações de
**B3 / NYSE / NASDAQ** (e outras bolsas) e em **renda fixa** (Tesouro Direto e títulos genéricos) com
**marcação a mercado**, e devolve um **relatório**.

**Arquitetura:** site estático (React/Vite) hospedado no GitHub Pages + **servidor na nuvem (Supabase)**
como banco de dados, autenticação e sincronização. As alterações feitas por qualquer membro valem em
**todas as máquinas em tempo real**, e o acesso é restrito a quem tem login (**acesso correto e específico**).

## Como funciona

```
Navegador (GitHub Pages, SPA React)
  ├─ login (e-mail/senha)  ─────────►  Supabase Auth   (acesso específico; cadastro público desligado)
  ├─ lê/escreve dados      ─────────►  Postgres + RLS  (config, assets, transactions, prices_latest, reports)
  └─ assina mudanças       ◄─────────  Supabase Realtime (atualiza todas as máquinas em segundos)
GitHub Actions (cron)      ─service role─►  Postgres: upsert prices_latest (preços oficiais)
                           ─service role─►  Postgres: upsert prices_history (série p/ evolução)
```

- **Banco na nuvem.** Os dados vivem no Postgres do Supabase. Abrir o app (autenticado) lê o estado
  atual; operar grava linhas nas tabelas.
- **Acesso por login.** Só membros convidados entram. A **RLS** (Row Level Security) garante que sem
  login válido não se lê nada, e que o histórico de transações é **imutável** (append-only).
- **Tempo real.** Via Supabase Realtime, uma operação numa máquina aparece nas outras em segundos.
- **GitHub Pages** hospeda o site estático. **GitHub Actions** (cron) busca **preços/câmbio oficiais**
  e grava o snapshot no banco. Nada roda 24/7.

## Regras do jogo (integridade)

- **Capital inicial fixo em R$ 1.000.000, imutável.** A tabela `config` não aceita escrita via app
  (RLS só permite leitura); o motor de replay usa esse capital como gênese.
- **Preços sempre oficiais.** O usuário nunca digita o preço de uma ação — a cotação é obtida ao vivo
  no momento da operação e a avaliação contínua usa `prices_latest`, gravado apenas pela Action
  (service role). Nenhum usuário comum escreve preços.
- **Dólar real e momentâneo.** Ativos em USD são convertidos para BRL pela cotação real do dólar.
- **Renda fixa:** Tesouro Direto marca pelo **PU oficial**; sem MtM, cresce **linearmente** do PU de
  compra até o valor de vencimento.

## Setup (uma vez)

### 1. Supabase (banco + auth)
1. Crie um projeto em [supabase.com](https://supabase.com).
2. **SQL Editor → New query**, cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e rode.
   Isso cria as tabelas, ativa a RLS, semeia a `config` (capital R$1M) e liga o Realtime.
3. **Authentication → Providers → Email:** deixe habilitado. Em **Authentication → Sign In / Providers**
   (ou *Settings*), **desligue** "Allow new users to sign up" — o acesso é só por convite.
4. **Convide os membros:** *Authentication → Users → Add user / Invite*. No convite/edição, defina o
   nome de exibição em `user_metadata` (`name`) — é o rótulo que aparece no histórico.
5. Pegue as chaves em **Project Settings → API**: `Project URL`, `anon public` e `service_role`.

### 2. GitHub Pages + Actions
1. **Settings → Pages → Source = GitHub Actions.**
2. **Settings → Secrets and variables → Actions → New secret**, crie:
   - `SUPABASE_URL` = a Project URL
   - `SUPABASE_ANON_KEY` = a chave `anon public` (usada no build do site)
   - `SUPABASE_SERVICE_ROLE_KEY` = a chave `service_role` (usada só pela Action de preços)
   - `BRAPI_TOKEN` = seu token **Brapi PRO** (usado só pela Action, para a série histórica)
3. Push no branch `main` publica o site; o cron de preços roda dias úteis, de hora em hora.

> A `service_role` key e o `BRAPI_TOKEN` são **secretos** e só existem nos secrets da Action —
> nunca vão para o frontend. A `anon` key é pública de propósito (vai embutida no site); a proteção
> real é a RLS do banco.

### 3. Série histórica (evolução dos relatórios)
A aba **Relatório** mostra a **evolução do patrimônio** e a **rentabilidade por período** (este mês, 3
meses, 12 meses ou intervalo personalizado), com comparação opcional a **IBOV, S&P 500, CDI e IPCA**.
Isso é reconstruído a partir da tabela `prices_history`, preenchida pela Action com o histórico diário
(≈1 ano) da **Brapi PRO** (ações e índices), do câmbio (AwesomeAPI) e do **Banco Central** (CDI/IPCA).
Rode a seção `prices_history` do [`supabase/schema.sql`](supabase/schema.sql) uma vez e garanta o secret
`BRAPI_TOKEN`. Enquanto a Action não roda a primeira vez, a aba mostra um aviso amigável.

## Uso

- **Operar → Comprar ação/ETF/FII:** informe ticker, bolsa e quantidade. O preço oficial da B3 é
  cotado na hora; ativos em USD usam o último preço oficial de `prices_latest`. Um ticker ainda sem
  cotação é registrado para a Action precificar.
- **Operar → Renda fixa:** Tesouro Direto (PU oficial) ou título genérico (vencimento + valor no
  vencimento para o crescimento linear).
- **Operar → Vender:** escolhe a posição e a quantidade; cota e registra a venda.
- **Posições / Alocação:** carteira marcada a mercado, consolidada em BRL, com quebras por classe,
  bolsa e moeda.
- **Relatório:** painel de análise com **gráfico de evolução** do patrimônio, **rentabilidade por
  período** (este mês, 3 meses, 12 meses ou personalizado), **retornos mês a mês** e comparação com
  **IBOV / S&P 500 / CDI / IPCA**. Mantém **Imprimir/PDF**, **baixar HTML** e **salvar snapshot** na
  nuvem (tabela `reports`).

## Desenvolvimento local

```bash
cp .env.example .env.local   # e preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run dev            # http://localhost:5173/CarteiraFinance/
npm test               # testes do motor (Vitest)
npm run build          # typecheck + build de produção

# Rodar o buscador de preços localmente (o que a Action executa):
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run fetch-prices

# Gravar a série histórica (evolução dos relatórios) — precisa do token Brapi PRO:
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... BRAPI_TOKEN=... npm run fetch-history
```

## Estrutura

```
supabase/schema.sql        # tabelas + RLS + seed do config + realtime (rode no SQL Editor)
src/
  engine/                  # motor puro e testado: ledger, fx, bonds, portfolio, report
  data/                    # supabase (client), session (auth), supabaseClient (dados), precoProvider
  ui/                      # dashboard React + Login (visão, operar, posições, alocação, relatório, histórico)
scripts/fetch-prices.ts    # busca preços oficiais e faz upsert em prices_latest (service role)
scripts/fetch-history.ts   # série histórica (Brapi PRO + BCB) -> prices_history (evolução dos relatórios)
.github/workflows/         # prices.yml (cron) e deploy.yml (GitHub Pages)
.env.example               # modelo das variáveis do frontend (VITE_SUPABASE_*)
```

## Continuidade — a carteira não depende de nenhuma pessoa

Como a liga permanece por muito tempo e os membros entram e saem, nada deve ficar atrelado a uma conta
pessoal. Recomendação: use uma **organização** do Supabase (ou uma conta dedicada da liga) como dona do
projeto, com mais de um administrador. Ao trocar o responsável, você repassa o acesso ao projeto Supabase
e ao repositório — nenhum código muda; a URL, os dados e o histórico continuam.
