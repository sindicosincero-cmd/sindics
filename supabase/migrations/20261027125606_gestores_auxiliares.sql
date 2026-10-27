-- Gestor auxiliar: trabalha nos condomínios que o síndico autorizar.
create table if not exists public.gestores (
  id uuid primary key default gen_random_uuid(),
  sindico_id uuid not null references public.perfis(id) on delete cascade,
  gestor_id uuid references public.perfis(id) on delete set null,
  nome text not null check (char_length(btrim(nome)) between 3 and 120),
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  condominios uuid[] not null default '{}',
  status text not null default 'ativo' check (status in ('ativo','removido')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists gestores_sindico_email on public.gestores(sindico_id, lower(email)) where status = 'ativo';
create index if not exists gestores_gestor_idx on public.gestores(gestor_id) where status = 'ativo';
alter table public.gestores enable row level security;

-- dono liberado: perfil ativo e assinatura sem bloqueio (admin sempre)
create or replace function privado.dono_liberado(dono uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.perfis p
    where p.id = dono and p.ativo
      and (p.papel = 'admin' or not exists (
        select 1 from (select a.status, a.atraso_desde from public.assinaturas a where a.sindico_id = p.id order by a.criado_em desc limit 1) ult
        where ult.status = 'cancelada'
           or (ult.status = 'atrasada' and ult.atraso_desde is not null and (now() at time zone 'America/Sao_Paulo')::date - ult.atraso_desde >= 5)
      ))
  );
$$;

-- condomínios que o usuário logado pode operar como gestor
create or replace function privado.condominios_do_gestor() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct unnest(g.condominios) from public.gestores g
  where g.gestor_id = auth.uid() and g.status = 'ativo' and privado.dono_liberado(g.sindico_id);
$$;

create or replace function privado.conta_ativa() returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.perfis p where p.id = auth.uid() and p.papel = 'gestor')
      then exists (select 1 from public.gestores g where g.gestor_id = auth.uid() and g.status = 'ativo' and privado.dono_liberado(g.sindico_id))
    else privado.dono_liberado(auth.uid())
  end;
$$;
revoke all on function privado.dono_liberado(uuid), privado.condominios_do_gestor() from public;
grant execute on function privado.dono_liberado(uuid), privado.condominios_do_gestor(), privado.conta_ativa() to authenticated;

-- equipe: o síndico gerencia a própria; o gestor vê o próprio vínculo; admin vê tudo
create policy "equipe - sindico le" on public.gestores for select to authenticated using ((select auth.uid()) = sindico_id or (select auth.uid()) = gestor_id or (select privado.eh_admin()));
create policy "equipe - sindico altera" on public.gestores for update to authenticated
  using ((select auth.uid()) = sindico_id) with check ((select auth.uid()) = sindico_id);

-- só condomínios do próprio síndico podem ser autorizados; nome/e-mail normalizados
create or replace function privado.validar_gestor() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.email := lower(btrim(new.email)); new.nome := btrim(new.nome); new.atualizado_em := now();
  if exists (select 1 from unnest(new.condominios) c where not exists (select 1 from public.condominios k where k.id = c and k.sindico_id = new.sindico_id)) then
    raise exception 'Só é possível autorizar condomínios do próprio síndico.';
  end if;
  if auth.uid() is not null and not privado.eh_admin() and tg_op = 'UPDATE' then
    new.sindico_id := old.sindico_id; new.gestor_id := old.gestor_id; new.email := old.email;
  end if;
  return new;
end $$;
drop trigger if exists gestores_validar on public.gestores;
create trigger gestores_validar before insert or update on public.gestores for each row execute function privado.validar_gestor();

-- registros ligados a um condomínio pertencem ao dono do condomínio (mesmo quando o gestor cria)
create or replace function privado.dono_do_condominio() returns trigger
language plpgsql security definer set search_path = '' as $$
declare dono uuid;
begin
  if new.condominio_id is not null then
    select sindico_id into dono from public.condominios where id = new.condominio_id;
    if dono is not null then new.sindico_id := dono; end if;
  end if;
  return new;
end $$;
drop trigger if exists docs_dono on public.documentos_legais;
create trigger docs_dono before insert or update of condominio_id on public.documentos_legais for each row execute function privado.dono_do_condominio();
drop trigger if exists comp_dono on public.compromissos;
create trigger comp_dono before insert or update of condominio_id on public.compromissos for each row execute function privado.dono_do_condominio();

-- condomínios
alter policy "condominios proprios - leitura" on public.condominios using ((select auth.uid()) = sindico_id or id in (select privado.condominios_do_gestor()));
alter policy "condominios proprios - alterar" on public.condominios
  using ((((select auth.uid()) = sindico_id) or id in (select privado.condominios_do_gestor())) and (select privado.conta_ativa()))
  with check ((((select auth.uid()) = sindico_id) or id in (select privado.condominios_do_gestor())) and (select privado.conta_ativa()));

-- documentos legais
alter policy "documentos proprios - ler" on public.documentos_legais using ((select auth.uid()) = sindico_id or condominio_id in (select privado.condominios_do_gestor()));
alter policy "documentos proprios - criar" on public.documentos_legais with check ((((select auth.uid()) = sindico_id) or condominio_id in (select privado.condominios_do_gestor())) and (select privado.conta_ativa()));
alter policy "documentos proprios - alterar" on public.documentos_legais
  using ((((select auth.uid()) = sindico_id) or condominio_id in (select privado.condominios_do_gestor())) and (select privado.conta_ativa()))
  with check ((((select auth.uid()) = sindico_id) or condominio_id in (select privado.condominios_do_gestor())) and (select privado.conta_ativa()));
alter policy "documentos proprios - apagar" on public.documentos_legais using ((((select auth.uid()) = sindico_id) or condominio_id in (select privado.condominios_do_gestor())) and (select privado.conta_ativa()));

-- agenda
alter policy "compromissos proprios - ler" on public.compromissos using ((select auth.uid()) = sindico_id or condominio_id in (select privado.condominios_do_gestor()));
alter policy "compromissos proprios - criar" on public.compromissos with check ((((select auth.uid()) = sindico_id) or condominio_id in (select privado.condominios_do_gestor())) and (select privado.conta_ativa()));
alter policy "compromissos proprios - alterar" on public.compromissos
  using ((((select auth.uid()) = sindico_id) or condominio_id in (select privado.condominios_do_gestor())) and (select privado.conta_ativa()))
  with check ((((select auth.uid()) = sindico_id) or condominio_id in (select privado.condominios_do_gestor())) and (select privado.conta_ativa()));
alter policy "compromissos proprios - apagar" on public.compromissos using ((((select auth.uid()) = sindico_id) or condominio_id in (select privado.condominios_do_gestor())) and (select privado.conta_ativa()));

-- papel 'gestor' permitido
do $$ begin
  if exists (select 1 from pg_constraint where conrelid = 'public.perfis'::regclass and conname = 'perfis_papel_check') then
    alter table public.perfis drop constraint perfis_papel_check;
  end if;
end $$;
alter table public.perfis add constraint perfis_papel_check check (papel in ('admin','sindico','gestor'));
