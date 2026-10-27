/* ======================= DIAGNÓSTICO NA TELA ======================= */
(function(){
  const show = msg => { const h = document.getElementById("hint"); if (h){ h.textContent = "Erro: " + msg; h.classList.add("err"); } };
  window.addEventListener("error", e => show((e.message || "desconhecido") + (e.lineno ? " (linha " + e.lineno + ")" : "")));
  window.addEventListener("unhandledrejection", e => show(String(e.reason && (e.reason.message || e.reason)).slice(0, 160)));
  window.SINDICS_V = "3.8.3";
})();
/* ======================= SERVIDOR (Supabase) ======================= */
const SUPABASE_URL = "https://hjjckvluydcejmrxolza.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqamNrdmx1eWRjZWptcnhvbHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwNDc3MDMsImV4cCI6MjEwODYyMzcwM30.7MtMPxBEaTkoNCqI2dt-2iLiugm_fkXVV6-TxdkTHR0";
const FN_SESSAO = SUPABASE_URL + "/functions/v1/sessao-sindics";
const FN_EXCLUIR = SUPABASE_URL + "/functions/v1/excluir-condominio";
const SITE_URL = "https://sindicosincero-cmd.github.io/sindics/";
const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
let PERFIL = null;

function preencherCabecalho(p){
  document.getElementById("hdrSindico").textContent = "Assistente do Síndico · " + (p.assinatura ? p.assinatura.split("—")[0].trim() : p.nome);
  document.getElementById("hdrEmpresa").textContent = p.empresa || "—";
  const cs = p.condominios || [];
  document.getElementById("hdrCondLabel").textContent = cs.length > 1 ? "Condomínios" : "Condomínio";
  document.getElementById("hdrCond").textContent = cs.length > 1 ? cs.length + " cadastrados" : (cs[0] ? cs[0].nome : "nenhum");
}
const WAKE_RE = /\b(s[ií]ndi(cs|ks|x|ques|quis|cos?)|sin\s?dics|syndics?)\b/i;
const SLEEP_RE = /(pode descansar|pode desligar|pode encerrar|encerr(ar|a|e)( (a )?conversa| por hoje| aqui)?\b|desligar sindics|desliga|at[eé] mais|at[eé] amanh[ãa]|at[eé] logo|tchau|boa noite,? sindics|obrigad[oa],? sindics|[eé] s[oó] isso|por hoje [eé] s[oó])/i;
const IDLE_MS = 30000;
/* Legenda das respostas do SINDICS na tela. false = só voz (as falas continuam no Registro). */
const SHOW_CAPTION = false;
const TOOL_LABEL = { indicadores_economicos:"Consultando Banco Central", noticias_brasil:"Buscando notícias", knowledge_base:"Consultando documentos do condomínio", knowledge_base_rag:"Consultando documentos do condomínio", mostrar_na_tela:"Montando painel" };

const $ = id => document.getElementById(id);
const stateEl=$("state"), toolEl=$("tool"), captionEl=$("caption"), youEl=$("you"), logEl=$("log"), hintEl=$("hint");
const wakeBtn=$("wakeBtn"), sleepBtn=$("sleepBtn"), muteBtn=$("mute"), sfxBtn=$("sfxBtn");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const isLite = matchMedia("(max-width: 860px)").matches || (navigator.hardwareConcurrency||8) <= 4;

/* ======================= MOTION (com reserva nativa) ======================= */
const M = window.Motion;
function anim(el, kf, opts={}){
  if (reduce) { const last = {}; for (const k in kf){ const v = kf[k]; last[k] = Array.isArray(v) ? v[v.length-1] : v; } Object.assign(el.style, last); return Promise.resolve(); }
  if (M && M.animate){ try{ return M.animate(el, kf, opts).finished || Promise.resolve(); }catch(_){} }
  const frames = {}; for (const k in kf){ frames[k] = Array.isArray(kf[k]) ? kf[k] : [getComputedStyle(el)[k], kf[k]]; }
  return el.animate(frames, {duration:(opts.duration||.5)*1000, delay:(opts.delay||0)*1000, easing:"cubic-bezier(.2,.9,.2,1)", fill:"forwards"}).finished;
}
const springIn = {type:"spring", stiffness:220, damping:22, duration:.7};

/* ======================= RELÓGIO E REDE ======================= */
function tick(){ $("clock").textContent = new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}); }
tick(); setInterval(tick, 10000);
function net(){ const on = navigator.onLine; $("netDot").style.background = on ? "var(--ok)" : "var(--danger)"; $("netDot").style.boxShadow = on ? "0 0 8px var(--ok)" : "0 0 8px var(--danger)"; $("netTxt").textContent = on ? "Online" : "Sem internet"; }
addEventListener("online", net); addEventListener("offline", net); net();

/* ======================= SONS DE INTERFACE ======================= */
/* Sons sintetizados na hora (sem arquivos): camadas suaves com reverberação, no estilo de interface de nave.
   O mesmo motor gera a prévia em áudio (renderSomPrevia) para ouvir fora do sistema. */
let sfxCtx = null, hum = null, motorSom = null;
function sfx(){ if (!sfxCtx) sfxCtx = new AudioContext(); return sfxCtx; }
function impulsoReverb(c, seg = 3, queda = 2.6){
  const n = Math.floor(c.sampleRate * seg), buf = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++){ const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, queda); }
  return buf;
}
function montarMotor(c){
  const comp = c.createDynamicsCompressor(); comp.threshold.value = -20; comp.knee.value = 18; comp.ratio.value = 3; comp.attack.value = .01; comp.release.value = .3;
  const master = c.createGain(); master.gain.value = 1.3; master.connect(comp); comp.connect(c.destination);
  const rev = c.createConvolver(); rev.buffer = impulsoReverb(c);
  const wet = c.createGain(); wet.gain.value = .5; rev.connect(wet); wet.connect(master);
  const dry = c.createGain(); dry.gain.value = .75; dry.connect(master);
  const bus = c.createGain(); bus.connect(dry); bus.connect(rev);
  const ruido = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const nd = ruido.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  return { c, bus, rev, ruido };
}
function motor(){ const c = sfx(); if (!motorSom || motorSom.c !== c) motorSom = montarMotor(c); return motorSom; }
/* vozes */
function vPad(m, f, t0, dur, ganho, pan = 0){
  const { c } = m, g = c.createGain(), lp = c.createBiquadFilter(), p = c.createStereoPanner ? c.createStereoPanner() : null;
  lp.type = "lowpass"; lp.frequency.setValueAtTime(600, t0); lp.frequency.linearRampToValueAtTime(2400, t0 + dur * .6); lp.Q.value = .4;
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(ganho, t0 + dur * .35); g.gain.setTargetAtTime(0, t0 + dur * .55, dur * .18);
  [["sine", -5], ["triangle", 5]].forEach(([tipo, det]) => { const o = c.createOscillator(); o.type = tipo; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(t0); o.stop(t0 + dur + 1.5); });
  lp.connect(g); if (p){ p.pan.value = pan; g.connect(p); p.connect(m.bus); } else g.connect(m.bus);
}
function vSino(m, f, t0, ganho, dur = 1.8, pan = 0){
  const { c } = m, car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain(), p = c.createStereoPanner ? c.createStereoPanner() : null;
  car.frequency.value = f; mod.frequency.value = f * 3.5;
  mg.gain.setValueAtTime(f * 1.4, t0); mg.gain.exponentialRampToValueAtTime(f * .02, t0 + dur * .5);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(ganho, t0 + .008); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
  mod.connect(mg); mg.connect(car.frequency); car.connect(g);
  if (p){ p.pan.value = pan; g.connect(p); p.connect(m.rev); p.connect(m.bus); } else { g.connect(m.bus); }
  car.start(t0); mod.start(t0); car.stop(t0 + dur + .1); mod.stop(t0 + dur + .1);
}
function vAr(m, t0, dur, ganho, f0, f1){
  const { c } = m, src = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
  src.buffer = m.ruido; src.loop = true; bp.type = "bandpass"; bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(f0, t0); bp.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(ganho, t0 + dur * .6); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
  src.connect(bp); bp.connect(g); g.connect(m.bus); src.start(t0); src.stop(t0 + dur + .05);
}
function vSub(m, t0, dur, ganho, f0, f1){
  const { c } = m, o = c.createOscillator(), g = c.createGain();
  o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur * .7);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(ganho, t0 + dur * .4); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
  o.connect(g); g.connect(m.bus); o.start(t0); o.stop(t0 + dur + .05);
}
/* composições */
const SONS = {
  // ignição: grave que sobe, ar que abre, acorde suspenso e um brilho de cristal no final
  boot(m, t){
    vSub(m, t, 2.2, .07, 41.2, 73.4);
    vAr(m, t + .05, 1.6, .035, 300, 7000);
    [[146.83, -.3], [220, .3], [329.63, -.15], [369.99, .15], [554.37, 0]].forEach(([f, pan], i) => vPad(m, f, t + .55 + i * .06, 2.8, .022, pan));
    [[1174.66, -.4], [1479.98, .4], [1760, -.2], [2217.46, .2]].forEach(([f, pan], i) => vSino(m, f, t + 1.15 + i * .11, .018, 2.2, pan));
    vSino(m, 587.33, t + 1.95, .03, 2.6); vSino(m, 880, t + 1.97, .022, 2.6);
  },
  wake(m, t){ vAr(m, t, .45, .025, 900, 6000); vSino(m, 880, t + .05, .03, 1.4, -.2); vSino(m, 1318.51, t + .14, .026, 1.6, .2); },
  sleep(m, t){ vSino(m, 1318.51, t, .022, 1.3, .2); vSino(m, 880, t + .12, .022, 1.5, -.2); vSino(m, 587.33, t + .26, .02, 1.8); vAr(m, t, .6, .015, 5000, 500); },
  panel(m, t){ vSino(m, 2093, t, .012, .7, (Math.random() - .5) * .6); },
  // alarme de agenda: três chamadas claras, sem estridência
  alarme(m, t){ [0, .6, 1.2].forEach(d => { vSino(m, 1046.5, t + d, .05, .9, -.2); vSino(m, 1318.51, t + d + .09, .045, .9, .2); vSino(m, 1567.98, t + d + .18, .04, 1.1); }); },
};
function tocar(nome){ try{ const m = motor(); SONS[nome](m, m.c.currentTime + .02); }catch(_){} }
const sndWake = () => tocar("wake");
const sndSleep = () => tocar("sleep");
const sndPanel = () => tocar("panel");
/* Som de ignição: se o navegador ainda não liberou o áudio (página aberta sem toque), toca no primeiro toque. */
let bootPendente = false;
const sndBoot = () => { const c = sfx(); if (c.state === "running") tocar("boot"); else bootPendente = true; };
/* Prévia em arquivo (só para ouvir/testar): renderiza os sons num WAV */
async function renderSomPrevia(nomes = ["boot", "wake", "sleep"], gap = 1.2){
  const durs = { boot: 5, wake: 2, sleep: 2.5, panel: 1, alarme: 2.6 };
  const total = nomes.reduce((t, n) => t + durs[n] + gap, 0), rate = 44100;
  const c = new OfflineAudioContext(2, Math.ceil(total * rate), rate), m = montarMotor(c);
  let t = .1; nomes.forEach(n => { SONS[n](m, t); t += durs[n] + gap; });
  const buf = await c.startRendering(), L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
  const dv = new DataView(new ArrayBuffer(44 + n * 4)); const w = (o, s) => [...s].forEach((ch, i) => dv.setUint8(o + i, ch.charCodeAt(0)));
  w(0, "RIFF"); dv.setUint32(4, 36 + n * 4, true); w(8, "WAVE"); w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++){ dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
  let pico = 0; for (let i = 0; i < n; i++) pico = Math.max(pico, Math.abs(L[i]), Math.abs(R[i]));
  return { wav: new Uint8Array(dv.buffer), pico };
}
function toggleHum(){
  const c = sfx();
  if (hum){ hum.g.gain.linearRampToValueAtTime(0, c.currentTime + .6); const h = hum; setTimeout(()=>{ try{ h.o1.stop(); h.o2.stop(); }catch(_){} }, 800); hum = null; sfxBtn.setAttribute("aria-pressed","false"); return; }
  const o1 = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
  o1.frequency.value = 55; o2.frequency.value = 82.5; o2.detune.value = 6; f.type = "lowpass"; f.frequency.value = 300;
  g.gain.value = 0; o1.connect(f); o2.connect(f); f.connect(g); g.connect(c.destination); o1.start(); o2.start();
  g.gain.linearRampToValueAtTime(.025, c.currentTime + 1.2); hum = {o1,o2,g}; sfxBtn.setAttribute("aria-pressed","true");
}

/* ======================= ESTADO ======================= */
let mode = "boot";
const MODE_LABEL = {boot:"Inicializando", standby:"Em prontidão", connecting:"Conectando", listening:"Ouvindo", thinking:"Processando", speaking:"Falando"};
const MODE_HEX_ESCURO = {boot:"#3fd0ff", standby:"#5a7fa8", connecting:"#8f7bff", listening:"#ffb547", thinking:"#8f7bff", speaking:"#3fd0ff"};
const MODE_HEX_CLARO  = {boot:"#0477ab", standby:"#4f6f94", connecting:"#5a45d1", listening:"#b86600", thinking:"#5a45d1", speaking:"#0477ab"};
const temaClaro = () => document.documentElement.dataset.theme === "light";
let MODE_HEX = temaClaro() ? MODE_HEX_CLARO : MODE_HEX_ESCURO;
function setMode(m){
  if (mode === m) return; mode = m;
  stateEl.textContent = MODE_LABEL[m];
  document.documentElement.style.setProperty("--accent", MODE_HEX[m]);
}

/* ======================= TEMA (escuro padrão / claro opcional) ======================= */
function aplicarTema(t){
  const claro = t === "light";
  if (claro) document.documentElement.dataset.theme = "light"; else delete document.documentElement.dataset.theme;
  try{ localStorage.setItem("sindics-tema", claro ? "light" : "dark"); }catch(_){}
  document.querySelector('meta[name="theme-color"]').content = claro ? "#e9eff5" : "#04070d";
  MODE_HEX = claro ? MODE_HEX_CLARO : MODE_HEX_ESCURO;
  document.documentElement.style.setProperty("--accent", MODE_HEX[mode]);
  $("themeBtn").textContent = claro ? "Tema escuro" : "Tema claro";
  if (window.sindicsTema3D) window.sindicsTema3D(claro);
}

/* ======================= MENU (recolhido; abre ao tocar ou por voz) ======================= */
const DRAWERS = ["menuDrawer","drawer","condDrawer","admDrawer"];
function abrirMenu(){ DRAWERS.forEach(id => $(id).classList.remove("open")); $("menuDrawer").classList.add("open"); $("menuBtn").setAttribute("aria-expanded","true"); $("menuBtn").classList.remove("pulsar"); }
function fecharMenu(){ $("menuDrawer").classList.remove("open"); $("menuBtn").setAttribute("aria-expanded","false"); }
function abrirGaveta(id){ fecharMenu(); $(id).classList.add("open"); }

/* Avisos curtos embaixo do núcleo: somem sozinhos (erros ficam) */
let hintTimer = null;
function agendarSumicoHint(){
  hintEl.classList.remove("apagada"); clearTimeout(hintTimer);
  if (!hintEl.classList.contains("err")) hintTimer = setTimeout(() => hintEl.classList.add("apagada"), 7000);
}
new MutationObserver(agendarSumicoHint).observe(hintEl, { childList:true, characterData:true, subtree:true });
agendarSumicoHint();
const inSession = () => ["connecting","listening","thinking","speaking"].includes(mode);

/* ======================= LEGENDA, REGISTRO, PAINÉIS ======================= */
let typeTimer = null;
function typeCaption(text){
  clearInterval(typeTimer); let i = 0; captionEl.textContent = "";
  const span = document.createElement("span"), cur = document.createElement("span"); cur.className = "cursor";
  captionEl.append(span, cur);
  const speed = Math.max(16, Math.min(42, 3400 / Math.max(text.length,1)));
  typeTimer = setInterval(() => { i++; span.textContent = text.slice(0,i); if (i >= text.length){ clearInterval(typeTimer); setTimeout(()=>cur.remove(), 1500); } }, speed);
}
function addLog(who, text){
  const p = document.createElement("p"); p.className = who; const s = document.createElement("small");
  s.textContent = who === "a" ? "SINDICS" : who === "u" ? "VOCÊ" : new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
  p.append(s, document.createTextNode(text)); logEl.append(p); logEl.scrollTop = logEl.scrollHeight;
}
const TYPE_TAG = {noticias:"Notícias", calculo:"Cálculo", regra:"Regra", indicador:"Indicador", checklist:"Checklist", texto:"Info", alarme:"Alarme"};
function limparTela(){ $("panels").innerHTML = ""; }
function showPanel(p){
  const box = $("panels");
  if (/^tela limpa$/i.test(String(p.titulo || "").trim()) && !(p.itens || []).length){ limparTela(); addLog("s", "Tela limpa."); return; }
  const tipo = TYPE_TAG[p.tipo] ? p.tipo : "texto";
  const card = document.createElement("div"); card.className = "holo card " + tipo;
  const h = document.createElement("h3"); h.innerHTML = `<span></span><em></em>`; h.firstChild.textContent = TYPE_TAG[tipo]; h.lastChild.textContent = new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
  const x = document.createElement("button"); x.type = "button"; x.className = "x"; x.textContent = "×"; x.setAttribute("aria-label", "Fechar painel"); x.onclick = () => card.remove(); h.append(x);
  const t = document.createElement("p"); t.className = "t"; t.textContent = p.titulo || "";
  const ul = document.createElement("ul");
  (Array.isArray(p.itens) ? p.itens : []).slice(0,6).forEach(x => { const li = document.createElement("li"); li.textContent = String(x); ul.append(li); });
  card.append(h, t, ul);
  if (p.resultado){ const r = document.createElement("div"); r.className = "res"; r.textContent = p.resultado; card.append(r); }
  if (p.fonte){ const f = document.createElement("div"); f.className = "src"; f.textContent = "Fonte: " + p.fonte; card.append(f); }
  box.prepend(card);
  while (box.children.length > 3) box.lastChild.remove();
  sndPanel(); core.pulse = 1;
  card.style.opacity = 0;
  anim(card, {opacity:[0,1], transform:["translateX(40px) scale(.96)","translateX(0) scale(1)"], filter:["blur(6px)","blur(0px)"]}, springIn);
  const lis = [...ul.children];
  lis.forEach((li,i) => { li.style.opacity = 0; anim(li, {opacity:[0,1], transform:["translateX(12px)","translateX(0)"]}, {duration:.35, delay:.15 + i*.08}); });
  addLog("s", `Painel: ${p.titulo || TYPE_TAG[tipo]}`);
}
function showTool(name){
  const label = TOOL_LABEL[name] || "Processando";
  toolEl.textContent = "◆ " + label + "…";
  anim(toolEl, {opacity:[0,1]}, {duration:.25});
  clearTimeout(showTool.t); showTool.t = setTimeout(() => { toolEl.textContent = ""; }, 6000);
}

/* ======================= INDICADORES AO VIVO (Banco Central) ======================= */
async function sgs(code, n){
  const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/${n}?formato=json`);
  if (!r.ok) throw new Error(r.status); return r.json();
}
const br = (v, d=2) => Number(v).toLocaleString("pt-BR",{minimumFractionDigits:d, maximumFractionDigits:d});
const mes = s => { const [, m, a] = s.split("/"); return ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"][+m-1] + "/" + a; };
async function loadIndicators(){
  const set = (id, val, date) => { $("i-"+id).textContent = val; $("d-"+id).textContent = date; };
  const fail = id => set(id, "—", "indisponível agora");
  sgs(432,1).then(d => set("selic", br(d[0].valor) + "%", "ao ano · " + d[0].data)).catch(()=>fail("selic"));
  sgs(13522,1).then(d => set("ipca", br(d[0].valor) + "%", "ref. " + mes(d[0].data))).catch(()=>fail("ipca"));
  sgs(189,12).then(d => { const acc = (d.reduce((a,x) => a*(1+Number(x.valor)/100), 1) - 1) * 100; set("igpm", br(acc) + "%", "até " + mes(d[d.length-1].data)); }).catch(()=>fail("igpm"));
  sgs(1,20).then(d => {
    const v = d.map(x => Number(x.valor)); set("usd", "R$ " + br(v[v.length-1], 4).replace(/0+$/,"").replace(/,$/,""), "venda · " + d[d.length-1].data);
    const mn = Math.min(...v), mx = Math.max(...v), w = 200, h = 30, sx = w/(v.length-1);
    const pts = v.map((y,i) => `${(i*sx).toFixed(1)},${(h-3-(y-mn)/(mx-mn||1)*(h-6)).toFixed(1)}`);
    const last = pts[pts.length-1].split(",");
    $("sp-usd").innerHTML = `<polyline points="0,${h} ${pts.join(" ")} ${w},${h}" style="fill:var(--line)" stroke="none"/><polyline points="${pts.join(" ")}" fill="none" style="stroke:var(--cyan)" stroke-width="1.4"/><circle cx="${last[0]}" cy="${last[1]}" r="2.6" style="fill:var(--cyan)"/>`;
  }).catch(()=>fail("usd"));
}

/* ======================= ÁUDIO ======================= */
let micStream=null, inCtx=null, processor=null, micAnalyser=null;
let outCtx=null, outAnalyser=null, outRate=16000, playHead=0, playing=[];
let ws=null, muted=false, idleTimer=null, sleepAfterReply=false;
function b64FromInt16(a){ const b = new Uint8Array(a.buffer); let s = ""; for (let i=0;i<b.length;i+=0x8000) s += String.fromCharCode.apply(null, b.subarray(i,i+0x8000)); return btoa(s); }
function int16FromB64(s){ const bin = atob(s); const b = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) b[i] = bin.charCodeAt(i); return new Int16Array(b.buffer, 0, b.length>>1); }
async function initAudio(){
  if (!outCtx){ outCtx = new AudioContext(); outAnalyser = outCtx.createAnalyser(); outAnalyser.fftSize = 512; outAnalyser.smoothingTimeConstant = .6; outAnalyser.connect(outCtx.destination); }
  if (!micStream){
    micStream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true, autoGainControl:true, channelCount:1}});
    inCtx = new AudioContext({sampleRate:16000});
    const src = inCtx.createMediaStreamSource(micStream);
    micAnalyser = inCtx.createAnalyser(); micAnalyser.fftSize = 512;
    processor = inCtx.createScriptProcessor(2048,1,1);
    processor.onaudioprocess = e => {
      if (!ws || ws.readyState !== 1 || muted) return;
      const f = e.inputBuffer.getChannelData(0), o = new Int16Array(f.length);
      for (let i=0;i<f.length;i++){ const s = Math.max(-1, Math.min(1, f[i])); o[i] = s<0 ? s*0x8000 : s*0x7fff; }
      ws.send(JSON.stringify({user_audio_chunk: b64FromInt16(o)}));
    };
    const sink = inCtx.createGain(); sink.gain.value = 0;
    src.connect(micAnalyser); src.connect(processor); processor.connect(sink); sink.connect(inCtx.destination);
  }
  liberarSom();
  await new Promise(r => setTimeout(r, 250));   // resume() fica pendente sem toque: não esperar por ele
  return somLiberado();
}
/* O navegador escuta sem toque, mas só deixa a página FALAR depois de um toque (exceto como app instalado). */
const somLiberado = () => !!outCtx && outCtx.state === "running" && (!inCtx || inCtx.state === "running");
function liberarSom(){
  [outCtx, inCtx, sfxCtx].forEach(c => { if (c && c.state !== "running") c.resume().catch(() => {}); });
  if (bootPendente && sfxCtx){ bootPendente = false; sfxCtx.resume().then(() => { if (!inSession()) tocar("boot"); }).catch(() => {}); }
}
let wakePendente = false;
function mostrarToque(titulo, texto){ $("tapTitulo").textContent = titulo; $("tapMsg").textContent = texto; $("tapOverlay").hidden = false; }
/* Qualquer toque ou tecla, em qualquer lugar, libera o som — sem botão específico */
["pointerdown","keydown","touchend"].forEach(ev => addEventListener(ev, () => {
  if (!outCtx || somLiberado()) return;
  liberarSom();
  setTimeout(() => {
    if (!somLiberado()) return;
    $("tapOverlay").hidden = true;
    if (wakePendente){ wakePendente = false; wake(); }
  }, 200);
}, { capture:true, passive:true }));
function playChunk(b64){
  const pcm = int16FromB64(b64); if (!pcm.length) return;
  const buf = outCtx.createBuffer(1, pcm.length, outRate), ch = buf.getChannelData(0);
  for (let i=0;i<pcm.length;i++) ch[i] = pcm[i]/0x8000;
  const src = outCtx.createBufferSource(); src.buffer = buf; src.connect(outAnalyser);
  playHead = Math.max(playHead, outCtx.currentTime + .04); src.start(playHead); playHead += buf.duration;
  playing.push(src); src.onended = () => { playing = playing.filter(s => s !== src); };
}
function stopPlayback(){ playing.forEach(s => { try{ s.stop(); }catch(_){} }); playing = []; if (outCtx) playHead = outCtx.currentTime; }

/* ======================= PALAVRA DE ATIVAÇÃO ======================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec=null, recOn=false, escutaBloqueada=false;
function startWake(){
  if (!SR || recOn || inSession()) return;
  rec = new SR(); rec.lang = "pt-BR"; rec.continuous = true; rec.interimResults = true;
  rec.onresult = e => { for (let i=e.resultIndex;i<e.results.length;i++){ if (WAKE_RE.test(e.results[i][0].transcript)){ wake(); return; } } };
  rec.onend = () => { recOn = false; if (mode === "standby") setTimeout(startWake, 300); };
  rec.onerror = e => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed"){
      escutaBloqueada = true;
      mostrarToque("TOQUE PARA ATIVAR", "O navegador pediu um toque para começar a ouvir “SINDICS”. Toque em qualquer lugar — depois disso é só falar.");
    }
  };
  try{ rec.start(); recOn = true; }catch(_){}
}
function stopWake(){ if (rec){ rec.onend = null; try{ rec.abort(); }catch(_){} } recOn = false; }

/* ======================= SESSÃO ======================= */
function standby(note){
  setMode("standby"); wakeBtn.hidden = false; sleepBtn.hidden = true; youEl.textContent = ""; toolEl.textContent = "";
  captionEl.textContent = !SHOW_CAPTION ? "" : SR ? "Em prontidão. Diga “SINDICS” quando precisar." : "Em prontidão. Toque em Chamar agora quando precisar.";
  if (note) addLog("s", note); startWake();
}
function resetIdle(){
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (outCtx && playHead > outCtx.currentTime){ resetIdle(); return; } endSession("Sem conversa por 30 segundos. Voltei à prontidão."); }, IDLE_MS);
}
async function wake(){
  if (inSession()) return;
  if (!micStream){
    try{ await initAudio(); }
    catch(_){ mostrarToque("MICROFONE BLOQUEADO", "Clique no cadeado ao lado do endereço, coloque Microfone em Permitir e recarregue a página."); return; }
  }
  if (!somLiberado()){ liberarSom(); await new Promise(r => setTimeout(r, 250)); }
  if (!somLiberado()){
    wakePendente = true; sndWake();
    mostrarToque("OUVI VOCÊ", "Toque em qualquer lugar da tela para liberar a minha voz. Isso só é pedido uma vez por abertura — instalado como aplicativo, nem isso.");
    return;
  }
  $("tapOverlay").hidden = true;
  if ($("condDrawer").classList.contains("open") && !(PERFIL?.condominios || []).length) $("condDrawer").classList.remove("open"); // sem condomínio: cadastro pode ser por voz
  stopWake(); sndWake(); setMode("connecting"); wakeBtn.hidden = true; sleepBtn.hidden = false; youEl.textContent = "";
  captionEl.textContent = "";
  /* Pede ao servidor um acesso temporário (só para síndico logado e ativo) */
  let acesso;
  try{
    const { data: { session } } = await sb.auth.getSession();
    if (!session){ endSession("Sessão expirada."); mostrarLogin("Sua sessão expirou. Entre novamente."); return; }
    const [r] = await Promise.all([
      fetch(FN_SESSAO, { method:"POST", headers:{ "Authorization":"Bearer " + session.access_token, "apikey": SUPABASE_ANON, "Content-Type":"application/json" }, body:"{}" }),
      bootLines(["Credenciais", "Base condominial", "Banco Central", "Canal de voz"], 110)
    ]);
    acesso = await r.json().catch(() => ({}));
    if (r.status === 402){ endSession("Acesso suspenso por assinatura."); mostrarBloqueio(acesso.erro || "Acesso suspenso por falta de pagamento."); return; }
    if (!r.ok || !acesso.signed_url) throw new Error(acesso.erro || ("Servidor respondeu " + r.status));
  }catch(err){
    hintEl.textContent = err.message || "Não foi possível liberar a conversa."; hintEl.classList.add("err");
    endSession("Conversa não liberada: " + (err.message || "erro")); return;
  }
  if (acesso.perfil){ PERFIL = { ...PERFIL, ...acesso.perfil, voz: acesso.voz || PERFIL?.voz }; preencherCabecalho(PERFIL); rotuloVoz(); }
  captionEl.textContent = "Conectando…";
  /* Voz escolhida pelo síndico. Se a feminina falhar ao conectar, tenta de novo com a padrão. */
  const usarVoz = acesso.voz === "feminina" && acesso.voice_id && !vozFalhou;
  const dv = { ...acesso.dynamic_variables, voz: usarVoz ? "feminina" : "masculina" };
  const override = { agent: { prompt: { knowledge_base: acesso.knowledge_base || [] } } };
  if (usarVoz) override.tts = { voice_id: acesso.voice_id };
  let conectou = false;
  ws = new WebSocket(acesso.signed_url);
  ws.onopen = () => ws.send(JSON.stringify({
    type:"conversation_initiation_client_data",
    dynamic_variables: dv,
    conversation_config_override: override
  }));
  ws.onmessage = ev => {
    let m; try{ m = JSON.parse(ev.data); }catch(_){ return; }
    switch(m.type){
      case "conversation_initiation_metadata": {
        const f = m.conversation_initiation_metadata_event?.agent_output_audio_format || "pcm_16000"; const r = /pcm_(\d+)/.exec(f); outRate = r ? +r[1] : 16000;
        conectou = true; setMode("listening"); captionEl.textContent = ""; hintEl.classList.remove("err"); hintEl.textContent = "Conectado · pode falar e interromper quando quiser · diga “pode descansar” para encerrar"; resetIdle(); break;
      }
      case "audio": { const a = m.audio_event?.audio_base_64; if (a){ playChunk(a); resetIdle(); } break; }
      case "agent_response": { const t = m.agent_response_event?.agent_response; if (t){ if (SHOW_CAPTION) typeCaption(t); addLog("a", t); } if (reiniciarAposFala){ reiniciarAposFala = false; reiniciarComNovaVoz(); } else if (sleepAfterReply) sleepAfterSpeech(); break; }
      case "user_transcript": { const t = m.user_transcription_event?.user_transcript; if (t && t.trim()){ if (SHOW_CAPTION) youEl.textContent = t; addLog("u", t); setMode("thinking"); resetIdle(); if (SLEEP_RE.test(t)) sleepAfterReply = true; } break; }
      case "client_tool_call": {
        const c = m.client_tool_call || {}; const sock = ws;
        resetIdle();
        executarFerramenta(c.tool_name, c.parameters || {}).then(res => {
          if (c.tool_call_id && sock && sock.readyState === 1)
            sock.send(JSON.stringify({type:"client_tool_result", tool_call_id:c.tool_call_id, result: typeof res === "string" ? res : JSON.stringify(res), is_error:false}));
        }).catch(err => {
          if (c.tool_call_id && sock && sock.readyState === 1)
            sock.send(JSON.stringify({type:"client_tool_result", tool_call_id:c.tool_call_id, result:"Erro: " + (err && err.message || err), is_error:true}));
        });
        break;
      }
      case "agent_tool_request": case "agent_tool_response": case "agent_tool_call": {
        const body = m[m.type] || m[m.type + "_event"] || {}; const name = body.tool_name || body.name;
        if (m.type !== "agent_tool_response" && name && name !== "mostrar_na_tela") showTool(name); resetIdle(); break;
      }
      case "interruption": stopPlayback(); break;
      case "ping": { const id = m.ping_event?.event_id, d = m.ping_event?.ping_ms || 0; setTimeout(() => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({type:"pong", event_id:id})); }, d); break; }
    }
  };
  ws.onerror = () => { hintEl.textContent = "Falha na conexão com o SINDICS. Confira a internet."; hintEl.classList.add("err"); };
  ws.onclose = ev => {
    if (usarVoz && !conectou && mode === "connecting"){
      vozFalhou = true; addLog("s", "A voz feminina não está liberada na conta de voz (código " + ev.code + "). Usando a voz padrão.");
      endSession("Reconectando com a voz padrão…"); hintEl.textContent = "Voz feminina indisponível no momento — usando a voz padrão."; hintEl.classList.add("err");
      setTimeout(wake, 600); return;
    }
    if (mode === "connecting"){ hintEl.textContent = "O SINDICS recusou a conexão (código " + ev.code + "). Use o endereço oficial: sindicosincero-cmd.github.io/sindics"; hintEl.classList.add("err"); }
    if (inSession()) endSession("Conversa encerrada.");
  };
}
function sleepAfterSpeech(){ const w = () => { if (outCtx && playHead > outCtx.currentTime){ setTimeout(w,300); return; } setTimeout(() => endSession("Encerrado a seu pedido."), 600); }; setTimeout(w, 400); }
function endSession(note){
  clearTimeout(idleTimer); sleepAfterReply = false; const s = ws; ws = null;
  try{ s && s.readyState <= 1 && s.close(); }catch(_){}
  stopPlayback(); if (inSession()) sndSleep(); standby(note);
}

/* ======================= SEQUÊNCIA DE INICIALIZAÇÃO ======================= */
const bootEl = $("bootlog");
async function bootLines(lines, gap=160){
  bootEl.innerHTML = "";
  for (const l of lines){
    const d = document.createElement("div"); d.innerHTML = `<span></span> <span class="ok">OK</span>`; d.firstChild.textContent = "▸ " + l + " " + ".".repeat(Math.max(2, 22 - l.length));
    bootEl.append(d); anim(d, {opacity:[0,1], transform:["translateX(-10px)","translateX(0)"]}, {duration:.2});
    await new Promise(r => setTimeout(r, reduce ? 0 : gap));
  }
  setTimeout(() => anim(bootEl, {opacity:[1,0]}, {duration:.6}).then(() => { bootEl.innerHTML = ""; bootEl.style.opacity = 1; }), 900);
}
async function bootSequence(){
  core.boot = 0; sndBoot();
  await bootLines(["Núcleo SINDICS", "Reconhecimento de voz", "Base condominial", "Indicadores · Banco Central", "Módulo de notícias", "Síntese de voz"]);
  const mb = $("menuBtn"); mb.style.opacity = 0; anim(mb, {opacity:[0,.62]}, {duration:.6, delay:.2}).then(() => { mb.style.opacity = ""; });
}

/* ======================= BOTÕES ======================= */
wakeBtn.addEventListener("click", wake);
sleepBtn.addEventListener("click", () => endSession("Encerrado pelo botão."));
muteBtn.addEventListener("click", () => { muted = !muted; muteBtn.textContent = muted ? "Ativar mic" : "Silenciar mic"; muteBtn.setAttribute("aria-pressed", String(muted)); });
sfxBtn.addEventListener("click", toggleHum);
$("logBtn").addEventListener("click", () => abrirGaveta("drawer"));
$("closeLog").addEventListener("click", () => $("drawer").classList.remove("open"));
$("menuBtn").addEventListener("click", () => $("menuDrawer").classList.contains("open") ? fecharMenu() : abrirMenu());
$("closeMenu").addEventListener("click", fecharMenu);
$("themeBtn").addEventListener("click", () => aplicarTema(temaClaro() ? "dark" : "light"));
$("themeBtn").textContent = temaClaro() ? "Tema escuro" : "Tema claro";
wakeBtn.addEventListener("click", fecharMenu);
document.addEventListener("keydown", e => {
  if (e.target.closest("button,input")) return;
  if (e.code === "Space"){ e.preventDefault(); inSession() ? endSession("Encerrado pelo teclado.") : (mode === "standby" && wake()); }
  if (e.key === "Escape"){ DRAWERS.forEach(id => $(id).classList.remove("open")); $("menuBtn").setAttribute("aria-expanded","false"); fecharCalendario(); fecharDocumentacao(); fecharRadar(); fecharComunicado(); fecharLgpd(); if (perfilModo === "editar") fecharPerfil(); }
});

/* ======================= APLICATIVO INSTALÁVEL (voz liberada sem toque) ======================= */
let pedidoInstalar = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); pedidoInstalar = e; $("installBtn").hidden = false; });
addEventListener("appinstalled", () => { $("installBtn").hidden = true; pedidoInstalar = null; addLog("s", "SINDICS instalado como aplicativo."); });
$("installBtn").addEventListener("click", async () => { if (!pedidoInstalar) return; pedidoInstalar.prompt(); await pedidoInstalar.userChoice.catch(() => {}); pedidoInstalar = null; $("installBtn").hidden = true; });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
document.addEventListener("visibilitychange", () => { if (!document.hidden && mode === "standby") startWake(); });

/* ======================= LOGIN ======================= */
const loginMsg = $("loginMsg");
function msg(t, err){ loginMsg.textContent = t || ""; loginMsg.style.color = err ? "var(--danger)" : "var(--muted)"; }
function mostrarLogin(t, err){
  if (perfilModo !== "criar") $("perfilOverlay").hidden = true; fecharLgpd();
  $("loginOverlay").hidden = false; $("newPwdForm").hidden = true; $("loginForm").hidden = false; $("forgotBtn").hidden = false;
  msg(t, err); setTimeout(() => $("email").focus(), 80);
}
const ERROS = { "Invalid login credentials":"E-mail ou senha incorretos.", "Email not confirmed":"Confirme seu e-mail antes de entrar." };
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("email").value.trim(), password = $("pwd").value;
  if (!email || !password){ msg("Preencha e-mail e senha.", true); return; }
  $("loginBtn").disabled = true; msg("Entrando…");
  const { error } = await sb.auth.signInWithPassword({ email, password });
  $("loginBtn").disabled = false; $("pwd").value = "";
  if (error){ msg(ERROS[error.message] || "Não foi possível entrar: " + error.message, true); return; }
  await aposLogin();
});
$("forgotBtn").addEventListener("click", async () => {
  const email = $("email").value.trim();
  if (!email){ msg("Digite seu e-mail acima e clique de novo em Esqueci minha senha.", true); $("email").focus(); return; }
  msg("Enviando…");
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL });
  msg(error ? "Não foi possível enviar: " + error.message : "Se o e-mail estiver cadastrado, chegará um link para criar uma nova senha.", !!error);
});
$("newPwdForm").addEventListener("submit", async e => {
  e.preventDefault();
  const a = $("pwd1").value, b = $("pwd2").value;
  if (a.length < 8){ msg("A senha precisa ter pelo menos 8 caracteres.", true); return; }
  if (a !== b){ msg("As duas senhas não são iguais.", true); return; }
  const { error } = await sb.auth.updateUser({ password: a });
  if (error){ msg("Não foi possível salvar: " + error.message, true); return; }
  $("pwd1").value = $("pwd2").value = "";
  await aposLogin();
});
async function sair(){
  if (inSession()) endSession("Saiu da conta.");
  stopWake(); await sb.auth.signOut(); PERFIL = null;
  try{ history.replaceState(null, "", location.pathname); }catch(_){}
  mostrarLogin("Você saiu. Até logo!");
}
$("logoutBtn").addEventListener("click", sair);
$("googleBtn").addEventListener("click", async () => {
  msg("Abrindo o Google…");
  const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: SITE_URL, queryParams: { prompt: "select_account" } } });
  if (error) msg("Não foi possível entrar com Google: " + error.message, true);
});
$("admBtn").addEventListener("click", () => { abrirGaveta("admDrawer"); carregarAdmin(); });
$("closeAdm").addEventListener("click", () => $("admDrawer").classList.remove("open"));

/* ======================= AGENDA E DOCUMENTOS (ferramentas de voz) ======================= */
const TZ = "America/Sao_Paulo";
const isoDia = d => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year:"numeric", month:"2-digit", day:"2-digit" }).format(d);
const hojeISO = () => isoDia(new Date());
const diasAte = d => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(hojeISO() + "T00:00:00Z")) / 86400000);
const dataBR = d => d ? d.split("-").reverse().join("/") : "";
const quando = ts => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday:"short", day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }).format(new Date(ts));
const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
function acharCondominio(nome){
  if (!nome) return null;
  const n = norm(nome), cs = PERFIL?.condominios || [];
  const c = cs.find(x => norm(x.nome) === n) || cs.find(x => norm(x.nome).includes(n) || n.includes(norm(x.nome)));
  if (!c) throw new Error(`O condomínio "${nome}" não está cadastrado para este síndico. Condomínios disponíveis: ${cs.map(x => x.nome).join(", ")}.`);
  return c;
}
const nomeCondPorId = id => (PERFIL?.condominios || []).find(c => c.id === id)?.nome || "";
const exigeData = (v, campo) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(v || "")) throw new Error(`${campo} precisa estar no formato AAAA-MM-DD.`); return v; };
const comFuso = v => /([+-]\d{2}:?\d{2}|Z)$/.test(v) ? v : v + "-03:00";

const minutosLembrete = v => (v === undefined || v === null || v === "") ? 30 : Math.max(0, Math.min(10080, Math.round(Number(v)) || 0));
function textoLembrete(m){
  if (!m) return "Sem alarme";
  if (m % 1440 === 0) return `Alarme ${m / 1440} dia${m > 1440 ? "s" : ""} antes`;
  if (m % 60 === 0) return `Alarme ${m / 60} hora${m > 60 ? "s" : ""} antes`;
  return `Alarme ${m} minutos antes`;
}
function aposMudarAgenda(dt){ carregarLembretes(); if (!$("calOverlay").hidden) abrirCalendario(dt ? isoDia(dt) : null); }

async function executarFerramenta(nome, a){
  /* Comandos só de tela: respondem na hora, sem consultar o servidor */
  if (nome === "mostrar_na_tela"){ showPanel(a); return "Painel exibido na tela."; }
  if (nome === "tela_controlar") return controlarTela(a);
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("Sessão expirada; o síndico precisa entrar de novo.");
  return executarComDados(nome, a, user);
}
function controlarTela(a){
  switch (a.acao){
    case "abrir_menu": abrirMenu(); return "Menu aberto.";
    case "fechar_menu": DRAWERS.forEach(id => $(id).classList.remove("open")); $("menuBtn").setAttribute("aria-expanded","false"); fecharCalendario(); fecharDocumentacao(); fecharRadar(); return "Menu e janelas fechados.";
    case "tema_claro": aplicarTema("light"); return "Tema claro ativado.";
    case "tema_escuro": aplicarTema("dark"); return "Tema escuro ativado.";
    case "abrir_condominios": abrirCondominios(); return "Janela de condomínios aberta.";
    case "abrir_registro": abrirGaveta("drawer"); return "Registro da conversa aberto.";
    case "limpar_tela": limparTela(); return "Tela limpa.";
    case "abrir_calendario": {
      if (!PERFIL) throw new Error("Síndico não está logado.");
      abrirCalendario(a.data);
      const [y, m] = (calMes || hojeISO()).split("-").map(Number);
      return `Calendário de ${MESES[m - 1].toLowerCase()} de ${y} aberto na tela${calDia ? ", com o dia " + dataBR(calDia) + " em destaque" : ""}.`;
    }
    case "fechar_calendario": fecharCalendario(); return "Calendário fechado.";
    case "abrir_documentacao": return abrirDocumentacao(a.condominio).then(() => "Pasta de Documentação Legal aberta na tela.");
    case "fechar_documentacao": fecharDocumentacao(); return "Pasta de Documentação Legal fechada.";
    case "abrir_radar": return abrirRadar().then(ed => `Radar Condominial aberto na tela com ${ed.itens.length} notícias.`);
    case "fechar_radar": fecharRadar(); return "Radar fechado.";
    case "imprimir_comunicado": if ($("comOverlay").hidden) throw new Error("Não há comunicado aberto na tela."); setTimeout(imprimirComunicado, 300); return "Janela de impressão aberta (dá para escolher Salvar como PDF).";
    case "copiar_comunicado": if ($("comOverlay").hidden) throw new Error("Não há comunicado aberto na tela."); return copiarComunicado().then(() => $("comCopiar").textContent.includes("✓") ? "Texto copiado." : "O navegador não deixou copiar por voz; peça para tocar em Copiar texto.");
    case "fechar_comunicado": fecharComunicado(); return "Comunicado fechado.";
    case "abrir_lgpd": return abrirLgpd(a.aba === "condominio" ? "condominio" : "dados").then(() => a.aba === "condominio" ? "Roteiro de LGPD do condomínio aberto na tela." : "Área de Privacidade e LGPD aberta: dados do síndico, download, correção e pedidos.");
    case "fechar_lgpd": fecharLgpd(); return "Área de privacidade fechada.";
    case "abrir_cadastro": if (!PERFIL) throw new Error("Síndico não está logado."); abrirPerfil("editar", PERFIL); return "Cadastro do síndico aberto na tela para conferir e corrigir.";
    default: throw new Error("Ação de tela desconhecida.");
  }
}
async function executarComDados(nome, a, user){
  switch (nome){
    case "preferencias_voz": {
      const atual = PERFIL?.voz === "feminina" ? "feminina" : "masculina";
      const nova = a.voz === "feminina" || a.voz === "masculina" ? a.voz : (atual === "feminina" ? "masculina" : "feminina");
      if (nova === atual && !vozFalhou) return `A voz ${atual} já está em uso.`;
      await trocarVoz(nova);
      if (inSession()){ reiniciarAposFala = true; setTimeout(() => { if (reiniciarAposFala){ reiniciarAposFala = false; reiniciarComNovaVoz(); } }, 9000); }
      return `Voz ${nova} salva como preferência. Diga só uma frase curta de despedida (ex.: "Trocando para a voz ${nova}."); a conversa reinicia sozinha em seguida já com a nova voz.`;
    }
    case "agenda_criar": {
      const cond = a.condominio ? acharCondominio(a.condominio) : null;
      const ini = new Date(comFuso(a.inicio)); if (isNaN(ini)) throw new Error("Data e hora de início inválidas.");
      const fim = new Date(ini.getTime() + (Number(a.duracao_minutos) || 60) * 60000);
      const lembrete = minutosLembrete(a.lembrete_minutos);
      const { data, error } = await sb.from("compromissos").insert({ titulo: a.titulo, inicio: ini.toISOString(), fim: fim.toISOString(), condominio_id: cond?.id || null, local: a.local || "", observacoes: a.observacoes || "", lembrete_minutos: lembrete }).select("id").single();
      if (error) throw error;
      atualizarResumoTela(); aposMudarAgenda(ini);
      return { ok: true, id: data.id, mensagem: `Compromisso marcado: ${a.titulo}, ${quando(ini)}${cond ? ", " + cond.nome : ""}. ${textoLembrete(lembrete)}.` };
    }
    case "agenda_listar": {
      const di = exigeData(a.data_inicio, "data_inicio"), df = exigeData(a.data_fim, "data_fim");
      let q = sb.from("compromissos").select("id, titulo, inicio, fim, condominio_id, local, status, lembrete_minutos")
        .eq("sindico_id", user.id).gte("inicio", new Date(di + "T00:00:00-03:00").toISOString()).lte("inicio", new Date(df + "T23:59:59-03:00").toISOString()).order("inicio");
      if (!a.incluir_cancelados) q = q.neq("status", "cancelado");
      const { data, error } = await q; if (error) throw error;
      return { total: data.length, compromissos: data.map(c => ({ id: c.id, titulo: c.titulo, quando: quando(c.inicio), condominio: nomeCondPorId(c.condominio_id), local: c.local, status: c.status, alarme: textoLembrete(c.lembrete_minutos) })) };
    }
    case "agenda_alterar": {
      let patch;
      if (a.acao === "cancelar") patch = { status: "cancelado" };
      else if (a.acao === "concluir") patch = { status: "concluido" };
      else if (a.acao === "remarcar"){
        if (!a.novo_inicio) throw new Error("Para remarcar, informe novo_inicio.");
        const ini = new Date(comFuso(a.novo_inicio)); if (isNaN(ini)) throw new Error("Nova data inválida.");
        patch = { inicio: ini.toISOString(), fim: new Date(ini.getTime() + (Number(a.duracao_minutos) || 60) * 60000).toISOString(), status: "agendado", lembrete_avisado_em: null };
      } else if (a.acao === "alarme"){
        if (a.lembrete_minutos == null) throw new Error("Informe lembrete_minutos (0 desliga o alarme).");
        patch = { lembrete_avisado_em: null };
      } else throw new Error("Ação desconhecida.");
      if (a.lembrete_minutos != null) patch.lembrete_minutos = minutosLembrete(a.lembrete_minutos);
      const { data, error } = await sb.from("compromissos").update(patch).eq("id", a.id).eq("sindico_id", user.id).select("titulo, inicio, lembrete_minutos").maybeSingle();
      if (error) throw error; if (!data) throw new Error("Compromisso não encontrado.");
      atualizarResumoTela(); aposMudarAgenda(new Date(data.inicio));
      const feito = a.acao === "remarcar" ? "remarcado para " + quando(data.inicio) : a.acao === "cancelar" ? "cancelado" : a.acao === "concluir" ? "concluído" : "alarme ajustado";
      return { ok: true, mensagem: `${data.titulo}: ${feito}.${a.acao === "cancelar" || a.acao === "concluir" ? "" : " " + textoLembrete(data.lembrete_minutos) + "."}` };
    }
    case "documento_cadastrar": {
      const cond = acharCondominio(a.condominio);
      const cat = await carregarCatalogo();
      const codigo = (a.codigo && cat.some(k => k.codigo === a.codigo)) ? a.codigo : codigoDoDocumento(a.documento || "");
      const k = codigo ? cat.find(x => x.codigo === codigo) : null;
      const ren = a.data_renovacao ? exigeData(a.data_renovacao, "data_renovacao") : null;
      let venc = a.data_vencimento ? exigeData(a.data_vencimento, "data_vencimento") : null, calculado = false;
      if (!venc && ren && k){
        const { data: cd } = await sb.from("condominios").select("uf").eq("id", cond.id).maybeSingle();
        const meses = validadeMeses(k, cd?.uf);
        if (meses){ venc = somaMeses(ren, meses); calculado = true; }
      }
      if (!venc) throw new Error(k ? `Para ${k.nome}, a validade depende do próprio documento: pergunte a data de vencimento.` : "Informe a data de vencimento (AAAA-MM-DD).");
      const dias = Math.max(0, Math.min(365, Number(a.alertar_dias_antes) || k?.alerta_dias || 30));
      const registro = { documento: k ? k.nome : a.documento, condominio_id: cond.id, data_renovacao: ren, data_vencimento: venc, alertar_dias_antes: dias, observacoes: a.observacoes || "", catalogo_codigo: codigo, situacao: "ativo", ultimo_alerta_email: null };
      let res;
      const existente = codigo ? (await sb.from("documentos_legais").select("id").eq("condominio_id", cond.id).eq("catalogo_codigo", codigo).maybeSingle()).data : null;
      if (existente) res = await sb.from("documentos_legais").update(registro).eq("id", existente.id).select("id").single();
      else res = await sb.from("documentos_legais").insert(registro).select("id").single();
      if (res.error) throw res.error;
      atualizarResumoTela(); if (!$("docOverlay").hidden) renderDocumentacao();
      const f = diasAte(venc);
      return { ok: true, id: res.data.id, mensagem: `${registro.documento} do ${cond.nome} ${existente ? "atualizado" : "cadastrado"}. Vence em ${dataBR(venc)}${calculado ? " (calculado pela validade padrão a partir da renovação)" : ""} (${f < 0 ? "já vencido" : "faltam " + f + " dias"}). Aviso ${dias} dias antes.${k ? " Base legal: " + k.base_legal : ""}` };
    }
    case "documentacao_legal": {
      const cond = a.condominio ? acharCondominio(a.condominio) : (PERFIL?.condominios || [])[0];
      if (!cond) throw new Error("Nenhum condomínio cadastrado.");
      if (a.acao === "nao_se_aplica" || a.acao === "aplica_se"){
        const codigo = a.codigo || codigoDoDocumento(a.documento || "");
        if (!codigo) throw new Error("Não identifiquei o documento. Diga o nome como está na pasta (ex.: RIA dos elevadores, PMOC, PGR).");
        await marcarAplicacao(cond.id, codigo, a.acao === "nao_se_aplica");
        if (!$("docOverlay").hidden) renderDocumentacao();
        return { ok: true, mensagem: `${(await carregarCatalogo()).find(k => k.codigo === codigo)?.nome || codigo}: marcado como ${a.acao === "nao_se_aplica" ? "não se aplica" : "aplicável"} ao ${cond.nome}.` };
      }
      dlCondId = cond.id;
      if (a.mostrar !== false) await abrirDocumentacao(cond.nome);
      const { itens } = await statusDocumentacao(cond.id);
      const resumo = st => itens.filter(i => i.st === st).map(i => ({ codigo: i.k.codigo, documento: i.k.nome, vence_em: i.doc?.data_vencimento ? dataBR(i.doc.data_vencimento) : undefined, dias: i.f, condicao: i.k.condicao || undefined, base_legal: i.k.base_legal }));
      return { condominio: cond.nome, na_tela: a.mostrar !== false, vencidos: resumo("vencido"), vencendo: resumo("vencendo"), obrigatorios_sem_cadastro: resumo("falta"),
        confirmar_se_aplica_ou_recomendados: resumo("confirmar").map(({ codigo, documento, condicao }) => ({ codigo, documento, condicao })), em_dia: itens.filter(i => i.st === "emdia").length, nao_se_aplicam: itens.filter(i => i.st === "naoaplica").length };
    }
    case "radar_condominial": {
      const ed = await abrirRadar(!!a.atualizar);
      return { data: ed.data, total: ed.itens.length, aviso: ed.aviso, noticias: ed.itens.map(i => ({ tema: i.tema, titulo: i.titulo, fonte: i.fonte, quando: haQuanto(i.publicado) })) };
    }
    case "noticias_buscar": {
      const consulta = String(a.consulta || "").trim(); if (!consulta) throw new Error("Diga o assunto da busca (ex.: Selic, economia, São Paulo).");
      const { data: { session } } = await sb.auth.getSession(); if (!session) throw new Error("Sessão expirada.");
      const r = await fetch(FN_RADAR, { method: "POST", headers: { "Authorization": "Bearer " + session.access_token, "apikey": SUPABASE_ANON, "Content-Type": "application/json" }, body: JSON.stringify({ consulta }) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || "Não consegui buscar notícias agora.");
      const itens = (j.itens || []).slice(0, 6);
      if (itens.length) showPanel({ tipo: "noticias", titulo: "Notícias: " + consulta, itens: itens.map(i => `${i.titulo} — ${i.fonte}`), fonte: "Google Notícias" });
      return { consulta, total: itens.length, noticias: itens.map(i => ({ titulo: i.titulo, fonte: i.fonte, quando: haQuanto(i.publicado) })) };
    }
    case "comunicado_exibir": {
      if (!a.corpo || String(a.corpo).trim().length < 20) throw new Error("Escreva o texto completo do comunicado em 'corpo'.");
      await mostrarComunicado(a);
      return "Comunicado aberto em tela inteira, com cabeçalho do condomínio e assinatura. O síndico pode ajustar o texto na tela, copiar ou imprimir/salvar em PDF.";
    }
    case "documentos_listar": {
      let q = sb.from("documentos_legais").select("id, documento, condominio_id, data_renovacao, data_vencimento, alertar_dias_antes, observacoes, situacao").eq("sindico_id", user.id).neq("situacao", "nao_aplica").order("data_vencimento");
      if (a.condominio) q = q.eq("condominio_id", acharCondominio(a.condominio).id);
      const { data, error } = await q; if (error) throw error;
      let itens = data.filter(d => d.data_vencimento).map(d => ({ id: d.id, documento: d.documento, condominio: nomeCondPorId(d.condominio_id), renovado_em: dataBR(d.data_renovacao), vence_em: dataBR(d.data_vencimento), dias_para_vencer: diasAte(d.data_vencimento), aviso_dias_antes: d.alertar_dias_antes, em_alerta: diasAte(d.data_vencimento) <= d.alertar_dias_antes, observacoes: d.observacoes }));
      if (a.somente_em_alerta) itens = itens.filter(i => i.em_alerta);
      return { total: itens.length, documentos: itens };
    }
    case "documento_alterar": {
      if (a.acao === "excluir"){
        const { data: alvo } = await sb.from("documentos_legais").select("documento, condominio_id").eq("id", a.id).eq("sindico_id", user.id).maybeSingle();
        if (!alvo) throw new Error("Documento não encontrado.");
        const ok = await confirmarNaTela("EXCLUIR DOCUMENTO", `Remover "${alvo.documento}"${alvo.condominio_id ? " do " + nomeCondPorId(alvo.condominio_id) : ""} da Pasta de Documentação Legal? O controle de vencimento deixa de existir.`, "Excluir documento");
        if (!ok) return { ok: false, mensagem: "O síndico não confirmou na tela. Nada foi apagado." };
        const { data, error } = await sb.from("documentos_legais").delete().eq("id", a.id).eq("sindico_id", user.id).select("documento").maybeSingle();
        if (error) throw error; if (!data) throw new Error("Documento não encontrado.");
        atualizarResumoTela(); return { ok: true, mensagem: `${data.documento} excluído.` };
      }
      const patch = {};
      if (a.acao === "renovar"){
        patch.data_renovacao = a.nova_data_renovacao ? exigeData(a.nova_data_renovacao, "nova_data_renovacao") : hojeISO();
        if (a.nova_data_vencimento) patch.data_vencimento = exigeData(a.nova_data_vencimento, "nova_data_vencimento");
        else {
          const { data: atual } = await sb.from("documentos_legais").select("catalogo_codigo, condominio_id").eq("id", a.id).maybeSingle();
          const k = atual?.catalogo_codigo ? (await carregarCatalogo()).find(x => x.codigo === atual.catalogo_codigo) : null;
          const { data: cd } = atual ? await sb.from("condominios").select("uf").eq("id", atual.condominio_id).maybeSingle() : { data: null };
          const meses = k ? validadeMeses(k, cd?.uf) : null;
          if (!meses) throw new Error("Informe a nova data de vencimento (a validade deste documento depende do próprio documento).");
          patch.data_vencimento = somaMeses(patch.data_renovacao, meses);
        }
        patch.ultimo_alerta_email = null; patch.situacao = "ativo";
      }
      if (a.alertar_dias_antes != null) patch.alertar_dias_antes = Math.max(0, Math.min(365, Number(a.alertar_dias_antes)));
      if (!Object.keys(patch).length) throw new Error("Nada para alterar.");
      const { data, error } = await sb.from("documentos_legais").update(patch).eq("id", a.id).eq("sindico_id", user.id).select("documento, data_vencimento, alertar_dias_antes").maybeSingle();
      if (error) throw error; if (!data) throw new Error("Documento não encontrado.");
      atualizarResumoTela();
      return { ok: true, mensagem: `${data.documento}: vence em ${dataBR(data.data_vencimento)}, aviso ${data.alertar_dias_antes} dias antes.` };
    }
    case "condominios_listar": {
      const { data, error } = await sb.from("condominios").select("nome, cnpj, endereco, cidade, unidades, convencao_status, regulamento_status").eq("sindico_id", user.id).order("nome");
      if (error) throw error;
      const st = s => s === "pronto" ? "enviado e lido" : s === "erro" ? "erro de leitura, reenviar" : s === "pendente" ? "pendente" : "em leitura";
      return { total: data.length, condominios: data.map(c => ({ nome: c.nome, cnpj: mascaraCnpj(c.cnpj || ""), endereco: [c.endereco, c.cidade].filter(Boolean).join(", "), apartamentos: c.unidades, convencao: st(c.convencao_status), regulamento: st(c.regulamento_status) })) };
    }
    case "condominio_cadastrar": {
      const cnpj = soCnpj(a.cnpj);
      if (!cnpjValido(cnpj)) throw new Error("CNPJ inválido. Peça para o síndico repetir os 14 números do CNPJ.");
      const nomeC = String(a.nome || "").trim(); if (nomeC.length < 3) throw new Error("Informe o nome do condomínio.");
      const unidades = Math.round(Number(a.unidades)); if (!(unidades >= 1 && unidades <= 99999)) throw new Error("Informe a quantidade de apartamentos.");
      let endereco = String(a.endereco || "").trim(), cidade = String(a.cidade || "").trim(), uf = String(a.uf || "").trim().toUpperCase();
      const cep = String(a.cep || "").replace(/\D/g, "");
      if (cep){
        if (cep.length !== 8) throw new Error("O CEP precisa ter 8 dígitos.");
        let j; try{ j = await (await fetch(`https://viacep.com.br/ws/${cep}/json/`)).json(); }catch(_){ throw new Error("Não consegui consultar o CEP agora. Peça rua, bairro, cidade e estado."); }
        if (j.erro) throw new Error("CEP não encontrado. Confirme o CEP ou peça rua, bairro, cidade e estado.");
        endereco = [j.logradouro, j.bairro].filter(Boolean).join(", ") || endereco; cidade = j.localidade || cidade; uf = j.uf || uf;
      }
      const num = String(a.numero || "").trim();
      if (!num && !/\d/.test(endereco)) throw new Error("Falta o número do endereço.");
      if (num) endereco += `, nº ${num}`;
      if (a.complemento) endereco += ` ${String(a.complemento).trim()}`;
      if (endereco.length < 5 || cidade.length < 2 || !/^[A-Z]{2}$/.test(uf)) throw new Error("Endereço incompleto. Peça o CEP e o número, ou rua, bairro, cidade e estado.");
      const { data, error } = await sb.from("condominios").insert({ cnpj, nome: nomeC, cep, unidades, endereco, cidade: `${cidade}/${uf}`, uf }).select("id").single();
      if (error) throw new Error(/condominios_cnpj_unico|duplicate/i.test(error.message) ? "Este CNPJ já está cadastrado no SINDICS. Se o condomínio é do síndico, ele deve falar com o administrador." : error.message);
      await recarregarCondominiosPerfil(); atualizarResumoTela();
      if ($("condDrawer").classList.contains("open")) listarCondominios();
      showPanel({ tipo: "checklist", titulo: `${nomeC} cadastrado`, itens: [
        `CNPJ ${mascaraCnpj(cnpj)}`, `${endereco} — ${cidade}/${uf}`, `${unidades} apartamentos`,
        "Pendente: Convenção em PDF", "Pendente: Regulamento Interno em PDF",
        "Envie os PDFs em Condomínios › Editar" ] });
      ["menuBtn","condBtn"].forEach(id => $(id).classList.add("pulsar")); setTimeout(() => ["menuBtn","condBtn"].forEach(id => $(id).classList.remove("pulsar")), 20000);
      return { ok: true, id: data.id, mensagem: `${nomeC} cadastrado: CNPJ ${mascaraCnpj(cnpj)}, ${endereco}, ${cidade}/${uf}, ${unidades} apartamentos. Pendentes: Convenção e Regulamento Interno em PDF, que o síndico envia no botão Condomínios, opção Editar. Até lá, as respostas sobre regras desse condomínio seguem só a lei geral.` };
    }
    case "condominio_excluir": {
      if (a.confirmado !== true) throw new Error("Exclusão não confirmada. Avise o que será apagado e peça para o síndico dizer 'confirmo a exclusão'.");
      const cond = acharCondominio(a.condominio);
      const ok = await confirmarNaTela("EXCLUIR CONDOMÍNIO", `Apagar o cadastro do ${cond.nome}, com Convenção, Regulamento, PDFs e prazos de documentos legais? A agenda é mantida. Não dá para desfazer.`, "Excluir condomínio");
      if (!ok) return { ok: false, mensagem: "O síndico não confirmou na tela. Nada foi apagado." };
      const { data: { session } } = await sb.auth.getSession(); if (!session) throw new Error("Sessão expirada.");
      const r = await fetch(FN_EXCLUIR, { method: "POST", headers: { "Authorization": "Bearer " + session.access_token, "apikey": SUPABASE_ANON, "Content-Type": "application/json" }, body: JSON.stringify({ condominio_id: cond.id, confirmado: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || "Não foi possível excluir agora (erro " + r.status + ").");
      await recarregarCondominiosPerfil(); atualizarResumoTela();
      if ($("condDrawer").classList.contains("open")) listarCondominios();
      showPanel({ tipo: "texto", titulo: `${cond.nome} excluído`, itens: ["Cadastro, Convenção, Regulamento e PDFs removidos", j.prazos_removidos ? `${j.prazos_removidos} prazo(s) de documentos legais removido(s)` : "Nenhum prazo de documento legal vinculado", "Compromissos da agenda foram mantidos"] });
      return { ok: true, mensagem: `Cadastro do ${cond.nome} excluído. ${j.prazos_removidos || 0} prazo(s) de documentos legais removidos; compromissos da agenda mantidos.` };
    }
    default: return "Ferramenta não reconhecida pela tela.";
  }
}

/* Painel fixo: vencimentos e agenda de hoje */
async function atualizarResumoTela(){
  if (!PERFIL) return;
  const { data: { user } } = await sb.auth.getUser(); if (!user) return;
  const hoje = hojeISO();
  const [{ data: docs }, { data: comps }] = await Promise.all([
    sb.from("documentos_legais").select("documento, condominio_id, data_vencimento, alertar_dias_antes").eq("sindico_id", user.id).order("data_vencimento"),
    sb.from("compromissos").select("titulo, inicio, condominio_id").eq("sindico_id", user.id).eq("status", "agendado")
      .gte("inicio", new Date(hoje + "T00:00:00-03:00").toISOString()).lte("inicio", new Date(hoje + "T23:59:59-03:00").toISOString()).order("inicio")
  ]);
  const alerta = (docs || []).map(d => ({ ...d, f: diasAte(d.data_vencimento) })).filter(d => d.f <= d.alertar_dias_antes);
  const box = $("resumoDia"); box.innerHTML = "";
  const h = document.createElement("h3"); h.innerHTML = "<span>Hoje</span><em></em>"; h.lastChild.textContent = new Date().toLocaleDateString("pt-BR", { day:"2-digit", month:"short" });
  box.append(h);
  const sec = (titulo, linhas, vazio) => {
    const t = document.createElement("p"); t.className = "rs-t"; t.textContent = titulo; box.append(t);
    const ul = document.createElement("ul"); ul.className = "rs";
    if (!linhas.length){ const li = document.createElement("li"); li.className = "ok"; li.textContent = vazio; ul.append(li); }
    linhas.forEach(([txt, cls]) => { const li = document.createElement("li"); li.textContent = txt; if (cls) li.className = cls; ul.append(li); });
    box.append(ul);
  };
  sec("Documentos em alerta", alerta.slice(0, 5).map(d => [`${d.documento}${d.condominio_id ? " · " + nomeCondPorId(d.condominio_id) : ""} — ${d.f < 0 ? "vencido há " + (-d.f) + "d" : d.f === 0 ? "vence hoje" : "vence em " + d.f + "d"}`, d.f < 0 ? "crit" : d.f <= 15 ? "warn" : ""]), "Nenhum documento no prazo de alerta.");
  sec("Agenda de hoje", (comps || []).map(c => [`${new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour:"2-digit", minute:"2-digit" }).format(new Date(c.inicio))} · ${c.titulo}`, ""]), "Nada marcado para hoje.");
  if (!$("calOverlay").hidden) renderCalendario();
}

/* ======================= ALARMES DOS COMPROMISSOS ======================= */
/* Cada compromisso tem "avisar X minutos antes" (padrão 30). Com o SINDICS aberto (aba, app instalado
   ou em segundo plano), o alarme toca, aparece na tela e vira notificação do sistema. */
let lembretes = [];
async function carregarLembretes(){
  if (!PERFIL || !sb) return;
  const { data: { user } } = await sb.auth.getUser(); if (!user) return;
  const agora = Date.now();
  const { data } = await sb.from("compromissos").select("id, titulo, inicio, condominio_id, local, lembrete_minutos")
    .eq("sindico_id", user.id).eq("status", "agendado").is("lembrete_avisado_em", null).gt("lembrete_minutos", 0)
    .gte("inicio", new Date(agora - 10 * 60000).toISOString()).lte("inicio", new Date(agora + 8 * 86400000).toISOString()).order("inicio");
  lembretes = data || [];
  verificarLembretes();
}
function verificarLembretes(){
  const agora = Date.now();
  for (const c of [...lembretes]){
    const ini = Date.parse(c.inicio);
    if (agora >= ini - c.lembrete_minutos * 60000 && agora <= ini + 10 * 60000){
      lembretes = lembretes.filter(x => x.id !== c.id);
      dispararAlarme(c);
      sb.from("compromissos").update({ lembrete_avisado_em: new Date().toISOString() }).eq("id", c.id).then(() => {}, () => {});
    }
  }
}
function faltaTexto(min){
  if (min <= 0) return "Começando agora";
  if (min < 60) return `Em ${min} min`;
  if (min < 1440){ const h = Math.floor(min / 60), m = min % 60; return `Em ${h}h${m ? String(m).padStart(2, "0") : ""}`; }
  const d = Math.round(min / 1440); return d === 1 ? "Amanhã" : `Em ${d} dias`;
}
const sndAlarme = () => tocar("alarme");
function dispararAlarme(c){
  const falta = faltaTexto(Math.round((Date.parse(c.inicio) - Date.now()) / 60000));
  const cond = nomeCondPorId(c.condominio_id);
  showPanel({ tipo: "alarme", titulo: `${falta}: ${c.titulo}`, itens: [cap1(quando(c.inicio)), cond, c.local].filter(Boolean) });
  sndAlarme(); core.pulse = 1.4;
  addLog("s", `Alarme: ${c.titulo} (${falta.toLowerCase()})`);
  notificar(`SINDICS · ${falta}`, `${c.titulo} — ${quando(c.inicio)}${cond ? " · " + cond : ""}`, c.id);
  /* em conversa: avisa o SINDICS para ele mencionar ao síndico */
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "contextual_update", text: `ALARME DE AGENDA: "${c.titulo}" ${falta.toLowerCase()} (${quando(c.inicio)}${cond ? ", " + cond : ""}). Avise o síndico em uma frase assim que possível.` }));
}
const cap1 = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
function notificar(titulo, corpo, tag){
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const op = { body: corpo, icon: "icon-192.png", badge: "icon-192.png", tag: "sindics-" + tag, requireInteraction: true };
  if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(r => r.showNotification(titulo, op)).catch(() => { try{ new Notification(titulo, op); }catch(_){} });
  else { try{ new Notification(titulo, op); }catch(_){} }
}
/* Permissão de notificação: pedida no primeiro toque na tela (o navegador exige um gesto) */
addEventListener("pointerdown", () => { if ("Notification" in window && Notification.permission === "default" && PERFIL) Notification.requestPermission().catch(() => {}); }, { once: true, capture: true });
setInterval(verificarLembretes, 20000);
setInterval(carregarLembretes, 5 * 60000);

/* ======================= CALENDÁRIO ======================= */
const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const SEMANA_LONGA = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
let calMes = null, calDia = null, calDados = { comps: [], docs: [] };
const pad2 = n => String(n).padStart(2, "0");
const horaSP = ts => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
function abrirCalendario(data){
  const d = (typeof data === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(data)) ? data : (calDia || hojeISO());
  calMes = d.slice(0, 7);
  calDia = d.length === 10 ? d : (hojeISO().startsWith(calMes) ? hojeISO() : calMes + "-01");
  fecharMenu(); $("calOverlay").hidden = false; renderCalendario();
}
function fecharCalendario(){ $("calOverlay").hidden = true; }
function mudarMes(delta){
  let [y, m] = calMes.split("-").map(Number); m += delta;
  if (m < 1){ m = 12; y--; } if (m > 12){ m = 1; y++; }
  calMes = `${y}-${pad2(m)}`; calDia = hojeISO().startsWith(calMes) ? hojeISO() : calMes + "-01"; renderCalendario();
}
async function renderCalendario(){
  const [y, m] = calMes.split("-").map(Number);
  const diasMes = new Date(Date.UTC(y, m, 0)).getUTCDate(), offset = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  $("calTitulo").textContent = `${MESES[m - 1]} ${y}`;
  const mesPedido = calMes;
  try{
    const { data: { user } } = await sb.auth.getUser();
    if (user){
      const [rc, rd] = await Promise.all([
        sb.from("compromissos").select("id, titulo, inicio, fim, condominio_id, local, status, lembrete_minutos").eq("sindico_id", user.id).neq("status", "cancelado")
          .gte("inicio", new Date(`${calMes}-01T00:00:00-03:00`).toISOString()).lte("inicio", new Date(`${calMes}-${pad2(diasMes)}T23:59:59-03:00`).toISOString()).order("inicio"),
        sb.from("documentos_legais").select("id, documento, condominio_id, data_vencimento, alertar_dias_antes").eq("sindico_id", user.id)
          .gte("data_vencimento", `${calMes}-01`).lte("data_vencimento", `${calMes}-${pad2(diasMes)}`).order("data_vencimento")
      ]);
      if (mesPedido !== calMes) return;   // usuário já trocou de mês
      calDados = { comps: rc.data || [], docs: rd.data || [] };
    }
  }catch(_){ calDados = { comps: [], docs: [] }; }
  const porDia = {};
  calDados.comps.forEach(c => { (porDia[isoDia(new Date(c.inicio))] ||= []).push({ tipo: "c", c }); });
  calDados.docs.forEach(d => { (porDia[d.data_vencimento] ||= []).push({ tipo: "d", d }); });
  const chave = e => e.tipo === "d" ? "0" : "1" + e.c.inicio;   // vencimentos primeiro, depois por horário
  Object.values(porDia).forEach(l => l.sort((a, b) => chave(a) < chave(b) ? -1 : 1));
  const grade = $("calGrade"); grade.innerHTML = "";
  for (let i = 0; i < offset; i++){ const v = document.createElement("div"); v.className = "cal-d vazio"; grade.append(v); }
  const hoje = hojeISO();
  for (let dia = 1; dia <= diasMes; dia++){
    const iso = `${calMes}-${pad2(dia)}`, evs = porDia[iso] || [];
    const b = document.createElement("button"); b.type = "button"; b.className = "cal-d" + (iso === hoje ? " hoje" : "") + (iso === calDia ? " sel" : "");
    const nc = evs.filter(e => e.tipo === "c").length, nd = evs.length - nc;
    b.setAttribute("aria-label", `${dia} de ${MESES[m - 1].toLowerCase()}${nc ? `, ${nc} compromisso${nc > 1 ? "s" : ""}` : ""}${nd ? `, ${nd} vencimento${nd > 1 ? "s" : ""}` : ""}`);
    if (iso === calDia) b.setAttribute("aria-current", "date");
    const n = document.createElement("span"); n.className = "n"; n.textContent = dia; b.append(n);
    evs.slice(0, 3).forEach(e => {
      const s = document.createElement("span");
      if (e.tipo === "c"){ s.className = "ev" + (e.c.status === "concluido" ? " feito" : ""); s.textContent = `${horaSP(e.c.inicio)} ${e.c.titulo}`; }
      else { s.className = "ev doc" + (e.d.data_vencimento < hoje ? " venc" : ""); s.textContent = `Vence: ${e.d.documento}`; }
      s.title = s.textContent; b.append(s);
    });
    if (evs.length > 3){ const mm = document.createElement("span"); mm.className = "mais"; mm.textContent = `+${evs.length - 3}`; b.append(mm); }
    b.onclick = () => { calDia = iso; grade.querySelectorAll(".sel").forEach(x => { x.classList.remove("sel"); x.removeAttribute("aria-current"); }); b.classList.add("sel"); b.setAttribute("aria-current", "date"); renderDia(porDia); };
    grade.append(b);
  }
  while (grade.children.length % 7){ const v = document.createElement("div"); v.className = "cal-d vazio"; grade.append(v); }
  renderDia(porDia);
}
function renderDia(porDia){
  const box = $("calDiaLista"); box.innerHTML = "";
  if (!calDia) return;
  const [y, m, d] = calDia.split("-").map(Number);
  const h = document.createElement("h3"); h.textContent = `${SEMANA_LONGA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} de ${MESES[m - 1].toLowerCase()}`; box.append(h);
  const evs = porDia[calDia] || [], hoje = hojeISO();
  if (!evs.length){ const p = document.createElement("p"); p.className = "cal-vazio"; p.textContent = "Nada marcado neste dia. Diga “SINDICS, marca …” para agendar."; box.append(p); return; }
  evs.forEach(e => {
    const it = document.createElement("div"), b = document.createElement("b"), s = document.createElement("strong"), sm = document.createElement("small");
    if (e.tipo === "c"){
      const c = e.c; it.className = "cal-item" + (c.status === "concluido" ? " feito" : "");
      b.textContent = `${horaSP(c.inicio)}${c.fim ? " – " + horaSP(c.fim) : ""}${c.status === "concluido" ? " · concluído" : ""}`;
      s.textContent = c.titulo;
      sm.textContent = [nomeCondPorId(c.condominio_id), c.local, textoLembrete(c.lembrete_minutos)].filter(Boolean).join(" · ");
    } else {
      const dd = e.d, venc = dd.data_vencimento < hoje; it.className = "cal-item doc" + (venc ? " venc" : "");
      b.textContent = venc ? "Documento vencido" : "Documento vence";
      s.textContent = dd.documento;
      sm.textContent = [nomeCondPorId(dd.condominio_id), `aviso ${dd.alertar_dias_antes} dias antes`].filter(Boolean).join(" · ");
    }
    it.append(b, s, sm); box.append(it);
  });
}
$("calBtn").addEventListener("click", () => abrirCalendario());
$("calFechar").addEventListener("click", fecharCalendario);
$("calPrev").addEventListener("click", () => mudarMes(-1));
$("calNext").addEventListener("click", () => mudarMes(1));
$("calHoje").addEventListener("click", () => abrirCalendario(hojeISO()));
$("calOverlay").addEventListener("click", e => { if (e.target.id === "calOverlay") fecharCalendario(); });

/* ======================= DOCUMENTAÇÃO LEGAL (catálogo padrão para todos os condomínios) ======================= */
let CATALOGO = null;
async function carregarCatalogo(){
  if (CATALOGO) return CATALOGO;
  const { data, error } = await sb.from("documentos_catalogo").select("*").order("ordem");
  if (error) throw new Error("Não consegui carregar a lista de documentos obrigatórios.");
  return (CATALOGO = data || []);
}
/* Reconhece o documento pelo nome falado */
const APELIDOS = [
  ["extintores_hidrostatico", /hidrost/], ["extintores", /extint/], ["mangueiras", /mangueir|hidrante/], ["brigada", /brigad/],
  ["avcb", /avcb|clcb|auto de vistoria|licenca (do )?corpo de bombeiros|bombeiros?$/], ["seguro_predial", /seguro/],
  ["spda", /spda|para.?raio/], ["laudo_eletrico", /eletric/], ["elevadores_ria", /\bria\b|inspecao anual.*elevador|relatorio de inspecao/],
  ["elevadores_contrato", /elevador/], ["potabilidade", /potabil|analise (da )?agua/], ["caixa_dagua", /caixa|reservatori/],
  ["dedetizacao", /dedetiz|praga|desratiz/], ["pmoc", /pmoc|ar.?condicionado|climatiz/], ["pgr", /\bpgr\b|ppra|gerenciamento de riscos/],
  ["pcmso", /pcmso/], ["certificado_digital", /certificado digital|e.?cnpj/], ["inspecao_predial", /inspecao predial|autovistoria/],
  ["gas", /\bgas\b|estanqueidade/],
];
function codigoDoDocumento(texto){ const t = norm(texto); const a = APELIDOS.find(([, re]) => re.test(t)); return a ? a[0] : null; }
function validadeMeses(k, uf){ const porUf = k.validade_por_uf || {}; return (uf && porUf[uf] != null) ? porUf[uf] : k.validade_meses; }
function somaMeses(iso, meses){ const [y, m, d] = iso.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1 + meses, d)); if (dt.getUTCDate() !== d) dt.setUTCDate(0); return dt.toISOString().slice(0, 10); }
function situacaoDoc(k, doc){
  if (doc && doc.situacao === "nao_aplica") return { st: "naoaplica", rotulo: "Não se aplica" };
  if (!doc || !doc.data_vencimento) return k.condicao || k.exigencia === "recomendado" ? { st: "confirmar", rotulo: k.exigencia === "recomendado" ? "Recomendado" : "Confirmar" } : { st: "falta", rotulo: "Sem cadastro" };
  const f = diasAte(doc.data_vencimento), alerta = doc.alertar_dias_antes ?? k.alerta_dias;
  if (f < 0) return { st: "vencido", rotulo: "Vencido", f };
  if (f <= alerta) return { st: "vencendo", rotulo: "Vencendo", f };
  return { st: "emdia", rotulo: "Em dia", f };
}
async function statusDocumentacao(condId){
  const { data: { user } } = await sb.auth.getUser(); if (!user) throw new Error("Sessão expirada.");
  const [cat, { data: cond }, { data: docs }] = await Promise.all([
    carregarCatalogo(),
    sb.from("condominios").select("id, nome, uf, cidade").eq("id", condId).maybeSingle(),
    sb.from("documentos_legais").select("id, documento, catalogo_codigo, data_renovacao, data_vencimento, alertar_dias_antes, situacao").eq("condominio_id", condId)
  ]);
  const porCodigo = new Map((docs || []).filter(d => d.catalogo_codigo).map(d => [d.catalogo_codigo, d]));
  const itens = cat.map(k => {
    const doc = porCodigo.get(k.codigo) || null, s = situacaoDoc(k, doc), meses = validadeMeses(k, cond?.uf);
    return { k, doc, ...s, meses };
  });
  const extras = (docs || []).filter(d => !d.catalogo_codigo && d.data_vencimento);   // documentos fora da lista padrão
  return { cond, itens, extras };
}
const ORDEM_ST = { vencido: 0, vencendo: 1, falta: 2, confirmar: 3, emdia: 4, naoaplica: 5 };
let dlCondId = null;
async function abrirDocumentacao(nomeCond){
  const cs = PERFIL?.condominios || [];
  if (!cs.length) throw new Error("Nenhum condomínio cadastrado ainda.");
  const alvo = nomeCond ? acharCondominio(nomeCond) : (cs.find(c => c.id === dlCondId) || cs[0]);
  dlCondId = alvo.id;
  const sel = $("dlCond"); sel.innerHTML = "";
  cs.forEach(c => { const o = document.createElement("option"); o.value = c.id; o.textContent = c.nome; if (c.id === dlCondId) o.selected = true; sel.append(o); });
  sel.hidden = cs.length < 2;
  fecharMenu(); $("docOverlay").hidden = false;
  return renderDocumentacao();
}
async function renderDocumentacao(){
  const lista = $("dlLista"); lista.innerHTML = "<p class='dl-nota'>Carregando…</p>";
  const { cond, itens, extras } = await statusDocumentacao(dlCondId);
  $("dlTitulo").textContent = "Documentação legal" + ((PERFIL?.condominios || []).length < 2 && cond ? " · " + cond.nome : "");
  const conta = st => itens.filter(i => i.st === st).length;
  $("dlResumo").innerHTML = "";
  [["vencido", "vencidos"], ["vencendo", "vencendo"], ["falta", "sem cadastro"], ["emdia", "em dia"]].forEach(([st, txt]) => {
    const s = document.createElement("span"); s.className = st; s.textContent = `${conta(st)} ${txt}`; $("dlResumo").append(s);
  });
  lista.innerHTML = "";
  const grupos = [["Atenção", i => ["vencido", "vencendo"].includes(i.st)], ["Obrigatórios sem cadastro", i => i.st === "falta"],
    ["Confirme se se aplica / recomendados", i => i.st === "confirmar"], ["Em dia", i => i.st === "emdia"], ["Não se aplicam a este condomínio", i => i.st === "naoaplica"]];
  grupos.forEach(([titulo, filtro]) => {
    const g = itens.filter(filtro).sort((a, b) => (ORDEM_ST[a.st] - ORDEM_ST[b.st]) || (a.f ?? 0) - (b.f ?? 0) || a.k.ordem - b.k.ordem);
    if (!g.length) return;
    const h = document.createElement("p"); h.className = "dl-grupo"; h.textContent = titulo; lista.append(h);
    g.forEach(i => {
      const d = document.createElement("div"); d.className = "dl-item " + i.st;
      const pill = document.createElement("span"); pill.className = "dl-pill"; pill.textContent = i.rotulo;
      const nome = document.createElement("strong"); nome.textContent = i.k.nome;
      const quando = document.createElement("span"); quando.className = "dl-quando";
      if (i.doc && i.doc.data_vencimento){
        quando.textContent = `Vence em ${dataBR(i.doc.data_vencimento)} · ${i.f < 0 ? "vencido há " + (-i.f) + " dias" : i.f === 0 ? "vence hoje" : "faltam " + i.f + " dias"}${i.doc.data_renovacao ? " · renovado em " + dataBR(i.doc.data_renovacao) : ""}`;
      } else if (i.st !== "naoaplica"){
        quando.textContent = (i.meses ? `Validade: ${i.meses % 12 === 0 ? (i.meses / 12) + (i.meses === 12 ? " ano" : " anos") : i.meses + " meses"}` : "Validade: a data do próprio documento") + (i.k.condicao ? ` · ${i.k.condicao}` : "");
      }
      const base = document.createElement("small"); base.textContent = i.k.base_legal;
      d.append(pill, nome);
      if (quando.textContent) d.append(quando);
      d.append(base);
      if (i.k.condicao || i.k.exigencia === "recomendado" || i.st === "naoaplica"){
        const b = document.createElement("button"); b.type = "button";
        b.textContent = i.st === "naoaplica" ? "Aplica-se" : "Não se aplica";
        b.onclick = async () => { b.disabled = true; try{ await marcarAplicacao(dlCondId, i.k.codigo, i.st !== "naoaplica"); await renderDocumentacao(); }catch(e){ b.disabled = false; b.textContent = "Erro"; b.title = e.message; } };
        if (i.doc && i.doc.data_vencimento) b.hidden = true;
        d.append(b);
      }
      lista.append(d);
    });
  });
  if (extras.length){
    const h = document.createElement("p"); h.className = "dl-grupo"; h.textContent = "Outros documentos cadastrados"; lista.append(h);
    extras.forEach(x => {
      const k = { nome: x.documento, base_legal: "Cadastrado pelo síndico", alerta_dias: x.alertar_dias_antes }; const s = situacaoDoc(k, x);
      const d = document.createElement("div"); d.className = "dl-item " + s.st;
      d.innerHTML = "<span class='dl-pill'></span><strong></strong><span class='dl-quando'></span>";
      d.children[0].textContent = s.rotulo; d.children[1].textContent = x.documento;
      d.children[2].textContent = `Vence em ${dataBR(x.data_vencimento)} · ${s.f < 0 ? "vencido há " + (-s.f) + " dias" : "faltam " + s.f + " dias"}`;
      lista.append(d);
    });
  }
  return { cond, itens };
}
async function marcarAplicacao(condId, codigo, naoAplica){
  if (naoAplica){
    const { data: ex } = await sb.from("documentos_legais").select("id, data_vencimento").eq("condominio_id", condId).eq("catalogo_codigo", codigo).maybeSingle();
    if (ex && ex.data_vencimento) throw new Error("Este documento já tem vencimento cadastrado.");
    const k = (await carregarCatalogo()).find(x => x.codigo === codigo);
    if (ex) { const { error } = await sb.from("documentos_legais").update({ situacao: "nao_aplica" }).eq("id", ex.id); if (error) throw error; }
    else { const { error } = await sb.from("documentos_legais").insert({ condominio_id: condId, catalogo_codigo: codigo, documento: k?.nome || codigo, situacao: "nao_aplica", data_vencimento: null }); if (error) throw error; }
  } else {
    const { error } = await sb.from("documentos_legais").delete().eq("condominio_id", condId).eq("catalogo_codigo", codigo).eq("situacao", "nao_aplica"); if (error) throw error;
  }
  atualizarResumoTela();
}
function fecharDocumentacao(){ $("docOverlay").hidden = true; }
$("docBtn").addEventListener("click", () => abrirDocumentacao().catch(e => { hintEl.textContent = e.message; }));
$("dlFechar").addEventListener("click", fecharDocumentacao);
$("dlCond").addEventListener("change", e => { dlCondId = e.target.value; renderDocumentacao(); });
$("docOverlay").addEventListener("click", e => { if (e.target.id === "docOverlay") fecharDocumentacao(); });

/* ======================= RADAR CONDOMINIAL ======================= */
const FN_RADAR = SUPABASE_URL + "/functions/v1/radar-condominial";
const SEMANA_EXT = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
function haQuanto(iso){
  if (!iso) return ""; const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 60) return `há ${Math.max(1, min)} min`; const h = Math.round(min / 60); if (h < 24) return `há ${h}h`; const d = Math.round(h / 24); return d === 1 ? "ontem" : `há ${d} dias`;
}
async function buscarRadar(atualizar = false){
  const { data: { session } } = await sb.auth.getSession(); if (!session) throw new Error("Sessão expirada.");
  const r = await fetch(FN_RADAR, { method: "POST", headers: { "Authorization": "Bearer " + session.access_token, "apikey": SUPABASE_ANON, "Content-Type": "application/json" }, body: JSON.stringify({ atualizar }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || "Não consegui buscar o Radar agora (erro " + r.status + ").");
  return j;
}
function renderRadar(ed){
  const [y, m, d] = ed.data.split("-").map(Number);
  const dia = new Date(Date.UTC(y, m - 1, d));
  $("rdData").textContent = `${cap1(SEMANA_EXT[dia.getUTCDay()])}, ${d} de ${MESES[m - 1].toLowerCase()} de ${y} · ${ed.itens.length} notícias · atualizado ${horaSP(ed.gerado_em)}`;
  const corpo = $("rdCorpo"); corpo.innerHTML = "";
  if (!ed.itens.length){ corpo.innerHTML = "<p class='cal-vazio'>Nenhuma notícia relevante do setor nas últimas 48 horas.</p>"; return; }
  const temas = [...new Set(ed.itens.map(i => i.tema))];
  temas.forEach((tema, ti) => {
    const sec = document.createElement("section"); sec.className = "rd-sec";
    const h = document.createElement("h3"); h.textContent = tema; sec.append(h);
    ed.itens.filter(i => i.tema === tema).forEach((i, k) => {
      const a = document.createElement("a"); a.className = "rd-art" + (ti === 0 && k === 0 ? " manchete" : ""); a.href = i.link; a.target = "_blank"; a.rel = "noopener noreferrer";
      const s = document.createElement("strong"); s.textContent = i.titulo;
      const sm = document.createElement("small"); sm.textContent = [i.fonte, haQuanto(i.publicado)].filter(Boolean).join(" · ");
      a.append(s, sm); sec.append(a);
    });
    corpo.append(sec);
  });
}
async function abrirRadar(atualizar = false){
  fecharMenu(); $("radarOverlay").hidden = false;
  $("rdCorpo").innerHTML = "<p class='cal-vazio'>Buscando as notícias do setor…</p>";
  try{ const ed = await buscarRadar(atualizar); renderRadar(ed); return ed; }
  catch(e){ $("rdCorpo").innerHTML = ""; const p = document.createElement("p"); p.className = "cal-vazio"; p.textContent = e.message; $("rdCorpo").append(p); throw e; }
}
function fecharRadar(){ $("radarOverlay").hidden = true; }
$("radarBtn").addEventListener("click", () => abrirRadar().catch(() => {}));
$("rdFechar").addEventListener("click", fecharRadar);
$("rdAtualizar").addEventListener("click", () => abrirRadar(true).catch(() => {}));
$("radarOverlay").addEventListener("click", e => { if (e.target.id === "radarOverlay") fecharRadar(); });

/* ======================= COMUNICADO EM TELA INTEIRA ======================= */
const TIPOS_COM = { comunicado:"Comunicado", circular:"Circular", aviso:"Aviso", advertencia:"Advertência", notificacao:"Notificação", multa:"Notificação de multa", edital:"Edital de convocação", convocacao:"Convocação", ata:"Ata", outro:"Documento" };
const dataExtenso = iso => { const [y, m, d] = iso.split("-").map(Number); return `${d} de ${MESES[m - 1].toLowerCase()} de ${y}`; };
async function mostrarComunicado(a){
  let cond = null;
  if (a.condominio){
    const c = acharCondominio(a.condominio);
    const { data } = await sb.from("condominios").select("nome, cnpj, endereco, cidade, cep").eq("id", c.id).maybeSingle();
    cond = data || c;
  } else if ((PERFIL?.condominios || []).length === 1){
    const { data } = await sb.from("condominios").select("nome, cnpj, endereco, cidade, cep").eq("id", PERFIL.condominios[0].id).maybeSingle();
    cond = data;
  }
  $("comCond").textContent = cond ? "Condomínio " + cond.nome.replace(/^condom[ií]nio\s+/i, "") : "Condomínio";
  $("comDados").textContent = cond ? [cond.cnpj ? "CNPJ " + mascaraCnpj(cond.cnpj) : "", [cond.endereco, cond.cidade].filter(Boolean).join(" – "), cond.cep ? "CEP " + cond.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2") : ""].filter(Boolean).join(" · ") : "";
  $("comTipo").textContent = TIPOS_COM[a.tipo] || a.tipo || "Comunicado";
  $("comTitulo").textContent = a.titulo || "";
  $("comPara").textContent = a.destinatario ? "Para: " + a.destinatario : "";
  const cidade = (cond?.cidade || "").split("/")[0];
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(a.data || "") ? a.data : hojeISO();
  $("comData").textContent = (cidade ? cidade + ", " : "") + dataExtenso(dia);
  const corpo = $("comCorpo"); corpo.innerHTML = "";
  String(a.corpo || "").replace(/\r/g, "").split(/\n\s*\n|\n(?=\S)/).map(s => s.trim()).filter(Boolean)
    .forEach(par => { const p = document.createElement("p"); p.textContent = par; corpo.append(p); });
  const ass = PERFIL?.assinatura || PERFIL?.nome || "Síndico";
  const [nomeAss, cargo] = ass.split(/\s+[—–-]\s+/);
  $("comAss").textContent = nomeAss; $("comAssCargo").textContent = cargo || "Síndico";
  DRAWERS.forEach(id => $(id).classList.remove("open")); fecharCalendario(); fecharDocumentacao(); fecharRadar();
  $("comOverlay").hidden = false; $("comOverlay").scrollTop = 0;
}
function textoComunicado(){
  const linhas = [$("comCond").textContent, $("comDados").textContent, "", $("comTipo").textContent.toUpperCase(), $("comTitulo").textContent, "",
    [$("comPara").textContent, $("comData").textContent].filter(Boolean).join(" — "), "",
    ...[...$("comCorpo").querySelectorAll("p")].map(p => p.innerText.trim() + "\n"), "", $("comAss").textContent, $("comAssCargo").textContent];
  return linhas.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
async function copiarComunicado(){
  try{ await navigator.clipboard.writeText(textoComunicado()); $("comCopiar").textContent = "Copiado ✓"; }
  catch(_){ $("comCopiar").textContent = "Não foi possível copiar"; }
  setTimeout(() => { $("comCopiar").textContent = "Copiar texto"; }, 2500);
}
function imprimirComunicado(){ document.body.classList.add("imprimindo"); window.print(); }
addEventListener("afterprint", () => document.body.classList.remove("imprimindo"));
function fecharComunicado(){ $("comOverlay").hidden = true; }
$("comCopiar").addEventListener("click", copiarComunicado);
$("comImprimir").addEventListener("click", imprimirComunicado);
$("comFechar").addEventListener("click", fecharComunicado);

/* ======================= VOZ DO ASSISTENTE ======================= */
const VOZ_NOME = { masculina: "masculina", feminina: "feminina" };
let vozFalhou = false;          // a voz feminina não abriu nesta página: usa a masculina
let reiniciarAposFala = false;  // troca de voz pedida durante a conversa
function rotuloVoz(){ $("vozBtn").textContent = "Voz: " + (PERFIL?.voz === "feminina" ? "feminina" : "masculina"); }
async function trocarVoz(nova){
  if (!PERFIL) throw new Error("Síndico não está logado.");
  if (!VOZ_NOME[nova]) nova = PERFIL.voz === "feminina" ? "masculina" : "feminina";
  const { data: { user } } = await sb.auth.getUser(); if (!user) throw new Error("Sessão expirada.");
  const { error } = await sb.from("perfis").update({ voz: nova }).eq("id", user.id);
  if (error) throw error;
  PERFIL.voz = nova; vozFalhou = false; rotuloVoz();
  addLog("s", "Voz do SINDICS: " + nova + ".");
  return nova;
}
$("vozBtn").addEventListener("click", async () => {
  try{
    const nova = await trocarVoz();
    if (inSession()){ endSession("Trocando a voz…"); setTimeout(wake, 700); }
    else { hintEl.classList.remove("err"); hintEl.textContent = "Voz " + nova + " escolhida. Diga “SINDICS” para ouvir."; }
  }catch(e){ hintEl.textContent = "Não foi possível trocar a voz: " + (e.message || e); hintEl.classList.add("err"); }
});
function reiniciarComNovaVoz(){
  const w = () => { if (outCtx && playHead > outCtx.currentTime){ setTimeout(w, 300); return; } endSession("Trocando a voz…"); setTimeout(wake, 700); };
  setTimeout(w, 500);
}

/* ======================= CADASTRO DO SÍNDICO ======================= */
const TERMOS_V = "2026-10-26";
let perfilModo = "criar";       // criar | completar | editar
let perfilDepois = null;         // o que fazer depois de salvar
const pfMsg = (t, err) => { $("pfMsg").textContent = t || ""; $("pfMsg").style.color = err ? "var(--danger)" : "var(--ok)"; };
const soDig = v => (v || "").replace(/\D/g, "");
function mascaraTel(v){
  const d = soDig(v).slice(0, 11);
  if (d.length <= 2) return d ? "(" + d : "";
  if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}
const PF_CAMPOS = { pfNome:"nome", pfEmpresa:"empresa", pfCnpj:"cnpj", pfCep:"cep", pfEnd:"endereco", pfCidade:"cidade", pfUf:"uf", pfEmailC:"email_contato", pfTel:"telefone", pfAss:"assinatura" };
function preencherPerfilForm(p = {}){
  for (const [id, k] of Object.entries(PF_CAMPOS)){
    let v = p[k] || "";
    if (k === "cnpj") v = v ? mascaraCnpj(v) : "";
    if (k === "cep") v = v ? soDig(v).replace(/^(\d{5})(\d{3})$/, "$1-$2") : "";
    if (k === "telefone") v = v ? mascaraTel(v) : "";
    $(id).value = v; $(id).removeAttribute("aria-invalid");
  }
}
function abrirPerfil(modo, p = {}, aviso = ""){
  perfilModo = modo;
  const criar = modo === "criar";
  $("pfAcesso").hidden = !criar;
  $("pfTitulo").textContent = criar ? "Criar conta de síndico" : modo === "completar" ? "Complete seu cadastro" : "Meu cadastro";
  $("pfIntro").textContent = aviso || (criar
    ? "Preencha seus dados profissionais. Depois de confirmar o e-mail, seu acesso é liberado pelo administrador."
    : modo === "completar" ? "Para continuar usando o SINDICS, precisamos dos seus dados profissionais completos e do seu aceite à Política de Privacidade."
    : "Confira e corrija seus dados. As alterações valem na hora.");
  $("pfSalvar").textContent = criar ? "Criar conta" : "Salvar cadastro";
  $("pfFechar").hidden = modo === "completar";
  $("pfSair").hidden = modo !== "completar";
  ["pfEmail","pfSenha","pfSenha2"].forEach(id => { $(id).value = id === "pfEmail" ? ($("email").value || "") : ""; });
  preencherPerfilForm(p);
  if (!criar && !$("pfEmailC").value && p.email) $("pfEmailC").value = p.email;
  $("pfAceite").checked = !criar && p.aceite_termos_versao === TERMOS_V;
  pfMsg(""); fecharMenu();
  $("perfilOverlay").hidden = false; $("perfilOverlay").querySelector(".perfil").scrollTop = 0;
  setTimeout(() => $(criar ? "pfEmail" : "pfNome").focus(), 80);
}
function fecharPerfil(){ $("perfilOverlay").hidden = true; }
function lerPerfilForm(){
  const v = {};
  for (const [id, k] of Object.entries(PF_CAMPOS)) v[k] = $(id).value.trim();
  v.cnpj = soCnpj(v.cnpj); v.cep = soDig(v.cep); v.telefone = soDig(v.telefone); v.uf = v.uf.toUpperCase(); v.email_contato = v.email_contato.toLowerCase();
  if (!v.assinatura && v.nome) v.assinatura = v.nome + " — Síndico";
  return v;
}
function validarPerfil(v){
  const erro = (id, t) => { $(id).setAttribute("aria-invalid", "true"); $(id).focus(); return t; };
  Object.keys(PF_CAMPOS).forEach(id => $(id).removeAttribute("aria-invalid"));
  if (v.nome.length < 3 || !/\s/.test(v.nome)) return erro("pfNome", "Informe seu nome completo (nome e sobrenome).");
  if (v.empresa.length < 2) return erro("pfEmpresa", "Informe o nome da sua empresa.");
  if (!cnpjValido(v.cnpj)) return erro("pfCnpj", "CNPJ da empresa inválido. Confira os números.");
  if (v.cep.length !== 8) return erro("pfCep", "Informe o CEP com 8 números.");
  if (!/^[A-Z]{2}$/.test(v.uf)) return erro("pfUf", "Informe a UF com 2 letras.");
  if (v.endereco.length < 5 || !/\d/.test(v.endereco)) return erro("pfEnd", "Informe o endereço com rua e número.");
  if (v.cidade.length < 2) return erro("pfCidade", "Informe a cidade.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email_contato)) return erro("pfEmailC", "E-mail de contato inválido.");
  if (v.telefone.length < 10 || v.telefone.length > 11) return erro("pfTel", "Telefone inválido: use DDD + número.");
  if (!$("pfAceite").checked) return "Para continuar, marque o aceite da Política de Privacidade e dos Termos de Uso.";
  return "";
}
$("pfCnpj").addEventListener("input", e => { e.target.value = mascaraCnpj(e.target.value); e.target.removeAttribute("aria-invalid"); });
$("pfTel").addEventListener("input", e => { e.target.value = mascaraTel(e.target.value); e.target.removeAttribute("aria-invalid"); });
$("pfUf").addEventListener("input", e => { e.target.value = e.target.value.replace(/[^a-z]/gi, "").toUpperCase(); });
$("pfCep").addEventListener("input", async e => {
  const v = soDig(e.target.value).slice(0, 8);
  e.target.value = v.length > 5 ? v.slice(0, 5) + "-" + v.slice(5) : v;
  if (v.length !== 8) return;
  try{
    pfMsg("Buscando endereço pelo CEP…");
    const j = await (await fetch(`https://viacep.com.br/ws/${v}/json/`)).json();
    if (j.erro){ pfMsg("CEP não encontrado. Preencha o endereço manualmente.", true); return; }
    if (!$("pfEnd").value) $("pfEnd").value = [j.logradouro, j.bairro].filter(Boolean).join(", ") + (j.logradouro ? ", nº " : "");
    $("pfCidade").value = j.localidade || ""; $("pfUf").value = j.uf || "";
    pfMsg("Endereço preenchido. Complete o número.");
    $("pfEnd").focus(); const len = $("pfEnd").value.length; $("pfEnd").setSelectionRange(len, len);
  }catch(_){ pfMsg("Não consegui buscar o CEP agora. Preencha manualmente.", true); }
});
$("perfilForm").addEventListener("submit", async e => {
  e.preventDefault();
  const v = lerPerfilForm();
  if (perfilModo === "criar"){
    const email = $("pfEmail").value.trim().toLowerCase(), s1 = $("pfSenha").value, s2 = $("pfSenha2").value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ $("pfEmail").focus(); pfMsg("Informe um e-mail de login válido.", true); return; }
    if (s1.length < 8){ $("pfSenha").focus(); pfMsg("A senha precisa ter pelo menos 8 caracteres.", true); return; }
    if (s1 !== s2){ $("pfSenha2").focus(); pfMsg("As duas senhas não são iguais.", true); return; }
    if (!v.email_contato) v.email_contato = email;
    const err = validarPerfil(v); if (err){ pfMsg(err, true); return; }
    $("pfSalvar").disabled = true; pfMsg("Criando sua conta…");
    const { data, error } = await sb.auth.signUp({ email, password: s1, options: { emailRedirectTo: SITE_URL, data: { ...v, aceite_termos_versao: TERMOS_V } } });
    $("pfSalvar").disabled = false; $("pfSenha").value = $("pfSenha2").value = "";
    if (error){
      const m = /registered|already/i.test(error.message) ? "Este e-mail já tem conta. Use Entrar ou Esqueci minha senha."
        : /signups? not allowed|disabled/i.test(error.message) ? "O cadastro de novas contas está fechado no momento. Fale com o administrador do SINDICS."
        : "Não foi possível criar a conta: " + error.message;
      pfMsg(m, true); return;
    }
    fecharPerfil();
    if (data.session){ await aposLogin(); return; }
    $("email").value = email;
    mostrarLogin("Conta criada! Enviamos um link de confirmação para " + email + ". Depois de confirmar, seu acesso fica aguardando a aprovação do administrador.");
    return;
  }
  const err = validarPerfil(v); if (err){ pfMsg(err, true); return; }
  const { data: { user } } = await sb.auth.getUser();
  if (!user){ fecharPerfil(); mostrarLogin("Sua sessão expirou. Entre novamente."); return; }
  $("pfSalvar").disabled = true; pfMsg("Salvando…");
  const agora = new Date().toISOString();
  const patch = { ...v, cadastro_completo_em: PERFIL?.cadastro_completo_em || agora };
  if (PERFIL?.aceite_termos_versao !== TERMOS_V){ patch.aceite_termos_em = agora; patch.aceite_termos_versao = TERMOS_V; }
  const { error } = await sb.from("perfis").update(patch).eq("id", user.id);
  $("pfSalvar").disabled = false;
  if (error){ pfMsg(error.message || "Não foi possível salvar.", true); return; }
  if (PERFIL) Object.assign(PERFIL, patch);
  pfMsg("Cadastro salvo ✓");
  const depois = perfilDepois; perfilDepois = null;
  setTimeout(() => { fecharPerfil(); if (PERFIL) preencherCabecalho(PERFIL); if (depois) depois(); }, 500);
});
$("pfFechar").addEventListener("click", () => { fecharPerfil(); if (perfilModo === "criar") mostrarLogin(); });
$("pfSair").addEventListener("click", async () => { fecharPerfil(); perfilDepois = null; await sb.auth.signOut(); mostrarLogin("Você saiu. Entre de novo quando quiser completar o cadastro."); });
$("criarContaBtn").addEventListener("click", () => { msg(""); abrirPerfil("criar"); });
$("perfilBtn").addEventListener("click", () => PERFIL && abrirPerfil("editar", PERFIL));

/* ======================= PRIVACIDADE E LGPD ======================= */
const TIPO_SOL = { exclusao:"Exclusão da conta", correcao:"Correção de dados", acesso:"Acesso aos dados", revogacao:"Revogação de consentimento", outro:"Outro assunto" };
const STATUS_SOL = { aberta:"Recebida", em_andamento:"Em andamento", atendida:"Atendida", recusada:"Recusada" };
const lgMsg = (t, err) => { $("lgMsg").textContent = t || ""; $("lgMsg").style.color = err ? "var(--danger)" : "var(--ok)"; };
const CHECK_LGPD = [
  { k:"mapa", t:"Mapear os dados tratados", d:"Liste o que o condomínio coleta: cadastro de moradores e inquilinos, visitantes e prestadores na portaria, imagens de câmeras, biometria ou reconhecimento facial, dados de funcionários.", b:"Art. 37" },
  { k:"base", t:"Definir a base legal de cada uso", d:"Cobrança de cotas e assembleias: obrigação legal e execução da convenção. Câmeras para segurança: legítimo interesse. Biometria é dado sensível: só com consentimento ou outra base do art. 11, e ofereça alternativa (cartão, senha).", b:"Arts. 7º e 11" },
  { k:"canal", t:"Criar canal de privacidade", d:"Um e-mail ou formulário para moradores exercerem seus direitos. Condomínio de pequeno porte pode dispensar a indicação de encarregado, mas precisa manter esse canal.", b:"Res. ANPD 2/2022, art. 11" },
  { k:"aviso", t:"Publicar aviso de privacidade", d:"Informe no mural e na portaria quais dados são coletados, para quê, por quanto tempo e o canal de contato. Use o botão “Gerar aviso” acima.", b:"Arts. 6º, VI, e 9º" },
  { k:"cftv", t:"Regras para as câmeras", d:"Placa de aviso nas áreas filmadas; nada de câmeras em banheiros e vestiários; acesso às gravações só por pessoas autorizadas; prazo de guarda definido (ex.: 30 dias); entrega de imagens só ao titular, à polícia ou por ordem judicial.", b:"Arts. 6º e 46" },
  { k:"inadimplencia", t:"Não expor inadimplentes", d:"Não divulgue nomes ou unidades de devedores em murais, elevadores ou grupos. A cobrança é feita de forma individual; na prestação de contas, os dados ficam restritos aos condôminos.", b:"Art. 6º, III; CC art. 1.335" },
  { k:"contratos", t:"Cláusula LGPD nos contratos", d:"Administradora, portaria remota, segurança, aplicativo do condomínio e contabilidade são operadores: o contrato deve dizer que só usam os dados para o serviço e protegem com segurança.", b:"Arts. 39 e 42" },
  { k:"grupos", t:"Cuidado nos grupos e comunicados", d:"Não compartilhe documentos, telefones ou fotos de moradores em grupos de WhatsApp. Advertências e multas vão só para a unidade envolvida.", b:"Art. 6º, III" },
  { k:"funcionarios", t:"Treinar funcionários e portaria", d:"Porteiros e zeladores não devem informar a estranhos quem mora, quem saiu ou quem recebeu visita. Faça um treinamento curto e registre.", b:"Art. 50" },
  { k:"descarte", t:"Descarte e prazo de guarda", d:"Apague cadastros de visitantes, ex-moradores e ex-funcionários quando não forem mais necessários (salvo obrigação legal, como documentos trabalhistas e fiscais).", b:"Arts. 15 e 16" },
  { k:"direitos", t:"Responder pedidos dos titulares", d:"Quando um morador pedir acesso aos próprios dados, responda de forma completa em até 15 dias.", b:"Arts. 18 e 19, II" },
  { k:"incidente", t:"Plano para incidentes", d:"Vazamento de dados que possa causar dano relevante deve ser comunicado à ANPD e aos afetados em 3 dias úteis (6 para pequeno porte). Tenha um responsável e um roteiro.", b:"Art. 48; Res. ANPD 15/2024" },
];
let lgUid = null;
const chaveCheck = () => "sindics-lgpd-" + (lgUid || "x") + "-" + ($("lgCondSel").value || "geral");
function lerCheck(){ try{ return JSON.parse(localStorage.getItem(chaveCheck()) || "{}"); }catch(_){ return {}; } }
function gravarCheck(o){ try{ localStorage.setItem(chaveCheck(), JSON.stringify(o)); }catch(_){} }
function renderCheck(){
  const feitos = lerCheck(), box = $("lgCheck"); box.innerHTML = "";
  CHECK_LGPD.forEach(it => {
    const l = document.createElement("label"); l.className = "lg-item" + (feitos[it.k] ? " feito" : "");
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!feitos[it.k];
    cb.onchange = () => { const f = lerCheck(); if (cb.checked) f[it.k] = hojeISO(); else delete f[it.k]; gravarCheck(f); renderCheck(); };
    const st = document.createElement("strong"); st.textContent = it.t;
    const sp = document.createElement("span"); sp.textContent = it.d;
    const sm = document.createElement("small"); sm.textContent = (feitos[it.k] ? "Feito em " + dataBR(feitos[it.k]) + " · " : "") + it.b;
    l.append(cb, st, sp, sm); box.append(l);
  });
  const n = CHECK_LGPD.filter(it => feitos[it.k]).length;
  $("lgProg").textContent = `${n} de ${CHECK_LGPD.length} itens concluídos`;
}
function abaLgpd(qual){
  const dados = qual !== "condominio";
  $("lgDados").hidden = !dados; $("lgCond").hidden = dados;
  $("lgAbaDados").setAttribute("aria-selected", String(dados)); $("lgAbaCond").setAttribute("aria-selected", String(!dados));
}
async function abrirLgpd(aba = "dados"){
  if (!PERFIL) throw new Error("Síndico não está logado.");
  const { data: { user } } = await sb.auth.getUser(); if (!user) throw new Error("Sessão expirada.");
  lgUid = user.id;
  DRAWERS.forEach(id => $(id).classList.remove("open")); fecharCalendario(); fecharDocumentacao(); fecharRadar();
  const sel = $("lgCondSel"), atual = sel.value; sel.innerHTML = "";
  const cs = PERFIL.condominios || [];
  (cs.length ? cs : [{ id: "geral", nome: "Meu condomínio" }]).forEach(c => { const o = document.createElement("option"); o.value = c.id; o.textContent = c.nome; sel.append(o); });
  if (atual && [...sel.options].some(o => o.value === atual)) sel.value = atual;
  abaLgpd(aba); renderCheck(); lgMsg("");
  $("lgpdOverlay").hidden = false;
  await carregarDadosLgpd(user);
}
function fecharLgpd(){ $("lgpdOverlay").hidden = true; }
async function carregarDadosLgpd(user){
  const [{ data: p }, { count: nCond }, { count: nDoc }, { count: nComp }, { count: nSes }, { data: sols }] = await Promise.all([
    sb.from("perfis").select("*").eq("id", user.id).maybeSingle(),
    sb.from("condominios").select("id", { count:"exact", head:true }).eq("sindico_id", user.id),
    sb.from("documentos_legais").select("id", { count:"exact", head:true }).eq("sindico_id", user.id),
    sb.from("compromissos").select("id", { count:"exact", head:true }).eq("sindico_id", user.id),
    sb.from("sessoes").select("id", { count:"exact", head:true }).eq("sindico_id", user.id),
    sb.from("lgpd_solicitacoes").select("*").eq("sindico_id", user.id).order("criado_em", { ascending:false }),
  ]);
  const dl = $("lgResumo"); dl.innerHTML = "";
  const linha = (t, v) => { const a = document.createElement("dt"), b = document.createElement("dd"); a.textContent = t; b.textContent = v || "—"; dl.append(a, b); };
  if (p){
    linha("Nome", p.nome); linha("Empresa", p.empresa); linha("CNPJ", p.cnpj ? mascaraCnpj(p.cnpj) : "");
    linha("Endereço", [p.endereco, p.cidade && p.uf ? p.cidade + "/" + p.uf : p.cidade, p.cep ? "CEP " + soDig(p.cep).replace(/^(\d{5})(\d{3})$/, "$1-$2") : ""].filter(Boolean).join(" · "));
    linha("Login", p.email); linha("Contato", [p.email_contato, p.telefone ? mascaraTel(p.telefone) : ""].filter(Boolean).join(" · "));
    linha("Voz", p.voz); linha("Aceite", p.aceite_termos_em ? "Política versão " + p.aceite_termos_versao + ", em " + new Date(p.aceite_termos_em).toLocaleDateString("pt-BR") : "pendente");
  }
  linha("Registros", `${nCond ?? 0} condomínio(s), ${nDoc ?? 0} documento(s) legal(is), ${nComp ?? 0} compromisso(s), ${nSes ?? 0} conversa(s)`);
  if (p?.exclusao_solicitada_em) linha("Exclusão", "solicitada em " + new Date(p.exclusao_solicitada_em).toLocaleDateString("pt-BR"));
  const lista = $("lgLista"); lista.innerHTML = "";
  if (!(sols || []).length){ const v = document.createElement("p"); v.className = "dica"; v.textContent = "Nenhuma solicitação até agora."; lista.append(v); }
  (sols || []).forEach(s => {
    const d = document.createElement("div"); d.className = "lg-sol " + s.status;
    const t = document.createElement("strong"); t.textContent = TIPO_SOL[s.tipo] || s.tipo;
    const m = document.createElement("small"); m.textContent = `${STATUS_SOL[s.status] || s.status} · ${new Date(s.criado_em).toLocaleDateString("pt-BR")}${s.resposta ? " · Resposta: " + s.resposta : ""}`;
    d.append(t, m); lista.append(d);
  });
  $("lgExcluir").disabled = !!p?.exclusao_solicitada_em;
  if (p?.exclusao_solicitada_em) $("lgExcluir").textContent = "Exclusão já solicitada";
}
async function baixarMeusDados(){
  const { data: { user } } = await sb.auth.getUser(); if (!user) throw new Error("Sessão expirada.");
  lgMsg("Reunindo seus dados…");
  const tabelas = ["perfis", "condominios", "documentos_legais", "compromissos", "sessoes", "lgpd_solicitacoes"];
  const res = await Promise.all(tabelas.map(t => sb.from(t).select("*").eq(t === "perfis" ? "id" : "sindico_id", user.id)));
  const pacote = { gerado_em: new Date().toISOString(), titular: user.email, observacao: "Exportação de dados pessoais do SINDICS (LGPD, art. 18, II e V). O áudio das conversas não é gravado; as transcrições ficam com a ElevenLabs por até 90 dias e podem ser pedidas pelo canal de privacidade.", dados: {} };
  tabelas.forEach((t, i) => { pacote.dados[t] = res[i].data || []; });
  const blob = new Blob([JSON.stringify(pacote, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `sindics-meus-dados-${hojeISO()}.json`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  lgMsg("Arquivo com seus dados baixado ✓");
}
async function pedirLgpd(tipo, detalhe){
  const { data: { user } } = await sb.auth.getUser(); if (!user) throw new Error("Sessão expirada.");
  const { error } = await sb.from("lgpd_solicitacoes").insert({ sindico_id: user.id, tipo, detalhe: detalhe || "", status: "aberta" });
  if (error) throw error;
  if (tipo === "exclusao") await sb.from("perfis").update({ exclusao_solicitada_em: new Date().toISOString() }).eq("id", user.id);
  await carregarDadosLgpd(user);
}
let confirmaExcluir = 0;
$("lgExcluir").addEventListener("click", async () => {
  if (Date.now() - confirmaExcluir > 6000){ confirmaExcluir = Date.now(); $("lgExcluir").textContent = "Toque de novo para confirmar"; lgMsg("A exclusão apaga sua conta, seus condomínios, documentos e agenda em até 15 dias. Antes, você pode baixar seus dados.", true); setTimeout(() => { if ($("lgExcluir").textContent.startsWith("Toque")) $("lgExcluir").textContent = "Pedir exclusão da conta"; }, 6000); return; }
  confirmaExcluir = 0; $("lgExcluir").disabled = true;
  try{ await pedirLgpd("exclusao", "Pedido de exclusão feito pelo próprio síndico na área de Privacidade."); lgMsg("Pedido de exclusão registrado. Você receberá a confirmação no seu e-mail de contato."); }
  catch(e){ $("lgExcluir").disabled = false; lgMsg("Não foi possível registrar: " + (e.message || e), true); }
});
$("lgForm").addEventListener("submit", async e => {
  e.preventDefault();
  const det = $("lgDetalhe").value.trim();
  if (det.length < 5){ lgMsg("Descreva o pedido em poucas palavras.", true); $("lgDetalhe").focus(); return; }
  try{ await pedirLgpd($("lgTipo").value, det); $("lgDetalhe").value = ""; lgMsg("Solicitação enviada. Resposta em até 15 dias."); }
  catch(err){ lgMsg("Não foi possível enviar: " + (err.message || err), true); }
});
$("lgBaixar").addEventListener("click", () => baixarMeusDados().catch(e => lgMsg("Não foi possível baixar: " + (e.message || e), true)));
$("lgCorrigir").addEventListener("click", () => { fecharLgpd(); abrirPerfil("editar", PERFIL); });
$("lgAbaDados").addEventListener("click", () => abaLgpd("dados"));
$("lgAbaCond").addEventListener("click", () => abaLgpd("condominio"));
$("lgCondSel").addEventListener("change", renderCheck);
$("lgFechar").addEventListener("click", fecharLgpd);
$("lgpdOverlay").addEventListener("click", e => { if (e.target.id === "lgpdOverlay") fecharLgpd(); });
$("lgpdBtn").addEventListener("click", () => abrirLgpd().catch(e => { hintEl.textContent = e.message; hintEl.classList.add("err"); }));
function textoAvisoPrivacidade(){
  return [
    "O condomínio trata dados pessoais de moradores, funcionários, visitantes e prestadores de serviço apenas para a administração do prédio, a segurança das pessoas e o cumprimento da lei, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).",
    "Quais dados: nome, documento, unidade, telefone e e-mail de moradores; nome e documento de visitantes e prestadores, registrados na portaria; imagens das câmeras de segurança das áreas comuns.",
    "Para quê: cobrança das cotas condominiais, convocações e comunicados, controle de acesso, segurança e cumprimento da Convenção e do Regulamento Interno.",
    "Por quanto tempo: as imagens das câmeras ficam guardadas pelo prazo técnico do sistema e são apagadas depois. Os registros de visitantes são eliminados quando deixam de ser necessários. Os demais dados ficam guardados enquanto durar a relação com o condomínio ou pelo prazo exigido em lei.",
    "Com quem compartilhamos: somente com empresas que prestam serviço ao condomínio (administradora, portaria, segurança, contabilidade), obrigadas por contrato a proteger os dados, e com autoridades quando a lei exigir. Não divulgamos dados de moradores em murais ou grupos.",
    "Seus direitos: você pode pedir acesso, correção ou eliminação dos seus dados e tirar dúvidas pelo canal abaixo. Pedidos de acesso são respondidos em até 15 dias.",
    "Canal de privacidade: fale com a administração do condomínio (síndico) pelos meios oficiais de contato.",
  ].join("\n\n");
}
$("lgAviso").addEventListener("click", async () => {
  const id = $("lgCondSel").value, c = (PERFIL?.condominios || []).find(x => x.id === id);
  fecharLgpd();
  try{ await mostrarComunicado({ tipo: "aviso", titulo: "Aviso de Privacidade — Proteção de Dados (LGPD)", destinatario: "Moradores, funcionários e visitantes", condominio: c?.nome, corpo: textoAvisoPrivacidade() }); }
  catch(e){ hintEl.textContent = e.message; hintEl.classList.add("err"); }
});

/* ======================= CONFIRMAÇÃO NA TELA (ações que não têm volta) ======================= */
/* Exclusões pedidas por voz só acontecem depois de um toque do síndico. Protege contra mal-entendidos
   e contra textos maliciosos dentro de documentos tentando induzir o assistente. */
let confPendente = null;
function confirmarNaTela(titulo, texto, rotulo = "Excluir", segundos = 45){
  if (confPendente) confPendente(false);
  return new Promise(resolve => {
    const ov = $("confOverlay"); let resto = segundos;
    $("confTitulo").textContent = titulo; $("confTexto").textContent = texto; $("confSim").textContent = rotulo;
    const tique = () => { $("confTempo").textContent = `Sem resposta em ${resto}s, nada é apagado.`; if (inSession()) resetIdle(); };
    tique(); const timer = setInterval(() => { resto--; tique(); if (resto <= 0) fim(false); }, 1000);
    const fim = ok => { clearInterval(timer); ov.hidden = true; confPendente = null; $("confSim").onclick = $("confNao").onclick = null; resolve(ok); };
    confPendente = fim;
    $("confSim").onclick = () => fim(true); $("confNao").onclick = () => fim(false);
    ov.hidden = false; setTimeout(() => $("confNao").focus(), 50);
  });
}

/* ======================= ASSINATURA (Asaas) ======================= */
const FN_ASSINAR = SUPABASE_URL + "/functions/v1/assinar";
const DIAS_BLOQUEIO = 5;
const STATUS_ASS = { pendente: "aguardando pagamento", ativa: "em dia", atrasada: "em atraso", cancelada: "cancelada" };
function diasDeAtraso(a){ return a && a.status === "atrasada" && a.atraso_desde ? Math.max(0, diasAte(a.atraso_desde) * -1) : 0; }
async function situacaoAssinatura(uid){
  const { data: a } = await sb.from("assinaturas").select("status, atraso_desde, link_pagamento").eq("sindico_id", uid).order("criado_em", { ascending: false }).limit(1).maybeSingle();
  if (!a) return { tem: false };
  const atraso = diasDeAtraso(a);
  return { tem: true, ...a, atraso, faltam: DIAS_BLOQUEIO - atraso, bloqueado: a.status === "cancelada" || (a.status === "atrasada" && atraso >= DIAS_BLOQUEIO) };
}
async function chamarAssinar(corpo){
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(FN_ASSINAR, { method: "POST", headers: { "Authorization": "Bearer " + (session?.access_token || ""), "apikey": SUPABASE_ANON, "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || ("Servidor respondeu " + r.status));
  return j;
}
async function pagarAgora(botao){
  const janela = window.open("", "_blank"); // abre já no clique, para o navegador não bloquear
  const txt = botao?.textContent; if (botao){ botao.disabled = true; botao.textContent = "Abrindo…"; }
  try{
    const { link } = await chamarAssinar({ acao: "pagar" });
    if (janela) janela.location.href = link; else location.href = link;
  }catch(e){
    if (janela) janela.close();
    hintEl.textContent = "Pagamento: " + e.message; hintEl.classList.add("err");
    if ($("bloqueioOverlay") && !$("bloqueioOverlay").hidden) $("bloqueioMsg").textContent = e.message + " Se precisar, escreva para sindicanciaethics@gmail.com.";
  }
  if (botao){ botao.disabled = false; botao.textContent = txt; }
}
function mostrarAvisoAtraso(s){
  const dias = s.atraso ? `há ${s.atraso} dia${s.atraso > 1 ? "s" : ""}` : "desde hoje";
  $("pagBannerTxt").textContent = `Sua assinatura do SINDICS está em atraso ${dias}. O acesso será suspenso ${s.faltam <= 1 ? "amanhã" : `em ${s.faltam} dias`} se o pagamento não for regularizado.`;
  $("pagBanner").hidden = false;
}
function mostrarBloqueio(texto){
  if (inSession()) endSession("Acesso suspenso.");
  stopWake();
  $("bloqueioMsg").textContent = texto;
  $("bloqueioOverlay").hidden = false; $("pagBanner").hidden = true;
}
$("pagBannerBtn").addEventListener("click", e => pagarAgora(e.currentTarget));
$("pagBannerFechar").addEventListener("click", () => { $("pagBanner").hidden = true; });
$("bloqueioPagar").addEventListener("click", e => pagarAgora(e.currentTarget));
$("bloqueioRever").addEventListener("click", async () => {
  $("bloqueioMsg").textContent = "Conferindo o pagamento…";
  const { data: { user } } = await sb.auth.getUser(); if (!user){ $("bloqueioOverlay").hidden = true; mostrarLogin(); return; }
  const s = await situacaoAssinatura(user.id);
  if (s.bloqueado){ $("bloqueioMsg").textContent = "O pagamento ainda não foi confirmado. Pix e cartão confirmam em instantes; boleto, em até 2 dias úteis. Tente de novo daqui a pouco."; return; }
  $("bloqueioOverlay").hidden = true; await aposLogin();
});
$("bloqueioSair").addEventListener("click", async () => { $("bloqueioOverlay").hidden = true; await sair(); });

/* ======================= ADMINISTRAÇÃO (aprovar síndicos) ======================= */
async function carregarAdmin(){
  const lista = $("admLista"); lista.innerHTML = "<p class='rs-t'>Carregando…</p>";
  const [{ data: ps, error }, { data: cs }, { data: sols }, { data: asss }] = await Promise.all([
    sb.from("perfis").select("id, nome, email, ativo, papel, plano, limite_sessoes_mes, criado_em, empresa, cnpj, telefone, email_contato, cidade, uf, cadastro_completo_em, exclusao_solicitada_em").order("criado_em", { ascending:false }),
    sb.from("condominios").select("id, sindico_id, nome"),
    sb.from("lgpd_solicitacoes").select("*").in("status", ["aberta", "em_andamento"]).order("criado_em"),
    sb.from("assinaturas").select("*").order("criado_em", { ascending: false })
  ]);
  if (error){ lista.textContent = "Erro: " + error.message; return; }
  lista.innerHTML = "";
  /* Assinaturas (Asaas) */
  const boxA = document.createElement("div"); boxA.className = "adm-lgpd adm-ass";
  const hA = document.createElement("h4");
  const ativas = (asss || []).filter(a => a.status === "ativa").length, atras = (asss || []).filter(a => a.status === "atrasada").length;
  hA.textContent = `Assinaturas · ${ativas} em dia · ${atras} em atraso · ${(asss || []).filter(a => a.status === "pendente").length} aguardando pagamento`;
  const bCon = document.createElement("button"); bCon.type = "button"; bCon.textContent = "Conectar Asaas"; bCon.style.cssText = "padding:6px 10px;font-size:10px;align-self:flex-start";
  const msgCon = document.createElement("small");
  bCon.onclick = async () => { bCon.disabled = true; msgCon.textContent = "Conectando…"; try{ const j = await chamarAssinar({ acao: "configurar_webhook" }); msgCon.textContent = j.mensagem; msgCon.style.color = "var(--ok)"; }catch(e){ msgCon.textContent = e.message; msgCon.style.color = "var(--danger)"; } bCon.disabled = false; };
  boxA.append(hA, bCon, msgCon);
  (asss || []).slice(0, 30).forEach(a => {
    const atraso = diasDeAtraso(a);
    const it = document.createElement("small");
    const sit = a.status === "atrasada" ? `em atraso há ${atraso} dia(s)${atraso >= DIAS_BLOQUEIO ? " · BLOQUEADO" : ` · bloqueia em ${DIAS_BLOQUEIO - atraso}`}` : (STATUS_ASS[a.status] || a.status);
    it.textContent = `${a.nome} · ${a.email} · R$ ${Number(a.valor).toFixed(2).replace(".", ",")} · ${sit}${a.ultimo_pagamento_em ? " · último pagamento " + new Date(a.ultimo_pagamento_em).toLocaleDateString("pt-BR") : ""}${(a.status === "ativa" || a.status === "atrasada") && !a.sindico_id ? " · conta ainda não criada" : ""}`;
    if (a.status === "atrasada") it.style.color = atraso >= DIAS_BLOQUEIO ? "var(--danger)" : "var(--amber)";
    boxA.append(it);
    if (a.status === "ativa" || a.status === "atrasada"){
      const bR = document.createElement("button"); bR.type = "button"; bR.textContent = a.sindico_id ? "Reenviar acesso" : "Criar conta e enviar convite"; bR.style.cssText = "padding:5px 9px;font-size:9.5px;align-self:flex-start";
      bR.onclick = async () => { bR.disabled = true; try{ const j = await chamarAssinar({ acao: "reenviar_convite", assinatura_id: a.id }); bR.textContent = j.mensagem; }catch(e){ bR.textContent = e.message; bR.disabled = false; } };
      boxA.append(bR);
    }
  });
  if (!(asss || []).length){ const v = document.createElement("small"); v.textContent = "Nenhuma assinatura ainda. Depois de colocar a chave do Asaas no servidor, toque em Conectar Asaas uma vez."; boxA.append(v); }
  lista.append(boxA);
  if ((sols || []).length){
    const box = document.createElement("div"); box.className = "adm-lgpd";
    const h = document.createElement("h4"); h.textContent = `Pedidos LGPD em aberto (${sols.length}) · prazo 15 dias`; box.append(h);
    sols.forEach(sl => {
      const quem = ps.find(x => x.id === sl.sindico_id);
      const prazo = new Date(new Date(sl.criado_em).getTime() + 15 * 86400000);
      const it = document.createElement("small"); it.textContent = `${TIPO_SOL[sl.tipo] || sl.tipo} — ${quem?.nome || quem?.email || "síndico"} · pedido em ${new Date(sl.criado_em).toLocaleDateString("pt-BR")} · responder até ${prazo.toLocaleDateString("pt-BR")}${sl.detalhe ? " · " + sl.detalhe : ""}`;
      const b = document.createElement("button"); b.type = "button"; b.textContent = "Marcar atendido"; b.style.cssText = "padding:6px 10px;font-size:10px;align-self:flex-start";
      b.onclick = async () => { b.disabled = true; const { error } = await sb.from("lgpd_solicitacoes").update({ status: "atendida", atendido_em: new Date().toISOString() }).eq("id", sl.id); if (error) alertaAdm(error.message); carregarAdmin(); };
      box.append(it, b);
    });
    lista.append(box);
  }
  ps.forEach(p => {
    const card = document.createElement("div"); card.className = "adm";
    const conds = (cs || []).filter(c => c.sindico_id === p.id).map(c => c.nome);
    const topo = document.createElement("div"); topo.className = "adm-top";
    const n = document.createElement("strong"); n.textContent = p.nome || "(sem nome)";
    const st = document.createElement("span"); st.className = "pill " + (p.ativo ? "on" : "off"); st.textContent = p.papel === "admin" ? "admin" : p.ativo ? "ativo" : "aguardando";
    const asP = (asss || []).find(a => a.sindico_id === p.id);
    if (asP && p.papel !== "admin"){ const d = diasDeAtraso(asP); st.textContent = asP.status === "atrasada" ? (d >= DIAS_BLOQUEIO ? "bloqueado" : `atraso ${d}d`) : (STATUS_ASS[asP.status] || asP.status); st.className = "pill " + (asP.status === "ativa" ? "on" : "off"); }
    topo.append(n, st);
    const em = document.createElement("small"); em.textContent = `${p.email} · desde ${new Date(p.criado_em).toLocaleDateString("pt-BR")}`;
    const cd = document.createElement("small"); cd.textContent = conds.length ? "Condomínios: " + conds.join(", ") : "Nenhum condomínio cadastrado";
    const emp = document.createElement("small");
    emp.textContent = p.cadastro_completo_em
      ? `${p.empresa}${p.cnpj ? " · CNPJ " + mascaraCnpj(p.cnpj) : ""} · ${p.cidade}/${p.uf} · ${p.telefone ? mascaraTel(p.telefone) : ""} · ${p.email_contato}`
      : "Cadastro profissional incompleto";
    card.append(topo, em, emp, cd);
    if (p.exclusao_solicitada_em){ const ex = document.createElement("small"); ex.style.color = "var(--danger)"; ex.textContent = "Pediu exclusão da conta em " + new Date(p.exclusao_solicitada_em).toLocaleDateString("pt-BR"); card.append(ex); }
    if (p.papel !== "admin"){
      const acoes = document.createElement("div"); acoes.className = "adm-acoes";
      const b = document.createElement("button"); b.type = "button"; b.textContent = p.ativo ? "Bloquear" : "Aprovar"; if (!p.ativo) b.className = "primary";
      b.onclick = async () => { b.disabled = true; const { error } = await sb.from("perfis").update({ ativo: !p.ativo }).eq("id", p.id); if (error) alertaAdm(error.message); carregarAdmin(); };
      const bc = document.createElement("button"); bc.type = "button"; bc.textContent = "Condomínios";
      bc.onclick = () => abrirCondominios({ id: p.id, nome: p.nome || p.email });
      acoes.append(b, bc); card.append(acoes);
    }
    lista.append(card);
  });
}
function alertaAdm(t){ const p = document.createElement("p"); p.className = "rs-t"; p.style.color = "var(--danger)"; p.textContent = "Erro: " + t; $("admLista").prepend(p); }

/* ======================= CADASTRO DE CONDOMÍNIOS ======================= */
const soCnpj = v => (v || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 14);
function mascaraCnpj(v){
  const c = soCnpj(v);
  return c.replace(/^(.{2})(.{0,3})(.{0,3})(.{0,4})(.{0,2}).*$/, (m, a, b, cc, d, e) =>
    a + (b ? "." + b : "") + (cc ? "." + cc : "") + (d ? "/" + d : "") + (e ? "-" + e : ""));
}
function cnpjValido(v){
  const c = soCnpj(v);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c) || /^(.)\1{13}$/.test(c)) return false;
  const val = ch => ch.charCodeAt(0) - 48;
  const dv = (base, pesos) => { const s = [...base].reduce((t, ch, i) => t + val(ch) * pesos[i], 0) % 11; return s < 2 ? 0 : 11 - s; };
  const d1 = dv(c.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
  const d2 = dv(c.slice(0, 13), [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return d1 === Number(c[12]) && d2 === Number(c[13]);
}
let condAlvo = null;   // { id, nome } do síndico dono (admin cadastrando para outro); null = próprio
let condEditId = null; // id do condomínio em edição
const cMsg = (t, err) => { $("cMsg").textContent = t || ""; $("cMsg").style.color = err ? "var(--danger)" : "var(--ok)"; };

function limparFormCond(){
  ["cCnpj","cNome","cCep","cUnid","cEnd","cCidade","cUf","cConv","cReg"].forEach(id => { $(id).value = ""; $(id).removeAttribute("aria-invalid"); });
  condEditId = null; $("cCancelar").hidden = true; $("cSalvar").textContent = "Salvar condomínio";
  $("cConvObr").hidden = $("cRegObr").hidden = false;
  $("cDocDica").textContent = "O SINDICS lê os dois documentos e passa a conhecer as regras do condomínio. PDFs escaneados também funcionam, só demoram um pouco mais.";
  $("cProg").hidden = true;
  $("condFormTitulo").textContent = condAlvo ? `Cadastrar condomínio para ${condAlvo.nome}` : "Cadastrar condomínio"; cMsg("");
}

/* ---------- Leitura dos PDFs (texto + OCR quando escaneado) ---------- */
const FN_DOC = SUPABASE_URL + "/functions/v1/processar-documento";
const TIPO_NOME = { convencao: "Convenção", regulamento: "Regulamento Interno" };
const STATUS_TXT = { pendente: "aguardando PDF", enviado: "enviado", processando: "lendo…", pronto: "lido ✓", erro: "não lido" };
const scriptsCarregados = {};
function carregarScript(src){
  if (!scriptsCarregados[src]) scriptsCarregados[src] = new Promise((ok, falha) => {
    const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => falha(new Error("Não consegui carregar o leitor de PDF. Verifique a internet.")); document.head.append(s);
  });
  return scriptsCarregados[src];
}
function progresso(pct, txt){ $("cProg").hidden = false; $("cProgBar").style.width = Math.max(2, Math.min(100, pct)) + "%"; $("cProgTxt").textContent = txt; }

async function extrairTextoPDF(file, rotulo){
  await carregarScript("vendor/pdf.min.js");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const total = pdf.numPages, textos = [], semTexto = [];
  for (let i = 1; i <= total; i++){
    progresso((i / total) * 35, `${rotulo}: lendo página ${i} de ${total}…`);
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const t = tc.items.map(it => it.str + (it.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+/g, " ").trim();
    textos[i - 1] = t;
    if (t.replace(/\s/g, "").length < 80) semTexto.push(i);
  }
  let ocr = false;
  if (semTexto.length){
    ocr = true;
    progresso(38, `${rotulo}: ${semTexto.length} página(s) escaneada(s). Preparando reconhecimento de texto…`);
    await carregarScript("vendor/tesseract.min.js");
    const worker = await Tesseract.createWorker("por");
    try{
      for (let k = 0; k < semTexto.length; k++){
        const i = semTexto[k];
        progresso(40 + (k / semTexto.length) * 55, `${rotulo}: reconhecendo texto da página ${i} (${k + 1} de ${semTexto.length})…`);
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 2 });
        const cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height;
        await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
        const { data } = await worker.recognize(cv);
        textos[i - 1] = (data.text || "").trim();
        cv.width = cv.height = 0;
      }
    } finally { await worker.terminate(); }
  }
  const texto = textos.map((t, i) => `[Página ${i + 1}]\n${t}`).join("\n\n");
  return { texto, paginas: total, ocr };
}

async function processarDocumento(condId, donoId, tipo, file){
  const rotulo = TIPO_NOME[tipo];
  if (file.size > 30 * 1024 * 1024) throw new Error(`${rotulo}: o arquivo passa de 30 MB.`);
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") throw new Error(`${rotulo}: envie um arquivo PDF.`);
  const { data: { session } } = await sb.auth.getSession(); if (!session) throw new Error("Sessão expirada. Entre novamente.");
  // guarda o original no cofre (só o próprio síndico)
  if (donoId === session.user.id){
    progresso(1, `${rotulo}: guardando o PDF no cofre…`);
    const up = await sb.storage.from("documentos-condominio").upload(`${donoId}/${condId}/${tipo}.pdf`, file, { upsert: true, contentType: "application/pdf" });
    if (up.error) console.warn("upload", up.error.message);
  }
  const { texto, paginas, ocr } = await extrairTextoPDF(file, rotulo);
  progresso(96, `${rotulo}: ensinando o SINDICS…`);
  const r = await fetch(FN_DOC, { method: "POST", headers: { "Authorization": "Bearer " + session.access_token, "apikey": SUPABASE_ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ condominio_id: condId, tipo, texto, paginas, ocr }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${rotulo}: ${j.erro || "erro " + r.status}`);
  progresso(100, `${rotulo}: pronto! ${paginas} páginas lidas${ocr ? " (com reconhecimento de imagem)" : ""}.`);
  return j;
}
async function listarCondominios(){
  const { data: { user } } = await sb.auth.getUser(); if (!user) return [];
  const dono = condAlvo ? condAlvo.id : user.id;
  const { data, error } = await sb.from("condominios").select("id, nome, cnpj, endereco, cidade, uf, cep, unidades, convencao_status, regulamento_status, convencao_msg, regulamento_msg").eq("sindico_id", dono).order("nome");
  const box = $("condLista"); box.innerHTML = "";
  if (error){ box.textContent = "Erro ao carregar: " + error.message; return []; }
  if (!data.length){ const p = document.createElement("p"); p.className = "rs-t"; p.textContent = "Nenhum condomínio cadastrado ainda."; box.append(p); }
  data.forEach(c => {
    const d = document.createElement("div"); d.className = "cond";
    const n = document.createElement("strong"); n.textContent = c.nome;
    const l1 = document.createElement("small"); l1.textContent = c.cnpj ? "CNPJ " + mascaraCnpj(c.cnpj) : "CNPJ não informado — complete o cadastro"; if (!c.cnpj) l1.className = "falta";
    const l2 = document.createElement("small"); l2.textContent = [c.endereco, [c.cidade, c.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ") || "Endereço não informado"; if (!c.endereco) l2.className = "falta";
    const l3 = document.createElement("small"); l3.textContent = c.unidades ? c.unidades + " apartamentos" : "Quantidade de apartamentos não informada";
    const b = document.createElement("button"); b.type = "button"; b.textContent = "Editar";
    b.onclick = () => {
      condEditId = c.id; $("cCnpj").value = c.cnpj ? mascaraCnpj(c.cnpj) : ""; $("cNome").value = c.nome; $("cCep").value = c.cep ? c.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2") : "";
      $("cUnid").value = c.unidades || ""; $("cEnd").value = c.endereco || ""; $("cCidade").value = (c.cidade || "").replace(/\/[A-Z]{2}$/, ""); $("cUf").value = c.uf || (c.cidade || "").split("/")[1] || "";
      $("condFormTitulo").textContent = "Editar " + c.nome; $("cSalvar").textContent = "Salvar alterações"; $("cCancelar").hidden = false; cMsg(""); $("cCnpj").focus();
      $("cConvObr").hidden = c.convencao_status !== "pronto" ? false : true; $("cRegObr").hidden = c.regulamento_status !== "pronto" ? false : true;
      $("cDocDica").textContent = "Anexe um PDF só se quiser enviar ou substituir aquele documento. Os que já foram lidos continuam valendo.";
    };
    const st = document.createElement("div"); st.className = "docst";
    [["convencao", c.convencao_status], ["regulamento", c.regulamento_status]].forEach(([t, s]) => {
      const sp = document.createElement("span"); sp.className = s; sp.textContent = `${TIPO_NOME[t]}: ${STATUS_TXT[s] || s}`; st.append(sp);
    });
    const msgs = [["convencao", c.convencao_status, c.convencao_msg], ["regulamento", c.regulamento_status, c.regulamento_msg]]
      .filter(([, s, m]) => s === "erro" && m).map(([t, , m]) => { const sm = document.createElement("small"); sm.className = "docmsg"; sm.textContent = `${TIPO_NOME[t]}: ${m}`; return sm; });
    d.append(n, l1, l2, l3, st, ...msgs, b); box.append(d);
  });
  return data;
}
async function abrirCondominios(alvo = null, aviso = ""){
  condAlvo = alvo; $("condTitulo").textContent = alvo ? "Condomínios de " + alvo.nome : "Meus condomínios";
  $("condAviso").hidden = !aviso; $("condAviso").textContent = aviso;
  limparFormCond(); abrirGaveta("condDrawer"); await listarCondominios();
}
$("cCnpj").addEventListener("input", e => { e.target.value = mascaraCnpj(e.target.value); e.target.removeAttribute("aria-invalid"); });
$("cCep").addEventListener("input", async e => {
  let v = e.target.value.replace(/\D/g, "").slice(0, 8);
  e.target.value = v.length > 5 ? v.slice(0, 5) + "-" + v.slice(5) : v;
  if (v.length !== 8) return;
  try{
    cMsg("Buscando endereço pelo CEP…");
    const r = await fetch(`https://viacep.com.br/ws/${v}/json/`); const j = await r.json();
    if (j.erro){ cMsg("CEP não encontrado. Preencha o endereço manualmente.", true); return; }
    if (!$("cEnd").value) $("cEnd").value = [j.logradouro, j.bairro].filter(Boolean).join(", ") + (j.logradouro ? ", nº " : "");
    $("cCidade").value = j.localidade || ""; $("cUf").value = j.uf || "";
    cMsg("Endereço preenchido. Complete o número.");
    $("cEnd").focus(); const len = $("cEnd").value.length; $("cEnd").setSelectionRange(len, len);
  }catch(_){ cMsg("Não consegui buscar o CEP agora. Preencha manualmente.", true); }
});
$("cUf").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ""); });
$("cUnid").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 5); });
$("cCancelar").addEventListener("click", limparFormCond);
$("closeCond").addEventListener("click", () => $("condDrawer").classList.remove("open"));
$("condBtn").addEventListener("click", () => abrirCondominios());

$("condForm").addEventListener("submit", async e => {
  e.preventDefault();
  const v = { cnpj: soCnpj($("cCnpj").value), nome: $("cNome").value.trim(), cep: $("cCep").value.replace(/\D/g, ""),
              unidades: Number($("cUnid").value), endereco: $("cEnd").value.trim().replace(/,?\s*nº\s*$/i, ""), cidade: $("cCidade").value.trim(), uf: $("cUf").value.trim() };
  const erros = [];
  const marca = (id, ok) => { if (ok) $(id).removeAttribute("aria-invalid"); else { $(id).setAttribute("aria-invalid", "true"); erros.push(id); } };
  marca("cCnpj", cnpjValido(v.cnpj)); marca("cNome", v.nome.length >= 3); marca("cUnid", v.unidades >= 1);
  marca("cEnd", v.endereco.length >= 5); marca("cCidade", v.cidade.length >= 2); marca("cUf", /^[A-Z]{2}$/.test(v.uf));
  const fConv = $("cConv").files[0] || null, fReg = $("cReg").files[0] || null;
  if (!condEditId){ marca("cConv", !!fConv); marca("cReg", !!fReg); }
  else { if (!$("cConvObr").hidden) marca("cConv", !!fConv); if (!$("cRegObr").hidden) marca("cReg", !!fReg); }
  if (erros.length){
    const m = erros[0] === "cCnpj" ? "CNPJ inválido. Confira os números."
            : (erros[0] === "cConv" || erros[0] === "cReg") ? "Anexe a Convenção e o Regulamento Interno em PDF."
            : "Preencha os campos obrigatórios marcados em vermelho.";
    cMsg(m, true); $(erros[0]).focus(); return;
  }
  const registro = { cnpj: v.cnpj, nome: v.nome, cep: v.cep, unidades: v.unidades, endereco: v.endereco, cidade: `${v.cidade}/${v.uf}`, uf: v.uf };
  $("cSalvar").disabled = true; cMsg("Salvando…");
  const { data: { user } } = await sb.auth.getUser();
  const donoId = condAlvo ? condAlvo.id : user.id;
  let res, condId = condEditId;
  if (condEditId) res = await sb.from("condominios").update(registro).eq("id", condEditId);
  else {
    if (condAlvo) registro.sindico_id = condAlvo.id;
    res = await sb.from("condominios").insert(registro).select("id").single();
    if (!res.error) condId = res.data.id;
  }
  if (res.error){
    $("cSalvar").disabled = false;
    const m = res.error.message || "";
    cMsg(/condominios_cnpj_unico|duplicate/i.test(m) ? "Este CNPJ já está cadastrado no SINDICS. Se o condomínio é seu, fale com o administrador." : m, true);
    return;
  }
  // Lê os PDFs, um de cada vez
  const falhas = [];
  for (const [tipo, f] of [["convencao", fConv], ["regulamento", fReg]]){
    if (!f) continue;
    cMsg("");
    try{ await processarDocumento(condId, donoId, tipo, f); }
    catch(err){ falhas.push(err.message || String(err)); }
  }
  $("cSalvar").disabled = false;
  if (falhas.length){
    cMsg("Dados salvos, mas houve problema com os documentos: " + falhas.join(" | ") + " Você pode reenviar em Editar.", true);
  } else {
    cMsg(fConv || fReg ? "Pronto! O SINDICS já conhece as regras deste condomínio." : (condEditId ? "Alterações salvas." : "Condomínio cadastrado!"));
    setTimeout(() => { $("cProg").hidden = true; }, 2500);
  }
  const msgFinal = $("cMsg").textContent, corFinal = $("cMsg").style.color;
  limparFormCond(); $("cMsg").textContent = msgFinal; $("cMsg").style.color = corFinal;
  await listarCondominios();
  if (!condAlvo) await recarregarCondominiosPerfil();
  if (condAlvo && $("admDrawer").classList.contains("open")) carregarAdmin();
});
async function recarregarCondominiosPerfil(){
  const { data: { user } } = await sb.auth.getUser(); if (!user || !PERFIL) return;
  const { data: cs } = await sb.from("condominios").select("id, nome, cidade, unidades, cnpj").eq("sindico_id", user.id).order("nome");
  PERFIL.condominios = cs || []; preencherCabecalho(PERFIL);
  if (PERFIL.condominios.length) $("condAviso").hidden = true;
}

let iniciado = false;
async function aposLogin(){
  const { data: { user } } = await sb.auth.getUser();
  if (!user){ mostrarLogin(); return; }
  const { data: p } = await sb.from("perfis").select("nome, assinatura, empresa, papel, ativo, email, cnpj, cep, endereco, cidade, uf, email_contato, telefone, voz, cadastro_completo_em, aceite_termos_em, aceite_termos_versao, exclusao_solicitada_em").eq("id", user.id).maybeSingle();
  if (p && (!p.cadastro_completo_em || p.aceite_termos_versao !== TERMOS_V)){
    PERFIL = { ...p, condominios: PERFIL?.condominios || [] };
    $("loginOverlay").hidden = true; msg("");
    perfilDepois = aposLogin;
    abrirPerfil("completar", p, !p.cadastro_completo_em ? "" : "A Política de Privacidade do SINDICS foi atualizada. Confira seus dados e marque o aceite para continuar.");
    return;
  }
  if (!p || !p.ativo){
    await sb.auth.signOut();
    mostrarLogin("Cadastro recebido! Seu acesso está aguardando a aprovação do administrador. Você será avisado quando for liberado.", true);
    return;
  }
  $("pagBanner").hidden = true;
  if (p.papel !== "admin"){
    const s = await situacaoAssinatura(user.id);
    if (s.bloqueado){
      $("loginOverlay").hidden = true; msg("");
      mostrarBloqueio(s.status === "cancelada"
        ? "Sua assinatura do SINDICS foi cancelada. Para voltar a usar, fale com a nossa equipe em sindicanciaethics@gmail.com."
        : `Sua assinatura está em atraso há ${s.atraso} dias e o acesso foi suspenso. Regularize o pagamento e o SINDICS volta na hora.`);
      if (s.status === "cancelada") $("bloqueioPagar").hidden = $("bloqueioRever").hidden = true;
      return;
    }
    if (s.tem && s.status === "atrasada") mostrarAvisoAtraso(s);
  }
  const { data: cs } = await sb.from("condominios").select("id, nome, cidade, unidades, cnpj").eq("sindico_id", user.id).order("nome");
  PERFIL = { ...p, condominios: cs || [] }; preencherCabecalho(PERFIL); rotuloVoz();
  $("admBtn").hidden = p.papel !== "admin";
  $("loginOverlay").hidden = true; msg("");
  try{ history.replaceState(null, "", location.pathname); }catch(_){}
  atualizarResumoTela(); carregarLembretes();
  if (!iniciado){ iniciado = true; start(); }
  if (!PERFIL.condominios.length)
    abrirCondominios(null, "Bem-vindo ao SINDICS! Cadastre o seu condomínio aqui (CNPJ, nome, endereço, apartamentos, Convenção e Regulamento em PDF) ou feche esta janela e diga “SINDICS” para cadastrar por voz.");
  else if (PERFIL.condominios.some(c => !c.cnpj))
    abrirCondominios(null, "Complete o cadastro: informe o CNPJ e o endereço dos condomínios marcados em âmbar.");
}
async function start(){
  loadIndicators(); setInterval(loadIndicators, 30*60*1000);
  captionEl.textContent = "";
  await bootSequence();
  await ativarSemToque();
}
/* Liga microfone e escuta da palavra "SINDICS" sozinho, sem botão.
   Se o microfone já foi permitido antes, nada é pedido; na primeira vez o navegador pergunta. */
async function ativarSemToque(){
  let perm = "prompt";
  try{ perm = (await navigator.permissions.query({ name:"microphone" })).state; }catch(_){}
  if (perm === "denied"){ mostrarToque("MICROFONE BLOQUEADO", "Clique no cadeado ao lado do endereço, coloque Microfone em Permitir e recarregue a página."); return; }
  stateEl.textContent = "Ligando microfone";
  try{ await initAudio(); }
  catch(_){ mostrarToque("ATIVAR SINDICS", "Toque aqui e, quando o navegador perguntar, clique em Permitir para o microfone."); return; }
  standby("SINDICS em prontidão.");
  if (!SR) hintEl.textContent = "Este navegador não reconhece a palavra “SINDICS”. Use o Google Chrome ou chame pelo menu.";
}
let activating = false;
$("tapOverlay").addEventListener("click", async () => {
  if (activating) return; activating = true;
  try{
    if (!micStream){ $("tapMsg").textContent = "Ativando… se o navegador perguntar, clique em Permitir para o microfone."; await initAudio(); }
    liberarSom(); await new Promise(r => setTimeout(r, 250));
    if (escutaBloqueada){ escutaBloqueada = false; recOn = false; }
    if (mode === "boot") standby("SINDICS em prontidão."); else if (mode === "standby") startWake();
    if (somLiberado()){
      $("tapOverlay").hidden = true;
      if (wakePendente){ wakePendente = false; wake(); }
    } else $("tapMsg").textContent = "O som ainda está bloqueado. Toque de novo.";
  }catch(_){
    $("tapTitulo").textContent = "MICROFONE BLOQUEADO";
    $("tapMsg").textContent = "Não consegui acessar o microfone. Clique no cadeado ao lado do endereço, coloque Microfone em Permitir, recarregue a página e toque aqui.";
  }
  activating = false;
});

/* ======================= NÚCLEO 3D ======================= */
const core = { level:0, gather:0, pulse:0, boot:1, color:new (window.THREE ? THREE.Color : Object)("#3fd0ff") };
const bins = new Uint8Array(256);
function readLevel(an){ if (!an) return 0; an.getByteFrequencyData(bins); let s = 0; for (let i=2;i<70;i++) s += bins[i]; return s/(68*255); }

function initGL(){
  if (!window.THREE){ hintEl.textContent = "Não foi possível carregar o núcleo 3D. Verifique a internet."; return; }
  const canvas = $("gl");
  let renderer;
  try{ renderer = new THREE.WebGLRenderer({canvas, antialias:!isLite, alpha:false, powerPreference:"high-performance"}); }
  catch(_){ hintEl.textContent = "Este navegador não suporta o núcleo 3D."; return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, isLite ? 1.25 : 2));
  renderer.setClearColor(0x04070d, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 100); camera.position.set(0, 0, 9);
  const group = new THREE.Group(); scene.add(group);

  const NOISE = `
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;} vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);} vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}`;

  /* esfera de plasma */
  const uni = { uTime:{value:0}, uLevel:{value:0}, uColor:{value:new THREE.Color("#3fd0ff")}, uBoot:{value:0}, uLight:{value:0} };
  const plasma = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.35, isLite ? 32 : 64),
    new THREE.ShaderMaterial({ uniforms:uni, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false,
      vertexShader: NOISE + `
        uniform float uTime; uniform float uLevel; uniform float uBoot; varying vec3 vN; varying vec3 vV; varying float vD;
        void main(){ float n = snoise(normal*1.6 + uTime*0.35) * (0.10 + uLevel*0.55) + snoise(normal*4.0 - uTime*0.8) * (0.03 + uLevel*0.18);
          vec3 p = position * uBoot + normal * n; vD = n; vec4 mv = modelViewMatrix * vec4(p,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uLevel; uniform float uLight; varying vec3 vN; varying vec3 vV; varying float vD;
        void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2); float core = pow(abs(dot(vN, vV)), 6.0);
          vec3 c = uColor * (f*1.4 + vD*1.2 + 0.08) + vec3(1.0)*core*(0.12 + uLevel*0.5);
          float a = clamp(f*0.95 + core*0.25 + 0.05, 0.0, 1.0);
          /* tema claro: tinta colorida translúcida em vez de luz somada (que sumiria no fundo claro) */
          vec3 cl = mix(uColor, uColor*0.55, f) + uColor*vD*0.8;
          float al = clamp(f*0.85 + 0.12 + core*uLevel*0.35, 0.0, 0.92);
          gl_FragColor = mix(vec4(c, a), vec4(cl, al), uLight); }`
    })
  );
  group.add(plasma);

  /* brilho */
  const glowTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d"); const r = g.createRadialGradient(128,128,0,128,128,128);
    r.addColorStop(0,"rgba(255,255,255,1)"); r.addColorStop(.2,"rgba(255,255,255,.55)"); r.addColorStop(.5,"rgba(255,255,255,.12)"); r.addColorStop(1,"rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0,0,256,256); return new THREE.CanvasTexture(c); })();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex, color:0x3fd0ff, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, opacity:.55}));
  glow.scale.set(7,7,1); scene.add(glow);
  const heart = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex, color:0xffffff, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, opacity:.9}));
  heart.scale.set(1.6,1.6,1); scene.add(heart);

  /* partículas orbitais */
  const N = isLite ? 700 : 1800;
  const pos = new Float32Array(N*3), seed = new Float32Array(N*3);
  for (let i=0;i<N;i++){ const th = Math.acos(2*Math.random()-1), ph = Math.random()*Math.PI*2, r = 1.9 + Math.pow(Math.random(),2)*1.6; seed[i*3]=th; seed[i*3+1]=ph; seed[i*3+2]=r; }
  const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute("position", new THREE.BufferAttribute(pos,3));
  const pMat = new THREE.PointsMaterial({color:0x3fd0ff, size: isLite ? .045 : .035, map:glowTex, transparent:true, opacity:.85, blending:THREE.AdditiveBlending, depthWrite:false});
  const points = new THREE.Points(pGeo, pMat); group.add(points);

  /* anéis HUD segmentados */
  function ringSeg(r, seg, gapFrac, tiltX, tiltY, opacity){
    const v = []; const step = Math.PI*2/seg, res = 12;
    for (let k=0;k<seg;k++){ const a0 = k*step, a1 = a0 + step*(1-gapFrac);
      for (let j=0;j<res;j++){ const t0 = a0+(a1-a0)*j/res, t1 = a0+(a1-a0)*(j+1)/res; v.push(Math.cos(t0)*r, Math.sin(t0)*r, 0, Math.cos(t1)*r, Math.sin(t1)*r, 0); } }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(v,3));
    const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({color:0x3fd0ff, transparent:true, opacity, blending:THREE.AdditiveBlending, depthWrite:false}));
    m.rotation.x = tiltX; m.rotation.y = tiltY; return m;
  }
  const rings = [
    {m:ringSeg(2.55, 3, .3, 1.25, .2, .85), s:.35},
    {m:ringSeg(2.85, 64, .55, 1.35, -.15, .45), s:-.12},
    {m:ringSeg(3.25, 8, .45, 1.2, .35, .55), s:.2},
    {m:ringSeg(3.7, 120, .7, 1.5, 0, .3), s:-.05},
  ];
  rings.forEach(r => group.add(r.m));
  let claro3D = false;

  /* anel de frequência (espectro da voz) */
  const FB = 128, fPos = new Float32Array(FB*2*3);
  const fGeo = new THREE.BufferGeometry(); fGeo.setAttribute("position", new THREE.BufferAttribute(fPos,3));
  const fLines = new THREE.LineSegments(fGeo, new THREE.LineBasicMaterial({color:0x3fd0ff, transparent:true, opacity:.9, blending:THREE.AdditiveBlending, depthWrite:false}));
  scene.add(fLines);

  /* Troca de tema do núcleo: fundo, mistura de cores e brilho */
  window.sindicsTema3D = claro => {
    claro3D = claro;
    renderer.setClearColor(claro ? 0xe9eff5 : 0x04070d, 1);
    uni.uLight.value = claro ? 1 : 0;
    const modo = claro ? THREE.NormalBlending : THREE.AdditiveBlending;
    [plasma.material, glow.material, heart.material, pMat, fLines.material, ...rings.map(r => r.m.material)].forEach(m => { m.blending = modo; m.needsUpdate = true; });
  };
  window.sindicsTema3D(temaClaro());

  function resize(){
    const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w/h;
    camera.position.z = w < 860 ? 11.5 : 9; camera.position.y = w < 860 ? -.6 : -.35; camera.updateProjectionMatrix();
  }
  addEventListener("resize", resize); resize();

  let last = performance.now(), mx = 0, my = 0;
  addEventListener("pointermove", e => { mx = (e.clientX/innerWidth - .5); my = (e.clientY/innerHeight - .5); });
  const target = new THREE.Color();

  function frame(now){
    const dt = Math.min(.05, (now - last)/1000); last = now; const t = now/1000;
    const outL = readLevel(outAnalyser), inL = readLevel(micAnalyser);
    const speakingNow = outCtx && playHead > outCtx.currentTime + .02;
    if (["listening","thinking","speaking"].includes(mode)){ if (speakingNow) setMode("speaking"); else if (mode === "speaking") setMode("listening"); }
    const want = mode === "speaking" ? outL*2.4 : mode === "listening" ? inL*2.8 : (mode === "thinking" || mode === "connecting") ? .22 + .1*Math.sin(t*7) : mode === "standby" ? .03 + inL*.5 : .05;
    core.level += (Math.min(1,want) - core.level) * .16;
    core.gather += (((mode === "thinking" || mode === "connecting") ? 1 : 0) - core.gather) * .05;
    core.pulse *= .93; core.boot += (1 - core.boot) * .035;
    const L = core.level + core.pulse*.35;

    target.set(MODE_HEX[mode]); uni.uColor.value.lerp(target, .05);
    const col = uni.uColor.value;
    uni.uTime.value = t; uni.uLevel.value = L; uni.uBoot.value = core.boot;
    glow.material.color.copy(col); glow.material.opacity = claro3D ? .14 + L*.2 : .35 + L*.5; glow.scale.setScalar((5.5 + L*3) * core.boot);
    if (claro3D) heart.material.color.copy(col); else heart.material.color.setRGB(1, 1, 1);
    heart.material.opacity = claro3D ? .3 + L*.35 : .55 + L*.45; heart.scale.setScalar((1.1 + L*1.4) * core.boot);
    pMat.color.copy(col); fLines.material.color.copy(col);
    rings.forEach(r => r.m.material.color.copy(col));

    const sp = reduce ? 0 : 1, spin = (mode === "standby" ? .45 : 1) * sp;
    plasma.rotation.y += dt*.15*spin; plasma.rotation.x += dt*.05*spin;
    rings.forEach((r,i) => { r.m.rotation.z += dt * r.s * (1 + L*3) * spin; r.m.scale.setScalar(core.boot * (1 + L*.06*(i%2 ? 1 : -1))); });

    for (let i=0;i<N;i++){
      const th = seed[i*3], ph = seed[i*3+1] + t*(.12 + (i%7)*.015)*spin, r0 = seed[i*3+2];
      const r = (r0 * (1 - core.gather*.45) + L*.6*Math.sin(t*6 + i)) * core.boot;
      pos[i*3] = r*Math.sin(th)*Math.cos(ph); pos[i*3+1] = r*Math.cos(th)*.92; pos[i*3+2] = r*Math.sin(th)*Math.sin(ph);
    }
    pGeo.attributes.position.needsUpdate = true;

    const an = mode === "speaking" ? outAnalyser : micAnalyser; if (an) an.getByteFrequencyData(bins);
    const live = inSession() ? 1 : .2;
    for (let k=0;k<FB;k++){
      const v = an ? bins[2 + (k % 64)]/255 : 0, a = k/FB*Math.PI*2 + t*.08*spin;
      const r1 = 2.05*core.boot, r2 = r1 + .06 + v*.9*live + Math.sin(t*2+k)*.015;
      fPos.set([Math.cos(a)*r1, Math.sin(a)*r1, 0, Math.cos(a)*r2, Math.sin(a)*r2, 0], k*6);
    }
    fGeo.attributes.position.needsUpdate = true;

    group.rotation.y += ((mx*.35) - group.rotation.y) * .04; group.rotation.x += ((my*.25) - group.rotation.x) * .04;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
initGL();

/* ======================= PARTIDA ======================= */
(async function partida(){
  if (!sb){ mostrarLogin("Não foi possível carregar o módulo de login. Verifique a internet e recarregue.", true); return; }
  let recuperando = /type=recovery/.test(location.hash);
  const convite = /type=invite/.test(location.hash);
  sb.auth.onAuthStateChange((evento) => {
    if (evento === "PASSWORD_RECOVERY"){
      recuperando = true;
      $("loginOverlay").hidden = false; $("loginForm").hidden = true; $("forgotBtn").hidden = true; $("newPwdForm").hidden = false;
      msg("Crie sua nova senha."); setTimeout(() => $("pwd1").focus(), 80);
    }
    if (evento === "SIGNED_OUT" && $("loginOverlay").hidden){ if (inSession()) endSession("Sessão encerrada."); mostrarLogin("Sua sessão terminou. Entre novamente."); }
  });
  const { data: { session } } = await sb.auth.getSession();
  if (recuperando) return;
  if (convite && session){
    $("loginOverlay").hidden = false; $("loginForm").hidden = true; $("forgotBtn").hidden = true; $("newPwdForm").hidden = false;
    msg("Pagamento confirmado. Bem-vindo ao SINDICS! Crie sua senha para entrar."); setTimeout(() => $("pwd1").focus(), 80);
    return;
  }
  if (session) await aposLogin(); else mostrarLogin();
})();
