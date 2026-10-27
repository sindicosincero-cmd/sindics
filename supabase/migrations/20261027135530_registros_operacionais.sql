-- Localização do condomínio (só o síndico define)
alter table public.condominios add column if not exists lat double precision, add column if not exists lng double precision, add column if not exists local_definido_em timestamptz;

create or replace function privado.proteger_local_condominio() returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if auth.uid() is not null and not privado.eh_admin() and auth.uid() <> old.sindico_id then
    new.lat := old.lat; new.lng := old.lng; new.local_definido_em := old.local_definido_em;
  elsif new.lat is distinct from old.lat or new.lng is distinct from old.lng then
    if new.lat is not null and (new.lat not between -34 and 6 or new.lng not between -74 and -28) then raise exception 'Localização fora do Brasil.'; end if;
    new.local_definido_em := case when new.lat is null then null else now() end;
  end if;
  return new;
end $$;
drop trigger if exists condominios_local on public.condominios;
create trigger condominios_local before update on public.condominios for each row execute function privado.proteger_local_condominio();

-- Registro operacional: o diário do dia a dia. Não se altera nem se apaga (só o sistema marca a resolução).
create table public.registros_operacionais (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  sindico_id uuid not null references public.perfis(id) on delete cascade,
  autor_id uuid references public.perfis(id) on delete set null,
  autor_nome text not null default '',
  autor_papel text not null default '',
  tipo text not null check (tipo in ('vistoria','manutencao','ocorrencia','atendimento','prestador','limpeza','seguranca','administrativo','outro')),
  descricao text not null check (length(btrim(descricao)) between 3 and 2000),
  unidade text check (unidade is null or length(unidade) <= 40),
  situacao text not null default 'resolvido' check (situacao in ('resolvido','pendente')),
  referencia_id uuid references public.registros_operacionais(id) on delete set null,
  resolvido_em timestamptz,
  resolvido_por_nome text,
  ocorrido_em timestamptz not null default now(),
  -- localização: o SINDICS NÃO guarda as coordenadas, só a distância até o condomínio
  precisao_m integer,
  distancia_m integer,
  local_status text not null default 'sem_localizacao' check (local_status in ('no_condominio','fora','sem_localizacao','condominio_sem_local','impreciso')),
  fotos text[] not null default '{}' check (cardinality(fotos) <= 3),
  origem text not null default 'tela' check (origem in ('tela','voz')),
  criado_em timestamptz not null default now()
);
create index registros_cond_data on public.registros_operacionais (condominio_id, ocorrido_em desc);
create index registros_sindico_data on public.registros_operacionais (sindico_id, ocorrido_em desc);
create index registros_pendentes on public.registros_operacionais (condominio_id) where situacao = 'pendente';
alter table public.registros_operacionais enable row level security;

-- Coordenadas chegam numa coluna temporária e são descartadas no gatilho
alter table public.registros_operacionais add column lat_temp double precision, add column lng_temp double precision;

create or replace function privado.preparar_registro() returns trigger language plpgsql security definer set search_path to '' as $$
declare c record; p record; ref record; d double precision;
begin
  select id, sindico_id, lat, lng into c from public.condominios where id = new.condominio_id;
  if c.id is null then raise exception 'Condomínio não encontrado.'; end if;
  new.sindico_id := c.sindico_id;
  if auth.uid() is not null then new.autor_id := auth.uid(); end if;
  select nome, tratamento, papel into p from public.perfis where id = new.autor_id;
  new.autor_nome := coalesce(nullif(btrim(p.nome), ''), 'Usuário');
  new.autor_papel := case when p.papel = 'gestor' then 'gestor' else 'síndico' end;
  new.descricao := btrim(new.descricao);
  new.unidade := nullif(btrim(coalesce(new.unidade, '')), '');
  new.ocorrido_em := now(); new.criado_em := now();
  new.resolvido_em := null; new.resolvido_por_nome := null;
  -- fotos só dentro da pasta do condomínio
  if exists (select 1 from unnest(new.fotos) f where f not like c.sindico_id::text || '/' || c.id::text || '/%') then
    raise exception 'Foto fora da pasta do condomínio.';
  end if;
  -- distância até o condomínio (fórmula de haversine); as coordenadas não são guardadas
  if new.lat_temp is null or new.lng_temp is null then
    new.local_status := 'sem_localizacao'; new.distancia_m := null; new.precisao_m := null;
  elsif c.lat is null then
    new.local_status := 'condominio_sem_local'; new.distancia_m := null;
  else
    d := 2 * 6371000 * asin(sqrt(power(sin(radians(new.lat_temp - c.lat) / 2), 2) + cos(radians(c.lat)) * cos(radians(new.lat_temp)) * power(sin(radians(new.lng_temp - c.lng) / 2), 2)));
    new.distancia_m := round(d);
    new.local_status := case
      when coalesce(new.precisao_m, 0) > 1500 then 'impreciso'
      when d <= greatest(200, least(coalesce(new.precisao_m, 0), 500)) then 'no_condominio'
      else 'fora' end;
  end if;
  new.lat_temp := null; new.lng_temp := null;
  -- resolução de uma pendência: novo registro que aponta para a pendência
  if new.referencia_id is not null then
    select id, condominio_id, situacao into ref from public.registros_operacionais where id = new.referencia_id;
    if ref.id is null or ref.condominio_id <> new.condominio_id then raise exception 'Pendência não encontrada neste condomínio.'; end if;
    if ref.situacao <> 'pendente' then raise exception 'Essa pendência já foi resolvida.'; end if;
    new.situacao := 'resolvido';
    update public.registros_operacionais set situacao = 'resolvido', resolvido_em = now(), resolvido_por_nome = new.autor_nome where id = ref.id;
  end if;
  return new;
end $$;
create trigger registros_preparar before insert on public.registros_operacionais for each row execute function privado.preparar_registro();

create policy "registros - ler" on public.registros_operacionais for select to authenticated
  using ((select auth.uid()) = sindico_id or condominio_id in (select privado.condominios_do_gestor()) or (select privado.eh_admin()));
create policy "registros - criar" on public.registros_operacionais for insert to authenticated
  with check (((select auth.uid()) = sindico_id or condominio_id in (select privado.condominios_do_gestor())) and (select privado.conta_ativa()));
-- sem políticas de UPDATE/DELETE: o diário não pode ser editado nem apagado pelo app
revoke update, delete on public.registros_operacionais from anon, authenticated;

-- Fotos dos registros (privadas)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('operacao-fotos', 'operacao-fotos', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "fotos operacao - enviar" on storage.objects for insert to authenticated with check (
  bucket_id = 'operacao-fotos'
  and exists (select 1 from public.condominios c where c.id::text = (storage.foldername(name))[2] and c.sindico_id::text = (storage.foldername(name))[1]
              and (c.sindico_id = (select auth.uid()) or c.id in (select privado.condominios_do_gestor())))
  and (select privado.conta_ativa()));
create policy "fotos operacao - ler" on storage.objects for select to authenticated using (
  bucket_id = 'operacao-fotos'
  and ((storage.foldername(name))[1] = (select auth.uid())::text
       or exists (select 1 from public.condominios c where c.id::text = (storage.foldername(name))[2] and c.id in (select privado.condominios_do_gestor()))
       or (select privado.eh_admin())));
