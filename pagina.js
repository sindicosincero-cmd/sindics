/* ===== Ajuste aqui ===== */
const PLANOS = { essencial: { nome: "Essencial", preco: "R$ 450" }, profissional: { nome: "Profissional", preco: "R$ 899" } };
const WHATSAPP = "";   // só números, com DDI e DDD. Ex.: "5511999999999" (usado no "Fale com a nossa equipe")
const MENSAGEM = "Olá! Tenho uma dúvida sobre o SINDICS, a inteligência condominial por voz.";
const FN_ASSINAR = "https://hjjckvluydcejmrxolza.supabase.co/functions/v1/assinar";
/* ======================== */
const contato = WHATSAPP
  ? "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(MENSAGEM)
  : "mailto:contato@sindics.com.br?subject=" + encodeURIComponent("Dúvida sobre o SINDICS") + "&body=" + encodeURIComponent(MENSAGEM);
document.querySelectorAll(".js-contato").forEach(a => { a.href = contato; if (WHATSAPP){ a.target = "_blank"; a.rel = "noopener"; } });

/* ---------- Assinatura ---------- */
(function(){
  const modal = document.getElementById("modalAssinar"), form = document.getElementById("formAssinar"), msg = document.getElementById("maMsg"), $ = id => document.getElementById(id);
  let voltarFoco = null;
  const marcarPlano = v => { const p = PLANOS[v] ? v : "essencial"; const r = form.querySelector(`input[name="maPlano"][value="${p}"]`); if (r) r.checked = true; $("maPlano").textContent = `Plano ${PLANOS[p].nome} · ${PLANOS[p].preco}/mês`; };
  form.querySelectorAll('input[name="maPlano"]').forEach(r => r.addEventListener("change", () => marcarPlano(r.value)));
  const abrir = e => { e.preventDefault(); voltarFoco = e.currentTarget; marcarPlano(e.currentTarget.dataset.plano || form.querySelector('input[name="maPlano"]:checked')?.value); modal.hidden = false; document.body.style.overflow = "hidden"; setTimeout(() => $("maNome").focus(), 50); };
  const fechar = () => { modal.hidden = true; document.body.style.overflow = ""; if (voltarFoco) voltarFoco.focus(); };
  document.querySelectorAll(".js-assinar").forEach(a => a.addEventListener("click", abrir));
  $("maFechar").addEventListener("click", fechar);
  modal.addEventListener("click", e => { if (e.target === modal) fechar(); });
  addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) fechar(); });

  const dig = v => v.replace(/\D/g, "");
  $("maTel").addEventListener("input", e => { const d = dig(e.target.value).slice(0, 11); e.target.value = d.length <= 2 ? d : d.length <= 6 ? `(${d.slice(0,2)}) ${d.slice(2)}` : d.length <= 10 ? `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}` : `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`; });
  $("maDoc").addEventListener("input", e => { const d = dig(e.target.value).slice(0, 14);
    e.target.value = d.length <= 11 ? d.replace(/^(\d{3})(\d{0,3})(\d{0,3})(\d{0,2}).*$/, (m, a, b, c, x) => a + (b ? "." + b : "") + (c ? "." + c : "") + (x ? "-" + x : ""))
      : d.replace(/^(\d{2})(\d{3})(\d{3})(\d{0,4})(\d{0,2}).*$/, (m, a, b, c, x, y) => `${a}.${b}.${c}/${x}${y ? "-" + y : ""}`); });

  const cpfOk = c => { if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false; const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += +c[i] * (n + 1 - i); const r = s * 10 % 11; return r === 10 ? 0 : r; }; return dv(9) === +c[9] && dv(10) === +c[10]; };
  const cnpjOk = c => { if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false; const dv = (b, p) => { const s = [...b].reduce((t, ch, i) => t + +ch * p[i], 0) % 11; return s < 2 ? 0 : 11 - s; }; return dv(c.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]) === +c[12] && dv(c.slice(0, 13), [6,5,4,3,2,9,8,7,6,5,4,3,2]) === +c[13]; };
  const erro = (id, t) => { if (id){ $(id).setAttribute("aria-invalid", "true"); $(id).focus(); } msg.className = "ma-msg"; msg.textContent = t; };

  form.addEventListener("input", e => { e.target.removeAttribute("aria-invalid"); if (msg.className === "ma-msg") msg.textContent = ""; });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    ["maNome","maEmail","maDoc","maTel"].forEach(id => $(id).removeAttribute("aria-invalid"));
    const nome = $("maNome").value.trim(), email = $("maEmail").value.trim().toLowerCase(), doc = dig($("maDoc").value), tel = dig($("maTel").value);
    if (nome.length < 5 || !/\s/.test(nome)) return erro("maNome", "Informe seu nome completo.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return erro("maEmail", "Informe um e-mail válido. É nele que você recebe o acesso.");
    if (!(doc.length === 11 ? cpfOk(doc) : cnpjOk(doc))) return erro("maDoc", "CPF ou CNPJ inválido. Confira os números.");
    if (tel.length < 10) return erro("maTel", "Informe o WhatsApp com DDD.");
    if (!$("maAceite").checked) return erro(null, "Para assinar, aceite a Política de Privacidade e os Termos de Uso.");
    const btn = $("maEnviar"); btn.disabled = true; btn.textContent = "Preparando o pagamento…"; msg.className = "ma-msg ok"; msg.textContent = "";
    try{
      const r = await fetch(FN_ASSINAR, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "assinar", plano: form.querySelector('input[name="maPlano"]:checked')?.value || "essencial", nome, email, cpf_cnpj: doc, telefone: tel, aceite: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || "Não foi possível iniciar a assinatura agora.");
      if (j.link){ msg.textContent = "Tudo certo. Abrindo a página de pagamento…"; location.href = j.link; return; }
      msg.textContent = j.aviso || "Assinatura criada. O link de pagamento chega no seu e-mail.";
    }catch(err){ erro(null, err.message + " Se preferir, fale com a nossa equipe."); }
    btn.disabled = false; btn.textContent = "Ir para o pagamento";
  });
})();

const reduzir = matchMedia("(prefers-reduced-motion: reduce)").matches;
const espera = ms => new Promise(r => setTimeout(r, reduzir ? 0 : ms));
addEventListener("scroll", () => document.getElementById("topo").classList.toggle("rolou", scrollY > 40), { passive: true });

/* ======================= NÚCLEO (WebGL puro) ======================= */
const nucleo = { nivel: 0, alvo: 0.04, boot: 0, mx: 0, my: 0, visivel: true };
let falando = false;
(function(){
  const cv = document.getElementById("nucleo");
  const gl = cv.getContext("webgl", { antialias: false, premultipliedAlpha: false }) || cv.getContext("experimental-webgl");
  if (!gl){ cv.style.background = "radial-gradient(circle at 50% 40%,#fff 0 1.5%,rgba(63,208,255,.9) 4%,rgba(63,208,255,.25) 13%,transparent 26%)"; return; }
  const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const FS = `precision highp float;
  uniform vec2 uRes; uniform float uT; uniform float uL; uniform float uB; uniform vec2 uM;
  float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
  float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p*=2.03;a*=.5;}return v;}
  float anel(vec2 q,float r,float esp,float seg,float duty,float vel,float tilt){
    vec2 e=vec2(q.x,q.y/tilt); float d=abs(length(e)-r)*tilt; float a=atan(e.y,e.x)/6.2831853+.5;
    float s=step(fract(a*seg+uT*vel),duty); return smoothstep(esp,0.,d)*s;}
  void main(){
    vec2 uv=(gl_FragCoord.xy-.5*uRes)/min(uRes.x,uRes.y);
    float mob=step(uRes.x,uRes.y);
    uv.y-=mix(.17,.42,mob);
    uv-=uM*.025;
    uv/=mix(.86,.8,mob);
    float r=length(uv), a=atan(uv.y,uv.x);
    float L=uL, B=uB;
    vec3 ci=vec3(.247,.816,1.);
    float R=.2*B+.035*(fbm(vec2(a*2.,uT*.6))-.5)*(1.+L*4.)+.012*sin(a*7.+uT*3.)*L;
    float borda=exp(-abs(r-R)*(38.-L*14.));
    float dentro=smoothstep(R,0.,r);
    float plasma=fbm(uv*6.+vec2(uT*.35,-uT*.25))*dentro;
    vec3 c=ci*(borda*1.1+plasma*.9*(.6+L)+dentro*.12);
    c+=vec3(1.)*exp(-r*r*(260.-L*120.))*(.75+L*.9);
    c+=ci*exp(-r*(5.2-L*1.6))*(.32+L*.45);
    float bar=fract(a/6.2831853*96.);
    float amp=.012+fbm(vec2(floor(a/6.2831853*96.),uT*5.))*.09*L;
    float ri=.245*B;
    c+=ci*step(bar,.42)*step(ri,r)*step(r,ri+amp)*(.45+L);
    c+=ci*.85*anel(uv,.33*B,.0035,3.,.68,.06,.42);
    c+=ci*.45*anel(uv,.37*B,.0022,64.,.42,-.025,.38);
    c+=ci*.55*anel(uv,.43*B,.003,8.,.55,.035,.46);
    c+=ci*.28*anel(uv,.5*B,.002,120.,.3,-.012,.34);
    vec2 pp=vec2(a*3.+uT*.12, r*22.);
    vec2 id=floor(pp*vec2(6.,1.)); vec2 fp=fract(pp*vec2(6.,1.))-.5;
    float rnd=h(id); float on=step(.72,rnd)*smoothstep(.17,.62,r)*smoothstep(.95,.6,r);
    c+=ci*on*smoothstep(.09,0.,length(fp*vec2(.55,1.)))*(.6+.6*sin(uT*2.+rnd*30.));
    vec2 g=abs(fract(gl_FragCoord.xy/42.)-.5);
    c+=ci*.035*step(.48,max(g.x,g.y))*smoothstep(1.4,.2,r);
    c*=smoothstep(1.6,.3,r);
    c+=vec3(.016,.027,.05);
    gl_FragColor=vec4(c,1.);
  }`;
  try{
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = n => gl.getUniformLocation(pr, n); const uRes = U("uRes"), uT = U("uT"), uL = U("uL"), uB = U("uB"), uM = U("uM");
    const dpr = Math.min(devicePixelRatio || 1, innerWidth < 700 ? 1.25 : 1.5);
    const tamanho = () => { cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr); gl.viewport(0, 0, cv.width, cv.height); };
    addEventListener("resize", tamanho); tamanho();
    addEventListener("pointermove", e => { nucleo.mx = e.clientX / innerWidth - .5; nucleo.my = .5 - e.clientY / innerHeight; }, { passive: true });
    let mx = 0, my = 0, rodando = false;
    const quadro = t => {
      if (!nucleo.visivel){ rodando = false; return; }
      nucleo.nivel += (nucleo.alvo - nucleo.nivel) * .18;
      nucleo.boot += (1 - nucleo.boot) * (reduzir ? 1 : .035);
      mx += (nucleo.mx - mx) * .05; my += (nucleo.my - my) * .05;
      gl.uniform2f(uRes, cv.width, cv.height); gl.uniform1f(uT, reduzir ? 8 : t / 1000);
      gl.uniform1f(uL, nucleo.nivel); gl.uniform1f(uB, Math.max(.05, nucleo.boot)); gl.uniform2f(uM, mx, my);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (reduzir){ rodando = false; return; }
      requestAnimationFrame(quadro);
    };
    const ligar = () => { if (!rodando){ rodando = true; requestAnimationFrame(quadro); } };
    new IntersectionObserver(es => { nucleo.visivel = es[0].isIntersecting; if (nucleo.visivel) ligar(); }).observe(cv);
    ligar();
    window.sindicsRedesenha = ligar;
  }catch(err){
    console.error(err);
    cv.style.background = "radial-gradient(circle at 50% 40%,#fff 0 1.5%,rgba(63,208,255,.9) 4%,rgba(63,208,255,.25) 13%,transparent 26%)";
  }
  document.querySelectorAll(".btn").forEach(b => {
    b.addEventListener("pointerenter", () => { if (!falando) nucleo.alvo = .3; });
    b.addEventListener("pointerleave", () => { if (!falando) nucleo.alvo = .04; });
  });
})();

/* ======================= A RECEPÇÃO ======================= */
(async function recepcao(){
  const bootEl = document.getElementById("bootlog"), estado = document.getElementById("estado"), alvo = document.getElementById("digitado");
  const relogio = () => { document.getElementById("relogio").textContent = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date()); };
  relogio(); setInterval(relogio, 15000);
  const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(new Date()));
  const saud = hora < 5 ? "Boa noite" : hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  for (const l of ["Núcleo SINDICS", "Base condominial", "Legislação e prazos", "Reconhecimento de voz", "Síntese de voz"]){
    const d = document.createElement("div"); d.innerHTML = "▸ <span></span> <span class='ok'>OK</span>"; d.children[0].textContent = l + " " + ".".repeat(Math.max(2, 24 - l.length));
    bootEl.append(d); await espera(170);
  }
  estado.textContent = "EM PRONTIDÃO"; await espera(900);
  const frases = [saud + ". Eu sou o SINDICS.", "Estava esperando por você."];
  document.getElementById("saudacao").setAttribute("aria-label", frases.join(" "));
  estado.textContent = "FALANDO"; falando = true;
  for (let i = 0; i < frases.length; i++){
    if (i) alvo.append(document.createElement("br"));
    const span = document.createElement("span"); alvo.append(span);
    for (const ch of frases[i]){
      span.textContent += ch;
      nucleo.alvo = /[ .,]/.test(ch) ? .12 : .35 + Math.random() * .55;
      await espera(/[.,]/.test(ch) ? 260 : 42);
    }
    nucleo.alvo = .08; await espera(450);
  }
  falando = false; nucleo.alvo = .04; estado.textContent = "EM PRONTIDÃO";
  document.querySelectorAll(".surge").forEach((e, i) => setTimeout(() => e.classList.add("on"), reduzir ? 0 : i * 160));
  if (reduzir && window.sindicsRedesenha) window.sindicsRedesenha();
})();

/* ======================= CONVERSA DE EXEMPLO ======================= */
(function(){
  const passos = [...document.querySelectorAll("#demo .passo")];
  if (reduzir || !("IntersectionObserver" in window)){ passos.forEach(p => p.classList.add("on")); return; }
  const ms = [200, 1400, 1100, 2000, 1400];
  const io = new IntersectionObserver(async es => {
    if (!es.some(e => e.isIntersecting)) return; io.disconnect();
    for (let i = 0; i < passos.length; i++){ await espera(ms[i]); passos[i].classList.add("on"); }
  }, { threshold: .35 });
  io.observe(document.getElementById("demo"));
})();
