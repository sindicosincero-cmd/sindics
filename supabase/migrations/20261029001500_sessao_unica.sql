-- Uma conversa de voz por conta: quando dois aparelhos (ou duas abas) ouvem "SINDICS" ao mesmo tempo,
-- só o primeiro abre a conversa. A reserva vale 20 segundos; o mesmo aparelho pode reabrir quando quiser.
alter table public.perfis add column if not exists sessao_voz_em timestamptz, add column if not exists sessao_voz_aparelho text;

create or replace function privado.reservar_sessao_voz(p_uid uuid, p_aparelho text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare ok boolean;
begin
  update public.perfis set sessao_voz_em = now(), sessao_voz_aparelho = left(coalesce(p_aparelho, ''), 64)
   where id = p_uid
     and (sessao_voz_em is null or sessao_voz_em < now() - interval '20 seconds' or sessao_voz_aparelho = left(coalesce(p_aparelho, ''), 64))
  returning true into ok;
  return coalesce(ok, false);
end $$;
revoke all on function privado.reservar_sessao_voz(uuid, text) from public, anon, authenticated;
grant execute on function privado.reservar_sessao_voz(uuid, text) to service_role;

-- RPC pública só para o servidor (service_role); o app não chama direto
create or replace function public.reservar_sessao_voz(p_uid uuid, p_aparelho text)
returns boolean language sql security definer set search_path = '' as $$ select privado.reservar_sessao_voz(p_uid, p_aparelho) $$;
revoke all on function public.reservar_sessao_voz(uuid, text) from public, anon, authenticated;
grant execute on function public.reservar_sessao_voz(uuid, text) to service_role;
