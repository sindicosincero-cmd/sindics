// SINDICS — relatório operacional automático. Roda no dia 1 de cada mês (pg_cron) para o mês anterior:
// resume a Operação do dia de cada condomínio, guarda em relatorios_mensais e manda o resumo por e-mail ao síndico,
// com o link que abre o relatório completo (para imprimir ou salvar em PDF) no SINDICS.
import { createClient } from "jsr:@supabase/supabase-js@2";

const TZ = "America/Sao_Paulo";
const APP = "https://sindics.com.br/app/";
const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const TIPOS: Record<string, string> = { vistoria: "Vistorias e rondas", manutencao: "Manutenções", ocorrencia: "Ocorrências", atendimento: "Atendimentos a moradores", prestador: "Prestadores e fornecedores", limpeza: "Limpeza", seguranca: "Segurança", administrativo: "Administrativo", outro: "Outros" };
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const r = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

function mesAnterior(): string {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
function limites(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  const prox = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { ini: new Date(`${mes}-01T00:00:00-03:00`).toISOString(), fim: new Date(`${prox}-01T00:00:00-03:00`).toISOString() };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return r({ erro: "Método não permitido." }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const tok = req.headers.get("x-sindics-cron") || "";
  const { data: ok } = tok ? await admin.rpc("conferir_token_cron", { t: tok }) : { data: false };
  if (ok !== true) return r({ erro: "Não autorizado." }, 401);

  let corpo: any = {}; try { corpo = await req.json(); } catch (_) { /* */ }
  const mes = /^\d{4}-\d{2}$/.test(corpo?.mes || "") ? corpo.mes : mesAnterior();
  const reenviar = corpo?.reenviar === true;
  const { ini, fim } = limites(mes);
  const [ano, mm] = mes.split("-").map(Number);
  const nomeMes = `${MESES[mm - 1]} de ${ano}`;

  // teste: corpo.sindico_id limita a um síndico só
  const qc = admin.from("condominios").select("id, nome, sindico_id");
  const { data: conds } = await (/^[0-9a-f-]{36}$/.test(corpo?.sindico_id || "") ? qc.eq("sindico_id", corpo.sindico_id) : qc);
  const porSindico = new Map<string, any[]>();
  for (const c of conds || []) {
    const { data: ja } = await admin.from("relatorios_mensais").select("id, enviado_em").eq("condominio_id", c.id).eq("mes", mes).maybeSingle();
    if (ja?.enviado_em && !reenviar) continue;
    const [{ data: regs }, { data: abertas }] = await Promise.all([
      admin.from("registros_operacionais").select("tipo, situacao, local_status, referencia_id").eq("condominio_id", c.id).gte("ocorrido_em", ini).lt("ocorrido_em", fim),
      admin.from("registros_operacionais").select("descricao, ocorrido_em").eq("condominio_id", c.id).eq("situacao", "pendente").lt("ocorrido_em", fim).order("ocorrido_em").limit(5),
    ]);
    const lista = regs || [];
    const porTipo: Record<string, number> = {};
    lista.forEach((x) => { porTipo[x.tipo] = (porTipo[x.tipo] || 0) + 1; });
    const comLocal = lista.filter((x) => x.local_status === "no_condominio" || x.local_status === "fora");
    const resumo = {
      total: lista.length,
      por_tipo: porTipo,
      pendencias_abertas: (abertas || []).length,
      pendencias_exemplo: (abertas || []).map((a) => a.descricao.slice(0, 120)),
      solucoes: lista.filter((x) => x.referencia_id).length,
      presenca_confirmada_pct: comLocal.length ? Math.round(comLocal.filter((x) => x.local_status === "no_condominio").length / comLocal.length * 100) : null,
    };
    await admin.from("relatorios_mensais").upsert({ condominio_id: c.id, sindico_id: c.sindico_id, mes, resumo, gerado_em: new Date().toISOString() }, { onConflict: "condominio_id,mes" });
    if (!porSindico.has(c.sindico_id)) porSindico.set(c.sindico_id, []);
    porSindico.get(c.sindico_id)!.push({ ...c, resumo });
  }

  const key = (Deno.env.get("RESEND_API_KEY") || "").trim();
  const de = Deno.env.get("EMAIL_REMETENTE") || "SINDICS <acesso@sindics.com.br>";
  let enviados = 0;
  for (const [sid, lista] of porSindico) {
    const { data: p } = await admin.from("perfis").select("email, nome, tratamento, ativo").eq("id", sid).maybeSingle();
    if (!p?.email || !p.ativo || !key) continue;
    const nome = esc((p.tratamento || "").trim() || (p.nome || "").trim().split(/\s+/)[0] || "");
    const blocos = lista.map((c) => {
      const s = c.resumo;
      const tipos = Object.entries(s.por_tipo as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(TIPOS[k] || k)}: <b>${v}</b>`).join(" · ") || "Nenhum registro no mês.";
      const link = `${APP}?relatorio=${c.id}&mes=${mes}`;
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;border-radius:10px;margin:0 0 14px"><tr><td style="padding:16px 18px;line-height:1.6">
<p style="margin:0 0 6px;font-size:16px;color:#fff"><b>${esc(c.nome)}</b></p>
<p style="margin:0 0 6px">${s.total} registro(s) · ${s.solucoes} solução(ões) · ${s.pendencias_abertas} pendência(s) em aberto${s.presenca_confirmada_pct != null ? ` · presença confirmada em ${s.presenca_confirmada_pct}%` : ""}</p>
<p style="margin:0 0 8px;color:#9fb0c8;font-size:13px">${tipos}</p>
${s.pendencias_exemplo.length ? `<p style="margin:0 0 8px;color:#ffb547;font-size:13px">Pendências: ${s.pendencias_exemplo.map(esc).join("; ")}</p>` : ""}
<a href="${link}" style="display:inline-block;background:#2f7bff;color:#fff;text-decoration:none;padding:9px 18px;border-radius:999px;font-weight:bold;font-size:14px">Abrir relatório completo</a>
</td></tr></table>`;
    }).join("");
    const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif;color:#e8eef8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#111a2e;border-radius:14px;padding:28px" cellpadding="0" cellspacing="0"><tr><td>
<p style="margin:0 0 4px;font-size:13px;letter-spacing:2px;color:#7fb3ff">SINDICS · RELATÓRIO OPERACIONAL</p>
<h1 style="margin:0 0 14px;font-size:22px;color:#fff">Seu mês de ${esc(nomeMes)}${nome ? ", " + nome : ""}</h1>
<p style="margin:0 0 18px;line-height:1.55">O SINDICS fechou a Operação do dia de ${esc(nomeMes)}. O resumo de cada condomínio está abaixo; o relatório completo abre no SINDICS, pronto para imprimir ou salvar em PDF para o conselho e a assembleia.</p>
${blocos}
<p style="margin:16px 0 0;line-height:1.55;color:#9fb0c8;font-size:12px">Relatório gerado automaticamente todo dia 1º. Dúvidas: contato@sindics.com.br.</p>
</td></tr></table></td></tr></table></body></html>`;
    const texto = `SINDICS — relatório operacional de ${nomeMes}\n\n` + lista.map((c) => `${c.nome}: ${c.resumo.total} registros, ${c.resumo.pendencias_abertas} pendências em aberto. Relatório: ${APP}?relatorio=${c.id}&mes=${mes}`).join("\n");
    try {
      const rr = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ from: de, to: [p.email], reply_to: "contato@sindics.com.br", subject: `SINDICS: relatório operacional de ${nomeMes}`, html, text: texto }) });
      if (!rr.ok) { console.error("Resend", rr.status, (await rr.text()).slice(0, 300)); continue; }
      enviados++;
      await admin.from("relatorios_mensais").update({ enviado_em: new Date().toISOString() }).eq("mes", mes).in("condominio_id", lista.map((c) => c.id));
    } catch (e) { console.error("Resend", e); }
  }
  return r({ ok: true, mes, condominios: [...porSindico.values()].flat().length, emails: enviados });
});
