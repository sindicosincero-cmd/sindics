# SINDICS

Assistente de voz do síndico, no estilo JARVIS. Criado por **Elison Cardoso — Síndico Profissional** (Sindicância Ethics).

**Acesso:** https://sindicosincero-cmd.github.io/sindics/ (Chrome no computador ou Android)

- Diga **"SINDICS"** para chamar; **"pode descansar"** para encerrar. Barra de espaço também funciona.
- Consulta a convenção e o regulamento de cada condomínio, notícias do Brasil e indicadores do Banco Central.
- Voz e inteligência via ElevenLabs Agents.

## Segurança (Fase 1)
- O agente só aceita conexões vindas de `sindicosincero-cmd.github.io`.
- Limite de 3 conversas simultâneas e 150 por dia.
- Os documentos dos condomínios ficam apenas na ElevenLabs, nunca neste repositório.

## Perfil do síndico
No `index.html`, o bloco `PERFIL` define nome, assinatura, empresa e condomínios. Esses dados são enviados ao agente a cada conversa. Na Fase 2 o perfil passa a vir do login de cada síndico.

## Roteiro
1. **Fase 1 — base segura** (concluída): instruções genéricas, trava de endereço, limites de uso.
2. **Fase 2 — piloto (3 a 5 síndicos)**: login, backend, agente privado com acesso temporário, base por condomínio.
3. **Fase 3 — produto**: cobrança, painel de documentos, termos de uso e LGPD, domínio próprio.
