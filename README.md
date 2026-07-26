# CarteiraFinance — Carteira da Liga

Carteira de investimentos **fictícia e compartilhada** para a liga de mercado financeiro colocar em
prática o que estuda. Começa com um capital fixo de **R$ 1.000.000**, permite alocar em ações de
**B3 / NYSE / NASDAQ** e em **renda fixa** (Tesouro Direto e títulos genéricos) com marcação a
mercado, e acompanha o desempenho contra **IBOV, S&P 500, CDI e IPCA**.

**Arquitetura:** site estático (React/Vite) no GitHub Pages + **Supabase** (banco, autenticação,
sincronização e a função de cotações). Toda operação vale em **todas as máquinas em tempo real**,
e o acesso é restrito a quem tem login.

## Como funciona

```
Navegador (GitHub Pages, SPA React)
  ├─ login (e-mail/senha)  ─────────►  Supabase Auth   (acesso por convite)
  ├─ lê/escreve dados      ─────────►  Postgres + RLS  (config, assets, transactions, prices, membros)
  ├─ cotação ao vivo       ─────────►  Edge Function `cotacoes` ──► Yahoo Finance
  └─ assina mudanças       ◄─────────  Supabase Realtime
GitHub Actions (cron)      ─service role─►  prices_latest  (rede de segurança, de hora em hora)
                           ─service role─►  prices_history (série diária p/ os gráficos)
```

- **Preço ao vivo, sem esperar cron.** Ao abrir o app, ele pede as cotações à Edge Function, que
  consulta o Yahoo server-side e devolve preço + fechamento anterior. Por isso o patrimônio já
  aparece completo e cada posição mostra a **variação do dia**. A função repete a consulta a cada
  minuto enquanto a aba está aberta.
- **Preços continuam oficiais.** Quem grava `prices_latest` é a Edge Function (service role) ou a
  Action — nunca o navegador do usuário. A RLS não dá escrita de preço a ninguém logado.
- **Se o gateway cair**, o app usa o último preço oficial do banco e avisa na tela. Nada quebra.

## Regras do jogo (integridade)

- **Capital inicial fixo em R$ 1.000.000, imutável.** A tabela `config` não aceita escrita via app;
  o motor de replay usa esse capital como gênese.
- **Histórico imutável.** `transactions` é append-only — não há policy de UPDATE nem DELETE.
- **Nenhuma posição some do patrimônio.** Sem cotação disponível, a posição é avaliada **pelo custo**
  e marcada como “a custo” na tela. O dinheiro nunca desaparece do total.
- **Dólar real e momentâneo.** Ativos em USD são convertidos pela cotação do momento da operação.
- **Renda fixa:** Tesouro Direto marca pelo PU oficial; sem MtM, cresce **linearmente** do PU de
  compra até o valor de vencimento.

---

## Papéis e privilégios — como dar permissão a alguém

Três papéis, e a diferença prática é uma só: **quem pode operar a carteira**.

| Papel | Vê a carteira | Compra e vende | Gerencia papéis |
|---|:---:|:---:|:---:|
| **Membro** | ✅ | ❌ | ❌ |
| **Gestor** | ✅ | ✅ | ❌ |
| **Admin** | ✅ | ✅ | ✅ |

**O dia a dia:** quem entra pela primeira vez vira **Membro** automaticamente. Para promover
alguém, abra a aba **Admin** (só aparece para admins), ache a pessoa na tabela **Membros** e troque
o papel no seletor. Pronto — vale na hora, sem a pessoa precisar sair e entrar de novo, porque a
mudança se propaga pelo Realtime.

**O primeiro admin é a exceção.** Ninguém consegue se autopromover (é uma trava de segurança da
RLS), então o primeiro admin nasce direto no banco. No Supabase, **SQL Editor → New query**, troque
o e-mail e rode:

```sql
insert into public.membros (user_id, papel)
select id, 'admin' from auth.users where email = 'SEU-EMAIL@exemplo.com'
on conflict (user_id) do update set papel = 'admin';
```

Desse ponto em diante tudo é pela interface. O mesmo texto está dentro do app, na aba **Admin**.

> **A permissão vive no banco, não na tela.** A policy de INSERT em `transactions`
> (`supabase/schema.sql`) só aceita a gravação se quem chama for `gestor` ou `admin`. Esconder o
> botão é conveniência; a garantia é o Postgres recusar.

---

## Setup (uma vez)

### 1. Supabase — banco e autenticação

1. Crie um projeto em [supabase.com](https://supabase.com).
2. **SQL Editor → New query**, cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e
   rode. Cria as tabelas, ativa a RLS, semeia a `config` (capital R$ 1M) e liga o Realtime. O
   script é **idempotente** — pode rodar de novo com segurança, inclusive para atualizar um banco
   que já existe.
3. **Authentication → Providers → Email:** deixe habilitado. Em **Sign In / Providers**, **desligue**
   “Allow new users to sign up” — o acesso é só por convite.
4. **Convide os membros:** *Authentication → Users → Add user*. Não precisa preencher nome: no
   primeiro acesso o app pede que a própria pessoa cadastre o nome dela, e é esse nome — não o
   e-mail — que aparece no ranking, nos campeões da semana e nas comparações.
5. **Crie o primeiro admin** com o SQL da seção acima.
6. Pegue as chaves em **Project Settings → API**: `Project URL`, `anon public` e `service_role`.

### 2. Edge Function `cotacoes` — o gateway de preços

É o que faz o app ter preço ao vivo. Sem ela o app **ainda funciona**, mas depende do cron de hora
em hora e mostra um aviso.

**Pelo painel (sem instalar nada):** **Edge Functions → Deploy a new function**, nome `cotacoes`,
cole o conteúdo de [`supabase/functions/cotacoes/index.ts`](supabase/functions/cotacoes/index.ts) e
publique. O arquivo é autocontido de propósito.

**Ou pelo CLI:**
```bash
npx supabase link --project-ref SEU-PROJECT-REF
npx supabase functions deploy cotacoes
```

Não precisa configurar segredo nenhum: `SUPABASE_URL`, `SUPABASE_ANON_KEY` e
`SUPABASE_SERVICE_ROLE_KEY` já são injetadas pelo Supabase.

### 3. GitHub Pages + Actions

1. **Settings → Pages → Source = GitHub Actions.**
2. **Settings → Secrets and variables → Actions → New secret:**
   - `SUPABASE_URL` — a Project URL
   - `SUPABASE_ANON_KEY` — a chave `anon public` (usada no build do site)
   - `SUPABASE_SERVICE_ROLE_KEY` — a chave `service_role` (só nas Actions)
   - `BRAPI_TOKEN` — **opcional**; se existir, a Brapi PRO é usada para refinar o histórico da B3.
     Sem ele tudo funciona pelo Yahoo.
3. Push no `main` publica o site. O cron de **preços** roda dias úteis de hora em hora (rede de
   segurança), e o de **série histórica** 1×/dia após o fechamento.

### 4. Série histórica (gráficos de evolução)

Os gráficos de evolução e a comparação com IBOV/CDI vêm da tabela `prices_history`. Para
preenchê-la agora, entre como admin e clique em **Admin → Série histórica → Gerar série histórica
agora** — busca ~2 anos de fechamentos, do dólar e dos índices em alguns segundos. Depois disso a
Action diária mantém a série crescendo (o upsert **nunca apaga**, então “Tudo/desde o início”
continua correto anos depois).

---

## Uso

- **Visão geral:** patrimônio total, variação do dia, retorno desde o início, caixa, investido e
  P&L. Gráfico de **evolução do patrimônio** (R$) ou de **rentabilidade acumulada** (%) contra os
  índices, com seletor de período. Maiores posições e alocação por classe.
- **Operar** (só gestor/admin):
  - *Comprar* — digite o ticker; bolsa, moeda, tipo e nome são detectados sozinhos e o **preço de
    mercado já vem preenchido**, editável. O app mostra custo total e caixa restante antes de você
    confirmar.
  - *Vender* — escolha a posição; o preço vem cotado (com botão de recotar) e é editável.
  - *Renda fixa* — Tesouro Direto (PU oficial) ou título genérico (vencimento + valor no vencimento).
- **Posições:** preço médio, preço atual, variação do dia, P&L e peso com barra. Posições sem
  cotação aparecem marcadas **a custo**.
- **Alocação:** distribuição por classe, bolsa e moeda em barra empilhada + tabela.
- **Relatório:** análise por período (este mês, 3m, 12m, tudo ou personalizado), rentabilidade
  contra os índices, retorno mês a mês, **Imprimir/PDF**, **baixar HTML** e **salvar snapshot**.
- **Histórico:** todas as operações, imutáveis, com autor e horário.
- **Admin** (só admin): papéis dos membros e geração da série histórica.

## Desenvolvimento local

```bash
cp .env.example .env.local   # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run dev            # http://localhost:5173/CarteiraFinance/
npm test               # testes do motor (Vitest)
npm run build          # typecheck + build de produção

# Rodar a Edge Function localmente:
npx supabase functions serve cotacoes

# O que as Actions executam:
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run fetch-prices
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run fetch-history   # BRAPI_TOKEN é opcional
```

## Estrutura

```
supabase/schema.sql              # tabelas + RLS + seed + realtime + papéis (rode no SQL Editor)
supabase/functions/cotacoes/     # Edge Function: cotação ao vivo, busca de ticker, série histórica
src/
  engine/                        # motor puro e testado: ledger, fx, bonds, portfolio, evolucao, report
  data/                          # supabase (client), session (auth), supabaseClient, cotacoes, precoProvider
  ui/                            # Shell + Dashboard, Operar, Posições, Alocação, Relatório, Histórico, Admin
  theme/tokens.css               # design system (marca + paleta de gráficos validada p/ daltonismo)
scripts/fetch-prices.ts          # cron de preços -> prices_latest
scripts/fetch-history.ts         # cron da série diária -> prices_history (Yahoo primário)
.github/workflows/               # prices.yml, history.yml, deploy.yml
```

### Multi-carteira (dormente)

O banco suporta **carteiras pessoais** por membro (tabelas `wallets`, `transactions.carteira_id`, a
RPC `fork_carteira_pessoal` e as policies por carteira), e o motor de ranking segue testado em
`src/engine/comparacao.ts`. A interface foi simplificada para tratar só a **carteira da liga** —
reativar é escrever a UI de novo, sem nenhuma migração de banco.

## Continuidade — a carteira não depende de nenhuma pessoa

Como a liga permanece por muito tempo e os membros entram e saem, nada deve ficar atrelado a uma
conta pessoal. Use uma **organização** do Supabase (ou uma conta dedicada da liga) como dona do
projeto, com mais de um administrador. Ao trocar o responsável, você repassa o acesso ao projeto
Supabase e ao repositório — nenhum código muda; a URL, os dados e o histórico continuam.
