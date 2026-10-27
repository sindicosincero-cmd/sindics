alter table public.assinaturas add column if not exists plano text not null default 'essencial' check (plano in ('essencial','profissional','sob_consulta'));
