-- Fase 2 e 3: ata de assembleia, mandato, data-base do dissídio, previsão orçamentária e calendário legal.
alter table public.condominios
  add column if not exists ata_status text not null default 'pendente',
  add column if not exists ata_msg text not null default '',
  add column if not exists ata_kb_id text,
  add column if not exists ata_data date,
  add column if not exists mandato_fim date,
  add column if not exists dissidio_mes smallint check (dissidio_mes between 1 and 12);

create or replace function privado.validar_condominio()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare eh_admin boolean := privado.eh_admin();
begin
  new.cnpj := nullif(upper(regexp_replace(coalesce(new.cnpj,''), '[^0-9A-Za-z]', '', 'g')), '');
  new.nome := btrim(new.nome);
  new.endereco := btrim(new.endereco);
  new.cep := regexp_replace(coalesce(new.cep,''), '[^0-9]', '', 'g');
  new.uf := upper(btrim(coalesce(new.uf,'')));

  if new.cnpj is null then raise exception 'Informe o CNPJ do condomínio.'; end if;
  if not privado.cnpj_valido(new.cnpj) then raise exception 'CNPJ inválido. Confira os números.'; end if;
  if length(new.nome) < 3 then raise exception 'Informe o nome do condomínio.'; end if;
  if length(new.endereco) < 5 then raise exception 'Informe o endereço do condomínio.'; end if;
  if new.unidades is null or new.unidades < 1 or new.unidades > 20000 then raise exception 'Informe a quantidade de apartamentos.'; end if;
  if new.ata_data is not null and (new.ata_data > current_date + 1 or new.ata_data < date '1990-01-01') then raise exception 'Data da assembleia inválida.'; end if;
  if new.mandato_fim is not null and new.mandato_fim < date '2000-01-01' then raise exception 'Data de fim do mandato inválida.'; end if;

  if not eh_admin and auth.uid() is not null then
    if tg_op = 'INSERT' then
      if new.sindico_id <> auth.uid() then raise exception 'Você só pode cadastrar condomínios na sua própria conta.'; end if;
      new.kb_doc_ids := '{}';
      new.documentos := 'sem documentos cadastrados';
      new.convencao_status := 'pendente'; new.regulamento_status := 'pendente'; new.ata_status := 'pendente';
      new.convencao_msg := ''; new.regulamento_msg := ''; new.ata_msg := '';
      new.convencao_kb_id := null; new.regulamento_kb_id := null; new.ata_kb_id := null;
    else
      new.sindico_id := old.sindico_id;
      new.kb_doc_ids := old.kb_doc_ids;
      new.documentos := old.documentos;
      new.convencao_status := old.convencao_status; new.regulamento_status := old.regulamento_status; new.ata_status := old.ata_status;
      new.convencao_msg := old.convencao_msg; new.regulamento_msg := old.regulamento_msg; new.ata_msg := old.ata_msg;
      new.convencao_kb_id := old.convencao_kb_id; new.regulamento_kb_id := old.regulamento_kb_id; new.ata_kb_id := old.ata_kb_id;
    end if;
  end if;
  return new;
end; $function$;
revoke execute on function privado.validar_condominio() from public, anon, authenticated;

-- Previsão orçamentária atual de cada condomínio (uma por condomínio; a nova substitui a anterior)
create table public.orcamentos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null unique references public.condominios(id) on delete cascade,
  sindico_id uuid not null references public.perfis(id) on delete cascade,
  autor_id uuid references public.perfis(id) on delete set null,
  vigencia_inicio date not null,
  vigencia_fim date,
  taxa_media numeric(12,2) check (taxa_media is null or taxa_media >= 0),
  fundo_reserva_pct numeric(5,2) not null default 0 check (fundo_reserva_pct between 0 and 50),
  itens jsonb not null default '[]'::jsonb check (jsonb_typeof(itens) = 'array' and jsonb_array_length(itens) <= 200),
  premissas jsonb not null default '{}'::jsonb check (jsonb_typeof(premissas) = 'object'),
  arquivo_nome text,
  origem text not null default 'manual' check (origem in ('manual','pdf','planilha')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.orcamentos enable row level security;

create or replace function privado.preparar_orcamento() returns trigger language plpgsql security definer set search_path to '' as $$
declare c record; it jsonb;
begin
  select id, sindico_id into c from public.condominios where id = new.condominio_id;
  if c.id is null then raise exception 'Condomínio não encontrado.'; end if;
  new.sindico_id := c.sindico_id;
  if auth.uid() is not null then new.autor_id := auth.uid(); end if;
  if new.vigencia_fim is not null and new.vigencia_fim <= new.vigencia_inicio then raise exception 'O fim da vigência deve ser depois do início.'; end if;
  for it in select * from jsonb_array_elements(new.itens) loop
    if jsonb_typeof(it) <> 'object' or length(coalesce(it->>'descricao','')) not between 1 and 160
       or coalesce(it->>'categoria','') not in ('pessoal','encargos','contratos','manutencao','agua','energia','gas','seguro','administracao','consumo','juridico','outros')
       or jsonb_typeof(it->'valor') <> 'number' or (it->>'valor')::numeric < 0 or (it->>'valor')::numeric > 100000000 then
      raise exception 'Item inválido na previsão orçamentária: %', left(coalesce(it->>'descricao','(sem descrição)'), 60);
    end if;
  end loop;
  if tg_op = 'INSERT' then new.criado_em := now(); else new.criado_em := old.criado_em; end if;
  new.atualizado_em := now();
  return new;
end $$;
revoke all on function privado.preparar_orcamento() from public, anon, authenticated;
create trigger orcamentos_preparar before insert or update on public.orcamentos for each row execute function privado.preparar_orcamento();

create policy "orcamentos - ler" on public.orcamentos for select to authenticated
  using ((select auth.uid()) = sindico_id or condominio_id in (select privado.condominios_do_gestor()) or (select privado.eh_admin()));
create policy "orcamentos - criar" on public.orcamentos for insert to authenticated
  with check (((select auth.uid()) = sindico_id or condominio_id in (select privado.condominios_do_gestor())) and (select privado.conta_ativa()));
create policy "orcamentos - alterar" on public.orcamentos for update to authenticated
  using ((select auth.uid()) = sindico_id or condominio_id in (select privado.condominios_do_gestor()))
  with check (((select auth.uid()) = sindico_id or condominio_id in (select privado.condominios_do_gestor())) and (select privado.conta_ativa()));
create policy "orcamentos - apagar" on public.orcamentos for delete to authenticated
  using ((select auth.uid()) = sindico_id);

-- Calendário legal automático: compromissos gerados pelo SINDICS têm uma chave e não se duplicam
alter table public.compromissos
  add column if not exists origem text not null default 'manual' check (origem in ('manual','calendario_legal')),
  add column if not exists chave text;
create unique index if not exists compromissos_chave_unica on public.compromissos (sindico_id, chave) where chave is not null;
