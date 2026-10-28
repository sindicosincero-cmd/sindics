-- Memória do SINDICS: decisões, pendências, preferências e contexto que valem para as próximas conversas.
-- Nunca guarda dados pessoais de moradores (regra do agente + revisão do síndico na tela "Memória").
create table public.memorias (
  id uuid primary key default gen_random_uuid(),
  sindico_id uuid not null references public.perfis(id) on delete cascade,
  condominio_id uuid references public.condominios(id) on delete cascade,
  autor_id uuid references public.perfis(id) on delete set null,
  autor_nome text not null default '',
  tipo text not null check (tipo in ('decisao','pendencia','preferencia','contexto')),
  texto text not null check (length(btrim(texto)) between 3 and 400),
  prazo date,
  situacao text not null default 'aberta' check (situacao in ('aberta','concluida')),
  concluida_em timestamptz,
  origem text not null default 'voz' check (origem in ('voz','tela')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index memorias_sindico on public.memorias (sindico_id, situacao, criado_em desc);
create index memorias_cond on public.memorias (condominio_id) where condominio_id is not null;
alter table public.memorias enable row level security;

create or replace function privado.preparar_memoria() returns trigger language plpgsql security definer set search_path to '' as $$
declare c record; p record; n integer;
begin
  if tg_op = 'INSERT' then
    if new.condominio_id is not null then
      select id, sindico_id into c from public.condominios where id = new.condominio_id;
      if c.id is null then raise exception 'Condomínio não encontrado.'; end if;
      new.sindico_id := c.sindico_id;
    else
      new.sindico_id := coalesce(auth.uid(), new.sindico_id);
    end if;
    if auth.uid() is not null then new.autor_id := auth.uid(); end if;
    select nome, tratamento into p from public.perfis where id = new.autor_id;
    new.autor_nome := coalesce(nullif(btrim(p.tratamento), ''), nullif(btrim(p.nome), ''), 'Usuário');
    new.situacao := 'aberta'; new.concluida_em := null; new.criado_em := now();
    select count(*) into n from public.memorias where sindico_id = new.sindico_id and situacao = 'aberta';
    if n >= 300 then raise exception 'A memória do SINDICS está cheia (300 itens abertos). Conclua ou apague itens antigos na tela Memória.'; end if;
  else
    new.id := old.id; new.sindico_id := old.sindico_id; new.condominio_id := old.condominio_id; new.autor_id := old.autor_id;
    new.autor_nome := old.autor_nome; new.tipo := old.tipo; new.origem := old.origem; new.criado_em := old.criado_em;
    new.concluida_em := case when new.situacao = 'concluida' then coalesce(old.concluida_em, now()) else null end;
  end if;
  new.texto := btrim(new.texto);
  new.atualizado_em := now();
  return new;
end $$;
revoke all on function privado.preparar_memoria() from public, anon, authenticated;
create trigger memorias_preparar before insert or update on public.memorias for each row execute function privado.preparar_memoria();

create policy "memorias - ler" on public.memorias for select to authenticated
  using ((select auth.uid()) = sindico_id or (select auth.uid()) = autor_id or condominio_id in (select privado.condominios_do_gestor()));
create policy "memorias - criar" on public.memorias for insert to authenticated
  with check (((select auth.uid()) = sindico_id or condominio_id in (select privado.condominios_do_gestor())) and (select privado.conta_ativa()));
create policy "memorias - atualizar" on public.memorias for update to authenticated
  using ((select auth.uid()) = sindico_id or (select auth.uid()) = autor_id or condominio_id in (select privado.condominios_do_gestor()))
  with check ((select auth.uid()) = sindico_id or (select auth.uid()) = autor_id or condominio_id in (select privado.condominios_do_gestor()));
create policy "memorias - apagar" on public.memorias for delete to authenticated
  using ((select auth.uid()) = sindico_id or (select auth.uid()) = autor_id);

-- itens concluídos há mais de 12 meses saem da memória
select cron.schedule('sindics-limpar-memoria', '41 3 * * *', $$delete from public.memorias where situacao = 'concluida' and concluida_em < now() - interval '12 months'$$);
