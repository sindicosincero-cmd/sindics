-- Senha temporária do convite de gestor: depois de 72 horas sem troca, deixa de funcionar no servidor
-- (a senha é embaralhada e o texto da senha temporária é apagado do cadastro).
create extension if not exists pg_cron;

create or replace function privado.expirar_senhas_temporarias() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update auth.users
     set encrypted_password = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
         raw_user_meta_data = (raw_user_meta_data - 'senha_temporaria') || jsonb_build_object('senha_temp_expirada', true),
         updated_at = now()
   where raw_user_meta_data->>'trocar_senha' = 'true'
     and coalesce(raw_user_meta_data->>'senha_temp_expirada', 'false') <> 'true'
     and (raw_user_meta_data->>'senha_temp_expira')::timestamptz < now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function privado.expirar_senhas_temporarias() from public, anon, authenticated;

select cron.schedule('sindics-expirar-senhas-temporarias', '17 * * * *', $$select privado.expirar_senhas_temporarias()$$);
