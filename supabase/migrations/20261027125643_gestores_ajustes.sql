alter table public.gestores add column if not exists sindico_nome text not null default '';
-- gestor não cria condomínio próprio (só o síndico cadastra)
alter policy "condominios proprios - criar" on public.condominios with check (
  ((select auth.uid()) = sindico_id) and (select privado.conta_ativa())
  and not exists (select 1 from public.perfis p where p.id = (select auth.uid()) and p.papel = 'gestor'));
