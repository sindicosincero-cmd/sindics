create schema if not exists privado;
revoke all on schema privado from public, anon;
grant usage on schema privado to authenticated;

create or replace function privado.eh_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfis where id = (select auth.uid()) and papel = 'admin' and ativo);
$$;
revoke execute on function privado.eh_admin() from public, anon;
grant execute on function privado.eh_admin() to authenticated;

drop policy "admin - le todos os perfis" on public.perfis;
drop policy "admin - atualiza perfis" on public.perfis;
drop policy "admin - le todos os condominios" on public.condominios;
create policy "admin - le todos os perfis" on public.perfis for select to authenticated using ((select privado.eh_admin()));
create policy "admin - atualiza perfis" on public.perfis for update to authenticated using ((select privado.eh_admin())) with check ((select privado.eh_admin()));
create policy "admin - le todos os condominios" on public.condominios for select to authenticated using ((select privado.eh_admin()));

drop function public.eh_admin();
