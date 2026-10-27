alter table public.perfis add column if not exists tratamento text not null default '' check (char_length(tratamento) <= 40);
comment on column public.perfis.tratamento is 'Como o SINDICS chama o usuário na conversa (ex.: Sr. Cardoso). Vazio = primeiro nome.';
-- Em produção, esta migração também preencheu o tratamento da conta do administrador
-- (ajuste de dados pessoais, omitido deste repositório).
