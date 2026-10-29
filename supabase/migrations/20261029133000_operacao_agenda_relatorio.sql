-- Operação do dia → agenda: todo registro vira um item da agenda (feito); pendência vira compromisso para resolver.
alter table public.compromissos drop constraint if exists compromissos_origem_check;
alter table public.compromissos add constraint compromissos_origem_check check (origem in ('manual','calendario_legal','operacao'));

create or replace function privado.operacao_para_agenda() returns trigger language plpgsql security definer set search_path to '' as $$
declare rot text; titulo text; amanha timestamptz;
begin
  rot := case new.tipo when 'vistoria' then 'Ronda/vistoria' when 'manutencao' then 'Manutenção' when 'ocorrencia' then 'Ocorrência'
    when 'atendimento' then 'Atendimento' when 'prestador' then 'Prestador' when 'limpeza' then 'Limpeza' when 'seguranca' then 'Segurança'
    when 'administrativo' then 'Administrativo' else 'Registro' end;
  titulo := rot || ': ' || left(regexp_replace(new.descricao, '\s+', ' ', 'g'), 90) || case when length(new.descricao) > 90 then '…' else '' end;
  -- o que foi feito (fica na agenda como concluído, sem alarme)
  insert into public.compromissos (sindico_id, condominio_id, titulo, inicio, fim, observacoes, status, lembrete_minutos, origem, chave)
  values (new.sindico_id, new.condominio_id, titulo, new.ocorrido_em, new.ocorrido_em + interval '15 minutes',
          new.descricao || case when new.unidade is not null then ' (unid. ' || new.unidade || ')' else '' end || ' — registrado por ' || new.autor_nome || ' (' || new.autor_papel || ')',
          case when new.situacao = 'pendente' then 'agendado' else 'concluido' end, 0, 'operacao', 'op:' || new.id)
  on conflict do nothing;
  -- pendência: compromisso para resolver no próximo dia útil, às 9h, com aviso 30 min antes
  if new.situacao = 'pendente' then
    amanha := (date_trunc('day', new.ocorrido_em at time zone 'America/Sao_Paulo') + interval '1 day' + interval '9 hours') at time zone 'America/Sao_Paulo';
    while extract(isodow from amanha at time zone 'America/Sao_Paulo') > 5 loop amanha := amanha + interval '1 day'; end loop;
    insert into public.compromissos (sindico_id, condominio_id, titulo, inicio, fim, observacoes, status, lembrete_minutos, origem, chave)
    values (new.sindico_id, new.condominio_id, 'Resolver pendência: ' || left(regexp_replace(new.descricao, '\s+', ' ', 'g'), 80), amanha, amanha + interval '1 hour',
            'Pendência registrada em ' || to_char(new.ocorrido_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || ' por ' || new.autor_nome || '.', 'agendado', 30, 'operacao', 'oppend:' || new.id)
    on conflict do nothing;
  end if;
  -- solução de uma pendência: fecha os itens da pendência na agenda
  if new.referencia_id is not null then
    update public.compromissos set status = 'concluido' where chave in ('op:' || new.referencia_id, 'oppend:' || new.referencia_id) and status = 'agendado';
  end if;
  return new;
end $$;
drop trigger if exists registros_para_agenda on public.registros_operacionais;
create trigger registros_para_agenda after insert on public.registros_operacionais for each row execute function privado.operacao_para_agenda();

-- Relatório operacional automático: gerado no dia 1 de cada mês para o mês anterior e enviado por e-mail ao síndico.
create table if not exists public.relatorios_mensais (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.condominios(id) on delete cascade,
  sindico_id uuid not null references public.perfis(id) on delete cascade,
  mes text not null check (mes ~ '^\d{4}-\d{2}$'),
  resumo jsonb not null default '{}',
  gerado_em timestamptz not null default now(),
  enviado_em timestamptz,
  unique (condominio_id, mes)
);
alter table public.relatorios_mensais enable row level security;
create policy relatorios_mensais_ler on public.relatorios_mensais for select to authenticated
  using (sindico_id = (select auth.uid()) or condominio_id in (select privado.condominios_do_gestor()) or (select privado.eh_admin()));

-- Token do agendamento guardado no cofre do banco; a função confere sem expor o valor.
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'sindics_cron_token') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'sindics_cron_token', 'Autoriza o agendamento mensal do relatório');
  end if;
end $$;
create or replace function public.conferir_token_cron(t text) returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'sindics_cron_token' and decrypted_secret = t)
$$;
revoke all on function public.conferir_token_cron(text) from public, anon, authenticated;
grant execute on function public.conferir_token_cron(text) to service_role;

-- Dia 1 de cada mês, 8h17 (Brasília)
select cron.unschedule('sindics-relatorio-mensal') where exists (select 1 from cron.job where jobname = 'sindics-relatorio-mensal');
select cron.schedule('sindics-relatorio-mensal', '17 11 1 * *', $cron$
  select net.http_post(
    url := 'https://hjjckvluydcejmrxolza.supabase.co/functions/v1/relatorio-mensal',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sindics-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'sindics_cron_token')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$cron$);
