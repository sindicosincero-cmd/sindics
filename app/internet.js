/* SINDICS — informações da internet: previsão do tempo (Open-Meteo) e pesquisa geral (Wikipédia + notícias).
   Tudo público e sem chave: nada do síndico ou do condomínio é enviado, só a cidade ou as coordenadas. */
(function(){
const I = {};
window.Internet = I;

const WMO = { 0:"céu limpo", 1:"predomínio de sol", 2:"parcialmente nublado", 3:"nublado", 45:"neblina", 48:"neblina com geada",
  51:"garoa fraca", 53:"garoa", 55:"garoa forte", 56:"garoa congelante", 57:"garoa congelante forte",
  61:"chuva fraca", 63:"chuva moderada", 65:"chuva forte", 66:"chuva congelante", 67:"chuva congelante forte",
  71:"neve fraca", 73:"neve", 75:"neve forte", 77:"grãos de neve", 80:"pancadas de chuva fracas", 81:"pancadas de chuva", 82:"pancadas de chuva fortes",
  85:"pancadas de neve", 86:"pancadas de neve fortes", 95:"trovoadas", 96:"trovoadas com granizo", 99:"trovoadas com granizo forte" };
const DIAS = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];
const r0 = v => Math.round(Number(v) || 0);
const mm = v => String(v).replace(".", ",");
async function jget(url, ms = 8000){
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try{ const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
  finally{ clearTimeout(t); }
}

/* Onde: condomínio cadastrado (coordenadas ou cidade) ou o nome de uma cidade */
async function localizar(local){
  const cs = (typeof PERFIL !== "undefined" && PERFIL?.condominios) || [];
  let c = null;
  if (local){ try{ c = acharCondominio(local); }catch(_){ c = null; } }
  else c = cs[0] || null;
  if (c && c.lat != null && c.lng != null) return { lat: c.lat, lng: c.lng, nome: c.nome, cidade: String(c.cidade || "").replace(/\/[A-Z]{2}$/, "") };
  const cidade = c ? String(c.cidade || "").replace(/\/[A-Z]{2}$/, "").trim() : String(local || "").trim();
  if (!cidade) throw new Error("Diga a cidade ou o condomínio para a previsão do tempo.");
  const g = await jget(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cidade)}&count=1&language=pt&country_code=BR`);
  const p = g?.results?.[0];
  if (!p) throw new Error(`Não encontrei a cidade "${cidade}". Diga o nome da cidade de outro jeito.`);
  return { lat: p.latitude, lng: p.longitude, nome: c ? c.nome : `${p.name}${p.admin1 ? " (" + p.admin1 + ")" : ""}`, cidade: p.name };
}

/* Previsão + avisos práticos para o condomínio */
I.tempo = async function(local, dias = 3){
  const n = Math.max(1, Math.min(7, Math.round(Number(dias) || 3)));
  const L = await localizar(local);
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${L.lat}&longitude=${L.lng}&timezone=America%2FSao_Paulo&forecast_days=${n}`
    + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m"
    + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,uv_index_max";
  const d = await jget(u);
  const cur = d.current || {}, dy = d.daily || {};
  const diasArr = (dy.time || []).map((t, i) => {
    const dt = new Date(t + "T12:00:00-03:00");
    return { data: t, dia: i === 0 ? "hoje" : i === 1 ? "amanhã" : DIAS[dt.getDay()], ceu: WMO[dy.weather_code[i]] || "—",
      max: r0(dy.temperature_2m_max[i]), min: r0(dy.temperature_2m_min[i]), chuva_mm: Math.round((dy.precipitation_sum[i] || 0) * 10) / 10,
      chance_chuva: dy.precipitation_probability_max?.[i] ?? null, rajada_kmh: r0(dy.wind_gusts_10m_max[i]), uv: Math.round(dy.uv_index_max?.[i] || 0) };
  });
  const avisos = [];
  diasArr.forEach((x, i) => {
    const quando = x.dia;
    if (x.chuva_mm >= 30 || (x.chuva_mm >= 15 && (x.chance_chuva ?? 0) >= 70) || [65, 82, 95, 96, 99].includes(dy.weather_code[i]))
      avisos.push([0, `Chuva forte ${quando} (${mm(x.chuva_mm)} mm): conferir calhas, ralos e grelhas, testar as bombas de drenagem da garagem e avisar os moradores sobre janelas e varais.`]);
    if (x.rajada_kmh >= 60) avisos.push([1, `Vento forte ${quando} (rajadas de ${x.rajada_kmh} km/h): recolher guarda-sóis, cadeiras e objetos soltos das áreas comuns e pedir atenção com vasos nas sacadas.`]);
    if (x.max >= 34) avisos.push([2, `Calor forte ${quando} (${x.max} °C): reforçar água e pausas para os funcionários e acompanhar o nível da caixa d'água.`]);
    if (x.min <= 8) avisos.push([3, `Frio ${quando} (mínima de ${x.min} °C): atenção à portaria noturna e aos moradores idosos.`]);
    if (x.uv >= 8 && x.chuva_mm < 5) avisos.push([4, `Índice UV muito alto ${quando} (${x.uv}): orientar o uso da piscina com proteção solar.`]);
  });
  return {
    local: L.nome, cidade: L.cidade,
    agora: { temperatura: r0(cur.temperature_2m), sensacao: r0(cur.apparent_temperature), ceu: WMO[cur.weather_code] || "—", umidade: r0(cur.relative_humidity_2m), vento_kmh: r0(cur.wind_speed_10m), rajada_kmh: r0(cur.wind_gusts_10m), chovendo: (cur.precipitation || 0) > 0 },
    dias: diasArr, avisos_para_o_condominio: [...new Set(avisos.sort((a, b) => a[0] - b[0]).map(x => x[1]))].slice(0, 4),
    fonte: "Open-Meteo (modelos meteorológicos; confirme alertas oficiais na Defesa Civil)"
  };
};

/* Resumo curto do dia para a abertura da conversa (sem bloquear: no máximo ~2,5 s) */
I.tempoHoje = async function(){
  try{
    const t = await Promise.race([I.tempo(null, 2), new Promise((_, f) => setTimeout(() => f(new Error("demorou")), 2500))]);
    const h = t.dias[0], a = t.dias[1];
    let s = `${t.cidade || t.local}: agora ${t.agora.temperatura} °C, ${t.agora.ceu}. Hoje ${h.min} a ${h.max} °C, ${h.ceu}${h.chance_chuva != null ? ", chance de chuva " + h.chance_chuva + "%" : ""}.`;
    if (a) s += ` Amanhã ${a.min} a ${a.max} °C, ${a.ceu}${a.chuva_mm ? ", " + mm(a.chuva_mm) + " mm" : ""}.`;
    if (t.avisos_para_o_condominio.length) s += " ALERTA: " + t.avisos_para_o_condominio[0];
    return s;
  }catch(_){ return "Previsão indisponível agora."; }
};

/* Pesquisa geral: enciclopédia (Wikipédia em português) + notícias recentes */
I.pesquisar = async function(consulta, buscarNoticias){
  const q = String(consulta || "").trim(); if (!q) throw new Error("Diga o que pesquisar.");
  const wiki = (async () => {
    const s = await jget(`https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*&srlimit=3`);
    const hits = s?.query?.search || [];
    const out = [];
    for (const h of hits.slice(0, 2)){
      try{
        const r = await jget(`https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(h.title.replace(/ /g, "_"))}`);
        if (r?.extract) out.push({ titulo: r.title, resumo: r.extract.slice(0, 700), link: r.content_urls?.desktop?.page || "" });
      }catch(_){}
    }
    return out;
  })().catch(() => []);
  const news = buscarNoticias ? buscarNoticias(q).catch(() => []) : Promise.resolve([]);
  const [enc, not] = await Promise.all([wiki, news]);
  if (!enc.length && !not.length) return { consulta: q, encontrado: false, mensagem: "Não achei nada confiável sobre isso na enciclopédia nem nas notícias recentes. Diga com outras palavras." };
  return { consulta: q, enciclopedia: enc, noticias_recentes: not.slice(0, 5),
    observacao: "Fontes públicas: Wikipédia (conteúdo enciclopédico, pode não estar atualizado) e notícias de veículos de imprensa. Cite a fonte ao responder e não invente além do que está aqui." };
};
})();
