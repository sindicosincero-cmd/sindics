-- Novos campos do condomínio
alter table public.condominios
  add column if not exists cnpj text,
  add column if not exists endereco text not null default '',
  add column if not exists cep text not null default '',
  add column if not exists uf text not null default '';

-- Validação de CNPJ (numérico e o novo alfanumérico da Receita, 2026)
create or replace function privado.cnpj_valido(p text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  c text := upper(regexp_replace(coalesce(p,''), '[^0-9A-Za-z]', '', 'g'));
  pesos1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  pesos2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int; r int; d1 int; d2 int; i int;
begin
  if length(c) <> 14 then return false; end if;
  if c !~ '^[0-9A-Z]{12}[0-9]{2}$' then return false; end if;
  if c ~ '^(.)\1{13}$' then return false; end if;
  s := 0;
  for i in 1..12 loop s := s + (ascii(substr(c,i,1)) - 48) * pesos1[i]; end loop;
  r := s % 11; d1 := case when r < 2 then 0 else 11 - r end;
  if d1 <> (ascii(substr(c,13,1)) - 48) then return false; end if;
  s := 0;
  for i in 1..13 loop s := s + (ascii(substr(c,i,1)) - 48) * pesos2[i]; end loop;
  r := s % 11; d2 := case when r < 2 then 0 else 11 - r end;
  return d2 = (ascii(substr(c,14,1)) - 48);
end; $$;
revoke execute on function privado.cnpj_valido(text) from public, anon;
grant execute on function privado.cnpj_valido(text) to authenticated;

-- CNPJ único no sistema
create unique index if not exists condominios_cnpj_unico on public.condominios (cnpj) where cnpj is not null;

-- Regras de cadastro (vale para síndico e admin)
create or replace function privado.validar_condominio()
returns trigger language plpgsql security definer set search_path = '' as $$
declare eh_admin boolean := privado.eh_admin();
begin
  -- normaliza
  new.cnpj := nullif(upper(regexp_replace(coalesce(new.cnpj,''), '[^0-9A-Za-z]', '', 'g')), '');
  new.nome := btrim(new.nome);
  new.endereco := btrim(new.endereco);
  new.cep := regexp_replace(coalesce(new.cep,''), '[^0-9]', '', 'g');
  new.uf := upper(btrim(coalesce(new.uf,'')));

  -- campos obrigatórios em todo cadastro novo e em qualquer alteração
  if new.cnpj is null then raise exception 'Informe o CNPJ do condomínio.'; end if;
  if not privado.cnpj_valido(new.cnpj) then raise exception 'CNPJ inválido. Confira os números.'; end if;
  if length(new.nome) < 3 then raise exception 'Informe o nome do condomínio.'; end if;
  if length(new.endereco) < 5 then raise exception 'Informe o endereço do condomínio.'; end if;
  if new.unidades is null or new.unidades < 1 or new.unidades > 20000 then raise exception 'Informe a quantidade de apartamentos.'; end if;

  -- síndico comum não mexe em dono nem em documentos da base de conhecimento
  if not eh_admin and auth.uid() is not null then
    if tg_op = 'INSERT' then
      if new.sindico_id <> auth.uid() then raise exception 'Você só pode cadastrar condomínios na sua própria conta.'; end if;
      new.kb_doc_ids := '{}';
      new.documentos := 'sem documentos cadastrados';
    else
      new.sindico_id := old.sindico_id;
      new.kb_doc_ids := old.kb_doc_ids;
      new.documentos := old.documentos;
    end if;
  end if;
  return new;
end; $$;
revoke execute on function privado.validar_condominio() from public, anon, authenticated;
drop trigger if exists condominios_validar on public.condominios;
create trigger condominios_validar before insert or update on public.condominios
  for each row execute function privado.validar_condominio();

-- Síndico pode cadastrar e editar os próprios condomínios
alter table public.condominios alter column sindico_id set default auth.uid();
create policy "condominios proprios - criar" on public.condominios
  for insert to authenticated with check ((select auth.uid()) = sindico_id);
create policy "condominios proprios - alterar" on public.condominios
  for update to authenticated using ((select auth.uid()) = sindico_id) with check ((select auth.uid()) = sindico_id);
