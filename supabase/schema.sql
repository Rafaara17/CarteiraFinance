-- CarteiraFinance — schema do banco (Postgres/Supabase).
-- Rode isto UMA vez no SQL Editor do seu projeto Supabase (roda como superusuário,
-- então ignora a RLS e consegue semear a config).
--
-- Modelo: o "banco na nuvem" substitui o antigo "repositório-como-banco".
--  - config        : 1 linha imutável (capital inicial fixo).
--  - assets        : registro de ativos (cresce sob demanda ao operar).
--  - transactions  : ledger append-only (sem UPDATE/DELETE — integridade).
--  - prices_latest : 1 linha com o snapshot oficial de preços (só a Action escreve).
--  - reports       : snapshots do relatório (opcional).
--
-- Segurança ("acesso correto e específico"): RLS ligada em tudo. Só quem está
-- AUTENTICADO lê/escreve; visitante anônimo não enxerga nada. A chave anon do
-- frontend é pública de propósito — a proteção é a RLS abaixo.

-- ---------------------------------------------------------------------------
-- config (imutável): só SELECT para autenticados; nenhum INSERT/UPDATE/DELETE.
-- ---------------------------------------------------------------------------
create table if not exists public.config (
  id             int primary key default 1 check (id = 1),
  nome_liga      text        not null,
  capital_inicial numeric    not null,
  moeda_base     text        not null,
  data_inicio    date        not null,
  benchmarks     jsonb       not null default '{}'::jsonb
);

alter table public.config enable row level security;

drop policy if exists config_select on public.config;
create policy config_select on public.config
  for select to authenticated using (true);
-- (sem policy de escrita => escrita negada para anon/authenticated; só service role)

-- Seed com os valores do antigo data/config.json (capital fixo em R$ 1.000.000).
insert into public.config (id, nome_liga, capital_inicial, moeda_base, data_inicio, benchmarks)
values (1, 'Carteira da Liga', 1000000, 'BRL', '2026-01-01',
        '{"BRL":"IBOV","USD":"S&P500"}'::jsonb)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- assets: leitura + upsert para autenticados.
-- ---------------------------------------------------------------------------
create table if not exists public.assets (
  ticker text primary key,
  tipo   text not null,
  bolsa  text not null,
  moeda  text not null,
  nome   text not null,
  bond   jsonb
);

alter table public.assets enable row level security;

drop policy if exists assets_select on public.assets;
create policy assets_select on public.assets
  for select to authenticated using (true);

drop policy if exists assets_insert on public.assets;
create policy assets_insert on public.assets
  for insert to authenticated with check (true);

drop policy if exists assets_update on public.assets;
create policy assets_update on public.assets
  for update to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- transactions: ledger append-only. SELECT + INSERT para autenticados;
-- sem UPDATE/DELETE => histórico imutável (equivale ao append-only antigo).
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
  id      uuid primary key default gen_random_uuid(),
  ts      timestamptz not null default now(),
  tipo    text not null check (tipo in ('compra','venda','provento','cupom')),
  membro  text not null,
  ticker  text not null,
  qtd     numeric,
  preco   numeric,
  moeda   text not null,
  fx      numeric not null default 1,
  taxa    numeric,
  valor   numeric,
  user_id uuid not null default auth.uid()
);

create index if not exists transactions_ts_idx on public.transactions (ts);

alter table public.transactions enable row level security;

drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions
  for select to authenticated using (true);

-- Só permite inserir em nome de si mesmo; sem policy de update/delete => imutável.
drop policy if exists transactions_insert on public.transactions;
create policy transactions_insert on public.transactions
  for insert to authenticated with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- prices_latest: 1 linha. SELECT para autenticados; ESCRITA só via service role
-- (a GitHub Action) => "preços sempre oficiais".
-- ---------------------------------------------------------------------------
create table if not exists public.prices_latest (
  id            int primary key default 1 check (id = 1),
  atualizado_em timestamptz,
  fonte         text,
  cambio        jsonb not null default '{"BRL":1}'::jsonb,
  acoes         jsonb not null default '{}'::jsonb,
  tesouro       jsonb not null default '{}'::jsonb
);

alter table public.prices_latest enable row level security;

drop policy if exists prices_select on public.prices_latest;
create policy prices_select on public.prices_latest
  for select to authenticated using (true);
-- (sem policy de escrita => só service role escreve)

-- Linha inicial vazia (a Action faz upsert sobre ela).
insert into public.prices_latest (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- reports: snapshots do relatório (SELECT + INSERT para autenticados).
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id        uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  membro    text not null,
  html      text not null,
  user_id   uuid not null default auth.uid()
);

alter table public.reports enable row level security;

drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports
  for select to authenticated using (true);

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert to authenticated with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- prices_history: série histórica diária (uma linha por dia de pregão) usada
-- para reconstruir a EVOLUÇÃO do patrimônio e a rentabilidade por período nos
-- relatórios. SELECT para autenticados; ESCRITA só via service role (a Action
-- de histórico, que busca com o token Brapi PRO) => mesma garantia de
-- "dados sempre oficiais" do prices_latest.
--
--   acoes   : { ticker -> preço de fechamento na moeda do ativo }
--   cambio  : { moeda  -> câmbio para BRL } (ex.: { "USD": 5.43 })
--   indices : { chave  -> nível acumulado do índice } (IBOV, SP500, CDI, IPCA)
-- ---------------------------------------------------------------------------
create table if not exists public.prices_history (
  data    date primary key,
  acoes   jsonb not null default '{}'::jsonb,
  cambio  jsonb not null default '{}'::jsonb,
  indices jsonb not null default '{}'::jsonb
);

alter table public.prices_history enable row level security;

drop policy if exists prices_history_select on public.prices_history;
create policy prices_history_select on public.prices_history
  for select to authenticated using (true);
-- (sem policy de escrita => só service role escreve)

-- ---------------------------------------------------------------------------
-- Realtime: publica mudanças para o app sincronizar entre máquinas ao vivo.
-- (idempotente: só adiciona à publicação se ainda não estiver lá)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['transactions','assets','prices_latest'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
