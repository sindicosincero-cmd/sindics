create table if not exists public.radar_cache (
  chave text primary key,            -- ex.: '2026-10-26'
  itens jsonb not null default '[]'::jsonb,
  gerado_em timestamptz not null default now()
);
alter table public.radar_cache enable row level security;  -- só o servidor (service role) lê e grava
comment on table public.radar_cache is 'Notícias do Radar Condominial já buscadas e filtradas, compartilhadas entre todos os síndicos.';
