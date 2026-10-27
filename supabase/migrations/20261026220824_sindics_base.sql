-- Perfis dos síndicos (1 para 1 com auth.users)
create table public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  assinatura text not null default '',
  empresa text not null default '',
  papel text not null default 'sindico' check (papel in ('sindico','admin')),
  ativo boolean not null default false,          -- só o administrador ativa
  plano text not null default 'piloto',
  limite_sessoes_mes integer not null default 200,
  criado_em timestamptz not null default now()
);

-- Condomínios de cada síndico
create table public.condominios (
  id uuid primary key default gen_random_uuid(),
  sindico_id uuid not null references public.perfis(id) on delete cascade,
  nome text not null,
  cidade text not null default '',
  unidades integer,
  documentos text not null default '',
  kb_doc_ids text[] not null default '{}',       -- documentos na base da ElevenLabs
  criado_em timestamptz not null default now()
);
create index condominios_sindico_idx on public.condominios(sindico_id);

-- Registro de sessões de conversa (uso)
create table public.sessoes (
  id uuid primary key default gen_random_uuid(),
  sindico_id uuid not null references public.perfis(id) on delete cascade,
  iniciada_em timestamptz not null default now()
);
create index sessoes_sindico_mes_idx on public.sessoes(sindico_id, iniciada_em);

-- Segurança por linha: cada síndico lê apenas os próprios dados; escrita só pelo servidor
alter table public.perfis enable row level security;
alter table public.condominios enable row level security;
alter table public.sessoes enable row level security;

create policy "perfil proprio - leitura" on public.perfis
  for select to authenticated using ((select auth.uid()) = id);
create policy "condominios proprios - leitura" on public.condominios
  for select to authenticated using ((select auth.uid()) = sindico_id);
create policy "sessoes proprias - leitura" on public.sessoes
  for select to authenticated using ((select auth.uid()) = sindico_id);

-- Cria o perfil (inativo) automaticamente quando uma conta é criada
create or replace function public.criar_perfil_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfis (id, nome)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)));
  return new;
end;
$$;
revoke execute on function public.criar_perfil_novo_usuario() from public, anon, authenticated;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil_novo_usuario();
