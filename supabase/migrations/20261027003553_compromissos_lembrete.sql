alter table public.compromissos
  add column if not exists lembrete_minutos integer not null default 30,
  add column if not exists lembrete_avisado_em timestamptz;
alter table public.compromissos
  add constraint compromissos_lembrete_faixa check (lembrete_minutos between 0 and 10080);
comment on column public.compromissos.lembrete_minutos is 'Quantos minutos antes do início o SINDICS dispara o alarme (0 = sem alarme). Padrão 30.';
comment on column public.compromissos.lembrete_avisado_em is 'Quando o alarme foi disparado; volta a nulo ao remarcar.';
create index if not exists compromissos_proximos_idx on public.compromissos (sindico_id, inicio) where status = 'agendado';
