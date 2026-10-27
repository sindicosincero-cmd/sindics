// SINDICS — Radar Condominial: notícias do setor condominial das últimas 48 horas,
// filtradas e classificadas por tema. Guarda a edição por 3 horas (compartilhada entre síndicos).
import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGENS = ["https://sindics.com.br", "https://www.sindics.com.br", "https://sindicosincero-cmd.github.io"];
const TZ = "America/Sao_Paulo";
const CACHE_MIN = 180;
const BUSCAS = [
  "condomínio when:2d",
  "síndico condomínio when:2d",
  "inadimplência condomínio when:3d",
  "\"taxa de condomínio\" when:3d",
  "condomínio lei OR STJ OR justiça when:3d",
  "condomínios porteiros OR zeladores OR \"recarga de veículos\" when:3d",
];

// Relevância para quem administra condomínio
const POSITIVO: [RegExp, number][] = [
  [/s[ií]ndic/i, 3], [/inadimpl/i, 3], [/taxa (de )?condom|cota(s)? condominia|cobran[cç]a|cobra(r)? condom|condom[ií]nio atrasad|d[ií]vida/i, 3],
  [/assembleia|conven[cç][aã]o|regimento|regulamento interno/i, 3], [/administradora|gest[aã]o (do |de )?condom/i, 3],
  [/\bSTJ\b|\bSTF\b|tribunal|justi[cç]a|decis[aã]o|juiz|TJ[A-Z]{2}\b/i, 2], [/\blei\b|projeto de lei|decreto|norma|regra(s)?\b|nota fiscal|reforma tribut/i, 2],
  [/porteir|zelador|funcion[aá]ri|escala 6x1|6×1|trabalhist/i, 2], [/elevador|manuten[cç][aã]o|AVCB|bombeiros|inc[eê]ndio|seguro/i, 2],
  [/ve[ií]culo(s)? el[eé]tric|carregador|recarga/i, 2], [/seguran[cç]a condominial|portaria|c[aâ]meras|LGPD|biometria/i, 1],
  [/airbnb|loca[cç][aã]o (de )?curta|temporada/i, 2], [/programa|subs[ií]dio|desconto|tarifa|Cemig|Enel|Sabesp/i, 1], [/multa/i, 1], [/moradores?|cond[oô]min/i, 1], [/energia|[aá]gua|g[aá]s/i, 1],
];
const NEGATIVO: RegExp[] = [
  /\bmort[oa]s?\b|assassin|homic[ií]d|baleado|tiros?\b|esfaque|corpo (de|é) encontrado/i, /\b(é|foi|s[aã]o|foram) pres[oa]s?\b|\bpreso\b|detid[oa]|\bPM\b|pol[ií]cia|tr[aá]fico|coca[ií]na|maconha|amea[cç]ad[oa] com faca/i,
  /elei[cç]|eleitora|vota[cç][aã]o|zona eleitoral|bolsonaro|\blula\b|presidenciais|STF.*ataque/i, /celebridade|BBB|novela|cantor|atriz|ator\b|\bBelo\b|Rayane/i,
  /esqueleto|arqueol|f[oó]ssil/i, /condom[ií]nio (log[ií]stico|industrial|empresarial)/i, /€|\bM€|Portugal|Caxias \(PT\)/i, /galeria de resid[eê]ncia|ArchDaily/i,
  /cadela|cachorro.*(arremess|morre)|morre ap[oó]s/i, /Estados Unidos/i,
];
const FONTES_FORA = /facebook|instagram|youtube|tiktok|x\.com|twitter|sapo|jornal construir/i;
const TEMAS: [string, RegExp][] = [
  ["Justiça e leis", /\bSTJ\b|\bSTF\b|tribunal|justi[cç]a|decis[aã]o|juiz|\blei\b|projeto de lei|decreto|nota fiscal|reforma tribut|regra/i],
  ["Finanças", /inadimpl|taxa (de )?condom|cota|cobran[cç]a|d[ií]vida|fintech|custo|or[cç]amento/i],
  ["Gestão e pessoas", /s[ií]ndic|assembleia|administradora|porteir|zelador|funcion|escala|gest[aã]o|forma[cç][aã]o|curso|treinamento/i],
  ["Segurança e manutenção", /elevador|manuten|AVCB|bombeiro|inc[eê]ndio|seguran|c[aâ]mera|portaria|seguro|obra/i],
  ["Energia e tecnologia", /el[eé]tric|recarga|carregador|energia|solar|tecnolog|aplicativo|intelig/i],
];

function cors(origin: string | null) {
  const allow = origin && ORIGENS.includes(origin) ? origin : ORIGENS[0];
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}
function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
}
const desescapar = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();
const tag = (xml: string, t: string) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? desescapar(m[1]) : ""; };
const normal = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

type Item = { titulo: string; fonte: string; link: string; publicado: string; tema: string; pontos: number };

function lerFeed(xml: string): Item[] {
  const itens: Item[] = [];
  for (const bloco of xml.split("<item>").slice(1)) {
    const fonte = tag(bloco, "source");
    let titulo = tag(bloco, "title");
    if (fonte && titulo.endsWith(" - " + fonte)) titulo = titulo.slice(0, -(fonte.length + 3));
    titulo = titulo.replace(/\s+[-–]\s+[^-–]{2,40}$/, (m) => (fonte && m.includes(fonte) ? "" : m)).trim();
    const pub = tag(bloco, "pubDate");
    itens.push({ titulo, fonte, link: tag(bloco, "link"), publicado: pub ? new Date(pub).toISOString() : "", tema: "", pontos: 0 });
  }
  return itens;
}
function pontuar(it: Item): number {
  const t = it.titulo;
  if (FONTES_FORA.test(it.fonte) || t.length < 25) return -99;
  let p = 0;
  for (const [re, peso] of POSITIVO) if (re.test(t)) p += peso;
  for (const re of NEGATIVO) if (re.test(t)) p -= 6;
  if (!/condom|s[ií]ndic|cond[oô]min|morador|pr[eé]dio/i.test(t)) p -= 4;
  return p;
}
function parecido(a: string, b: string) {
  const A = new Set(normal(a).split(" ").filter((w) => w.length > 3)), B = new Set(normal(b).split(" ").filter((w) => w.length > 3));
  if (!A.size || !B.size) return false;
  let c = 0; A.forEach((w) => { if (B.has(w)) c++; });
  return c / Math.min(A.size, B.size) >= 0.6;
}

async function montarEdicao(): Promise<Item[]> {
  const respostas = await Promise.allSettled(BUSCAS.map((q) =>
    fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`, { headers: { "User-Agent": "Mozilla/5.0 (SINDICS Radar)" } })
      .then((r) => (r.ok ? r.text() : ""))));
  const limite = Date.now() - 72 * 3600 * 1000;
  const todos = respostas.flatMap((r) => (r.status === "fulfilled" && r.value ? lerFeed(r.value) : []))
    .filter((i) => i.titulo && i.link && (!i.publicado || Date.parse(i.publicado) >= limite));
  todos.forEach((i) => { i.pontos = pontuar(i); i.tema = (TEMAS.find(([, re]) => re.test(i.titulo)) || ["Condomínio em pauta"])[0]; });
  const bons = todos.filter((i) => i.pontos >= 2).sort((a, b) => b.pontos - a.pontos || Date.parse(b.publicado) - Date.parse(a.publicado));
  const edicao: Item[] = [];
  const porTema: Record<string, number> = {};
  for (const i of bons) {
    if (edicao.some((e) => parecido(e.titulo, i.titulo)) || (porTema[i.tema] || 0) >= 4) continue;
    edicao.push(i); porTema[i.tema] = (porTema[i.tema] || 0) + 1;
    if (edicao.length >= 12) break;
  }
  return edicao;
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
  const { data: perfil } = await admin.from("perfis").select("ativo").eq("id", u.user.id).maybeSingle();
  if (!perfil?.ativo) return json({ erro: "Conta não liberada." }, 403, origin);

  let body: { atualizar?: boolean; consulta?: string } = {};
  try { body = await req.json(); } catch (_) { /* sem corpo */ }

  // Busca livre de notícias (economia, cidade, tema pedido pelo síndico): rápida, sem filtro do setor
  const consulta = String(body.consulta || "").replace(/[^\p{L}\p{N} "'.,:-]/gu, " ").trim().slice(0, 80);
  if (consulta) {
    const janela = /when:\d+[dh]/.test(consulta) ? "" : " when:2d";
    try {
      const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(consulta + janela)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`, { headers: { "User-Agent": "Mozilla/5.0 (SINDICS Radar)" } });
      const itens = (r.ok ? lerFeed(await r.text()) : []).filter((i) => i.titulo && !FONTES_FORA.test(i.fonte))
        .sort((a, b) => Date.parse(b.publicado) - Date.parse(a.publicado));
      const unicos: Item[] = [];
      for (const i of itens) { if (!unicos.some((e) => parecido(e.titulo, i.titulo))) unicos.push(i); if (unicos.length >= 8) break; }
      return json({ consulta, itens: unicos.map(({ pontos: _p, tema: _t, ...x }) => x) }, 200, origin);
    } catch (e) {
      console.error("busca", e);
      return json({ erro: "Não consegui buscar notícias agora." }, 502, origin);
    }
  }
  const chave = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const { data: cache } = await admin.from("radar_cache").select("itens, gerado_em").eq("chave", chave).maybeSingle();
  const recente = cache && Date.now() - Date.parse(cache.gerado_em) < CACHE_MIN * 60000;
  if (recente && !body.atualizar && (cache!.itens as Item[]).length) return json({ data: chave, gerado_em: cache!.gerado_em, itens: cache!.itens, cache: true }, 200, origin);

  let itens: Item[] = [];
  try { itens = await montarEdicao(); } catch (e) { console.error("radar", e); }
  if (!itens.length) {
    if (cache && (cache.itens as Item[]).length) return json({ data: chave, gerado_em: cache.gerado_em, itens: cache.itens, cache: true }, 200, origin);
    const { data: ultimo } = await admin.from("radar_cache").select("chave, itens, gerado_em").order("gerado_em", { ascending: false }).limit(1).maybeSingle();
    if (ultimo) return json({ data: ultimo.chave, gerado_em: ultimo.gerado_em, itens: ultimo.itens, cache: true, aviso: "Sem notícias novas agora; esta é a última edição." }, 200, origin);
    return json({ erro: "Não consegui buscar as notícias do setor agora. Tente de novo em alguns minutos." }, 502, origin);
  }
  const gerado_em = new Date().toISOString();
  const limpos = itens.map(({ pontos: _p, ...r }) => r);
  await admin.from("radar_cache").upsert({ chave, itens: limpos, gerado_em });
  return json({ data: chave, gerado_em, itens: limpos, cache: false }, 200, origin);
});
