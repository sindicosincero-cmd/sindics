-- Fiscalização SINDICS: tudo o que está pendente (documentos, pendências da operação, combinados com prazo, gestão)
-- vira um item com responsável, prazo e nível. A cada 5 dias o responsável é cobrado até resolver.
create table if not exists public.fiscalizacao (
  id uuid primary key default gen_random_uuid(),
  sindico_id uuid not null references public.perfis(id) on delete cascade,
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  chave text not null,
  origem text not null check (origem in ('documento','documento_faltante','operacao','combinado','gestao')),
  ref_id uuid,
  titulo text not null,
  detalhe text not null default '',
  prazo date,
  aberto_em timestamptz not null default now(),
  nivel text not null default 'atencao' check (nivel in ('atencao','cobranca','critico')),
  responsavel_id uuid references public.perfis(id) on delete set null,
  responsavel_nome text not null default '',
  cobrar_em date not null default current_date,
  cobrancas integer not null default 0,
  previsao date,
  justificativa text,
  respondido_em timestamptz,
  respondido_por text,
  historico jsonb not null default '[]',
  ultimo_email date,
  status text not null default 'aberta' check (status in ('aberta','resolvida')),
  resolvido_em timestamptz,
  unique (condominio_id, chave)
);
create index if not exists fiscalizacao_abertas on public.fiscalizacao (sindico_id) where status = 'aberta';
alter table public.fiscalizacao enable row level security;
drop policy if exists fiscalizacao_ler on public.fiscalizacao;
create policy fiscalizacao_ler on public.fiscalizacao for select to authenticated
  using (sindico_id = (select auth.uid()) or responsavel_id = (select auth.uid())
         or condominio_id in (select privado.condominios_do_gestor()) or (select privado.eh_admin()));

-- Recalcula a lista a partir das fontes (idempotente). Itens que deixaram de existir são marcados como resolvidos.
create or replace function privado.sincronizar_fiscalizacao() returns integer language plpgsql security definer set search_path to '' as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date; n integer;
begin
  create temp table if not exists _fisc (sindico_id uuid, condominio_id uuid, chave text, origem text, ref_id uuid, titulo text, detalhe text, prazo date, aberto date) on commit drop;
  truncate _fisc;

  -- documentos vencidos ou dentro do prazo de aviso
  insert into _fisc select d.sindico_id, d.condominio_id, 'doc:' || d.id, 'documento', d.id,
    d.documento || case when d.data_vencimento < hoje then ' vencido' else ' vencendo' end,
    case when d.data_vencimento < hoje then 'Venceu em ' else 'Vence em ' end || to_char(d.data_vencimento, 'DD/MM/YYYY') || '. Renove e atualize na Pasta de Documentação Legal.',
    d.data_vencimento, greatest(d.data_vencimento - coalesce(d.alertar_dias_antes, 30), (d.criado_em at time zone 'America/Sao_Paulo')::date)
  from public.documentos_legais d
  where d.condominio_id is not null and coalesce(d.situacao, '') <> 'nao_aplica' and d.data_vencimento is not null
    and d.data_vencimento <= hoje + coalesce(d.alertar_dias_antes, 30);

  -- obrigatórios (por lei ou norma, sem condição) ainda sem cadastro
  insert into _fisc select c.sindico_id, c.id, 'doccat:' || k.codigo, 'documento_faltante', null,
    'Cadastrar ' || k.nome, 'Documento obrigatório (' || coalesce(k.base_legal, 'lei/norma') || ') ainda sem cadastro na Pasta de Documentação Legal.',
    (c.criado_em at time zone 'America/Sao_Paulo')::date + 30, (c.criado_em at time zone 'America/Sao_Paulo')::date
  from public.condominios c cross join public.documentos_catalogo k
  where k.exigencia <> 'recomendado' and k.condicao is null
    and not exists (select 1 from public.documentos_legais d where d.condominio_id = c.id and d.catalogo_codigo = k.codigo);

  -- pendências da Operação do dia (prazo de 7 dias)
  insert into _fisc select r.sindico_id, r.condominio_id, 'op:' || r.id, 'operacao', r.id,
    'Pendência: ' || left(regexp_replace(r.descricao, '\s+', ' ', 'g'), 90),
    'Registrada em ' || to_char(r.ocorrido_em at time zone 'America/Sao_Paulo', 'DD/MM') || ' por ' || r.autor_nome || coalesce(' (unid. ' || r.unidade || ')', '') || '. Registre a solução na Operação do dia.',
    (r.ocorrido_em at time zone 'America/Sao_Paulo')::date + 7, (r.ocorrido_em at time zone 'America/Sao_Paulo')::date
  from public.registros_operacionais r where r.situacao = 'pendente';

  -- combinados com prazo (memória do SINDICS)
  insert into _fisc select m.sindico_id, m.condominio_id, 'mem:' || m.id, 'combinado', m.id,
    left(regexp_replace(m.texto, '\s+', ' ', 'g'), 110), 'Combinado com o SINDICS. Prazo ' || to_char(m.prazo, 'DD/MM/YYYY') || '.',
    m.prazo, least(m.prazo - 5, (m.criado_em at time zone 'America/Sao_Paulo')::date)
  from public.memorias m where m.tipo = 'pendencia' and m.situacao = 'aberta' and m.prazo is not null and m.condominio_id is not null and m.prazo <= hoje + 15;

  -- gestão: mandato perto do fim e previsão orçamentária ausente (a ata enviada é a da eleição, não serve para medir a ordinária anual)
  insert into _fisc select c.sindico_id, c.id, 'ges:mandato:' || c.mandato_fim, 'gestao', null,
    'Mandato do síndico ' || case when c.mandato_fim < hoje then 'vencido' else 'terminando' end,
    'Fim do mandato em ' || to_char(c.mandato_fim, 'DD/MM/YYYY') || '. Convoque a assembleia de eleição (Código Civil, art. 1.347).', c.mandato_fim, c.mandato_fim - 60
  from public.condominios c where c.mandato_fim is not null and c.mandato_fim <= hoje + 60;
  insert into _fisc select c.sindico_id, c.id, 'ges:orcamento', 'gestao', null,
    'Enviar a previsão orçamentária', 'Sem a previsão, o SINDICS não liga o orçamento aos índices. Envie em Condomínios › Editar.',
    (c.criado_em at time zone 'America/Sao_Paulo')::date + 30, (c.criado_em at time zone 'America/Sao_Paulo')::date
  from public.condominios c where not exists (select 1 from public.orcamentos o where o.condominio_id = c.id and jsonb_array_length(o.itens) > 0);

  -- grava / atualiza
  insert into public.fiscalizacao as f (sindico_id, condominio_id, chave, origem, ref_id, titulo, detalhe, prazo, aberto_em, cobrar_em)
  select x.sindico_id, x.condominio_id, x.chave, x.origem, x.ref_id, x.titulo, x.detalhe, x.prazo,
         (least(x.aberto, hoje)::timestamp at time zone 'America/Sao_Paulo'), hoje
  from _fisc x
  on conflict (condominio_id, chave) do update set titulo = excluded.titulo, detalhe = excluded.detalhe, prazo = excluded.prazo, sindico_id = excluded.sindico_id,
    status = 'aberta', resolvido_em = null,
    cobrar_em = case when f.status = 'resolvida' then hoje else f.cobrar_em end;

  update public.fiscalizacao f set status = 'resolvida', resolvido_em = now()
  where f.status = 'aberta' and not exists (select 1 from _fisc x where x.condominio_id = f.condominio_id and x.chave = f.chave);

  -- responsável: gestor ativo do condomínio, senão o síndico
  update public.fiscalizacao f set responsavel_id = coalesce(r.gestor_id, f.sindico_id), responsavel_nome = coalesce(r.nome_gestor, s.nome_sindico, '')
  from (select f2.id,
          (select gg.gestor_id from public.gestores gg where gg.status = 'ativo' and gg.gestor_id is not null and gg.sindico_id = f2.sindico_id and f2.condominio_id = any(gg.condominios) order by gg.criado_em limit 1) as gestor_id,
          (select coalesce(nullif(btrim(p.tratamento), ''), split_part(btrim(p.nome), ' ', 1)) from public.gestores gg join public.perfis p on p.id = gg.gestor_id
             where gg.status = 'ativo' and gg.sindico_id = f2.sindico_id and f2.condominio_id = any(gg.condominios) order by gg.criado_em limit 1) as nome_gestor
        from public.fiscalizacao f2 where f2.status = 'aberta') r,
       (select p.id, coalesce(nullif(btrim(p.tratamento), ''), split_part(btrim(p.nome), ' ', 1)) as nome_sindico from public.perfis p) s
  where f.id = r.id and s.id = f.sindico_id;

  -- nível: crítico (prazo vencido ou 20+ dias em aberto), cobrança (10+ dias ou prazo em até 15 dias), atenção
  -- documentos com validade e gestão seguem o prazo; pendências da operação e cadastros faltantes também pesam pelo tempo em aberto
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

-- O app chama ao abrir (atualiza tudo; barato) e lê o que pode ver pela RLS
create or replace function public.fiscalizacao_atualizar() returns integer language sql security definer set search_path = '' as $$
  select privado.sincronizar_fiscalizacao()
$$;
revoke all on function public.fiscalizacao_atualizar() from public, anon;
grant execute on function public.fiscalizacao_atualizar() to authenticated, service_role;

-- Resposta à cobrança: "em andamento" (nova previsão + justificativa) ou "resolvendo agora". Próxima cobrança em 5 dias (ou amanhã).
create or replace function public.fiscalizacao_responder(p_id uuid, p_acao text, p_previsao date, p_justificativa text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f record; quem text; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into f from public.fiscalizacao where id = p_id and status = 'aberta';
  if f.id is null then raise exception 'Item não encontrado ou já resolvido.'; end if;
  if not (f.sindico_id = auth.uid() or f.responsavel_id = auth.uid() or f.condominio_id in (select privado.condominios_do_gestor()) or privado.eh_admin()) then
    raise exception 'Sem acesso a este item.';
  end if;
  select coalesce(nullif(btrim(tratamento), ''), split_part(btrim(nome), ' ', 1), 'Usuário') into quem from public.perfis where id = auth.uid();
  if p_acao = 'andamento' then
    if p_previsao is null or p_previsao < hoje then raise exception 'Informe a nova previsão (data de hoje em diante).'; end if;
    if length(btrim(coalesce(p_justificativa, ''))) < 5 then raise exception 'Escreva o motivo ou o que já foi feito (mínimo 5 letras).'; end if;
    update public.fiscalizacao set previsao = p_previsao, justificativa = left(btrim(p_justificativa), 500), respondido_em = now(), respondido_por = quem,
      cobrar_em = least(hoje + 5, greatest(p_previsao, hoje + 1)), cobrancas = cobrancas + 1,
      historico = historico || jsonb_build_object('em', now(), 'por', quem, 'acao', 'andamento', 'previsao', p_previsao, 'texto', left(btrim(p_justificativa), 500))
    where id = p_id;
  elsif p_acao = 'resolvendo' then
    update public.fiscalizacao set respondido_em = now(), respondido_por = quem, cobrar_em = hoje + 1, cobrancas = cobrancas + 1,
      historico = historico || jsonb_build_object('em', now(), 'por', quem, 'acao', 'resolvendo')
    where id = p_id;
  else raise exception 'Ação inválida.'; end if;
  return jsonb_build_object('ok', true, 'proxima_cobranca', (select cobrar_em from public.fiscalizacao where id = p_id));
end $$;
revoke all on function public.fiscalizacao_responder(uuid, text, date, text) from public, anon;
grant execute on function public.fiscalizacao_responder(uuid, text, date, text) to authenticated;

-- Todo dia 7h13 (Brasília): atualiza a fiscalização e dispara os e-mails de cobrança (a cada 5 dias por item)
select cron.unschedule('sindics-fiscalizacao') where exists (select 1 from cron.job where jobname = 'sindics-fiscalizacao');
select cron.schedule('sindics-fiscalizacao', '13 10 * * *', $cron$
  select net.http_post(
    url := 'https://hjjckvluydcejmrxolza.supabase.co/functions/v1/fiscalizacao',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sindics-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'sindics_cron_token')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$cron$);
