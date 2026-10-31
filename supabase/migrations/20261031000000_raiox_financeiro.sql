-- Raio-X do Condomínio (fase 1): diagnóstico financeiro de entrada.
-- Números mensais da prestação de contas (por grupo de despesa), saldos, inadimplência e contratos.
-- O app calcula os achados; o plano de ação vira agenda e fiscalização.

create table if not exists public.raiox (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null unique references public.condominios(id) on delete cascade,
  sindico_id uuid not null references public.perfis(id) on delete cascade,
  autor_id uuid references public.perfis(id) on delete set null,
  meses jsonb not null default '[]'::jsonb check (jsonb_typeof(meses) = 'array' and jsonb_array_length(meses) <= 36),
  achados jsonb not null default '[]'::jsonb check (jsonb_typeof(achados) = 'array' and jsonb_array_length(achados) <= 80),
  resumo jsonb not null default '{}'::jsonb check (jsonb_typeof(resumo) = 'object'),
  plano_em timestamptz,
  arquivo_nome text,
  analisado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.raiox enable row level security;

create table if not exists public.contratos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  sindico_id uuid not null references public.perfis(id) on delete cascade,
  autor_id uuid references public.perfis(id) on delete set null,
  fornecedor text not null check (length(btrim(fornecedor)) between 2 and 120),
  servico text not null default '' check (length(servico) <= 120),
  categoria text not null default 'contratos' check (categoria in ('pessoal','encargos','contratos','manutencao','agua','energia','gas','seguro','administracao','consumo','juridico','outros')),
  valor_mensal numeric(12,2) check (valor_mensal is null or (valor_mensal >= 0 and valor_mensal <= 10000000)),
  inicio date,
  fim date,
  indice text check (indice is null or indice in ('ipca','igpm','inpc','incc','dissidio','fixo','outro')),
  mes_reajuste smallint check (mes_reajuste is null or mes_reajuste between 1 and 12),
  renovacao_automatica boolean not null default false,
  aviso_previo_dias smallint check (aviso_previo_dias is null or aviso_previo_dias between 0 and 365),
  multa text not null default '' check (length(multa) <= 200),
  observacao text not null default '' check (length(observacao) <= 500),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (fim is null or inicio is null or fim > inicio)
);
create index if not exists contratos_condominio_idx on public.contratos (condominio_id);
create index if not exists contratos_sindico_idx on public.contratos (sindico_id);
alter table public.contratos enable row level security;

-- dono e autor vêm do condomínio; meses validados
create or replace function privado.preparar_raiox() returns trigger language plpgsql security definer set search_path to '' as $$
declare c record; m jsonb;
begin
  select id, sindico_id into c from public.condominios where id = new.condominio_id;
  if c.id is null then raise exception 'Condomínio não encontrado.'; end if;
  new.sindico_id := c.sindico_id;
  if auth.uid() is not null then new.autor_id := auth.uid(); end if;
  for m in select * from jsonb_array_elements(new.meses) loop
    if jsonb_typeof(m) <> 'object' or coalesce(m->>'mes', '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
      raise exception 'Mês inválido no Raio-X (use AAAA-MM).';
    end if;
    if m ? 'despesas' and jsonb_typeof(m->'despesas') <> 'object' then raise exception 'Despesas inválidas em %.', m->>'mes'; end if;
  end loop;
  if tg_op = 'INSERT' then new.criado_em := now(); else new.criado_em := old.criado_em; end if;
  new.atualizado_em := now();
  return new;
end $$;
revoke all on function privado.preparar_raiox() from public, anon, authenticated;
drop trigger if exists raiox_preparar on public.raiox;
create trigger raiox_preparar before insert or update on public.raiox for each row execute function privado.preparar_raiox();

create or replace function privado.preparar_contrato() returns trigger language plpgsql security definer set search_path to '' as $$
declare c record;
begin
  select id, sindico_id into c from public.condominios where id = new.condominio_id;
  if c.id is null then raise exception 'Condomínio não encontrado.'; end if;
  new.sindico_id := c.sindico_id;
  if auth.uid() is not null then new.autor_id := auth.uid(); end if;
  new.fornecedor := btrim(new.fornecedor); new.servico := btrim(coalesce(new.servico, ''));
  if tg_op = 'INSERT' then new.criado_em := now(); else new.criado_em := old.criado_em; end if;
  new.atualizado_em := now();
  return new;
end $$;
revoke all on function privado.preparar_contrato() from public, anon, authenticated;
drop trigger if exists contratos_preparar on public.contratos;
create trigger contratos_preparar before insert or update on public.contratos for each row execute function privado.preparar_contrato();

-- RLS: o síndico e os gestores dos condomínios autorizados (mesma regra do orçamento)
do $$ declare t text; begin
  foreach t in array array['raiox','contratos'] loop
    execute format('drop policy if exists "%1$s - ler" on public.%1$s', t);
    execute format('drop policy if exists "%1$s - criar" on public.%1$s', t);
    execute format('drop policy if exists "%1$s - alterar" on public.%1$s', t);
    execute format('drop policy if exists "%1$s - apagar" on public.%1$s', t);
    execute format($p$create policy "%1$s - ler" on public.%1$s for select to authenticated
      using ((select auth.uid()) = sindico_id or condominio_id in (select privado.condominios_do_gestor()) or (select privado.eh_admin()))$p$, t);
    execute format($p$create policy "%1$s - criar" on public.%1$s for insert to authenticated
      with check (((select auth.uid()) = sindico_id or condominio_id in (select privado.condominios_do_gestor())) and (select privado.conta_ativa()))$p$, t);
    execute format($p$create policy "%1$s - alterar" on public.%1$s for update to authenticated
      using ((select auth.uid()) = sindico_id or condominio_id in (select privado.condominios_do_gestor()))
      with check (((select auth.uid()) = sindico_id or condominio_id in (select privado.condominios_do_gestor())) and (select privado.conta_ativa()))$p$, t);
    execute format($p$create policy "%1$s - apagar" on public.%1$s for delete to authenticated
      using ((select auth.uid()) = sindico_id)$p$, t);
  end loop;
end $$;

-- agenda e fiscalização aceitam as novas origens
alter table public.compromissos drop constraint if exists compromissos_origem_check;
alter table public.compromissos add constraint compromissos_origem_check check (origem in ('manual','calendario_legal','operacao','raiox'));
alter table public.fiscalizacao drop constraint if exists fiscalizacao_origem_check;
alter table public.fiscalizacao add constraint fiscalizacao_origem_check check (origem in ('documento','documento_faltante','operacao','combinado','gestao','contrato','raiox'));

-- Fiscalização: mesmas fontes de antes + contratos vencendo e o plano de ação do Raio-X
create or replace function privado.sincronizar_fiscalizacao() returns integer language plpgsql security definer set search_path to '' as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date; n integer;
begin
  create temp table if not exists _fisc (sindico_id uuid, condominio_id uuid, chave text, origem text, ref_id uuid, titulo text, detalhe text, prazo date, aberto date) on commit drop;
  truncate _fisc;

  insert into _fisc select d.sindico_id, d.condominio_id, 'doc:' || d.id, 'documento', d.id,
    d.documento || case when d.data_vencimento < hoje then ' vencido' else ' vencendo' end,
    case when d.data_vencimento < hoje then 'Venceu em ' else 'Vence em ' end || to_char(d.data_vencimento, 'DD/MM/YYYY') || '. Renove e atualize na Pasta de Documentação Legal.',
    d.data_vencimento, greatest(d.data_vencimento - coalesce(d.alertar_dias_antes, 30), (d.criado_em at time zone 'America/Sao_Paulo')::date)
  from public.documentos_legais d
  where d.condominio_id is not null and coalesce(d.situacao, '') <> 'nao_aplica' and d.data_vencimento is not null
    and d.data_vencimento <= hoje + coalesce(d.alertar_dias_antes, 30);

  insert into _fisc select c.sindico_id, c.id, 'doccat:' || k.codigo, 'documento_faltante', null,
    'Cadastrar ' || k.nome, 'Documento obrigatório (' || coalesce(k.base_legal, 'lei/norma') || ') ainda sem cadastro na Pasta de Documentação Legal.',
    (c.criado_em at time zone 'America/Sao_Paulo')::date + 30, (c.criado_em at time zone 'America/Sao_Paulo')::date
  from public.condominios c cross join public.documentos_catalogo k
  where k.exigencia <> 'recomendado' and k.condicao is null
    and not exists (select 1 from public.documentos_legais d where d.condominio_id = c.id and d.catalogo_codigo = k.codigo);

  insert into _fisc select r.sindico_id, r.condominio_id, 'op:' || r.id, 'operacao', r.id,
    'Pendência: ' || left(regexp_replace(r.descricao, '\s+', ' ', 'g'), 90),
    'Registrada em ' || to_char(r.ocorrido_em at time zone 'America/Sao_Paulo', 'DD/MM') || ' por ' || r.autor_nome || coalesce(' (unid. ' || r.unidade || ')', '') || '. Registre a solução na Operação do dia.',
    (r.ocorrido_em at time zone 'America/Sao_Paulo')::date + 7, (r.ocorrido_em at time zone 'America/Sao_Paulo')::date
  from public.registros_operacionais r where r.situacao = 'pendente';

  insert into _fisc select m.sindico_id, m.condominio_id, 'mem:' || m.id, 'combinado', m.id,
    left(regexp_replace(m.texto, '\s+', ' ', 'g'), 110), 'Combinado com o SINDICS. Prazo ' || to_char(m.prazo, 'DD/MM/YYYY') || '.',
    m.prazo, least(m.prazo - 5, (m.criado_em at time zone 'America/Sao_Paulo')::date)
  from public.memorias m where m.tipo = 'pendencia' and m.situacao = 'aberta' and m.prazo is not null and m.condominio_id is not null and m.prazo <= hoje + 15;

  insert into _fisc select c.sindico_id, c.id, 'ges:mandato:' || c.mandato_fim, 'gestao', null,
    'Mandato do síndico ' || case when c.mandato_fim < hoje then 'vencido' else 'terminando' end,
    'Fim do mandato em ' || to_char(c.mandato_fim, 'DD/MM/YYYY') || '. Convoque a assembleia de eleição (Código Civil, art. 1.347).', c.mandato_fim, c.mandato_fim - 60
  from public.condominios c where c.mandato_fim is not null and c.mandato_fim <= hoje + 60;
  insert into _fisc select c.sindico_id, c.id, 'ges:orcamento', 'gestao', null,
    'Enviar a previsão orçamentária', 'Sem a previsão, o SINDICS não liga o orçamento aos índices. Envie em Condomínios › Editar.',
    (c.criado_em at time zone 'America/Sao_Paulo')::date + 30, (c.criado_em at time zone 'America/Sao_Paulo')::date
  from public.condominios c where not exists (select 1 from public.orcamentos o where o.condominio_id = c.id and jsonb_array_length(o.itens) > 0);

  -- contratos: decidir renovação antes do aviso prévio (renovação automática) ou antes do fim
  insert into _fisc select k.sindico_id, k.condominio_id, 'ctr:' || k.id || ':' || k.fim, 'contrato', k.id,
    'Contrato ' || k.fornecedor || case when k.fim < hoje then ' vencido' when k.renovacao_automatica then ' renova sozinho' else ' terminando' end,
    coalesce(nullif(k.servico, '') || '. ', '') || 'Fim em ' || to_char(k.fim, 'DD/MM/YYYY')
      || case when k.renovacao_automatica and coalesce(k.aviso_previo_dias, 0) > 0
              then '; para não renovar, avise até ' || to_char(k.fim - k.aviso_previo_dias, 'DD/MM/YYYY') || '.'
              else '. Decida: renovar, renegociar ou cotar outro fornecedor.' end,
    k.fim - coalesce(case when k.renovacao_automatica then k.aviso_previo_dias end, 0),
    k.fim - coalesce(case when k.renovacao_automatica then k.aviso_previo_dias end, 0) - 60
  from public.contratos k
  where k.fim is not null and k.fim - coalesce(case when k.renovacao_automatica then k.aviso_previo_dias end, 0) <= hoje + 60
    and k.fim >= hoje - 30;

  -- plano de ação do Raio-X (achados que o síndico mandou para o plano)
  insert into _fisc select x.sindico_id, x.condominio_id, 'rx:' || (a->>'chave'), 'raiox', x.id,
    left(a->>'titulo', 140), left(coalesce(a->>'acao', ''), 400),
    (x.plano_em at time zone 'America/Sao_Paulo')::date + coalesce((a->>'prazo_dias')::int, 30),
    (x.plano_em at time zone 'America/Sao_Paulo')::date
  from public.raiox x cross join lateral jsonb_array_elements(x.achados) a
  where x.plano_em is not null and coalesce((a->>'no_plano')::boolean, false) and coalesce(a->>'chave', '') <> ''
    and coalesce(a->>'resolvido_em', '') = '';

  insert into public.fiscalizacao as f (sindico_id, condominio_id, chave, origem, ref_id, titulo, detalhe, prazo, aberto_em, cobrar_em)
  select x.sindico_id, x.condominio_id, x.chave, x.origem, x.ref_id, x.titulo, x.detalhe, x.prazo,
         (least(x.aberto, hoje)::timestamp at time zone 'America/Sao_Paulo'), hoje
  from _fisc x
  on conflict (condominio_id, chave) do update set titulo = excluded.titulo, detalhe = excluded.detalhe, prazo = excluded.prazo, sindico_id = excluded.sindico_id,
    status = 'aberta', resolvido_em = null,
    cobrar_em = case when f.status = 'resolvida' then hoje else f.cobrar_em end;

  update public.fiscalizacao f set status = 'resolvida', resolvido_em = now()
  where f.status = 'aberta' and not exists (select 1 from _fisc x where x.condominio_id = f.condominio_id and x.chave = f.chave);

  update public.fiscalizacao f set responsavel_id = coalesce(r.gestor_id, f.sindico_id), responsavel_nome = coalesce(r.nome_gestor, s.nome_sindico, '')
  from (select f2.id,
          (select gg.gestor_id from public.gestores gg where gg.status = 'ativo' and gg.gestor_id is not null and gg.sindico_id = f2.sindico_id and f2.condominio_id = any(gg.condominios) order by gg.criado_em limit 1) as gestor_id,
          (select coalesce(nullif(btrim(p.tratamento), ''), split_part(btrim(p.nome), ' ', 1)) from public.gestores gg join public.perfis p on p.id = gg.gestor_id
             where gg.status = 'ativo' and gg.sindico_id = f2.sindico_id and f2.condominio_id = any(gg.condominios) order by gg.criado_em limit 1) as nome_gestor
        from public.fiscalizacao f2 where f2.status = 'aberta') r,
       (select p.id, coalesce(nullif(btrim(p.tratamento), ''), split_part(btrim(p.nome), ' ', 1)) as nome_sindico from public.perfis p) s
  where f.id = r.id and s.id = f.sindico_id;

  update public.fiscalizacao f set nivel = case
      when (f.prazo is not null and f.prazo < hoje)
        or (f.origem in ('operacao','documento_faltante') and hoje - (f.aberto_em at time zone 'America/Sao_Paulo')::date >= 20) then 'critico'
      when (f.prazo is not null and f.prazo <= hoje + 15)
        or (f.origem in ('operacao','documento_faltante') and hoje - (f.aberto_em at time zone 'America/Sao_Paulo')::date >= 10) then 'cobranca'
      else 'atencao' end
  where f.status = 'aberta';

  select count(*) into n from public.fiscalizacao where status = 'aberta';
  return n;
end $$;
revoke all on function privado.sincronizar_fiscalizacao() from public, anon, authenticated;
