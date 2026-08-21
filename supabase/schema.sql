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

-- Fechamento anterior por ticker (e por moeda) — é o que permite mostrar a
-- VARIAÇÃO DO DIA de cada posição, não só o preço absoluto.
alter table public.prices_latest
  add column if not exists fechamento_anterior jsonb not null default '{}'::jsonb;

-- Símbolo do ativo no Yahoo (ex.: PETR4 -> "PETR4.SA"). Cacheado na 1ª cotação
-- bem-sucedida para nunca mais precisarmos adivinhar bolsa/sufixo.
alter table public.assets
  add column if not exists yahoo_symbol text;

-- ---------------------------------------------------------------------------
-- merge_prices_latest: MESCLA (não substitui) o snapshot de preços.
--
-- Usada pela Edge Function `cotacoes`, que cota só os tickers pedidos. Com
-- `jsonb ||` a operação é atômica: dois membros abrindo o app ao mesmo tempo não
-- se atropelam, e o que o cron gravou (em especial `tesouro`) fica intacto.
--
-- NÃO recebe grant para `authenticated` — só a service role (a Edge Function e
-- as Actions) executa. A garantia de "preço sempre oficial" continua de pé.
-- ---------------------------------------------------------------------------
create or replace function public.merge_prices_latest(
  p_acoes      jsonb default '{}'::jsonb,
  p_cambio     jsonb default '{}'::jsonb,
  p_fechamento jsonb default '{}'::jsonb,
  p_fonte      text  default 'yahoo finance (ao vivo)'
) returns void language sql security definer set search_path = public as $$
  update public.prices_latest
     set acoes               = acoes || coalesce(p_acoes, '{}'::jsonb),
         cambio              = cambio || coalesce(p_cambio, '{}'::jsonb),
         fechamento_anterior = fechamento_anterior || coalesce(p_fechamento, '{}'::jsonb),
         atualizado_em       = now(),
         fonte               = p_fonte
   where id = 1;
$$;

-- Tira o grant automático para PUBLIC e devolve execução SÓ para a service role
-- (Edge Function e GitHub Actions). Membro logado não consegue chamar.
revoke execute on function public.merge_prices_latest(jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant  execute on function public.merge_prices_latest(jsonb, jsonb, jsonb, text) to service_role;

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

-- ===========================================================================
-- PRIVILÉGIOS + CARTEIRAS (carteira central da liga + carteiras pessoais)
-- ---------------------------------------------------------------------------
-- Modelo:
--  - wallets  : as carteiras. Uma 'liga' (central, id fixo) + uma 'pessoal' por
--               membro (dono = user_id).
--  - membros  : papel de cada usuário ('admin' | 'gestor' | 'membro').
--  - transactions.carteira_id: a qual carteira cada operação pertence.
--
-- Regra de permissão (o "sistema de privilégios"):
--  - Só quem tem papel 'gestor' ou 'admin' OPERA (insere transações) na carteira
--    da LIGA. Todos continuam LENDO tudo (posições, alocação, rentabilidade).
--  - Cada membro OPERA livremente só na SUA carteira pessoal.
--  - Carteiras pessoais são visíveis a todos (habilita o ranking).
-- Tudo é forçado pela RLS abaixo — o frontend só reflete o que o banco garante.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- wallets: catálogo de carteiras. Criação de carteira pessoal só via a RPC
-- fork_carteira_pessoal (security definer); não há policy de escrita direta.
-- ---------------------------------------------------------------------------
create table if not exists public.wallets (
  id       uuid primary key default gen_random_uuid(),
  tipo     text not null check (tipo in ('liga','pessoal')),
  dono     uuid references auth.users(id) on delete cascade,
  nome     text not null,
  criada_em timestamptz not null default now()
);

-- No máximo UMA carteira da liga; no máximo UMA carteira pessoal por dono.
create unique index if not exists wallets_uma_liga  on public.wallets (tipo) where tipo = 'liga';
create unique index if not exists wallets_dono_unico on public.wallets (dono) where tipo = 'pessoal';

-- A carteira da liga tem id FIXO (referenciado pela migração e pelo default).
insert into public.wallets (id, tipo, dono, nome)
values ('00000000-0000-0000-0000-000000000001', 'liga', null, 'Carteira da Liga')
on conflict (id) do nothing;

alter table public.wallets enable row level security;

drop policy if exists wallets_select on public.wallets;
create policy wallets_select on public.wallets
  for select to authenticated using (true);
-- (sem policy de insert/update/delete => só a RPC fork_carteira_pessoal cria)

-- ---------------------------------------------------------------------------
-- membros: papel de cada usuário. Um usuário só se registra a si mesmo como
-- 'membro'; a promoção para 'gestor'/'admin' é exclusiva de um 'admin'.
-- ---------------------------------------------------------------------------
create table if not exists public.membros (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  nome      text,
  papel     text not null default 'membro' check (papel in ('admin','gestor','membro')),
  criado_em timestamptz not null default now()
);

-- `nome` é NULO até a pessoa escolher o próprio nome no primeiro acesso — é esse
-- nulo que o app usa para saber que ainda precisa pedir o cadastro. Bancos
-- criados antes desta mudança têm a coluna NOT NULL preenchida com o e-mail.
alter table public.membros alter column nome drop not null;
update public.membros set nome = null where nome like '%@%';

alter table public.membros enable row level security;

-- ---------------------------------------------------------------------------
-- Funções de papel (SECURITY DEFINER: leem membros sem recursão de RLS e
-- escondem a lógica). STABLE + search_path fixo por segurança. Definidas ANTES
-- das policies que as referenciam (funções `sql` validam o corpo na criação,
-- então wallets/membros já precisam existir aqui).
-- ---------------------------------------------------------------------------
create or replace function public.meu_papel()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select papel from public.membros where user_id = auth.uid()), 'membro');
$$;

create or replace function public.pode_gerir_liga()
returns boolean language sql stable security definer set search_path = public as $$
  select public.meu_papel() in ('gestor','admin');
$$;

create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.meu_papel() = 'admin';
$$;

-- Pode inserir na carteira cid? Liga => precisa ser gestor/admin; pessoal => ser o dono.
create or replace function public.pode_operar_carteira(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.wallets w
    where w.id = cid
      and ( (w.tipo = 'liga'    and public.pode_gerir_liga())
         or (w.tipo = 'pessoal' and w.dono = auth.uid()) )
  );
$$;

grant execute on function public.meu_papel()               to authenticated;
grant execute on function public.pode_gerir_liga()         to authenticated;
grant execute on function public.eh_admin()                to authenticated;
grant execute on function public.pode_operar_carteira(uuid) to authenticated;

-- Policies de membros (agora que eh_admin() já existe).
drop policy if exists membros_select on public.membros;
create policy membros_select on public.membros
  for select to authenticated using (true);

-- Auto-registro: só a própria linha e só como 'membro' (não dá para se autopromover).
drop policy if exists membros_insert on public.membros;
create policy membros_insert on public.membros
  for insert to authenticated
  with check (user_id = auth.uid() and papel = 'membro');

-- Promoção/rebaixamento e edição de nome: só admin.
drop policy if exists membros_update on public.membros;
create policy membros_update on public.membros
  for update to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- ---------------------------------------------------------------------------
-- RPC: cada pessoa cadastra o PRÓPRIO nome (é ele que aparece no ranking e nas
-- comparações, no lugar do e-mail). Vai por função porque a policy de UPDATE
-- acima é exclusiva de admin — abrir um UPDATE direto para o próprio usuário
-- abriria junto a coluna `papel`, e alguém poderia se autopromover. Aqui só o
-- `nome` é tocado, então a trava continua de pé.
-- ---------------------------------------------------------------------------
create or replace function public.definir_meu_nome(p_nome text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_nome text := nullif(btrim(p_nome), '');
begin
  if v_uid is null then
    raise exception 'não autenticado';
  end if;
  if v_nome is null then
    raise exception 'o nome não pode ficar em branco';
  end if;

  insert into public.membros (user_id, nome) values (v_uid, v_nome)
  on conflict (user_id) do update set nome = excluded.nome;

  -- A carteira pessoal herda o nome no fork; mantém o rótulo dela coerente.
  update public.wallets set nome = v_nome where tipo = 'pessoal' and dono = v_uid;
end;
$$;

grant execute on function public.definir_meu_nome(text) to authenticated;

-- ---------------------------------------------------------------------------
-- transactions.carteira_id: a qual carteira cada operação pertence.
-- Migração: tudo que já existe é da liga (id fixo). Depois vira NOT NULL com
-- default = liga (compat com qualquer código que ainda não passe carteira_id).
-- ---------------------------------------------------------------------------
alter table public.transactions
  add column if not exists carteira_id uuid references public.wallets(id);

update public.transactions
  set carteira_id = '00000000-0000-0000-0000-000000000001'
  where carteira_id is null;

alter table public.transactions
  alter column carteira_id set default '00000000-0000-0000-0000-000000000001';
alter table public.transactions
  alter column carteira_id set not null;

create index if not exists transactions_carteira_idx on public.transactions (carteira_id);

-- CORAÇÃO DA PERMISSÃO: só insere se for dono da carteira pessoal OU gestor/admin
-- na carteira da liga. (SELECT continua liberado para todos => ranking.)
drop policy if exists transactions_insert on public.transactions;
create policy transactions_insert on public.transactions
  for insert to authenticated
  with check (user_id = auth.uid() and public.pode_operar_carteira(carteira_id));

-- ---------------------------------------------------------------------------
-- RPC: criar a carteira pessoal do membro. Idempotente: se já existe, devolve o
-- id (e o p_copiar é ignorado). SECURITY DEFINER para criar a wallet e copiar o
-- ledger da liga numa transação só.
--
--   p_copiar = true  => nasce como CÓPIA da carteira da liga no momento da
--                       ativação; o membro diverge a partir dali.
--   p_copiar = false => nasce vazia. Sem ledger, o replay do motor devolve o
--                       capital inicial todo em caixa — nenhuma transação de
--                       aporte é criada (o capital é fixo e vem do config).
-- ---------------------------------------------------------------------------
-- create or replace não troca a assinatura de uma função: dropar a versão sem
-- argumentos primeiro (idempotente, o schema é re-executável).
drop function if exists public.fork_carteira_pessoal();
create or replace function public.fork_carteira_pessoal(p_copiar boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_wid  uuid;
  v_nome text;
begin
  if v_uid is null then
    raise exception 'não autenticado';
  end if;

  select id into v_wid from public.wallets where tipo = 'pessoal' and dono = v_uid;
  if v_wid is not null then
    return v_wid; -- já ativada
  end if;

  select nome into v_nome from public.membros where user_id = v_uid;

  insert into public.wallets (tipo, dono, nome)
  values ('pessoal', v_uid, coalesce(v_nome, 'Minha carteira'))
  returning id into v_wid;

  if p_copiar then
    -- Fork: copia o ledger da liga como ponto de partida (ids novos por default).
    insert into public.transactions
      (ts, tipo, membro, ticker, qtd, preco, moeda, fx, taxa, valor, user_id, carteira_id)
    select t.ts, t.tipo, t.membro, t.ticker, t.qtd, t.preco, t.moeda, t.fx, t.taxa, t.valor, v_uid, v_wid
    from public.transactions t
    join public.wallets w on w.id = t.carteira_id
    where w.tipo = 'liga'
    order by t.ts;
  end if;

  return v_wid;
end;
$$;

grant execute on function public.fork_carteira_pessoal(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime para as novas tabelas (papéis e carteiras aparecem ao vivo).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['wallets','membros'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ===========================================================================
-- CATÁLOGO OFICIAL DO TESOURO DIRETO
-- ---------------------------------------------------------------------------
-- Espelho da lista de títulos ofertados, alimentado pela Action de preços
-- (scripts/fetch-prices.ts, via brapi -> Tesouro Transparente).
--
-- POR QUE UMA TABELA, e não só o jsonb `prices_latest.tesouro`:
--
--  1. OVO E GALINHA. O formulário de compra listava os títulos a partir das
--     chaves de `prices_latest.tesouro`, que só era preenchido para títulos JÁ
--     presentes em `assets`. Ninguém conseguia escolher um título oficial antes
--     de já ter um — então ninguém tinha nenhum. Aqui o catálogo existe
--     independente da carteira.
--  2. O catálogo tem mais do que um preço: vencimento, indexador, as duas taxas
--     e o investimento mínimo. É isso que permite a tela de consulta (o
--     "site do Tesouro" dentro do app) e o preenchimento automático na compra.
--
-- `slug` é a chave estável da fonte ("tesouro-ipca-2035-15052035"): sobrevive a
-- uma renomeação do produto, o que o nome não faz.
--
-- ATENÇÃO: os PUs são de UM DIA ÚTIL (o Tesouro Transparente publica 1x/dia).
-- Não existe PU intradiário; `atualizado_em` é quando NÓS lemos, não quando o
-- Tesouro apurou.
--
-- SELECT para autenticados; ESCRITA só via service role => mesma garantia de
-- "dados sempre oficiais" de prices_latest.
-- ---------------------------------------------------------------------------
create table if not exists public.tesouro_titulos (
  slug                text primary key,
  nome                text not null,
  indexador           text,
  vencimento          date not null,
  pu_compra           numeric,
  pu_venda            numeric,  -- base da marcação a mercado de quem já tem o título
  taxa_compra         numeric,  -- % a.a.
  taxa_venda          numeric,
  investimento_minimo numeric,
  negociavel          boolean not null default true,
  atualizado_em       timestamptz not null default now()
);

alter table public.tesouro_titulos enable row level security;

drop policy if exists tesouro_titulos_select on public.tesouro_titulos;
create policy tesouro_titulos_select on public.tesouro_titulos
  for select to authenticated using (true);
-- (sem policy de escrita => só service role escreve)

-- data_base: a data A QUE OS PREÇOS SE REFEREM (a "Data Base" do arquivo do
-- Tesouro Transparente). Não é a mesma coisa que `atualizado_em`: esta diz que a
-- rotina rodou, aquela diz de quando é o preço. Numa marcação diária é a data_base
-- que denuncia dado velho — sem ela, uma semana de rotina quebrada passaria batida,
-- porque a tela seguiria mostrando um PU com cara de atual.
alter table public.tesouro_titulos
  add column if not exists data_base date;

create index if not exists tesouro_titulos_vencimento_idx
  on public.tesouro_titulos (vencimento);

-- Fora do Realtime de propósito: o catálogo muda uma vez por dia e a Action grava
-- dezenas de linhas de uma vez. Assinar isso viraria uma enxurrada de eventos para
-- recarregar dado que não mudou. A tela do Tesouro busca sob demanda e tem botão
-- de atualizar.

-- ===========================================================================
-- REINÍCIO DAS CARTEIRAS INDIVIDUAIS (exclusivo do admin)
-- ---------------------------------------------------------------------------
-- O ledger é append-only de propósito: `transactions` não tem policy de UPDATE
-- nem de DELETE, então ninguém apaga a própria operação depois de registrada —
-- é isso que faz o ranking valer alguma coisa.
--
-- Recomeçar a temporada é outra coisa: zerar as carteiras individuais de uma vez
-- precisa ser um ATO ADMINISTRATIVO EXPLÍCITO, não um buraco na regra. Daí o
-- desenho:
--   - a exceção mora numa única função SECURITY DEFINER (a única porta que apaga);
--   - a porta confere `eh_admin()` a cada chamada;
--   - toda passagem fica registrada em `carteiras_reinicios` (quem, quando,
--     quanto) — a integridade que se abre mão no ledger volta como auditoria.
--
-- A carteira da LIGA nunca é tocada aqui: ela é o histórico oficial da liga.
-- ===========================================================================

create table if not exists public.carteiras_reinicios (
  id           uuid primary key default gen_random_uuid(),
  executado_em timestamptz not null default now(),
  executor     uuid references auth.users(id),
  -- 'todas' | 'uma' — o recorte pedido, não o resultado (0 carteiras é um fato
  -- que também merece registro: mostra que a tentativa aconteceu).
  escopo       text not null check (escopo in ('todas','uma')),
  dono         uuid,    -- preenchido só quando o reinício foi de uma pessoa
  manteve      boolean not null, -- true = zerou o ledger sem apagar a carteira
  carteiras    int not null,
  operacoes    int not null
);

alter table public.carteiras_reinicios enable row level security;

drop policy if exists carteiras_reinicios_select on public.carteiras_reinicios;
create policy carteiras_reinicios_select on public.carteiras_reinicios
  for select to authenticated using (true);
-- (sem policy de escrita => só a RPC abaixo grava; ninguém apaga o registro)

-- ---------------------------------------------------------------------------
-- reiniciar_carteiras_pessoais: apaga o ledger das carteiras individuais.
--
--   p_manter_carteiras = false (padrão)
--       Apaga também as carteiras. Cada membro volta à tela de ativação e
--       reescolhe entre copiar a liga e começar do zero. É o reinício "de
--       temporada": a `criada_em` nova impede que a carteira apareça vencendo
--       períodos anteriores à recriação.
--   p_manter_carteiras = true
--       Mantém a carteira e só zera o ledger — o replay do motor devolve o
--       capital inicial todo em caixa. A `criada_em` antiga permanece, então a
--       carteira segue disputando períodos desde a ativação original.
--
--   p_dono = null (padrão) => todas as carteiras individuais.
--   p_dono = <user_id>     => só a carteira daquela pessoa (redo individual).
--
-- Devolve {"carteiras": n, "operacoes": m} — o que foi de fato apagado.
-- ---------------------------------------------------------------------------
create or replace function public.reiniciar_carteiras_pessoais(
  p_manter_carteiras boolean default false,
  p_dono             uuid    default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ids   uuid[];
  v_carts int;
  v_ops   int := 0;
begin
  if not public.eh_admin() then
    raise exception 'só um admin reinicia as carteiras individuais';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[]) into v_ids
  from public.wallets
  where tipo = 'pessoal' and (p_dono is null or dono = p_dono);

  v_carts := cardinality(v_ids);

  if v_carts > 0 then
    with apagadas as (
      delete from public.transactions where carteira_id = any(v_ids) returning 1
    )
    select count(*)::int into v_ops from apagadas;

    if not coalesce(p_manter_carteiras, false) then
      -- Depois do ledger: transactions.carteira_id referencia wallets(id) sem
      -- cascade, então a ordem inversa esbarraria na FK.
      delete from public.wallets where id = any(v_ids);
    end if;
  end if;

  insert into public.carteiras_reinicios
    (executor, escopo, dono, manteve, carteiras, operacoes)
  values
    (auth.uid(),
     case when p_dono is null then 'todas' else 'uma' end,
     p_dono,
     coalesce(p_manter_carteiras, false),
     v_carts, v_ops);

  return jsonb_build_object('carteiras', v_carts, 'operacoes', v_ops);
end;
$$;

-- A checagem de admin é DENTRO da função; o grant é para `authenticated` porque
-- é o app logado que chama. Quem não é admin recebe a exceção, não o dado.
revoke execute on function public.reiniciar_carteiras_pessoais(boolean, uuid) from public, anon;
grant  execute on function public.reiniciar_carteiras_pessoais(boolean, uuid) to authenticated;
