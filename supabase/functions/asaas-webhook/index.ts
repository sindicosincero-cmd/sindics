// SINDICS — recebe os avisos do Asaas (pagamento confirmado, atraso, cancelamento)
// e mantém a assinatura e o acesso do síndico em dia. Bloqueio: 5 dias de atraso (calculado na hora do acesso).
import { createClient } from "jsr:@supabase/supabase-js@2";

const SITE_URL = "https://sindics.com.br/app/";
const r200 = (t = "ok") => new Response(t, { status: 200 });

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

/* Primeiro pagamento: cria (ou libera) a conta do síndico e envia o convite para ele criar a senha. */
async function liberarConta(admin: any, a: any) {
  let uid: string | null = a.sindico_id;
  if (!uid) {
    const { data: p } = await admin.from("perfis").select("id").ilike("email", a.email).maybeSingle();
    uid = p?.id || null;
  }
  if (!uid) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(a.email, { redirectTo: SITE_URL, data: { nome: a.nome, telefone: a.telefone, email_contato: a.email } });
    if (error) throw error;
    uid = data.user.id;
  }
  await admin.from("perfis").update({ ativo: true, plano: a.plano || "essencial" }).eq("id", uid);
  if (a.sindico_id !== uid) await admin.from("assinaturas").update({ sindico_id: uid }).eq("id", a.id);
}
