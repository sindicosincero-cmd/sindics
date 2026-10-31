-- Sentinela SINDICS: verifica a saúde do sistema a cada 10 minutos, corrige o que tem correção segura
-- e avisa o administrador quando não consegue resolver.

create table if not exists public.sentinela_eventos (
  id bigint generated always as identity primary key,
  verificado_em timestamptz not null default now(),
  verificacao text not null,
  status text not null check (status in ('ok','corrigido','alerta','falha')),
  detalhe text not null default '',
  acao text not null default '',
  alertado boolean not null default false
);
create index if not exists sentinela_eventos_ver_idx on public.sentinela_eventos (verificacao, verificado_em desc);
alter table public.sentinela_eventos enable row level security;
drop policy if exists "sentinela - admin lê" on public.sentinela_eventos;
create policy "sentinela - admin lê" on public.sentinela_eventos for select to authenticated using ((select privado.eh_admin()));

-- Coleta o que só o banco sabe: rotinas agendadas, chamadas HTTP feitas pelo agendador, assinaturas sem acesso,
-- relatório mensal, tamanho do banco. Só o service_role (a função da sentinela) chama.
create or replace function public.sentinela_coletar() returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb := '{}'::jsonb; agora_sp timestamp := now() at time zone 'America/Sao_Paulo'; mes_ant text;
begin
  -- rotinas agendadas: última execução de cada uma
  r := r || jsonb_build_object('rotinas', coalesce((
    select jsonb_agg(jsonb_build_object('nome', j.jobname, 'agenda', j.schedule, 'ativa', j.active, 'status', d.status,
      'inicio', d.start_time, 'msg', left(coalesce(d.return_message, ''), 200)) order by j.jobname)
    from cron.job j left join lateral (select * from cron.job_run_details x where x.jobid = j.jobid order by x.start_time desc limit 1) d on true
    where j.jobname like 'sindics-%'), '[]'::jsonb));

  -- respostas HTTP das funções chamadas pelo agendador nas últimas 24 h (falhas)
  r := r || jsonb_build_object('http_falhas', coalesce((
    select jsonb_agg(jsonb_build_object('id', h.id, 'codigo', h.status_code, 'erro', left(coalesce(h.error_msg, ''), 200), 'em', h.created))
    from net._http_response h where h.created > now() - interval '24 hours' and (h.status_code is null or h.status_code >= 400 or h.error_msg is not null)), '[]'::jsonb));

  -- assinaturas pagas cujo acesso não está liberado há mais de 30 minutos
  r := r || jsonb_build_object('assinaturas_sem_acesso', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'email_parcial', regexp_replace(a.email, '^(.{2}).*(@.*)$', '\1***\2'), 'desde', a.atualizado_em, 'msg', a.acesso_msg))
    from public.assinaturas a left join public.perfis p on p.id = a.sindico_id
    where a.status = 'ativa' and (a.sindico_id is null or coalesce(p.ativo, false) = false) and a.atualizado_em < now() - interval '30 minutes'), '[]'::jsonb));

  -- relatório mensal: no dia 1º depois das 12h, todos os condomínios com movimento no mês anterior devem ter relatório
  mes_ant := to_char(date_trunc('month', agora_sp) - interval '1 month', 'YYYY-MM');
  r := r || jsonb_build_object('relatorio', jsonb_build_object('mes', mes_ant, 'verificar', extract(day from agora_sp) = 1 and extract(hour from agora_sp) >= 12 or extract(day from agora_sp) between 2 and 3,
    'faltando', (select count(*) from public.condominios c
      where exists (select 1 from public.registros_operacionais o where o.condominio_id = c.id and to_char(o.ocorrido_em at time zone 'America/Sao_Paulo', 'YYYY-MM') = mes_ant)
        and not exists (select 1 from public.relatorios_mensais m where m.condominio_id = c.id and m.mes = mes_ant and m.enviado_em is not null))));

  -- fiscalização: a rotina diária rodou hoje (depois das 10h30)?
  r := r || jsonb_build_object('fiscalizacao_hoje', exists (
    select 1 from cron.job j join cron.job_run_details d on d.jobid = j.jobid
    where j.jobname = 'sindics-fiscalizacao' and d.status = 'succeeded' and (d.start_time at time zone 'America/Sao_Paulo')::date = agora_sp::date),
    'hora_sp', extract(hour from agora_sp) + extract(minute from agora_sp) / 60.0);

  r := r || jsonb_build_object('banco_bytes', pg_database_size(current_database()),
    'arquivos_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects));

  -- limpeza: eventos com mais de 30 dias
  delete from public.sentinela_eventos where verificado_em < now() - interval '30 days';
  return r;
end $$;
revoke all on function public.sentinela_coletar() from public, anon, authenticated;
grant execute on function public.sentinela_coletar() to service_role;

-- a sentinela (e só ela) lê o token do agendador para acionar as outras rotinas quando for chamada manualmente
create or replace function public.sentinela_token() returns text language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'sindics_cron_token'
$$;
revoke all on function public.sentinela_token() from public, anon, authenticated;
grant execute on function public.sentinela_token() to service_role;

-- a cada 10 minutos
select cron.unschedule('sindics-sentinela') where exists (select 1 from cron.job where jobname = 'sindics-sentinela');
select cron.schedule('sindics-sentinela', '*/10 * * * *', $cron$
  select net.http_post(
    url := 'https://hjjckvluydcejmrxolza.supabase.co/functions/v1/sentinela',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sindics-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'sindics_cron_token')),
    body := '{}'::jsonb, timeout_milliseconds := 60000)
$cron$);
