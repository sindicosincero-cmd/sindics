-- Catálogo único de documentos obrigatórios/recomendados: vale para todos os condomínios.
create table if not exists public.documentos_catalogo (
  codigo text primary key,
  nome text not null,
  categoria text not null,
  exigencia text not null check (exigencia in ('lei','norma','recomendado')),
  base_legal text not null,
  validade_meses integer,                 -- null = depende do documento/contrato (síndico informa)
  validade_por_uf jsonb not null default '{}'::jsonb,  -- ex.: {"SP":36}
  alerta_dias integer not null default 30,
  condicao text,                          -- null = todo condomínio; senão "se houver ..."
  descricao text not null default '',
  ordem integer not null default 100
);
alter table public.documentos_catalogo enable row level security;
create policy "catalogo - leitura para logados" on public.documentos_catalogo for select to authenticated using (true);

insert into public.documentos_catalogo (codigo,nome,categoria,exigencia,base_legal,validade_meses,validade_por_uf,alerta_dias,condicao,descricao,ordem) values
('avcb','AVCB/CLCB – Licença do Corpo de Bombeiros','Segurança contra incêndio','lei','Legislação estadual de segurança contra incêndio. SP: Decreto 69.118/2024 e IT 01/2025 (Anexo K) – 3 anos para condomínios residenciais.',null,'{"SP":36}',120,null,'A renovação exige nova vistoria, ART de manutenção dos sistemas, atestado de brigada e laudos atualizados. Comece com antecedência.',10),
('seguro_predial','Seguro obrigatório da edificação','Seguro','lei','Código Civil, art. 1.346; Lei 4.591/1964, art. 13.',12,'{}',60,null,'Cobertura de incêndio ou destruição, total ou parcial, de toda a edificação. Apólice normalmente anual.',20),
('brigada','Atestado de brigada de incêndio','Segurança contra incêndio','lei','SP: IT 17/2025 do Corpo de Bombeiros – atualização dos brigadistas a cada 12 meses (exigido na vistoria do AVCB).',null,'{"SP":12}',45,null,'Treinamento/reciclagem dos brigadistas (funcionários e moradores voluntários) com novo atestado.',30),
('extintores','Manutenção e recarga dos extintores','Segurança contra incêndio','norma','ABNT NBR 12962 – manutenção anual; exigida pelo Corpo de Bombeiros.',12,'{}',30,null,'Empresa certificada pelo Inmetro. Guarde as notas e o selo de cada extintor.',40),
('extintores_hidrostatico','Teste hidrostático dos extintores','Segurança contra incêndio','norma','ABNT NBR 12962 – a cada 5 anos.',60,'{}',60,null,'Feito pela empresa de manutenção; confira a data gravada em cada extintor.',45),
('mangueiras','Inspeção e manutenção de mangueiras e hidrantes','Segurança contra incêndio','norma','ABNT NBR 12779 – inspeção semestral e manutenção anual.',12,'{}',30,null,'Inclui teste das mangueiras e verificação de esguichos e abrigos.',50),
('spda','Laudo de inspeção do SPDA (para-raios)','Segurança predial','norma','ABNT NBR 5419-3 – a cada 3 anos (1 ano em área litorânea ou atmosfera agressiva). Exigido na renovação do AVCB em SP.',36,'{}',60,null,'Também após raio direto no prédio, reforma ou dano visível. Profissional habilitado com ART.',60),
('laudo_eletrico','Laudo das instalações elétricas','Segurança predial','norma','ABNT NBR 5410; atestado exigido na vistoria do Corpo de Bombeiros.',null,'{}',60,null,'Renove junto com o AVCB ou após reformas elétricas. Profissional habilitado com ART.',65),
('elevadores_ria','RIA – Relatório de Inspeção Anual dos elevadores','Elevadores','lei','Lei municipal (em São Paulo: Lei 10.348/1987, art. 9º).',12,'{}',30,'se houver elevador','Emitido pela empresa conservadora ao fim do ciclo de 12 manutenções mensais. Fixe o relatório na casa de máquinas.',70),
('elevadores_contrato','Contrato com empresa conservadora de elevadores','Elevadores','lei','Lei municipal (em São Paulo: Lei 10.348/1987 – empresa registrada na Prefeitura).',null,'{}',60,'se houver elevador','Controle a vigência do contrato de manutenção mensal.',75),
('caixa_dagua','Limpeza e desinfecção dos reservatórios de água','Saúde e higiene','lei','Exigência sanitária – em SP, ao menos duas limpezas por ano.',6,'{}',20,null,'Empresa especializada, com certificado de execução. Recomenda-se análise da água logo após.',80),
('potabilidade','Análise de potabilidade da água','Saúde e higiene','recomendado','Boa prática sanitária após cada limpeza dos reservatórios.',6,'{}',20,null,'Coleta por laboratório independente, em frasco estéril.',85),
('dedetizacao','Controle de pragas (dedetização e desratização)','Saúde e higiene','recomendado','Sem periodicidade fixa em lei em SP; a vigilância sanitária orienta acompanhamento contínuo. Empresa deve seguir a RDC Anvisa 52/2009.',6,'{}',20,null,'Exija o certificado de execução e a ficha dos produtos usados.',90),
('pmoc','PMOC – manutenção do ar-condicionado','Climatização','lei','Lei 13.589/2018 – áreas comuns com climatização acima de 60.000 BTU.',12,'{}',30,'se houver ar-condicionado acima de 60.000 BTU nas áreas comuns','Plano com responsável técnico; mantenha as revisões em dia.',100),
('pgr','PGR – Programa de Gerenciamento de Riscos','Funcionários próprios','lei','NR-1 – avaliação de riscos revista a cada 2 anos.',24,'{}',45,'se houver funcionários contratados pelo condomínio','Não se aplica se toda a mão de obra for terceirizada (a terceirizada mantém o dela).',110),
('pcmso','PCMSO – relatório analítico anual','Funcionários próprios','lei','NR-7, item 7.6.2 – relatório anual do médico responsável.',12,'{}',45,'se houver funcionários contratados pelo condomínio','Inclui os exames ocupacionais periódicos.',115),
('certificado_digital','Certificado digital do condomínio (e-CNPJ)','Administrativo','recomendado','Necessário para eSocial, DCTFWeb e serviços da Receita Federal.',null,'{}',30,null,'Validade de 1 a 3 anos, conforme o tipo comprado.',120),
('inspecao_predial','Laudo de inspeção predial','Segurança predial','recomendado','ABNT NBR 16747; obrigatório em alguns municípios (ex.: Rio de Janeiro, autovistoria a cada 5 anos).',60,'{}',90,null,'Avaliação geral de estrutura, fachada, instalações e manutenção.',130),
('gas','Inspeção da rede de gás (estanqueidade)','Segurança predial','recomendado','ABNT NBR 15526; exigências variam conforme estado e concessionária.',null,'{}',60,'se houver gás encanado','Combine a periodicidade com a empresa responsável.',140)
on conflict (codigo) do update set nome=excluded.nome, categoria=excluded.categoria, exigencia=excluded.exigencia, base_legal=excluded.base_legal,
  validade_meses=excluded.validade_meses, validade_por_uf=excluded.validade_por_uf, alerta_dias=excluded.alerta_dias, condicao=excluded.condicao, descricao=excluded.descricao, ordem=excluded.ordem;

-- Documentos de cada condomínio passam a se ligar ao catálogo
alter table public.documentos_legais
  add column if not exists catalogo_codigo text references public.documentos_catalogo(codigo),
  add column if not exists situacao text not null default 'ativo' check (situacao in ('ativo','nao_aplica'));
alter table public.documentos_legais alter column data_vencimento drop not null;
alter table public.documentos_legais add constraint documentos_legais_ativo_tem_vencimento check (situacao = 'nao_aplica' or data_vencimento is not null);
create unique index if not exists documentos_legais_catalogo_unico on public.documentos_legais (condominio_id, catalogo_codigo) where catalogo_codigo is not null;
