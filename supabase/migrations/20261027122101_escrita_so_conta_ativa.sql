-- Conta liberada para gravar: perfil ativo e assinatura sem bloqueio (cancelada ou 5+ dias de atraso). Admin sempre.
create or replace function privado.conta_ativa() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.perfis p
    where p.id = auth.uid() and p.ativo
      and (p.papel = 'admin' or not exists (
        select 1 from (
          select a.status, a.atraso_desde from public.assinaturas a
          where a.sindico_id = p.id order by a.criado_em desc limit 1
        ) ult
        where ult.status = 'cancelada'
           or (ult.status = 'atrasada' and ult.atraso_desde is not null
               and (now() at time zone 'America/Sao_Paulo')::date - ult.atraso_desde >= 5)
      ))
  );
$$;
revoke all on function privado.conta_ativa() from public;
grant execute on function privado.conta_ativa() to authenticated;

alter policy "condominios proprios - criar" on public.condominios with check (((select auth.uid()) = sindico_id) and (select privado.conta_ativa()));
alter policy "condominios proprios - alterar" on public.condominios using (((select auth.uid()) = sindico_id) and (select privado.conta_ativa())) with check (((select auth.uid()) = sindico_id) and (select privado.conta_ativa()));

alter policy "documentos proprios - criar" on public.documentos_legais with check (((select auth.uid()) = sindico_id) and (select privado.conta_ativa()));
alter policy "documentos proprios - alterar" on public.documentos_legais using (((select auth.uid()) = sindico_id) and (select privado.conta_ativa())) with check (((select auth.uid()) = sindico_id) and (select privado.conta_ativa()));
alter policy "documentos proprios - apagar" on public.documentos_legais using (((select auth.uid()) = sindico_id) and (select privado.conta_ativa()));

alter policy "compromissos proprios - criar" on public.compromissos with check (((select auth.uid()) = sindico_id) and (select privado.conta_ativa()));
alter policy "compromissos proprios - alterar" on public.compromissos using (((select auth.uid()) = sindico_id) and (select privado.conta_ativa())) with check (((select auth.uid()) = sindico_id) and (select privado.conta_ativa()));
alter policy "compromissos proprios - apagar" on public.compromissos using (((select auth.uid()) = sindico_id) and (select privado.conta_ativa()));

alter policy "pdf proprio - enviar" on storage.objects with check (
  bucket_id = 'documentos-condominio'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.condominios c where c.id::text = (storage.foldername(objects.name))[2] and c.sindico_id = (select auth.uid()))
  and (select privado.conta_ativa()));
alter policy "pdf proprio - substituir" on storage.objects
  using (bucket_id = 'documentos-condominio' and (storage.foldername(name))[1] = (select auth.uid())::text and (select privado.conta_ativa()))
  with check (bucket_id = 'documentos-condominio' and (storage.foldername(name))[1] = (select auth.uid())::text and (select privado.conta_ativa()));

-- Tabelas só do servidor: deixa explícito que ninguém de fora lê nem grava
create policy "somente servidor" on public.asaas_eventos for all to anon, authenticated using (false) with check (false);
create policy "somente servidor" on public.radar_cache for all to anon, authenticated using (false) with check (false);
