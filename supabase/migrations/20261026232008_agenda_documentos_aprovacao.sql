-- E-mail no perfil (para alertas e para o admin identificar cadastros)
alter table public.perfis add column if not exists email text not null default '';
update public.perfis p set email = u.email from auth.users u where u.id = p.id and p.email = '';

create or replace function public.criar_perfil_novo_usuario()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfis (id, nome, email)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
          coalesce(new.email, ''));
  return new;
end; $$;
revoke execute on function public.criar_perfil_novo_usuario() from public, anon, authenticated;

-- Quem é administrador (usado nas regras de segurança)
create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfis where id = (select auth.uid()) and papel = 'admin' and ativo);
$$;
revoke execute on function public.eh_admin() from public, anon;
grant execute on function public.eh_admin() to authenticated;

-- Admin vê e aprova síndicos
create policy "admin - le todos os perfis" on public.perfis
  for select to authenticated using ((select public.eh_admin()));
create policy "admin - atualiza perfis" on public.perfis
  for update to authenticated using ((select public.eh_admin())) with check ((select public.eh_admin()));
create policy "admin - le todos os condominios" on public.condominios
  for select to authenticated using ((select public.eh_admin()));

-- Agenda
create table public.compromissos (
  id uuid primary key default gen_random_uuid(),
  sindico_id uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  condominio_id uuid references public.condominios(id) on delete set null,
  titulo text not null,
  inicio timestamptz not null,
  fim timestamptz,
  local text not null default '',
  observacoes text not null default '',
  status text not null default 'agendado' check (status in ('agendado','concluido','cancelado')),
  criado_em timestamptz not null default now()
);
create index compromissos_sindico_inicio_idx on public.compromissos(sindico_id, inicio);
alter table public.compromissos enable row level security;
create policy "compromissos proprios - ler" on public.compromissos for select to authenticated using ((select auth.uid()) = sindico_id);
create policy "compromissos proprios - criar" on public.compromissos for insert to authenticated with check ((select auth.uid()) = sindico_id);
create policy "compromissos proprios - alterar" on public.compromissos for update to authenticated using ((select auth.uid()) = sindico_id) with check ((select auth.uid()) = sindico_id);
create policy "compromissos proprios - apagar" on public.compromissos for delete to authenticated using ((select auth.uid()) = sindico_id);

-- Documentação legal
create table public.documentos_legais (
  id uuid primary key default gen_random_uuid(),
  sindico_id uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  condominio_id uuid references public.condominios(id) on delete cascade,
  documento text not null,
  data_renovacao date,
  data_vencimento date not null,
  alertar_dias_antes integer not null default 30 check (alertar_dias_antes between 0 and 365),
  observacoes text not null default '',
  ultimo_alerta_email date,
  criado_em timestamptz not null default now()
);
create index documentos_sindico_venc_idx on public.documentos_legais(sindico_id, data_vencimento);
alter table public.documentos_legais enable row level security;
create policy "documentos proprios - ler" on public.documentos_legais for select to authenticated using ((select auth.uid()) = sindico_id);
create policy "documentos proprios - criar" on public.documentos_legais for insert to authenticated with check ((select auth.uid()) = sindico_id);
create policy "documentos proprios - alterar" on public.documentos_legais for update to authenticated using ((select auth.uid()) = sindico_id) with check ((select auth.uid()) = sindico_id);
create policy "documentos proprios - apagar" on public.documentos_legais for delete to authenticated using ((select auth.uid()) = sindico_id);

-- Garante que o condomínio informado pertence ao síndico
create or replace function public.checar_condominio_do_sindico()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.condominio_id is not null and not exists (
    select 1 from public.condominios c where c.id = new.condominio_id and c.sindico_id = new.sindico_id) then
    raise exception 'Condomínio não pertence a este síndico';
  end if;
  return new;
end; $$;
revoke execute on function public.checar_condominio_do_sindico() from public, anon, authenticated;
create trigger compromissos_checa_cond before insert or update on public.compromissos for each row execute function public.checar_condominio_do_sindico();
create trigger documentos_checa_cond before insert or update on public.documentos_legais for each row execute function public.checar_condominio_do_sindico();
