-- Cadastro completo do síndico, preferência de voz e registros de LGPD
alter table public.perfis
  add column if not exists cnpj text,
  add column if not exists telefone text not null default '',
  add column if not exists email_contato text not null default '',
  add column if not exists cep text not null default '',
  add column if not exists endereco text not null default '',
  add column if not exists cidade text not null default '',
  add column if not exists uf text not null default '',
  add column if not exists cadastro_completo_em timestamptz,
  add column if not exists voz text not null default 'masculina',
  add column if not exists aceite_termos_em timestamptz,
  add column if not exists aceite_termos_versao text,
  add column if not exists exclusao_solicitada_em timestamptz;
alter table public.perfis drop constraint if exists perfis_voz_valida;
alter table public.perfis add constraint perfis_voz_valida check (voz in ('masculina','feminina'));

-- Validação e normalização do cadastro
create or replace function privado.validar_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.cnpj := nullif(upper(regexp_replace(coalesce(new.cnpj, ''), '[^0-9A-Za-z]', '', 'g')), '');
  new.telefone := regexp_replace(coalesce(new.telefone, ''), '\D', '', 'g');
  new.cep := regexp_replace(coalesce(new.cep, ''), '\D', '', 'g');
  new.uf := upper(trim(coalesce(new.uf, '')));
  new.email_contato := lower(trim(coalesce(new.email_contato, '')));
  if new.cadastro_completo_em is not null then
    if length(trim(new.nome)) < 3 then raise exception 'Informe seu nome completo.'; end if;
    if length(trim(new.empresa)) < 2 then raise exception 'Informe o nome da sua empresa.'; end if;
    if new.cnpj is null or not privado.cnpj_valido(new.cnpj) then raise exception 'CNPJ da empresa inválido.'; end if;
    if length(trim(new.endereco)) < 5 or length(trim(new.cidade)) < 2 or new.uf !~ '^[A-Z]{2}$' then raise exception 'Informe o endereço completo da empresa (rua, número, cidade e UF).'; end if;
    if new.email_contato !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail de contato inválido.'; end if;
    if length(new.telefone) not between 10 and 11 then raise exception 'Telefone inválido: use DDD + número.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists validar_perfil on public.perfis;
create trigger validar_perfil before insert or update on public.perfis for each row execute function privado.validar_perfil();

-- O próprio síndico pode atualizar o cadastro, mas não papel, aprovação, plano, limite ou e-mail de login
create or replace function privado.proteger_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not privado.eh_admin() then
    if new.id <> old.id or new.papel <> old.papel or new.ativo <> old.ativo or new.plano <> old.plano
       or new.limite_sessoes_mes <> old.limite_sessoes_mes or new.email <> old.email or new.criado_em <> old.criado_em then
      raise exception 'Alteração não permitida.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists proteger_perfil on public.perfis;
create trigger proteger_perfil before update on public.perfis for each row execute function privado.proteger_perfil();

drop policy if exists "perfil proprio - atualizar" on public.perfis;
create policy "perfil proprio - atualizar" on public.perfis for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Novo usuário: copia os dados do formulário de cadastro (os campos privilegiados ficam no padrão)
create or replace function public.criar_perfil_novo_usuario() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.perfis (id, nome, email, empresa, cnpj, telefone, email_contato, cep, endereco, cidade, uf, assinatura, aceite_termos_em, aceite_termos_versao)
  values (new.id,
          coalesce(m->>'nome', m->>'full_name', m->>'name', split_part(new.email, '@', 1)),
          coalesce(new.email, ''),
          coalesce(m->>'empresa', ''), m->>'cnpj', coalesce(m->>'telefone', ''), coalesce(m->>'email_contato', new.email, ''),
          coalesce(m->>'cep', ''), coalesce(m->>'endereco', ''), coalesce(m->>'cidade', ''), coalesce(m->>'uf', ''),
          coalesce(m->>'assinatura', ''),
          case when m->>'aceite_termos_versao' is not null then now() end, m->>'aceite_termos_versao');
  -- marca como completo só se tudo for válido (sem bloquear a criação da conta)
  begin
    update public.perfis set cadastro_completo_em = now() where id = new.id and m ? 'cnpj';
  exception when others then null;
  end;
  return new;
end $$;

-- Solicitações do titular (LGPD, art. 18)
create table if not exists public.lgpd_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  sindico_id uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  tipo text not null check (tipo in ('exclusao','correcao','acesso','revogacao','outro')),
  detalhe text not null default '',
  status text not null default 'aberta' check (status in ('aberta','em_andamento','atendida','recusada')),
  resposta text not null default '',
  criado_em timestamptz not null default now(),
  atendido_em timestamptz
);
alter table public.lgpd_solicitacoes enable row level security;
create policy "lgpd proprio - ler" on public.lgpd_solicitacoes for select to authenticated using ((select auth.uid()) = sindico_id);
create policy "lgpd proprio - criar" on public.lgpd_solicitacoes for insert to authenticated with check ((select auth.uid()) = sindico_id and status = 'aberta');
create policy "lgpd admin - ler" on public.lgpd_solicitacoes for select to authenticated using ((select privado.eh_admin()));
create policy "lgpd admin - atualizar" on public.lgpd_solicitacoes for update to authenticated using ((select privado.eh_admin())) with check ((select privado.eh_admin()));
create index if not exists lgpd_solicitacoes_sindico_idx on public.lgpd_solicitacoes (sindico_id);
comment on table public.lgpd_solicitacoes is 'Pedidos do titular (exclusão, correção, acesso, revogação) – LGPD art. 18.';
