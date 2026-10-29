// SINDICS — Fiscalização: roda todo dia (pg_cron). Atualiza a lista de pendências e manda e-mail de cobrança
// a cada 5 dias por item ao responsável (gestor do condomínio ou síndico). Itens críticos vão com o síndico em cópia.
import { createClient } from "jsr:@supabase/supabase-js@2";

const APP = "https://sindics.com.br/app/?fiscalizacao=1";
const TZ = "America/Sao_Paulo";
const NIVEL: Record<string, { rot: string; cor: string }> = { critico: { rot: "CRÍTICO", cor: "#ff5d5d" }, cobranca: { rot: "COBRANÇA", cor: "#ffb547" }, atencao: { rot: "ATENÇÃO", cor: "#e6c84a" } };
const ORDEM: Record<string, number> = { critico: 0, cobranca: 1, atencao: 2 };
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const r = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dBR = (d: string | null) => d ? d.split("-").reverse().join("/") : "—";
const dias = (de: string, ate: string) => Math.round((Date.parse(ate + "T00:00:00Z") - Date.parse(de.slice(0, 10) + "T00:00:00Z")) / 86400000);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return r({ erro: "Método não permitido." }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const tok = req.headers.get("x-sindics-cron") || "";
  const { data: ok } = tok ? await admin.rpc("conferir_token_cron", { t: tok }) : { data: false };
  if (ok !== true) return r({ erro: "Não autorizado." }, 401);
  let corpo: any = {}; try { corpo = await req.json(); } catch (_) { /* */ }

  await admin.rpc("fiscalizacao_atualizar");
  const hoje = hojeSP();
  const limite = new Date(Date.parse(hoje + "T00:00:00Z") - 5 * 86400000).toISOString().slice(0, 10);
  let q = admin.from("fiscalizacao").select("id, sindico_id, condominio_id, titulo, detalhe, prazo, aberto_em, nivel, responsavel_id, responsavel_nome, cobrancas, previsao, justificativa, ultimo_email")
    .eq("status", "aberta").or(`ultimo_email.is.null,ultimo_email.lte.${limite}`);
  if (/^[0-9a-f-]{36}$/.test(corpo?.sindico_id || "")) q = q.eq("sindico_id", corpo.sindico_id);
  const { data: itens } = await q;
  if (!itens?.length) return r({ ok: true, emails: 0 });

  const { data: conds } = await admin.from("condominios").select("id, nome");
  const nomeCond = new Map((conds || []).map((c) => [c.id, c.nome]));
  const ids = [...new Set(itens.flatMap((i) => [i.responsavel_id, i.sindico_id]).filter(Boolean))];
  const { data: pessoas } = await admin.from("perfis").select("id, email, nome, tratamento, ativo").in("id", ids);
  const P = new Map((pessoas || []).map((p) => [p.id, p]));

  // agrupa por responsável
  const grupos = new Map<string, any[]>();
  for (const i of itens) { const k = i.responsavel_id || i.sindico_id; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k)!.push(i); }

  const key = (Deno.env.get("RESEND_API_KEY") || "").trim();
  const de = Deno.env.get("EMAIL_REMETENTE") || "SINDICS <acesso@sindics.com.br>";
  if (!key) return r({ ok: true, emails: 0, aviso: "Sem RESEND_API_KEY." });
  let enviados = 0;
  for (const [resp, lista] of grupos) {
    const p = P.get(resp); if (!p?.email || p.ativo === false) continue;
    lista.sort((a, b) => ORDEM[a.nivel] - ORDEM[b.nivel] || String(a.prazo || "9").localeCompare(String(b.prazo || "9")));
    const criticos = lista.filter((i) => i.nivel === "critico");
    const cc = [...new Set(criticos.map((i) => i.sindico_id).filter((s) => s !== resp).map((s) => P.get(s)?.email).filter(Boolean))] as string[];
    const nome = esc((p.tratamento || "").trim() || (p.nome || "").trim().split(/\s+/)[0] || "");
    const linhas = lista.slice(0, 25).map((i) => {
      const n = NIVEL[i.nivel] || NIVEL.atencao;
      const aberto = dias(i.aberto_em, hoje);
      return `<tr><td style="padding:10px 12px;border-bottom:1px solid #1d2a44;vertical-align:top">
<span style="display:inline-block;font-size:11px;letter-spacing:1px;font-weight:bold;color:${n.cor};border:1px solid ${n.cor};padding:1px 6px;border-radius:4px">${n.rot}</span>
<span style="color:#9fb0c8;font-size:12px"> ${esc(nomeCond.get(i.condominio_id) || "")}</span><br>
<b style="color:#fff">${esc(i.titulo)}</b><br>
<span style="color:#9fb0c8;font-size:13px">${esc(i.detalhe)}</span><br>
<span style="font-size:12px;color:#c9d6e8">Prazo: ${dBR(i.prazo)} · em aberto há ${aberto} dia(s) · ${i.cobrancas} cobrança(s)${i.previsao ? ` · previsão informada: ${dBR(i.previsao)}` : ""}</span>
${i.justificativa ? `<br><span style="font-size:12px;color:#9fb0c8">Última justificativa: “${esc(i.justificativa)}”</span>` : ""}
</td></tr>`;
    }).join("");
    const assunto = criticos.length ? `SINDICS: ${criticos.length} pendência(s) crítica(s) sem solução` : `SINDICS: ${lista.length} pendência(s) aguardando você`;
    const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif;color:#e8eef8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:600px;background:#111a2e;border-radius:14px;padding:26px" cellpadding="0" cellspacing="0"><tr><td>
<p style="margin:0 0 4px;font-size:13px;letter-spacing:2px;color:${criticos.length ? "#ff5d5d" : "#7fb3ff"}">SINDICS · FISCALIZAÇÃO</p>
<h1 style="margin:0 0 12px;font-size:21px;color:#fff">${nome ? nome + ", " : ""}há pendências sem solução</h1>
<p style="margin:0 0 16px;line-height:1.55">A cada 5 dias o SINDICS cobra o que ainda está em aberto. Resolva ou informe a nova previsão com a justificativa: enquanto não for resolvido, o aviso continua.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;border-radius:10px">${linhas}</table>
${lista.length > 25 ? `<p style="color:#9fb0c8;font-size:13px">E mais ${lista.length - 25} item(ns) no sistema.</p>` : ""}
<p style="margin:20px 0 0" align="center"><a href="${APP}" style="display:inline-block;background:#2f7bff;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:bold">Abrir a fiscalização no SINDICS</a></p>
<p style="margin:16px 0 0;color:#9fb0c8;font-size:12px">${cc.length ? "O síndico responsável recebe cópia dos itens críticos. " : ""}Dúvidas: contato@sindics.com.br.</p>
</td></tr></table></td></tr></table></body></html>`;
    const texto = `SINDICS — Fiscalização\n\n` + lista.map((i) => `[${(NIVEL[i.nivel] || NIVEL.atencao).rot}] ${nomeCond.get(i.condominio_id) || ""}: ${i.titulo} — prazo ${dBR(i.prazo)}`).join("\n") + `\n\nAbrir: ${APP}`;
    try {
      const rr = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ from: de, to: [p.email], ...(cc.length ? { cc } : {}), reply_to: "contato@sindics.com.br", subject: assunto, html, text: texto }) });
      if (!rr.ok) { console.error("Resend", rr.status, (await rr.text()).slice(0, 300)); continue; }
      enviados++;
      await admin.from("fiscalizacao").update({ ultimo_email: hoje }).in("id", lista.map((i) => i.id));
    } catch (e) { console.error("Resend", e); }
  }
  return r({ ok: true, emails: enviados, itens: itens.length });
});
