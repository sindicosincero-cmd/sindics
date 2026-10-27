// SINDICS — recebe o texto extraído da Convenção ou do Regulamento Interno de um condomínio,
// cria o documento na base de conhecimento da ElevenLabs, liga ao agente e registra no condomínio.
import { createClient } from "jsr:@supabase/supabase-js@2";

const AGENT_ID = "agent_6201m5wqfm4xet39s7vtbkh5axex";
const ORIGENS = ["https://sindics.com.br", "https://www.sindics.com.br", "https://sindicosincero-cmd.github.io"];
const EL = "https://api.elevenlabs.io/v1/convai";
const TIPOS: Record<string, string> = { convencao: "Convenção de Condomínio", regulamento: "Regulamento Interno" };
const MIN_CHARS = 1500;      // menos que isso, o PDF provavelmente não foi lido
const MAX_CHARS = 400_000;   // proteção contra envios exagerados

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
async function elErro(r: Response) {
  try { const e = await r.json(); const d = e?.detail; return typeof d === "string" ? d : (d?.message || d?.status || JSON.stringify(d)?.slice(0, 200) || ""); } catch (_) { return ""; }
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

  let body: { condominio_id?: string; tipo?: string; texto?: string; paginas?: number; ocr?: boolean };
  try { body = await req.json(); } catch (_) { return json({ erro: "Envio inválido." }, 400, origin); }
  const tipo = String(body.tipo || "");
  if (!TIPOS[tipo]) return json({ erro: "Tipo de documento inválido." }, 400, origin);
  const texto = String(body.texto || "").replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const { data: perfil } = await admin.from("perfis").select("ativo, papel").eq("id", uid).maybeSingle();
  if (!perfil?.ativo) return json({ erro: "Conta não liberada." }, 403, origin);

  const { data: cond } = await admin.from("condominios").select("*").eq("id", body.condominio_id || "").maybeSingle();
  if (!cond) return json({ erro: "Condomínio não encontrado." }, 404, origin);
  if (cond.sindico_id !== uid && perfil.papel !== "admin") {
    // gestor auxiliar autorizado neste condomínio pelo síndico
    const { data: g } = await admin.from("gestores").select("id").eq("gestor_id", uid).eq("sindico_id", cond.sindico_id).eq("status", "ativo").contains("condominios", [cond.id]).maybeSingle();
    if (!g) return json({ erro: "Este condomínio não pertence à sua conta." }, 403, origin);
  }

  const colStatus = `${tipo}_status`, colMsg = `${tipo}_msg`, colKb = `${tipo}_kb_id`;
  const marcar = (status: string, msg: string, extra: Record<string, unknown> = {}) =>
    admin.from("condominios").update({ [colStatus]: status, [colMsg]: msg, ...extra }).eq("id", cond.id);
  // o gatilho de validação roda como service_role (auth.uid() nulo), então o servidor pode atualizar esses campos.

  if (texto.length < MIN_CHARS) {
    await marcar("erro", "Não foi possível ler o texto deste PDF. Envie uma versão mais nítida ou o arquivo original (não escaneado).");
    return json({ erro: "O PDF parece estar ilegível: quase nenhum texto foi encontrado. Envie uma versão mais nítida ou o arquivo original." }, 422, origin);
  }
  if (texto.length > MAX_CHARS) return json({ erro: "Documento grande demais. Envie apenas a Convenção ou o Regulamento, sem anexos." }, 413, origin);

  const key = (Deno.env.get("ELEVENLABS_API_KEY") || "").trim().replace(/\s+/g, "");
  if (!key) return json({ erro: "Servidor sem chave da ElevenLabs." }, 500, origin);
  const H = { "xi-api-key": key };

  await marcar("processando", "Enviando para a base do SINDICS…");

  // 1) cria o documento de texto na base de conhecimento
  const nomeDoc = `${cond.nome} — ${TIPOS[tipo]}`;
  const cabecalho = `CONDOMÍNIO ${cond.nome.toUpperCase()} — ${TIPOS[tipo].toUpperCase()}\nCNPJ: ${cond.cnpj || "não informado"}. Endereço: ${cond.endereco || ""}, ${cond.cidade || ""}. ${cond.unidades || ""} apartamentos.\n` +
    `Documento enviado pelo síndico em PDF e lido automaticamente${body.ocr ? " (com reconhecimento de texto em imagem; pode haver pequenos erros de leitura)" : ""}.\n\n`;
  const rc = await fetch(`${EL}/knowledge-base/text`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ name: nomeDoc, text: cabecalho + texto }),
  });
  if (!rc.ok) {
    const m = await elErro(rc);
    console.error("kb text", rc.status, m);
    await marcar("erro", "A base de conhecimento recusou o documento (" + rc.status + "). Tente novamente.");
    return json({ erro: `Não foi possível salvar na base do SINDICS (${rc.status}${m ? ": " + m : ""}).` }, 502, origin);
  }
  const { id: novoId } = await rc.json();

  // 2) liga o documento ao agente (e desliga a versão anterior, se houver)
  const antigo: string | null = cond[colKb] || null;
  const ra = await fetch(`${EL}/agents/${AGENT_ID}`, { headers: H });
  if (!ra.ok) {
    await marcar("erro", "Não consegui ligar o documento ao SINDICS. Tente novamente.");
    return json({ erro: "Não consegui ler a configuração do SINDICS (" + ra.status + ")." }, 502, origin);
  }
  const agente = await ra.json();
  const atual: Array<{ id: string; type: string; name: string; usage_mode?: string }> = agente?.conversation_config?.agent?.prompt?.knowledge_base || [];
  const nova = atual.filter((d) => d.id !== antigo && d.id !== novoId);
  nova.push({ id: novoId, type: "text", name: nomeDoc, usage_mode: "auto" });
  const rp = await fetch(`${EL}/agents/${AGENT_ID}`, {
    method: "PATCH", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_config: { agent: { prompt: { knowledge_base: nova } } } }),
  });
  if (!rp.ok) {
    const m = await elErro(rp);
    console.error("patch agent", rp.status, m);
    await marcar("erro", "Não consegui ligar o documento ao SINDICS. Tente novamente.");
    return json({ erro: `Não consegui ligar o documento ao SINDICS (${rp.status}${m ? ": " + m : ""}).` }, 502, origin);
  }

  // 3) prepara a busca no documento (índice) — não bloqueia
  fetch(`${EL}/knowledge-base/${novoId}/rag-index`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "multilingual_e5_large_instruct" }),
  }).catch(() => {});

  // 4) registra no condomínio
  const ids = new Set<string>((cond.kb_doc_ids || []).filter((x: string) => x !== antigo));
  ids.add(novoId);
  const outro = tipo === "convencao" ? "regulamento" : "convencao";
  const prontos = [TIPOS[tipo], cond[`${outro}_status`] === "pronto" ? TIPOS[outro] : null].filter(Boolean).sort();
  await admin.from("condominios").update({
    [colStatus]: "pronto",
    [colMsg]: `Lido em ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}${body.paginas ? " — " + body.paginas + " páginas" : ""}${body.ocr ? ", com reconhecimento de imagem" : ""}.`,
    [colKb]: novoId,
    kb_doc_ids: [...ids],
    documentos: prontos.join(" e "),
  }).eq("id", cond.id);

  // 5) remove a versão anterior da base (se existir)
  if (antigo && antigo !== novoId) fetch(`${EL}/knowledge-base/${antigo}?force=true`, { method: "DELETE", headers: H }).catch(() => {});

  return json({ ok: true, id: novoId, caracteres: texto.length }, 200, origin);
});
