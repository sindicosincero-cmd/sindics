alter table public.condominios
  add column if not exists convencao_status text not null default 'pendente'
    check (convencao_status in ('pendente','enviado','processando','pronto','erro')),
  add column if not exists regulamento_status text not null default 'pendente'
    check (regulamento_status in ('pendente','enviado','processando','pronto','erro')),
  add column if not exists convencao_msg text not null default '',
  add column if not exists regulamento_msg text not null default '',
  add column if not exists convencao_kb_id text,
  add column if not exists regulamento_kb_id text;

alter table public.condominios disable trigger condominios_validar;
update public.condominios
   set convencao_status = 'pronto', regulamento_status = 'pronto',
       convencao_kb_id = '1GR7sdDmGThK9nq8zAWs', regulamento_kb_id = 'hrpA9EZ2FZINXmTSGXNv'
 where kb_doc_ids @> array['1GR7sdDmGThK9nq8zAWs','hrpA9EZ2FZINXmTSGXNv'];
alter table public.condominios enable trigger condominios_validar;

create or replace function privado.validar_condominio()
returns trigger language plpgsql security definer set search_path = '' as $$
declare eh_admin boolean := privado.eh_admin();
begin
  new.cnpj := nullif(upper(regexp_replace(coalesce(new.cnpj,''), '[^0-9A-Za-z]', '', 'g')), '');
  new.nome := btrim(new.nome);
  new.endereco := btrim(new.endereco);
  new.cep := regexp_replace(coalesce(new.cep,''), '[^0-9]', '', 'g');
  new.uf := upper(btrim(coalesce(new.uf,'')));

  if new.cnpj is null then raise exception 'Informe o CNPJ do condomínio.'; end if;
  if not privado.cnpj_valido(new.cnpj) then raise exception 'CNPJ inválido. Confira os números.'; end if;
  if length(new.nome) < 3 then raise exception 'Informe o nome do condomínio.'; end if;
  if length(new.endereco) < 5 then raise exception 'Informe o endereço do condomínio.'; end if;
  if new.unidades is null or new.unidades < 1 or new.unidades > 20000 then raise exception 'Informe a quantidade de apartamentos.'; end if;

  if not eh_admin and auth.uid() is not null then
    if tg_op = 'INSERT' then
      if new.sindico_id <> auth.uid() then raise exception 'Você só pode cadastrar condomínios na sua própria conta.'; end if;
      new.kb_doc_ids := '{}';
      new.documentos := 'sem documentos cadastrados';
      new.convencao_status := 'pendente'; new.regulamento_status := 'pendente';
      new.convencao_msg := ''; new.regulamento_msg := '';
      new.convencao_kb_id := null; new.regulamento_kb_id := null;
    else
      new.sindico_id := old.sindico_id;
      new.kb_doc_ids := old.kb_doc_ids;
      new.documentos := old.documentos;
      new.convencao_status := old.convencao_status; new.regulamento_status := old.regulamento_status;
      new.convencao_msg := old.convencao_msg; new.regulamento_msg := old.regulamento_msg;
      new.convencao_kb_id := old.convencao_kb_id; new.regulamento_kb_id := old.regulamento_kb_id;
    end if;
  end if;
  return new;
end; $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos-condominio', 'documentos-condominio', false, 31457280, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 31457280, allowed_mime_types = array['application/pdf'];

create policy "pdf proprio - enviar" on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos-condominio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.condominios c where c.id::text = (storage.foldername(name))[2] and c.sindico_id = (select auth.uid())));
create policy "pdf proprio - substituir" on storage.objects for update to authenticated
  using (bucket_id = 'documentos-condominio' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'documentos-condominio' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "pdf proprio - ler" on storage.objects for select to authenticated
  using (bucket_id = 'documentos-condominio' and (storage.foldername(name))[1] = (select auth.uid())::text);
