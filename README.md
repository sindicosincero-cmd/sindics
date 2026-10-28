# SINDICS · Inteligência Condominial

Inteligência condominial por voz para síndicos. Ideia, produto e direção de **Elison Cardoso — Síndico Profissional** (Sindicância Ethics).

- **Site (vendas):** https://sindics.com.br/
- **Aplicativo:** https://sindics.com.br/app/

Este repositório guarda o **projeto completo**: o site, o aplicativo, o código do servidor, a estrutura do banco de dados e a configuração do agente de voz. Nenhuma chave secreta fica aqui: elas existem só nos "secrets" do Supabase.

## Como o projeto está organizado

| Pasta / arquivo | O que é | Onde roda |
|---|---|---|
| `index.html`, `pagina.js` | Landing page de vendas (planos e assinatura) | GitHub Pages — sindics.com.br |
| `app/` | O SINDICS: tela, voz, agenda, documentação legal, regras, comunicados, Operação do dia, relatório mensal, equipe, LGPD | GitHub Pages — sindics.com.br/app |
| `app/vendor/` | Bibliotecas de terceiros copiadas para o próprio site (com verificação de integridade) | — |
| `privacidade.html` | Política de Privacidade e Termos de Uso | sindics.com.br/privacidade.html |
| `assets/` | Tema claro/escuro e redirecionamentos | — |
| `supabase/migrations/` | Estrutura do banco de dados, em ordem cronológica (tabelas, regras de segurança por linha, gatilhos) | Supabase (projeto `hjjckvluydcejmrxolza`, São Paulo) |
| `supabase/functions/` | Funções do servidor (ver abaixo) | Supabase Edge Functions |
| `supabase/templates/` | Modelos dos e-mails de convite e de senha (com a senha temporária do gestor). Só podem ser aplicados no Supabase depois de configurar um servidor de e-mail próprio (SMTP) | Supabase → Authentication → Emails |
| `agente/prompt.md` | Instruções de comportamento da voz | ElevenLabs |
| `agente/ferramentas.json` | As 20 ferramentas que a voz usa | ElevenLabs |
| `agente/configuracao.json` | Voz, modelo, reconhecimento de fala, privacidade, segurança e limites | ElevenLabs |
| `.github/workflows/vendor.yml` | Rotina que baixa e confere as bibliotecas de `app/vendor/` | GitHub Actions |

### Funções do servidor (`supabase/functions/`)

| Função | Para que serve |
|---|---|
| `sessao-sindics` | Libera cada conversa de voz: confere login, assinatura e permissões; monta a saudação e o resumo do dia; escolhe a voz e os documentos do condomínio |
| `processar-documento` | Recebe o texto do Regulamento/Convenção (lido do PDF no aparelho) e ensina o SINDICS |
| `excluir-condominio` | Exclusão completa de um condomínio, a pedido do síndico |
| `radar-condominial` | Radar Condominial (notícias do setor) e busca de notícias |
| `assinar` | Assinatura via Asaas pelos planos Essencial (até 500 apartamentos) e Profissional (501 a 1.000), contando a soma dos apartamentos de todos os condomínios; link de pagamento; conexão do webhook |
| `asaas-webhook` | Recebe do Asaas pagamentos, atrasos e cancelamentos e libera ou bloqueia o acesso |
| `equipe` | Convida, reenvia acesso e remove gestores auxiliares. O convite leva uma senha temporária (72 horas, troca obrigatória no primeiro acesso); uma rotina de hora em hora invalida as senhas temporárias vencidas |

Existe ainda no Supabase uma função antiga `adicionar-voz-temp`, já desativada (responde 410) e sem uso; pode ser apagada.

## Segredos (não versionados)
Configurados no Supabase → Edge Functions → Secrets: `ELEVENLABS_API_KEY`, `ASAAS_API_KEY` (quando a cobrança for ligada) e, opcionalmente, `ASAAS_AMBIENTE`, `SINDICS_VALOR_ESSENCIAL`, `SINDICS_VALOR_PROFISSIONAL`, `SINDICS_LIMITE_GESTORES`. As chaves `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas pelo próprio Supabase.

## Como publicar uma alteração
- **Site e aplicativo:** qualquer alteração enviada para a branch `main` é publicada automaticamente pelo GitHub Pages em 1 a 2 minutos.
- **Funções do servidor:** `supabase functions deploy <nome> --project-ref hjjckvluydcejmrxolza --no-verify-jwt` (a autenticação é verificada dentro de cada função).
- **Banco de dados:** novas migrações em `supabase/migrations/` aplicadas com `supabase db push`.
- **Agente de voz:** alterações no painel da ElevenLabs; manter `agente/` atualizado como cópia de referência.

## Segurança e privacidade (resumo)
- Cada síndico só enxerga os próprios dados: regras de segurança por linha no banco (RLS) em todas as tabelas.
- Gestores auxiliares acessam só os condomínios autorizados pelo síndico.
- O diário operacional não pode ser editado nem apagado pelo aplicativo; a localização guarda só a distância até o condomínio.
- A voz só aceita conexões de `sindics.com.br` com token temporário emitido pelo servidor; a voz não é gravada e a transcrição é apagada em 90 dias.
- Política completa: `privacidade.html`.
