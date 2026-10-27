create policy "admin - cria condominios" on public.condominios
  for insert to authenticated with check ((select privado.eh_admin()));
create policy "admin - altera condominios" on public.condominios
  for update to authenticated using ((select privado.eh_admin())) with check ((select privado.eh_admin()));
