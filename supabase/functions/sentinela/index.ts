// SINDICS — Sentinela: roda a cada 10 minutos (pg_cron) ou quando o administrador toca em "Verificar agora".
// Verifica banco, rotinas agendadas, Asaas, voz, e-mail e site; corrige o que tem correção segura
// (reativar o webhook do Asaas, rodar de novo a fiscalização ou o relatório mensal) e avisa o administrador
// por e-mail quando não consegue resolver (no máximo um aviso por verificação a cada 6 horas).
import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGENS = ["https://sindics.com.br", "https://www.sindics.com.br", "https://sindicosincero-cmd.github.io"];
const AGENT_ID = "agent_6201m5wqfm4xet39s7vtbkh5axex";
const BASE = Deno.env.get("SUPABASE_URL")!;
const MB = 1024 * 1024;
const LIMITE_BANCO = Number(Deno.env.get("SENTINELA_LIMITE_BANCO_MB") || "400") * MB;   // plano gratuito: 500 MB
const LIMITE_ARQ = Number(Deno.env.get("SENTINELA_LIMITE_ARQUIVOS_MB") || "800") * MB;  // plano gratuito: 1 GB
type Ev = { verificacao: string; status: "ok" | "corrigido" | "alerta" | "falha"; detalhe: string; acao?: string };

function cors(origin: string | null) {
  const allow = origin && ORIGENS.includes(origin) ? origin : ORIGENS[0];
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}
const json = (b: unknown, s: number, o: string | null) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(o), "Content-Type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const buscar = (url: string, init: RequestInit = {}, ms = 12000) => { const c = new AbortController(); const id = setTimeout(() => c.abort(), ms); return fetch(url, { ...init, signal: c.signal }).finally(() => clearTimeout(id)); };

async function tokenWebhook(): Promise<string> {
  const env = Deno.env.get("ASAAS_WEBHOOK_TOKEN") || "";
  if (env.length >= 32) return env;
  const dados = new TextEncoder().encode((Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "") + "|sindics-asaas-webhook");
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", dados));
  return "sdx" + [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- verificações ---------- */
async function verificarBanco(admin: any, token: string): Promise<{ evs: Ev[]; dados: any }> {
  const evs: Ev[] = [];
  const { data: d, error } = await admin.rpc("sentinela_coletar");
  if (error || !d) return { evs: [{ verificacao: "banco", status: "falha", detalhe: "O banco não respondeu: " + (error?.message || "sem resposta") }], dados: null };
  evs.push({ verificacao: "banco", status: "ok", detalhe: `Banco ${Math.round(d.banco_bytes / MB)} MB · arquivos ${Math.round(d.arquivos_bytes / MB)} MB` });

  // espaço (limites do plano gratuito do Supabase)
  if (d.banco_bytes > LIMITE_BANCO || d.arquivos_bytes > LIMITE_ARQ)
    evs.push({ verificacao: "espaco", status: "alerta", detalhe: `Banco com ${Math.round(d.banco_bytes / MB)} MB e arquivos com ${Math.round(d.arquivos_bytes / MB)} MB, perto do limite do plano.`, acao: "Passar o Supabase para o plano Pro." });
  else evs.push({ verificacao: "espaco", status: "ok", detalhe: "Espaço dentro do limite." });

  // rotinas agendadas
  const falhas = (d.rotinas || []).filter((r: any) => r.status === "failed" || r.ativa === false);
  evs.push(falhas.length
    ? { verificacao: "rotinas", status: "alerta", detalhe: "Rotina com falha ou desligada: " + falhas.map((r: any) => `${r.nome} (${r.ativa === false ? "desligada" : r.msg || "falhou"})`).join("; ") }
    : { verificacao: "rotinas", status: "ok", detalhe: `${(d.rotinas || []).length} rotinas agendadas em ordem.` });

  // chamadas do agendador que voltaram com erro (24 h)
  const hf = d.http_falhas || [];
  evs.push(hf.length
    ? { verificacao: "chamadas", status: "alerta", detalhe: `${hf.length} chamada(s) do agendador com erro nas últimas 24 h (ex.: ${hf[0].codigo ?? ""} ${hf[0].erro || ""}).`.trim() }
    : { verificacao: "chamadas", status: "ok", detalhe: "Sem erros nas chamadas agendadas." });

  // fiscalização: se às 10h45 ainda não rodou hoje, roda agora
  if (!d.fiscalizacao_hoje && d.hora_sp >= 10.75) {
    const r = await buscar(BASE + "/functions/v1/fiscalizacao", { method: "POST", headers: { "Content-Type": "application/json", "x-sindics-cron": token }, body: "{}" }, 50000).catch((e) => ({ ok: false, status: String(e) } as any));
    evs.push(r.ok ? { verificacao: "fiscalizacao", status: "corrigido", detalhe: "A fiscalização de hoje não tinha rodado; rodei agora." }
      : { verificacao: "fiscalizacao", status: "falha", detalhe: "A fiscalização de hoje não rodou e a nova tentativa falhou (" + r.status + ")." });
  } else evs.push({ verificacao: "fiscalizacao", status: "ok", detalhe: d.fiscalizacao_hoje ? "Fiscalização de hoje feita." : "Fiscalização roda às 10h13." });

  // relatório mensal
  const rel = d.relatorio || {};
  if (rel.verificar && rel.faltando > 0) {
    const r = await buscar(BASE + "/functions/v1/relatorio-mensal", { method: "POST", headers: { "Content-Type": "application/json", "x-sindics-cron": token }, body: JSON.stringify({ mes: rel.mes }) }, 55000).catch((e) => ({ ok: false, status: String(e) } as any));
    evs.push(r.ok ? { verificacao: "relatorio", status: "corrigido", detalhe: `${rel.faltando} relatório(s) de ${rel.mes} não tinham saído; enviei agora.` }
      : { verificacao: "relatorio", status: "falha", detalhe: `${rel.faltando} relatório(s) de ${rel.mes} sem envio e a nova tentativa falhou (${r.status}).` });
  } else evs.push({ verificacao: "relatorio", status: "ok", detalhe: rel.verificar ? `Relatórios de ${rel.mes} enviados.` : "Próximo envio no dia 1º." });

  // assinatura paga sem acesso: dinheiro envolvido, só avisa
  const sa = d.assinaturas_sem_acesso || [];
  evs.push(sa.length
    ? { verificacao: "assinaturas", status: "alerta", detalhe: `${sa.length} assinatura(s) paga(s) sem acesso liberado: ${sa.map((a: any) => a.email_parcial).join(", ")}.`, acao: "Abrir Administração › Assinaturas e tocar em Reenviar acesso / Criar conta." }
    : { verificacao: "assinaturas", status: "ok", detalhe: "Todas as assinaturas pagas têm acesso." });
  return { evs, dados: d };
}

async function verificarAsaas(): Promise<Ev> {
  const key = (Deno.env.get("ASAAS_API_KEY") || "").trim();
  if (!key) return { verificacao: "asaas", status: "alerta", detalhe: "Chave do Asaas não configurada." };
  const prod = key.startsWith("$aact_prod_") || (!key.startsWith("$aact_hmlg_") && (Deno.env.get("ASAAS_AMBIENTE") || "").toLowerCase().startsWith("prod"));
  const base = prod ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
  const h = { "access_token": key, "Content-Type": "application/json", "User-Agent": "SINDICS/1.0 sentinela" };
  try {
    const r = await buscar(base + "/webhooks", { headers: h });
    if (!r.ok) return { verificacao: "asaas", status: "falha", detalhe: `O Asaas respondeu ${r.status} ao consultar o webhook.`, acao: "Conferir a chave do Asaas nos segredos do Supabase." };
    const lista = (await r.json())?.data || [];
    const url = BASE + "/functions/v1/asaas-webhook";
    const w = lista.find((x: any) => x.url === url);
    if (!w) return { verificacao: "asaas", status: "alerta", detalhe: "O webhook do SINDICS não está cadastrado no Asaas: pagamentos não liberam acesso sozinhos.", acao: "Administração › Conectar Asaas." };
    if (w.enabled === false || w.interrupted === true) {
      const corpo = { name: w.name || "SINDICS — assinaturas", url, email: w.email, enabled: true, interrupted: false, apiVersion: 3, authToken: await tokenWebhook(), sendType: w.sendType || "SEQUENTIALLY", events: w.events };
      const u = await buscar(base + "/webhooks/" + w.id, { method: "PUT", headers: h, body: JSON.stringify(corpo) });
      return u.ok ? { verificacao: "asaas", status: "corrigido", detalhe: `A fila de avisos do Asaas estava ${w.interrupted ? "interrompida" : "desligada"}; reativei. Os pagamentos represados serão processados agora.` }
        : { verificacao: "asaas", status: "falha", detalhe: `A fila do Asaas está interrompida e a reativação falhou (${u.status}).`, acao: "Administração › Conectar Asaas." };
    }
    return { verificacao: "asaas", status: "ok", detalhe: `Webhook ativo (${prod ? "produção" : "sandbox"}).` };
  } catch (e) { return { verificacao: "asaas", status: "falha", detalhe: "Asaas fora do ar ou sem resposta: " + String(e).slice(0, 120) }; }
}

async function verificarVoz(): Promise<Ev> {
  const key = Deno.env.get("ELEVENLABS_API_KEY") || "";
  if (!key) return { verificacao: "voz", status: "falha", detalhe: "Chave da ElevenLabs não configurada." };
  try {
    const r = await buscar(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${AGENT_ID}`, { headers: { "xi-api-key": key } });
    if (r.ok) return { verificacao: "voz", status: "ok", detalhe: "Voz disponível." };
    const t = (await r.text()).slice(0, 160);
    return { verificacao: "voz", status: "falha", detalhe: `A ElevenLabs respondeu ${r.status}: ${t}`, acao: r.status === 401 ? "Conferir a chave da ElevenLabs." : r.status === 402 || /quota|credit|limit/i.test(t) ? "Créditos ou minutos da ElevenLabs esgotados: recarregar ou subir o plano." : "Verificar o status da ElevenLabs." };
  } catch (e) { return { verificacao: "voz", status: "falha", detalhe: "ElevenLabs sem resposta: " + String(e).slice(0, 120) }; }
}

async function verificarEmail(): Promise<Ev> {
  const key = Deno.env.get("RESEND_API_KEY") || "";
  if (!key) return { verificacao: "email", status: "alerta", detalhe: "Chave do Resend não configurada: acessos e cobranças não saem por e-mail." };
  try {
    const r = await buscar("https://api.resend.com/domains", { headers: { "Authorization": "Bearer " + key } });
    if (r.status === 401 || r.status === 403) return { verificacao: "email", status: "ok", detalhe: "Chave de envio ativa (só envio; domínio não consultável)." };
    if (!r.ok) return { verificacao: "email", status: "falha", detalhe: `O Resend respondeu ${r.status}.` };
    const dom = ((await r.json())?.data || []).find((x: any) => x.name === "sindics.com.br");
    if (!dom) return { verificacao: "email", status: "alerta", detalhe: "Domínio sindics.com.br não encontrado no Resend." };
    return dom.status === "verified" ? { verificacao: "email", status: "ok", detalhe: "Domínio de e-mail verificado." }
      : { verificacao: "email", status: "alerta", detalhe: `Domínio de e-mail com status "${dom.status}": os e-mails podem não sair.`, acao: "Conferir os registros DNS na Hostinger." };
  } catch (e) { return { verificacao: "email", status: "falha", detalhe: "Resend sem resposta: " + String(e).slice(0, 120) }; }
}

async function verificarSite(): Promise<Ev> {
  try {
    const [a, b] = await Promise.all([buscar("https://sindics.com.br/app/", {}, 10000), buscar("https://sindics.com.br/", {}, 10000)]);
    const ta = a.ok ? await a.text() : "", tb = b.ok ? await b.text() : "";
    if (a.ok && b.ok && /SINDICS/.test(ta) && /SINDICS/.test(tb)) return { verificacao: "site", status: "ok", detalhe: "Site e aplicativo no ar." };
    return { verificacao: "site", status: "falha", detalhe: `Site ${b.status}, aplicativo ${a.status}.`, acao: "Verificar a hospedagem e o domínio." };
  } catch (e) { return { verificacao: "site", status: "falha", detalhe: "Site sem resposta: " + String(e).slice(0, 120) }; }
}

async function avisar(admin: any, evs: Ev[]) {
  const ruins = evs.filter((e) => e.status === "alerta" || e.status === "falha");
  if (!ruins.length) return 0;
  const seis = new Date(Date.now() - 6 * 3600000).toISOString();
  const { data: recentes } = await admin.from("sentinela_eventos").select("verificacao").eq("alertado", true).gte("verificado_em", seis).in("verificacao", ruins.map((e) => e.verificacao));
  const ja = new Set((recentes || []).map((x: any) => x.verificacao));
  const novos = ruins.filter((e) => !ja.has(e.verificacao));
  if (!novos.length) return 0;
  const key = Deno.env.get("RESEND_API_KEY") || "";
  const { data: adms } = await admin.from("perfis").select("email").eq("papel", "admin").eq("ativo", true);
  const para = (adms || []).map((a: any) => a.email).filter(Boolean);
  if (!key || !para.length) return 0;
  const linhas = novos.map((e) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #1d2a40;color:${e.status === "falha" ? "#ff8a95" : "#ffb547"};font-weight:bold;white-space:nowrap">${e.status === "falha" ? "FALHA" : "ALERTA"}</td><td style="padding:8px 10px;border-bottom:1px solid #1d2a40"><b>${esc(e.verificacao)}</b><br>${esc(e.detalhe)}${e.acao ? `<br><span style="color:#9fb0c8">O que fazer: ${esc(e.acao)}</span>` : ""}</td></tr>`).join("");
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif;color:#e8eef8"><table role="presentation" width="100%"><tr><td align="center" style="padding:28px 14px"><table role="presentation" width="100%" style="max-width:560px;background:#111a2e;border-radius:14px;padding:24px"><tr><td>
<p style="margin:0 0 4px;font-size:13px;letter-spacing:2px;color:#7fb3ff">SINDICS · SENTINELA</p>
<h1 style="margin:0 0 14px;font-size:20px;color:#fff">${novos.length} ponto(s) precisam de atenção</h1>
<table role="presentation" width="100%" style="font-size:14px;line-height:1.5;border-collapse:collapse">${linhas}</table>
<p style="margin:16px 0 0;font-size:12px;color:#9fb0c8">A sentinela verifica o sistema a cada 10 minutos e corrige sozinha o que é seguro. O mesmo aviso não se repete por 6 horas. Detalhes em Administração › Sentinela.</p>
</td></tr></table></td></tr></table></body></html>`;
  const r = await buscar("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("EMAIL_REMETENTE") || "SINDICS <acesso@sindics.com.br>", to: para, subject: `SINDICS · Sentinela: ${novos.map((e) => e.verificacao).join(", ")}`, html }) });
  if (!r.ok) { console.error("aviso sentinela", r.status, (await r.text()).slice(0, 200)); return 0; }
  novos.forEach((e) => ((e as any).alertado = true));
  return novos.length;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405, origin);
  const admin = createClient(BASE, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // autorização: agendador (token) ou administrador logado
  let token = req.headers.get("x-sindics-cron") || "";
  let ok = false;
  if (token) { const { data } = await admin.rpc("conferir_token_cron", { t: token }); ok = data === true; }
  if (!ok) {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = jwt ? await admin.auth.getUser(jwt) : { data: null as any };
    if (u?.user) { const { data: p } = await admin.from("perfis").select("papel").eq("id", u.user.id).maybeSingle(); ok = p?.papel === "admin"; }
    if (ok) { const { data: t } = await admin.rpc("sentinela_token"); token = t || ""; }
  }
  if (!ok) return json({ erro: "Não autorizado." }, 401, origin);

  const inicio = Date.now();
  const [b, ...outros] = await Promise.all([
    verificarBanco(admin, token).catch((e) => ({ evs: [{ verificacao: "banco", status: "falha", detalhe: String(e).slice(0, 200) } as Ev], dados: null })),
    verificarAsaas(), verificarVoz(), verificarEmail(), verificarSite(),
  ]);
  const evs: Ev[] = [...b.evs, ...outros];
  const alertas = await avisar(admin, evs).catch((e) => { console.error(e); return 0; });
  await admin.from("sentinela_eventos").insert(evs.map((e) => ({ verificacao: e.verificacao, status: e.status, detalhe: e.detalhe.slice(0, 1000), acao: (e.acao || "").slice(0, 300), alertado: !!(e as any).alertado })));
  const resumo = { ok: evs.filter((e) => e.status === "ok").length, corrigidos: evs.filter((e) => e.status === "corrigido").length, alertas: evs.filter((e) => e.status === "alerta").length, falhas: evs.filter((e) => e.status === "falha").length };
  return json({ ok: true, ...resumo, avisos_enviados: alertas, ms: Date.now() - inicio, eventos: evs }, 200, origin);
});
