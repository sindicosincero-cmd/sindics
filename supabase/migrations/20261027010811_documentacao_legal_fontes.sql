alter table public.documentos_catalogo add column if not exists fonte text not null default '';

update public.documentos_catalogo set
  base_legal = 'Licença estadual do Corpo de Bombeiros. SP: Decreto Estadual 69.118/2024 e IT 01/2025 – condomínio residencial, 3 anos. Vale a data de validade impressa no próprio auto.',
  fonte = 'IT 01/2025 do CBPMESP (item 4.2 e Anexo K); Decreto 69.118/2024'
where codigo = 'avcb';

update public.documentos_catalogo set
  base_legal = 'SP: IT 17/2025 do Corpo de Bombeiros, item 4.4.1.4.2 – atualização dos brigadistas a cada 12 meses; o atestado deve ter no máximo 12 meses na vistoria do AVCB.',
  fonte = 'IT 17/2025 – Brigada de incêndio (Portaria CCB 003/800/25)'
where codigo = 'brigada';

update public.documentos_catalogo set
  base_legal = 'SP: Decreto Estadual 12.342/1978, art. 10, §2º (limpeza periódica obrigatória) e Comunicado CVS 36/1991 (intervalo máximo de 6 meses). Nos demais estados, a Sabesp e a vigilância sanitária recomendam no mínimo semestral.',
  fonte = 'Decreto 12.342/1978; Comunicado CVS 36/1991'
where codigo = 'caixa_dagua';

update public.documentos_catalogo set
  base_legal = 'Município de São Paulo: Lei 10.348/1987 e Decreto 47.334/2006 – RIA emitido anualmente, pela internet, pela empresa conservadora registrada. Em outras cidades, verificar a lei municipal.',
  fonte = 'Lei 10.348/1987; Decreto 47.334/2006; Prefeitura de SP (RIA Online)'
where codigo = 'elevadores_ria';

update public.documentos_catalogo set
  base_legal = 'ABNT NBR 5419-3:2015, item 7.3 – inspeção completa a cada 3 anos (1 ano em atmosfera agressiva/litoral) e inspeção visual semestral. Laudo exigido na renovação do AVCB em SP.',
  fonte = 'ABNT NBR 5419-3:2015'
where codigo = 'spda';

update public.documentos_catalogo set
  base_legal = 'ABNT NBR 12962 – manutenção de 2º nível a cada 12 meses (1º nível semestral); exigida pelo Corpo de Bombeiros.',
  fonte = 'ABNT NBR 12962'
where codigo = 'extintores';

update public.documentos_catalogo set
  base_legal = 'ABNT NBR 12962 – manutenção de 3º nível (com teste hidrostático) a cada 5 anos.',
  fonte = 'ABNT NBR 12962'
where codigo = 'extintores_hidrostatico';

update public.documentos_catalogo set
  base_legal = 'NR-1, item 1.5.4.4.6 – avaliação de riscos revista a cada 2 anos (ou antes, se houver mudança, acidente ou nova exigência legal).',
  fonte = 'NR-1 (Ministério do Trabalho)'
where codigo = 'pgr';

update public.documentos_catalogo set fonte = 'NR-7 (Ministério do Trabalho)' where codigo = 'pcmso';
update public.documentos_catalogo set fonte = 'Código Civil, art. 1.346' where codigo = 'seguro_predial';
update public.documentos_catalogo set fonte = 'Lei 13.589/2018' where codigo = 'pmoc';
update public.documentos_catalogo set fonte = 'ABNT NBR 12779' where codigo = 'mangueiras';
update public.documentos_catalogo set fonte = 'Lei 10.348/1987 (município de SP)' where codigo = 'elevadores_contrato';
update public.documentos_catalogo set fonte = 'ABNT NBR 16747' where codigo = 'inspecao_predial';
