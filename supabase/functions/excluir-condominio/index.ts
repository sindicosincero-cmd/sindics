// SINDICS — exclui o cadastro de um condomínio (pedido do próprio síndico, representante legal).
// Remove: Convenção e Regulamento da base do SINDICS, PDFs guardados, prazos de documentos legais
// as fotos e o diário operacional e o registro do condomínio. Compromissos da agenda são mantidos, só perdem o vínculo.
import { createClient } from "jsr:@supabase/supabase-js@2";

const AGENT_ID = "agent_6201m5wqfm4xet39s7vtbkh5axex";
const ORIGENS = ["https://sindics.com.br", "https://www.sindics.com.br", "https://sindicosincero-cmd.github.io"];
const EL = "https://api.elevenlabs.io/v1/convai";
const BUCKET = "documentos-condominio";

function cors(origin: string | null) {
  const allow = origin && ORIGENS.includes(origin) ? origin : ORIGENS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405, origin);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ erro: "Faça login." }, 401, origin);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: u, error: eu } = await admin.auth.getUser(token);
  if (eu || !u?.user) return json({ erro: "Sessão expirada. Entre novamente." }, 401, origin);
  const uid = u.user.id;

  let body: { condominio_id?: string; confirmado?: boolean };
  try { body = await req.json(); } catch (_) { return json({ erro: "Envio inválido." }, 400, origin); }
  if (body.confirmado !== true) return json({ erro: "A exclusão precisa ser confirmada pelo síndico." }, 400, origin);

  const { data: perfil } = await admin.from("perfis").select("ativo, papel").eq("id", uid).maybeSingle();
  if (!perfil?.ativo) return json({ erro: "Conta não liberada." }, 403, origin);

  const { data: cond } = await admin.from("condominios").select("id, nome, sindico_id, kb_doc_ids, convencao_kb_id, regulamento_kb_id").eq("id", body.condominio_id || "").maybeSingle();
  if (!cond) return json({ erro: "Condomínio não encontrado." }, 404, origin);
  if (cond.sindico_id !== uid && perfil.papel !== "admin") return json({ erro: "Este condomínio não pertence à sua conta." }, 403, origin);

  const kbIds = [...new Set([...(cond.kb_doc_ids || []), cond.convencao_kb_id, cond.regulamento_kb_id].filter(Boolean))] as string[];
  const avisos: string[] = [];

  // 1) tira os documentos do agente e apaga da base de conhecimento
  if (kbIds.length) {
    const key = (Deno.env.get("ELEVENLABS_API_KEY") || "").trim().replace(/\s+/g, "");
    if (!key) return json({ erro: "Servidor sem chave da ElevenLabs." }, 500, origin);
    const H = { "xi-api-key": key };
    const ra = await fetch(`${EL}/agents/${AGENT_ID}`, { headers: H });
    if (!ra.ok) return json({ erro: `Não consegui acessar o SINDICS para remover os documentos (${ra.status}). Nada foi excluído.` }, 502, origin);
    const agente = await ra.json();
    const atual: Array<{ id: string }> = agente?.conversation_config?.agent?.prompt?.knowledge_base || [];
    const nova = atual.filter((d) => !kbIds.includes(d.id));
    if (nova.length !== atual.length) {
      const rp = await fetch(`${EL}/agents/${AGENT_ID}`, {
        method: "PATCH", headers: { ...H, "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_config: { agent: { prompt: { knowledge_base: nova } } } }),
      });
      if (!rp.ok) return json({ erro: `Não consegui remover os documentos do SINDICS (${rp.status}). Nada foi excluído.` }, 502, origin);
    }
    for (const id of kbIds) {
      const rd = await fetch(`${EL}/knowledge-base/${id}?force=true`, { method: "DELETE", headers: H });
      if (!rd.ok && rd.status !== 404) avisos.push(`documento ${id} (${rd.status})`);
    }
  }

  // 2) apaga os PDFs guardados
  const pasta = `${cond.sindico_id}/${cond.id}`;
  const { data: arqs } = await admin.storage.from(BUCKET).list(pasta);
  if (arqs?.length) await admin.storage.from(BUCKET).remove(arqs.map((a) => `${pasta}/${a.name}`));
  // fotos do diário operacional
  for (let i = 0; i < 20; i++) {
    const { data: fotos } = await admin.storage.from("operacao-fotos").list(pasta, { limit: 1000 });
    if (!fotos?.length) break;
    await admin.storage.from("operacao-fotos").remove(fotos.map((a) => `${pasta}/${a.name}`));
    if (fotos.length < 1000) break;
  }

  // 3) apaga o condomínio (prazos de documentos legais saem junto; compromissos ficam sem vínculo)
  const { count: prazos } = await admin.from("documentos_legais").select("id", { count: "exact", head: true }).eq("condominio_id", cond.id);
  const { error: ed } = await admin.from("condominios").delete().eq("id", cond.id);
  if (ed) return json({ erro: "Não consegui excluir o cadastro: " + ed.message }, 500, origin);
  if (avisos.length) console.warn("excluir-condominio: kb não apagado", avisos);

  return json({ ok: true, nome: cond.nome, prazos_removidos: prazos ?? 0 }, 200, origin);
});
