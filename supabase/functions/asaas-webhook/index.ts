// SINDICS — recebe os avisos do Asaas (pagamento confirmado, atraso, cancelamento)
// e mantém a assinatura e o acesso do síndico em dia. Bloqueio: 5 dias de atraso (calculado na hora do acesso).
import { createClient } from "jsr:@supabase/supabase-js@2";

const SITE_URL = "https://sindics.com.br/app/";
const r200 = (t = "ok") => new Response(t, { status: 200 });
// Senha temporária do primeiro acesso: vai no e-mail, vale 72 horas e precisa ser trocada ao entrar.
const VALIDADE_TEMP_H = 72;
function senhaTemporaria(): string {
  const M = "ABCDEFGHJKLMNPQRSTUVWXYZ", m = "abcdefghijkmnpqrstuvwxyz", d = "23456789", todos = M + m + d;
  const r = crypto.getRandomValues(new Uint32Array(12));
  const c = Array.from(r, (x, i) => (i === 0 ? M : i === 1 ? m : i === 2 ? d : todos)[x % (i === 0 ? M.length : i === 1 ? m.length : i === 2 ? d.length : todos.length)]);
  for (let i = c.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [c[i], c[j]] = [c[j], c[i]]; }
  const t = c.join(""); return `${t.slice(0, 4)}-${t.slice(4, 8)}-${t.slice(8)}`;
}
const metaTemp = (senha: string) => ({ senha_temporaria: senha, trocar_senha: true, senha_temp_expirada: false, senha_temp_expira: new Date(Date.now() + VALIDADE_TEMP_H * 3600000).toISOString() });

function asaas() {
  const key = (Deno.env.get("ASAAS_API_KEY") || "").trim();
  if (!key) return null;
  const amb = (Deno.env.get("ASAAS_AMBIENTE") || "").toLowerCase();
  const prod = key.startsWith("$aact_prod_") || (!key.startsWith("$aact_hmlg_") && amb.startsWith("prod"));
  const base = prod ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
  return async (caminho: string) => {
    const r = await fetch(base + caminho, { headers: { "access_token": key, "User-Agent": "SINDICS/1.0 (sindicosincero-cmd.github.io)" } });
    if (!r.ok) throw new Error("Asaas " + r.status + ": " + (await r.text()).slice(0, 200));
    return r.json();
  };
}
function igual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* Token do webhook derivado da chave de serviço do projeto: secreto, estável e sem precisar de outro segredo. */
async function tokenWebhook(): Promise<string> {
  const env = Deno.env.get("ASAAS_WEBHOOK_TOKEN") || "";
  if (env.length >= 32) return env;
  const dados = new TextEncoder().encode((Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "") + "|sindics-asaas-webhook");
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", dados));
  return "sdx" + [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Método não permitido.", { status: 405 });
  const tok = await tokenWebhook();
  if (!igual(req.headers.get("asaas-access-token") || "", tok)) return new Response("Não autorizado.", { status: 401 });

  let ev: any; try { ev = await req.json(); } catch (_) { return new Response("JSON inválido.", { status: 400 }); }
  if (!ev?.id || !ev?.event) return r200("ignorado");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // idempotência: o mesmo evento pode chegar mais de uma vez
  const { data: novo, error: eIns } = await admin.from("asaas_eventos").upsert({ id: ev.id, evento: ev.event, payload: ev }, { onConflict: "id", ignoreDuplicates: true }).select("id");
  if (eIns) { console.error(eIns); return new Response("Erro ao registrar.", { status: 500 }); }
  if (!novo?.length) return r200("duplicado");

  try {
    await processar(admin, ev);
    return r200();
  } catch (e) {
    console.error("webhook", ev.event, e);
    await admin.from("asaas_eventos").delete().eq("id", ev.id); // deixa o Asaas reenviar
    return new Response("Erro ao processar.", { status: 500 });
  }
});

async function processar(admin: any, ev: any) {
  const evento: string = ev.event;
  const subId: string | undefined = ev.payment?.subscription || (evento.startsWith("SUBSCRIPTION_") ? ev.subscription?.id : undefined);
  if (!subId) return;
  const { data: a } = await admin.from("assinaturas").select("*").eq("asaas_subscription_id", subId).maybeSingle();
  if (!a) return; // cobrança de outro produto

  if (evento === "SUBSCRIPTION_DELETED" || evento === "SUBSCRIPTION_INACTIVATED") {
    await admin.from("assinaturas").update({ status: "cancelada" }).eq("id", a.id);
    return;
  }
  const p = ev.payment || {};
  if (a.status === "cancelada") return;

  if (evento === "PAYMENT_OVERDUE") {
    const desde = a.atraso_desde && a.atraso_desde < p.dueDate ? a.atraso_desde : p.dueDate;
    await admin.from("assinaturas").update({ status: "atrasada", atraso_desde: desde, link_pagamento: p.invoiceUrl || a.link_pagamento }).eq("id", a.id);
    return;
  }
  if (evento === "PAYMENT_CREATED" || evento === "PAYMENT_UPDATED") {
    if (a.status === "ativa" && p.invoiceUrl) await admin.from("assinaturas").update({ link_pagamento: p.invoiceUrl }).eq("id", a.id);
    return;
  }

  // pagou, estornou, apagou ou restaurou: recalcula se ainda há cobrança vencida
  const pago = evento === "PAYMENT_CONFIRMED" || evento === "PAYMENT_RECEIVED";
  const consulta = asaas();
  let vencidas: any[] = [];
  if (consulta) {
    const r = await consulta(`/payments?subscription=${subId}&status=OVERDUE&limit=20`);
    vencidas = (r?.data || []).sort((x: any, y: any) => String(x.dueDate).localeCompare(String(y.dueDate)));
  }
  const patch: Record<string, unknown> = vencidas.length
    ? { status: "atrasada", atraso_desde: vencidas[0].dueDate, link_pagamento: vencidas[0].invoiceUrl }
    : { status: a.status === "pendente" && !pago ? "pendente" : "ativa", atraso_desde: null };
  if (pago) patch.ultimo_pagamento_em = new Date().toISOString();
  await admin.from("assinaturas").update(patch).eq("id", a.id);
  if (pago) {
    // falha ao criar a conta não pode travar a fila do Asaas: o admin reenvia o convite pelo painel
    try { await liberarConta(admin, a); } catch (e) { console.error("liberarConta", a.email, e); }
  }
}

/* Primeiro pagamento: cria a conta do síndico e envia por e-mail o acesso com uma senha temporária
   (válida por 72 horas; no primeiro acesso ele cria a senha pessoal). Pagamentos seguintes só mantêm a conta liberada. */
async function liberarConta(admin: any, a: any) {
  let uid: string | null = a.sindico_id, nova = false, msg = "";
  if (!uid) {
    const { data: p } = await admin.from("perfis").select("id").ilike("email", a.email).maybeSingle();
    uid = p?.id || null;
  }
  if (!uid) {
    nova = true;
    const senha = senhaTemporaria();
    const meta = { nome: a.nome, telefone: a.telefone, email_contato: a.email, convite: "assinante", ...metaTemp(senha) };
    if (Deno.env.get("RESEND_API_KEY")) {
      // e-mail próprio, em português, já com a senha temporária
      const { data: cu, error: ec } = await admin.auth.admin.createUser({ email: a.email, password: senha, email_confirm: true, user_metadata: meta });
      if (ec || !cu?.user) throw ec || new Error("createUser");
      uid = cu.user.id;
      msg = (await enviarAcesso(a.email, a.nome, senha))
        ? "Acesso enviado por e-mail com a senha temporária (válida por 72 horas)."
        : "Conta criada, mas o e-mail com o acesso não saiu. Use Reenviar acesso.";
    } else {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(a.email, { redirectTo: SITE_URL, data: meta });
      if (error) {
        console.error("convite assinante", a.email, error.message);
        const { data: cu, error: ec } = await admin.auth.admin.createUser({ email: a.email, password: senha, email_confirm: true, user_metadata: meta });
        if (ec || !cu?.user) throw ec || error;
        uid = cu.user.id; msg = "Conta criada, mas o e-mail com o acesso não saiu. Use Reenviar acesso.";
      } else {
        uid = data.user.id;
        const { error: ep } = await admin.auth.admin.updateUserById(uid, { password: senha, email_confirm: true });
        if (ep) { console.error("senha temporaria", ep.message); msg = "Convite enviado, mas a senha temporária não foi ativada. Use Reenviar acesso."; }
        else msg = "Convite enviado por e-mail (link). A senha temporária aparece em Reenviar acesso.";
      }
    }
  }
  const { data: pf } = await admin.from("perfis").select("papel").eq("id", uid).maybeSingle();
  const patchPerfil: Record<string, unknown> = { ativo: true };
  if (pf?.papel !== "admin") patchPerfil.plano = a.plano || "essencial";
  await admin.from("perfis").update(patchPerfil).eq("id", uid);
  const patchAss: Record<string, unknown> = {};
  if (a.sindico_id !== uid) patchAss.sindico_id = uid;
  if (nova) patchAss.acesso_msg = msg + " " + new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  if (Object.keys(patchAss).length) await admin.from("assinaturas").update(patchAss).eq("id", a.id);
}

/* E-mail de acesso em português, com a senha temporária, enviado pelo Resend (domínio sindics.com.br).
   Sem a chave RESEND_API_KEY nos segredos, devolve false e o fluxo antigo (convite padrão) continua valendo. */
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
async function enviarAcesso(email: string, nome: string, senha: string): Promise<boolean> {
  const key = (Deno.env.get("RESEND_API_KEY") || "").trim();
  if (!key) return false;
  const de = Deno.env.get("EMAIL_REMETENTE") || "SINDICS <acesso@sindics.com.br>";
  const primeiro = esc(String(nome || "").trim().split(/\s+/)[0] || "");
  const validade = new Date(Date.now() + VALIDADE_TEMP_H * 3600000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif;color:#e8eef8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#111a2e;border-radius:14px;padding:28px" cellpadding="0" cellspacing="0"><tr><td>
<p style="margin:0 0 4px;font-size:13px;letter-spacing:2px;color:#7fb3ff">SINDICS · INTELIGÊNCIA CONDOMINIAL</p>
<h1 style="margin:0 0 18px;font-size:22px;color:#fff">Seu acesso está liberado${primeiro ? ", " + primeiro : ""}</h1>
<p style="margin:0 0 16px;line-height:1.55">Recebemos o pagamento da sua assinatura. Use os dados abaixo para entrar pela primeira vez:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;border-radius:10px;margin:0 0 18px"><tr><td style="padding:16px 18px;line-height:1.7">
<span style="color:#9fb0c8">E-mail:</span> <strong style="color:#fff">${esc(email)}</strong><br>
<span style="color:#9fb0c8">Senha temporária:</span> <strong style="color:#fff;font-size:20px;letter-spacing:1px;font-family:Consolas,monospace">${esc(senha)}</strong><br>
<span style="color:#9fb0c8;font-size:13px">Válida até ${validade} (horário de Brasília).</span>
</td></tr></table>
<p style="margin:0 0 22px" align="center"><a href="${SITE_URL}" style="display:inline-block;background:#2f7bff;color:#fff;text-decoration:none;padding:13px 26px;border-radius:999px;font-weight:bold">Entrar no SINDICS</a></p>
<p style="margin:0 0 10px;line-height:1.55">Assim que entrar, o sistema pede para você criar a sua senha pessoal. A senha temporária deixa de valer nesse momento.</p>
<p style="margin:0;line-height:1.55;color:#9fb0c8;font-size:13px">Não pediu este acesso? Ignore este e-mail ou fale com contato@sindics.com.br.</p>
</td></tr></table></td></tr></table></body></html>`;
  const texto = `SINDICS — seu acesso está liberado.\n\nE-mail: ${email}\nSenha temporária: ${senha}\nVálida até ${validade} (horário de Brasília).\n\nEntre em ${SITE_URL} e crie a sua senha pessoal no primeiro acesso.\n\nDúvidas: contato@sindics.com.br`;
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from: de, to: [email], reply_to: "contato@sindics.com.br", subject: "Seu acesso ao SINDICS (senha temporária)", html, text: texto }) });
    if (!r.ok) { console.error("Resend", r.status, (await r.text()).slice(0, 300)); return false; }
    return true;
  } catch (e) { console.error("Resend", e); return false; }
}
