// SINDICS — assinatura via Asaas.
// acao "assinar"            (público): cria cliente + assinatura mensal no Asaas e devolve o link de pagamento.
// acao "pagar"              (síndico logado): devolve o link da cobrança em aberto.
// acao "configurar_webhook" (admin): testa a chave do Asaas e cadastra o webhook que avisa pagamentos e atrasos.
import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGENS = ["https://sindics.com.br", "https://www.sindics.com.br", "https://sindicosincero-cmd.github.io"];
// Planos (mensalidade fixa por faixa de condomínios). Acima de 10 condomínios: sob consulta, fora do autoatendimento.
const PLANOS: Record<string, { nome: string; valor: number; max: number }> = {
  essencial: { nome: "Essencial", valor: Number(Deno.env.get("SINDICS_VALOR_ESSENCIAL") || "450"), max: 5 },
  profissional: { nome: "Profissional", valor: Number(Deno.env.get("SINDICS_VALOR_PROFISSIONAL") || "899"), max: 10 },
};
const TZ = "America/Sao_Paulo";
const SITE_URL = "https://sindics.com.br/app/";

function cors(origin: string | null) {
  const allow = origin && ORIGENS.includes(origin) ? origin : ORIGENS[0];
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}
const json = (b: unknown, s: number, o: string | null) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(o), "Content-Type": "application/json" } });
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const so = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function asaas() {
  const key = (Deno.env.get("ASAAS_API_KEY") || "").trim();
  if (!key) throw new Error("A cobrança automática ainda não foi configurada (falta a chave do Asaas).");
  const amb = (Deno.env.get("ASAAS_AMBIENTE") || "").toLowerCase();
  const prod = key.startsWith("$aact_prod_") || (!key.startsWith("$aact_hmlg_") && amb.startsWith("prod"));
  const base = prod ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
  const chamar = async (metodo: string, caminho: string, corpo?: unknown) => {
    const r = await fetch(base + caminho, { method: metodo, headers: { "access_token": key, "Content-Type": "application/json", "User-Agent": "SINDICS/1.0 (sindicosincero-cmd.github.io)" }, body: corpo ? JSON.stringify(corpo) : undefined });
    const t = await r.text(); let j: any = {}; try { j = t ? JSON.parse(t) : {}; } catch (_) { j = { bruto: t }; }
    if (!r.ok) { const d = j?.errors?.[0]?.description || j?.bruto || r.status; console.error("Asaas", metodo, caminho, r.status, t.slice(0, 300)); throw new Error("Asaas: " + d); }
    return j;
  };
  return { chamar, prod };
}

function cpfValido(c: string) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}
function cnpjValido(v: string) {
  const c = v.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c) || /^(.)\1{13}$/.test(c)) return false;
  const val = (ch: string) => ch.charCodeAt(0) - 48;
  const dv = (b: string, p: number[]) => { const s = [...b].reduce((t, ch, i) => t + val(ch) * p[i], 0) % 11; return s < 2 ? 0 : 11 - s; };
  return dv(c.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]) === Number(c[12]) && dv(c.slice(0, 13), [6,5,4,3,2,9,8,7,6,5,4,3,2]) === Number(c[13]);
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
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405, origin);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let b: any = {}; try { b = await req.json(); } catch (_) { /* */ }
  const acao = b.acao || "assinar";

  try {
    if (acao === "assinar") {
      const nome = String(b.nome || "").trim().replace(/\s+/g, " ");
      const email = String(b.email || "").trim().toLowerCase();
      const doc = String(b.cpf_cnpj || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
      const tel = so(b.telefone);
      if (nome.length < 5 || !/\s/.test(nome)) return json({ erro: "Informe seu nome completo." }, 400, origin);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ erro: "Informe um e-mail válido. É nele que você recebe o acesso." }, 400, origin);
      if (!(doc.length === 11 ? cpfValido(doc) : cnpjValido(doc))) return json({ erro: "CPF ou CNPJ inválido. Confira os números." }, 400, origin);
      if (tel.length < 10 || tel.length > 11) return json({ erro: "Informe o WhatsApp com DDD." }, 400, origin);
      const plano = PLANOS[String(b.plano || "essencial")] ? String(b.plano || "essencial") : "";
      if (!plano) return json({ erro: "Plano inválido. Para mais de 10 condomínios, fale com a nossa equipe." }, 400, origin);
      const VALOR = PLANOS[plano].valor;
      if (b.aceite !== true) return json({ erro: "Para assinar, aceite a Política de Privacidade e os Termos de Uso." }, 400, origin);

      // proteção contra abuso
      const umaHora = new Date(Date.now() - 3600e3).toISOString();
      const { count: ultimaHora } = await admin.from("assinaturas").select("id", { count: "exact", head: true }).gte("criado_em", umaHora);
      if ((ultimaHora ?? 0) >= 40) return json({ erro: "Muitas assinaturas iniciadas agora. Tente de novo em alguns minutos." }, 429, origin);

      const { data: existentes } = await admin.from("assinaturas").select("*").or(`email.eq."${email}",cpf_cnpj.eq."${doc}"`).order("criado_em", { ascending: false });
      const viva = (existentes || []).find((a) => a.status === "ativa" || a.status === "atrasada");
      if (viva) return json({ erro: "Já existe uma assinatura para este e-mail ou documento. Entre no SINDICS com seu e-mail; se precisar, fale com o suporte." }, 409, origin);
      const recente = (existentes || []).find((a) => a.status === "pendente" && a.link_pagamento && (a.plano || "essencial") === plano && Date.now() - Date.parse(a.criado_em) < 48 * 3600e3);
      if (recente) return json({ ok: true, link: recente.link_pagamento, reaproveitado: true }, 200, origin);

      const { chamar } = asaas();
      const { data: linha, error: e1 } = await admin.from("assinaturas").insert({ nome, email, cpf_cnpj: doc, telefone: tel, valor: VALOR, plano }).select("id").single();
      if (e1) throw e1;

      const achados = await chamar("GET", `/customers?cpfCnpj=${doc}&limit=1`);
      const cliente = achados?.data?.[0] || await chamar("POST", "/customers", { name: nome, cpfCnpj: doc, email, mobilePhone: tel, externalReference: "sindics" });
      const ass = await chamar("POST", "/subscriptions", {
        customer: cliente.id, billingType: "UNDEFINED", value: VALOR, nextDueDate: hojeSP(), cycle: "MONTHLY",
        description: `SINDICS — Inteligência Condominial · Plano ${PLANOS[plano].nome} (até ${PLANOS[plano].max} condomínios)`, externalReference: linha.id,
      });
      let link = "";
      for (let i = 0; i < 5 && !link; i++) {
        const pg = await chamar("GET", `/subscriptions/${ass.id}/payments`);
        link = pg?.data?.[0]?.invoiceUrl || "";
        if (!link) await new Promise((r) => setTimeout(r, 800));
      }
      await admin.from("assinaturas").update({ asaas_customer_id: cliente.id, asaas_subscription_id: ass.id, link_pagamento: link || null }).eq("id", linha.id);
      if (!link) return json({ ok: true, link: "", aviso: "Assinatura criada. O link de pagamento chega no seu e-mail em instantes." }, 200, origin);
      return json({ ok: true, link }, 200, origin);
    }

    // ---- ações de quem está logado ----
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = token ? await admin.auth.getUser(token) : { data: null as any };
    if (!u?.user) return json({ erro: "Faça login." }, 401, origin);

    if (acao === "pagar") {
      const { data: a } = await admin.from("assinaturas").select("*").eq("sindico_id", u.user.id).order("criado_em", { ascending: false }).limit(1).maybeSingle();
      if (!a) return json({ erro: "Nenhuma assinatura encontrada para esta conta." }, 404, origin);
      let link = a.link_pagamento || "";
      if (a.asaas_subscription_id) {
        try {
          const { chamar } = asaas();
          const atr = await chamar("GET", `/payments?subscription=${a.asaas_subscription_id}&status=OVERDUE&limit=10`);
          const pend = atr?.data?.length ? atr : await chamar("GET", `/payments?subscription=${a.asaas_subscription_id}&status=PENDING&limit=10`);
          const p = (pend?.data || []).sort((x: any, y: any) => String(x.dueDate).localeCompare(String(y.dueDate)))[0];
          if (p?.invoiceUrl) link = p.invoiceUrl;
        } catch (_) { /* usa o link salvo */ }
      }
      if (!link) return json({ erro: "Não há cobrança em aberto agora." }, 404, origin);
      return json({ ok: true, link }, 200, origin);
    }

    if (acao === "configurar_webhook") {
      const { data: p } = await admin.from("perfis").select("papel").eq("id", u.user.id).maybeSingle();
      if (p?.papel !== "admin") return json({ erro: "Apenas o administrador." }, 403, origin);
      const tok = await tokenWebhook();
      const { chamar, prod } = asaas();
      const url = Deno.env.get("SUPABASE_URL") + "/functions/v1/asaas-webhook";
      const lista = await chamar("GET", "/webhooks");
      const ja = (lista?.data || []).find((w: any) => w.url === url);
      const corpo = {
        name: "SINDICS — assinaturas", url, email: u.user.email, enabled: true, interrupted: false, apiVersion: 3, authToken: tok, sendType: "SEQUENTIALLY",
        events: ["PAYMENT_CREATED", "PAYMENT_UPDATED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_OVERDUE", "PAYMENT_DELETED", "PAYMENT_RESTORED", "PAYMENT_REFUNDED", "SUBSCRIPTION_DELETED", "SUBSCRIPTION_INACTIVATED"],
      };
      if (ja) await chamar("PUT", `/webhooks/${ja.id}`, corpo); else await chamar("POST", "/webhooks", corpo);
      return json({ ok: true, ambiente: prod ? "produção" : "sandbox (testes)", mensagem: `Asaas conectado (${prod ? "produção" : "sandbox de testes"}). Pagamentos e atrasos agora atualizam o SINDICS sozinhos.` }, 200, origin);
    }

    if (acao === "reenviar_convite") {
      const { data: p } = await admin.from("perfis").select("papel").eq("id", u.user.id).maybeSingle();
      if (p?.papel !== "admin") return json({ erro: "Apenas o administrador." }, 403, origin);
      const { data: a } = await admin.from("assinaturas").select("*").eq("id", b.assinatura_id).maybeSingle();
      if (!a) return json({ erro: "Assinatura não encontrada." }, 404, origin);
      if (a.status !== "ativa" && a.status !== "atrasada") return json({ erro: "Essa assinatura ainda não tem pagamento confirmado." }, 400, origin);
      let uid: string | null = a.sindico_id;
      if (!uid) { const { data: pf } = await admin.from("perfis").select("id").ilike("email", a.email).maybeSingle(); uid = pf?.id || null; }
      if (uid) {
        await admin.from("perfis").update({ ativo: true, plano: a.plano || "essencial" }).eq("id", uid);
        await admin.from("assinaturas").update({ sindico_id: uid }).eq("id", a.id);
        const { error } = await admin.auth.resetPasswordForEmail(a.email, { redirectTo: SITE_URL });
        if (error) return json({ erro: "Conta liberada, mas o e-mail não saiu: " + error.message }, 502, origin);
        return json({ ok: true, mensagem: "Conta liberada. Enviei um link para o síndico criar a senha." }, 200, origin);
      }
      const { data, error } = await admin.auth.admin.inviteUserByEmail(a.email, { redirectTo: SITE_URL, data: { nome: a.nome, telefone: a.telefone, email_contato: a.email } });
      if (error) return json({ erro: "O convite não saiu: " + error.message }, 502, origin);
      await admin.from("perfis").update({ ativo: true, plano: a.plano || "essencial" }).eq("id", data.user.id);
      await admin.from("assinaturas").update({ sindico_id: data.user.id }).eq("id", a.id);
      return json({ ok: true, mensagem: "Convite enviado para " + a.email + "." }, 200, origin);
    }

    return json({ erro: "Ação desconhecida." }, 400, origin);
  } catch (e) {
    console.error(e);
    return json({ erro: (e as Error).message || "Erro ao processar a assinatura." }, 502, origin);
  }
});
