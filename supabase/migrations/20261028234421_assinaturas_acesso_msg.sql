-- Situação do envio do acesso ao novo assinante (para o administrador acompanhar no painel)
alter table public.assinaturas add column if not exists acesso_msg text;
