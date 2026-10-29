// SINDICS — libera uma conversa de voz para um síndico logado e ativo,
// com saudação por horário, apresentação no primeiro acesso e resumo do dia.
import { createClient } from "jsr:@supabase/supabase-js@2";

const AGENT_ID = "agent_6201m5wqfm4xet39s7vtbkh5axex";
const ORIGENS = ["https://sindics.com.br", "https://www.sindics.com.br", "https://sindicosincero-cmd.github.io"];
const TZ = "America/Sao_Paulo";
// Documento neutro (lei geral + como usar o SINDICS). Vai em TODA conversa, para que a seleção
// de documentos nunca fique vazia e nunca caia na base inteira (que tem documentos de outros síndicos).
const KB_BASE_GERAL = { id: "5iU2mzefR0ybqam03BNZ", type: "text", name: "SINDICS — Base geral", usage_mode: "auto" };
const KB_LGPD = { id: "nCaVi3KN0A4mTWJ2Sm92", type: "text", name: "SINDICS — LGPD no condomínio", usage_mode: "auto" };
// Vozes do SINDICS (o síndico escolhe no menu ou por voz)
const VOZES: Record<string, string> = { masculina: "rVRk0uJAtO8T38Gm03mf", feminina: "KHmfNHtEjHhLK9eER20w" };

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
const fmtData = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const horaAgoraSP = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(new Date()));
function diasEntre(a: string, b: string): number { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
function dataBR(iso: string): string { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; }
function horaFala(ts: string): string {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts)).split(":").map(Number);
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}
const fmtCnpj = (c: string | null) => c ? c.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, "$1.$2.$3/$4-$5") : "não informado";
const NUM = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez"];
const n = (x: number, fem = false) => (x === 1 ? (fem ? "uma" : "um") : x === 2 ? (fem ? "duas" : "dois") : (NUM[x] || String(x)));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ZERO = "00000000-0000-0000-0000-000000000000";
async function donoLiberado(admin: any, dono: string): Promise<boolean> {
  const { data: p } = await admin.from("perfis").select("ativo, papel").eq("id", dono).maybeSingle();
  if (!p?.ativo) return false;
  if (p.papel === "admin") return true;
  const { data: a } = await admin.from("assinaturas").select("status, atraso_desde").eq("sindico_id", dono).order("criado_em", { ascending: false }).limit(1).maybeSingle();
  if (!a) return true;
  if (a.status === "cancelada") return false;
  if (a.status === "atrasada" && a.atraso_desde) {
    const hojeIso = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return Math.round((Date.parse(hojeIso + "T00:00:00Z") - Date.parse(a.atraso_desde + "T00:00:00Z")) / 86400000) < 5;
  }
  return true;
}
const ST: Record<string, string> = { pronto: "lido", pendente: "PENDENTE (enviar o PDF no botão Condomínios)", erro: "com ERRO de leitura (reenviar o PDF)", processando: "em leitura", enviado: "em leitura" };

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405, origin);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ erro: "Faça login para usar o SINDICS." }, 401, origin);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: u, error: eu } = await admin.auth.getUser(token);
  if (eu || !u?.user) return json({ erro: "Sessão expirada. Entre novamente." }, 401, origin);
  const uid = u.user.id;

  const { data: perfil } = await admin.from("perfis").select("*").eq("id", uid).maybeSingle();
  if (!perfil) return json({ erro: "Perfil não encontrado." }, 403, origin);
  if (!perfil.ativo) return json({ erro: "Sua conta ainda não foi liberada pelo administrador." }, 403, origin);

  // ---- Uma conversa por conta: dois aparelhos ouvindo "SINDICS" ao mesmo tempo não abrem duas vozes ----
  let corpo: any = {}; try { corpo = await req.json(); } catch (_) { /* */ }
  const aparelho = String(corpo?.aparelho || "").slice(0, 64);
  if (aparelho) {
    const { data: livre, error: eRes } = await admin.rpc("reservar_sessao_voz", { p_uid: uid, p_aparelho: aparelho });
    if (eRes) console.error("reservar_sessao_voz", eRes.message);
    else if (livre === false) return json({ erro: "O SINDICS já está atendendo em outro aparelho ou aba.", outro_aparelho: true }, 409, origin);
  }

  // ---- Gestor auxiliar: trabalha só nos condomínios que o síndico autorizou ----
  const ehGestor = perfil.papel === "gestor";
  let condIds: string[] = [], perfilUsuario = "síndico titular da conta", empresaConta = perfil.empresa;
  if (ehGestor) {
    const { data: vinc } = await admin.from("gestores").select("sindico_id, sindico_nome, condominios").eq("gestor_id", uid).eq("status", "ativo");
    if (!vinc?.length) return json({ erro: "Seu acesso de gestor foi encerrado. Fale com o síndico." }, 403, origin);
    const liberados: any[] = [];
    for (const v of vinc) if (await donoLiberado(admin, v.sindico_id)) liberados.push(v);
    if (!liberados.length) return json({ erro: "O SINDICS está suspenso porque a assinatura do síndico está pendente. Avise o síndico.", bloqueio: "dono" }, 402, origin);
    condIds = [...new Set(liberados.flatMap((v) => v.condominios || []))] as string[];
    const nomes = [...new Set(liberados.map((v) => v.sindico_nome).filter(Boolean))].join(" e ");
    perfilUsuario = `gestor auxiliar${nomes ? " do síndico " + nomes : ""}. Pode cuidar da agenda, documentos legais, comunicados, regras e cálculos dos condomínios autorizados. NÃO pode cadastrar nem excluir condomínios, nem tratar de assinatura ou equipe: nesses casos, oriente com gentileza a falar com o síndico.`;
    const { data: dono } = await admin.from("perfis").select("empresa").eq("id", liberados[0].sindico_id).maybeSingle();
    empresaConta = dono?.empresa || perfil.empresa;
  }
  const ids = condIds.length ? condIds : [ZERO];

  // ---- Assinatura: atraso avisa; 5 dias de atraso ou cancelamento bloqueia ----
  const DIAS_BLOQUEIO = 5;
  let avisoAssinatura = "";
  if (perfil.papel !== "admin" && !ehGestor) {
    const { data: ass } = await admin.from("assinaturas").select("status, atraso_desde, link_pagamento").eq("sindico_id", uid).order("criado_em", { ascending: false }).limit(1).maybeSingle();
    if (ass) {
      const hojeIso = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const atraso = ass.status === "atrasada" && ass.atraso_desde ? Math.max(0, Math.round((Date.parse(hojeIso + "T00:00:00Z") - Date.parse(ass.atraso_desde + "T00:00:00Z")) / 86400000)) : 0;
      if (ass.status === "cancelada") return json({ erro: "Sua assinatura do SINDICS foi cancelada. Para voltar a usar, fale com o suporte.", bloqueio: "cancelada" }, 402, origin);
      if (ass.status === "atrasada" && atraso >= DIAS_BLOQUEIO) return json({ erro: `Acesso suspenso: a assinatura está em atraso há ${atraso} dias. Regularize o pagamento para liberar na hora.`, bloqueio: "atraso", link_pagamento: ass.link_pagamento }, 402, origin);
      if (ass.status === "atrasada") {
        const faltam = DIAS_BLOQUEIO - atraso;
        avisoAssinatura = `Antes de tudo: a assinatura do SINDICS está em atraso${atraso ? ` há ${atraso} dia${atraso > 1 ? "s" : ""}` : ""}. Para evitar o bloqueio ${faltam === 1 ? "amanhã" : `em ${faltam} dias`}, use o botão Pagar agora na tela.`;
      }
    }
  }

  const qCond = admin.from("condominios").select("id, nome, cidade, unidades, documentos, kb_doc_ids, cnpj, endereco, convencao_status, regulamento_status");
  const { data: conds } = await (ehGestor ? qCond.in("id", ids) : qCond.eq("sindico_id", uid)).order("nome");
  const condominios = conds || [];
  const nomeCond = new Map(condominios.map((c) => [c.id, c.nome]));
  const docsPendentes = condominios.filter((c) => c.regulamento_status !== "pronto"); // Convenção é opcional

  const inicioMes = new Date(); inicioMes.setUTCDate(1); inicioMes.setUTCHours(3, 0, 0, 0);
  const [{ count: noMes }, { count: total }] = await Promise.all([
    admin.from("sessoes").select("id", { count: "exact", head: true }).eq("sindico_id", uid).gte("iniciada_em", inicioMes.toISOString()),
    admin.from("sessoes").select("id", { count: "exact", head: true }).eq("sindico_id", uid),
  ]);
  if ((noMes ?? 0) >= perfil.limite_sessoes_mes) return json({ erro: "Você atingiu o limite de conversas do seu plano neste mês." }, 429, origin);
  const primeiroAcesso = (total ?? 0) === 0;
  const inicioHoje = new Date(fmtData(new Date()) + "T00:00:00-03:00").toISOString();
  const { count: hojeSessoes } = await admin.from("sessoes").select("id", { count: "exact", head: true }).eq("sindico_id", uid).gte("iniciada_em", inicioHoje);
  const oferecerRadar = (hojeSessoes ?? 0) === 0;

  // ---- Situação do dia ----
  const hoje = fmtData(new Date());
  const amanha = fmtData(new Date(Date.now() + 86400000));
  const hora = horaAgoraSP();
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";

  const qDocs = admin.from("documentos_legais").select("documento, condominio_id, data_vencimento, alertar_dias_antes, catalogo_codigo, situacao");
  const { data: docsTodos } = await (ehGestor ? qDocs.in("condominio_id", ids) : qDocs.eq("sindico_id", uid)).order("data_vencimento");
  const docs = (docsTodos || []).filter((d) => d.situacao !== "nao_aplica" && d.data_vencimento);
  // Pasta de Documentação Legal: obrigatórios (lei/norma, sem condição) ainda não cadastrados
  const { data: catalogo } = await admin.from("documentos_catalogo").select("codigo, nome, exigencia, condicao").order("ordem");
  const pendentesDoc = condominios.map((c) => {
    const tem = new Set((docsTodos || []).filter((d) => d.condominio_id === c.id && d.catalogo_codigo).map((d) => d.catalogo_codigo));
    const faltam = (catalogo || []).filter((k) => k.exigencia !== "recomendado" && !k.condicao && !tem.has(k.codigo));
    return { nome: c.nome, faltam: faltam.map((k) => k.nome) };
  }).filter((x) => x.faltam.length);
  const emAlerta = (docs || []).map((d) => ({ ...d, faltam: diasEntre(hoje, d.data_vencimento) })).filter((d) => d.faltam <= d.alertar_dias_antes);

  const qComp = admin.from("compromissos").select("titulo, inicio, condominio_id, local");
  const { data: comps } = await (ehGestor ? qComp.or(`sindico_id.eq.${uid},condominio_id.in.(${ids.join(",")})`) : qComp.eq("sindico_id", uid)).eq("status", "agendado")
    .gte("inicio", new Date(hoje + "T00:00:00-03:00").toISOString()).lte("inicio", new Date(amanha + "T23:59:59-03:00").toISOString()).order("inicio");
  const agora = Date.now();
  const hojeComps = (comps || []).filter((c) => fmtData(new Date(c.inicio)) === hoje);
  const restantesHoje = hojeComps.filter((c) => Date.parse(c.inicio) >= agora - 30 * 60000);
  const amanhaComps = (comps || []).filter((c) => fmtData(new Date(c.inicio)) === amanha);

  // ---- Memória do SINDICS (o que ficou combinado nas conversas anteriores) ----
  const qMem = admin.from("memorias").select("id, tipo, texto, prazo, condominio_id, criado_em, autor_nome").eq("situacao", "aberta");
  const { data: mems } = await (ehGestor ? qMem.or(`autor_id.eq.${uid},condominio_id.in.(${ids.join(",")})`) : qMem.eq("sindico_id", uid))
    .order("criado_em", { ascending: false }).limit(60);
  const ORDEM_MEM: Record<string, number> = { preferencia: 0, pendencia: 1, decisao: 2, contexto: 3 };
  const ROT_MEM: Record<string, string> = { preferencia: "Preferência", pendencia: "Pendência", decisao: "Decisão", contexto: "Contexto" };
  const memOrd = (mems || []).slice().sort((a, b) => (ORDEM_MEM[a.tipo] - ORDEM_MEM[b.tipo]) || String(a.prazo || "9999").localeCompare(String(b.prazo || "9999")));
  const memoria = memOrd.length
    ? memOrd.map((m) => `- [${m.id.slice(0, 8)}] ${ROT_MEM[m.tipo] || m.tipo}${m.condominio_id ? " (" + (nomeCond.get(m.condominio_id) || "condomínio") + ")" : ""}${m.prazo ? ", prazo " + dataBR(m.prazo) : ""}, desde ${dataBR(fmtData(new Date(m.criado_em)))}: ${m.texto}`).join("\n")
    : "Nada guardado ainda.";
  const pendUrgentes = (mems || []).filter((m) => m.tipo === "pendencia" && m.prazo && diasEntre(hoje, m.prazo) <= 2)
    .sort((a, b) => String(a.prazo).localeCompare(String(b.prazo)));

  const linhaDoc = (d: typeof emAlerta[number]) => {
    const onde = d.condominio_id ? ` (${nomeCond.get(d.condominio_id) || "condomínio"})` : "";
    const st = d.faltam < 0 ? `VENCIDO há ${-d.faltam} dia(s)` : d.faltam === 0 ? "vence HOJE" : `vence em ${d.faltam} dia(s)`;
    return `- ${d.documento}${onde}: ${st}, em ${dataBR(d.data_vencimento)}.`;
  };
  const linhaComp = (c: { titulo: string; inicio: string; condominio_id: string | null; local: string }) =>
    `- ${horaFala(c.inicio)}: ${c.titulo}${c.condominio_id ? " (" + (nomeCond.get(c.condominio_id) || "") + ")" : ""}${c.local ? ", " + c.local : ""}.`;
  const alertas_detalhe = [
    emAlerta.length ? "Documentos em alerta:\n" + emAlerta.map(linhaDoc).join("\n") : "Nenhum documento em alerta.",
    hojeComps.length ? "Compromissos de hoje:\n" + hojeComps.map(linhaComp).join("\n") : "Nenhum compromisso hoje.",
    amanhaComps.length ? "Compromissos de amanhã:\n" + amanhaComps.map(linhaComp).join("\n") : "Nenhum compromisso amanhã.",
    avisoAssinatura ? "ASSINATURA EM ATRASO: " + avisoAssinatura + " Se o síndico perguntar, explique que o pagamento é feito pelo botão Pagar agora (Pix, boleto ou cartão) e libera na hora; não insista mais de uma vez." : "",
    docsPendentes.length ? "Regulamento Interno ainda não enviado: " + docsPendentes.map((c) => c.nome).join(", ") + "." : "",
    ...pendentesDoc.map((x) => `Pasta de Documentação Legal do ${x.nome}: ${x.faltam.length} documento(s) obrigatório(s) sem cadastro (${x.faltam.slice(0, 4).join("; ")}${x.faltam.length > 4 ? "…" : ""}).`),
  ].filter(Boolean).join("\n");

  // ---- Abertura falada (no máximo 2 informações) ----
  // como o síndico prefere ser chamado (ex.: "Sr. Cardoso"); sem preferência, o primeiro nome
  const nome = (perfil.tratamento || "").trim() || (perfil.nome || "").trim().split(/\s+/)[0] || "síndico";
  const pontos: string[] = [];
  for (const d of emAlerta.slice(0, 2)) {
    const onde = d.condominio_id && condominios.length > 1 ? ` do ${nomeCond.get(d.condominio_id)}` : "";
    pontos.push(d.faltam < 0 ? `o ${d.documento}${onde} está vencido` : d.faltam === 0 ? `o ${d.documento}${onde} vence hoje` : `o ${d.documento}${onde} vence em ${d.faltam} dias`);
  }
  if (pontos.length < 2) {
    if (hora < 18 && restantesHoje.length) {
      const c = restantesHoje[0];
      pontos.push(restantesHoje.length === 1 ? `você tem um compromisso às ${horaFala(c.inicio)}: ${c.titulo}` : `você tem ${n(restantesHoje.length, true)} agendas hoje, a primeira às ${horaFala(c.inicio)}`);
    } else if (hora >= 18 && amanhaComps.length) {
      const c = amanhaComps[0];
      pontos.push(amanhaComps.length === 1 ? `amanhã você tem ${c.titulo} às ${horaFala(c.inicio)}` : `amanhã você tem ${n(amanhaComps.length, true)} agendas, a primeira às ${horaFala(c.inicio)}`);
    }
  }
  if (pontos.length < 2 && pendUrgentes.length) {
    const m = pendUrgentes[0], f = diasEntre(hoje, m.prazo);
    const curto = m.texto.length > 70 ? m.texto.slice(0, 70).replace(/\s+\S*$/, "") + "…" : m.texto.replace(/[.!]+$/, "");
    pontos.push(`${f < 0 ? "ficou atrasada" : f === 0 ? "vence hoje" : f === 1 ? "vence amanhã" : "vence em dois dias"} a pendência: ${curto}`);
  }
  if (pontos.length < 2 && docsPendentes.length) {
    pontos.push(docsPendentes.length === 1
      ? `o regulamento interno do ${docsPendentes[0].nome} ainda não foi enviado`
      : `${n(docsPendentes.length)} condomínios ainda estão sem regulamento interno`);
  }
  const extras = Math.max(0, emAlerta.length - 2);

  let abertura: string;
  if (!condominios.length && ehGestor) {
    abertura = `${saudacao}, ${nome}. Ainda não há condomínios liberados para você. Peça ao síndico para autorizar em Minha equipe.`;
  } else if (!condominios.length) {
    abertura = primeiroAcesso
      ? `${saudacao}, ${nome}. Eu sou o SINDICS, sua inteligência condominial. Vamos começar cadastrando o seu condomínio? Pode ser por voz, agora mesmo.`
      : `${saudacao}, ${nome}. Você ainda não tem condomínio cadastrado. Quer cadastrar agora, por voz?`;
  } else if (primeiroAcesso) {
    abertura = `${saudacao}, ${nome}. Eu sou o SINDICS, sua inteligência condominial. É só falar comigo naturalmente, e pode me interromper quando quiser. Por onde começamos?`;
  } else if (!pontos.length) {
    abertura = `${saudacao}, ${nome}. Tudo em dia por aqui. Em que posso ajudar?`;
  } else if (pontos.length === 1 && !extras) {
    abertura = `${saudacao}, ${nome}. Um ponto de atenção: ${pontos[0]}. Em que posso ajudar?`;
  } else {
    abertura = `${saudacao}, ${nome}. ${cap(n(pontos.length))} pontos de atenção: ${pontos[0]}, e ${pontos[1]}${extras ? `. Há mais ${n(extras)} documento${extras > 1 ? "s" : ""} no prazo de aviso` : ""}. Em que posso ajudar?`;
  }

  if (avisoAssinatura) abertura = abertura.replace(/^([^.]*\.)/, `$1 ${avisoAssinatura}`);

  if (oferecerRadar && condominios.length && !primeiroAcesso && !avisoAssinatura) {
    abertura = abertura.replace(/ Em que posso ajudar\?$/, " O Radar Condominial de hoje já está pronto, se quiser ouvir.");
  }

  // ---- Acesso temporário na ElevenLabs ----
  const key = (Deno.env.get("ELEVENLABS_API_KEY") || "").trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "");
  if (!key) return json({ erro: "Servidor sem chave da ElevenLabs configurada." }, 500, origin);
  const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${AGENT_ID}`, { headers: { "xi-api-key": key } });
  if (!r.ok) {
    let motivo = "";
    try { const e = await r.json(); const d = e?.detail; motivo = typeof d === "string" ? d : (d?.status || d?.message || ""); } catch (_) { /* */ }
    console.error("ElevenLabs get-signed-url", r.status, motivo);
    return json({ erro: `A ElevenLabs não liberou a conversa (${r.status}${motivo ? ": " + motivo : ""}).` }, 502, origin);
  }
  const { signed_url } = await r.json();
  await admin.from("sessoes").insert({ sindico_id: uid });

  const texto = condominios.length
    ? condominios.map((c) =>
      `- ${c.nome} — CNPJ ${fmtCnpj(c.cnpj)}; endereço: ${c.endereco || "não informado"}, ${c.cidade || ""}; ${c.unidades ? c.unidades + " apartamentos" : "apartamentos não informados"}. ` +
      `Regulamento Interno: ${ST[c.regulamento_status] || c.regulamento_status}. Convenção (opcional): ${c.convencao_status === "pendente" ? "não enviada" : (ST[c.convencao_status] || c.convencao_status)}.`
    ).join("\n")
    : (ehGestor ? "Nenhum condomínio liberado para este gestor." : "Nenhum condomínio cadastrado ainda. Ofereça o cadastro por voz (condominio_cadastrar).");
  const kb = [KB_BASE_GERAL, KB_LGPD, ...condominios.flatMap((c) => (c.kb_doc_ids || []).map((id: string, i: number) => ({ id, type: "text", name: `${c.nome} — documento ${i + 1}`, usage_mode: "auto" })))];

  return json({
    signed_url,
    perfil: {
      nome: perfil.nome, assinatura: perfil.assinatura, empresa: perfil.empresa, papel: perfil.papel,
      condominios: condominios.map((c) => ({ id: c.id, nome: c.nome, cidade: c.cidade, unidades: c.unidades, cnpj: c.cnpj })),
      sessoes_mes: (noMes ?? 0) + 1, limite_sessoes_mes: perfil.limite_sessoes_mes,
    },
    dynamic_variables: {
      sindico_nome: nome, sindico_assinatura: perfil.assinatura, empresa: empresaConta, condominios: texto, perfil_usuario: perfilUsuario,
      abertura, alertas_detalhe, memoria, primeiro_acesso: primeiroAcesso ? "sim" : "não", saudacao,
      voz: perfil.voz === "feminina" ? "feminina" : "masculina",
      radar_oferecido: oferecerRadar && condominios.length && !primeiroAcesso && !avisoAssinatura ? "sim" : "não",
      resumo_alertas: "",
    },
    knowledge_base: kb,
    voz: perfil.voz === "feminina" ? "feminina" : "masculina",
    voice_id: VOZES[perfil.voz] || VOZES.masculina,
    cadastro_completo: !!perfil.cadastro_completo_em,
  }, 200, origin);
});
