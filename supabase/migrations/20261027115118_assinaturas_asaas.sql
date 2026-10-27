create table if not exists public.assinaturas (
  id uuid primary key default gen_random_uuid(),
  sindico_id uuid references public.perfis(id) on delete set null,
  nome text not null,
  email text not null,
  cpf_cnpj text not null,
  telefone text not null default '',
  asaas_customer_id text,
  asaas_subscription_id text unique,
  status text not null default 'pendente' check (status in ('pendente','ativa','atrasada','cancelada')),
  valor numeric(10,2) not null default 349.00,
  atraso_desde date,
  link_pagamento text,
  ultimo_pagamento_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists assinaturas_sindico_idx on public.assinaturas(sindico_id);
create index if not exists assinaturas_email_idx on public.assinaturas(lower(email));
alter table public.assinaturas enable row level security;
create policy "assinatura propria - ler" on public.assinaturas for select to authenticated using ((select auth.uid()) = sindico_id);
create policy "admin - le assinaturas" on public.assinaturas for select to authenticated using ((select privado.eh_admin()));

create table if not exists public.asaas_eventos (
  id text primary key,
  evento text not null,
  recebido_em timestamptz not null default now(),
  payload jsonb not null
);
alter table public.asaas_eventos enable row level security;

create or replace function privado.tocar_atualizado_em() returns trigger language plpgsql set search_path = '' as $$
begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists assinaturas_atualizado on public.assinaturas;
create trigger assinaturas_atualizado before update on public.assinaturas for each row execute function privado.tocar_atualizado_em();
