-- Plano por total de apartamentos da carteira: Essencial até 500, Profissional até 1.000.
-- Sem assinatura (administrador, contas liberadas manualmente) ou plano sob consulta: sem limite automático.
-- Edição que não aumenta apartamentos nem troca de dono nunca é bloqueada.
create or replace function privado.conferir_limite_apartamentos() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_plano text; v_limite integer; v_total integer;
begin
  if tg_op = 'UPDATE' and new.sindico_id = old.sindico_id and coalesce(new.unidades, 0) <= coalesce(old.unidades, 0) then
    return new;
  end if;
  select s.plano into v_plano from public.assinaturas s
   where s.sindico_id = new.sindico_id and s.status <> 'cancelada'
   order by s.criado_em desc limit 1;
  v_limite := case v_plano when 'essencial' then 500 when 'profissional' then 1000 else null end;
  if v_limite is null then return new; end if;
  select coalesce(sum(c.unidades), 0) into v_total from public.condominios c
   where c.sindico_id = new.sindico_id and c.id <> new.id;
  v_total := v_total + coalesce(new.unidades, 0);
  if v_total > v_limite then
    raise exception 'Sua carteira passaria a ter % apartamentos, acima do limite de % do plano %. Para continuar, mude de plano pelo e-mail contato@sindics.com.br.',
      v_total, v_limite, initcap(v_plano) using errcode = 'P0001', hint = 'limite_plano';
  end if;
  return new;
end $$;
revoke all on function privado.conferir_limite_apartamentos() from public, anon, authenticated;

drop trigger if exists limite_plano_apartamentos on public.condominios;
create trigger limite_plano_apartamentos before insert or update of unidades, sindico_id on public.condominios
  for each row execute function privado.conferir_limite_apartamentos();

alter table public.assinaturas alter column valor set default 550;
