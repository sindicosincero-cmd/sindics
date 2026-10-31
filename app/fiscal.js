/* SINDICS — Fiscalização: cobra a cada 5 dias o que está pendente (documentos, pendências da operação,
   combinados com prazo, gestão) até resolver. Faixa fixa no topo, tela de cobrança, cor do núcleo e abertura da voz. */
(function(){
const F = { itens: [], nivel: null };
window.Fiscal = F;
const NIV = { critico: { rot: "Crítico", ordem: 0 }, cobranca: { rot: "Cobrança", ordem: 1 }, atencao: { rot: "Atenção", ordem: 2 } };
const ORIG = { documento: "Documento", documento_faltante: "Documento", operacao: "Operação", combinado: "Combinado", gestao: "Gestão" };
const hojeF = () => (typeof hojeISO === "function" ? hojeISO() : new Date().toISOString().slice(0, 10));
const diasDe = (ts) => Math.max(0, Math.round((Date.parse(hojeF() + "T00:00:00Z") - Date.parse(String(ts).slice(0, 10) + "T00:00:00Z")) / 86400000));
const dBR = d => d ? d.split("-").reverse().join("/") : "—";
const nomeC = id => (typeof nomeCondPorId === "function" ? nomeCondPorId(id) : "") || "Condomínio";
const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const respondidoHoje = i => i.respondido_em && String(i.respondido_em).slice(0, 10) === hojeF();
const devido = i => i.cobrar_em <= hojeF();
const ordenar = l => l.sort((a, b) => NIV[a.nivel].ordem - NIV[b.nivel].ordem || String(a.prazo || "9").localeCompare(String(b.prazo || "9")));

F.carregar = async function(abrirSeDevido = true){
  if (typeof sb === "undefined" || !sb || typeof PERFIL === "undefined" || !PERFIL) return;
  try{ await sb.rpc("fiscalizacao_atualizar"); }catch(_){}
  const { data, error } = await sb.from("fiscalizacao").select("*").eq("status", "aberta");
  if (error){ console.warn("fiscalização", error.message); return; }
  const ids = new Set((PERFIL.condominios || []).map(c => c.id));
  F.itens = ordenar((data || []).filter(i => ids.has(i.condominio_id)));
  F.nivel = F.itens.length ? F.itens[0].nivel : null;
  pintar();
  const q = new URLSearchParams(location.search);
  if (q.get("fiscalizacao") === "1" || F.pedirAbrir){ F.pedirAbrir = false; F.abrir(false); return; }
  if (!abrirSeDevido) return;
  const devidos = F.itens.filter(i => devido(i) && !respondidoHoje(i));
  const temCritico = devidos.some(i => i.nivel === "critico");
  let visto = ""; try{ visto = localStorage.getItem("sindics-fisc-visto") || ""; }catch(_){}
  if (devidos.length && (temCritico || visto !== hojeF())) setTimeout(() => F.abrir(true), 1500);
};

/* Faixa do topo, contador do menu e cor do núcleo */
function pintar(){
  const bar = $("fiscBar"), n = F.itens.length;
  const crit = F.itens.filter(i => i.nivel === "critico").length, cob = F.itens.filter(i => i.nivel === "cobranca").length;
  document.body.dataset.fisc = F.nivel || "";
  $("fiscBadge").textContent = n ? String(n) : ""; $("fiscBadge").hidden = !n;
  if (!n){ bar.hidden = true; return; }
  bar.hidden = false; bar.className = "fisc-bar " + F.nivel;
  $("fiscBarTxt").textContent = `Fiscalização: ${n} pendência${n > 1 ? "s" : ""}` + (crit ? ` · ${crit} crítica${crit > 1 ? "s" : ""}` : "") + (cob ? ` · ${cob} em cobrança` : "");
  const top = F.itens[0];
  $("fiscBarSub").textContent = `${top.titulo} — ${nomeC(top.condominio_id)}` + (top.prazo ? ` · prazo ${dBR(top.prazo)}` : "");
}

/* Cor do núcleo em prontidão: âmbar com cobrança, vermelho pulsando com crítico (lido pelo laço 3D) */
F.corNucleo = function(t){
  if (F.nivel === "critico") return Math.sin(t * 3) > -0.2 ? "#ff3b4e" : "#8a1c27";
  if (F.nivel === "cobranca") return "#ffb547";
  return null;
};

/* Abertura da conversa: no dia da cobrança, o SINDICS começa pelo item mais grave */
F.abertura = function(abertura){
  const devidos = F.itens.filter(i => devido(i) && i.nivel !== "atencao");
  if (!devidos.length) return abertura;
  const i = devidos[0], extra = devidos.length - 1;
  const quando = i.prazo ? (i.prazo < hojeF() ? `com prazo vencido em ${dBR(i.prazo)}` : `com prazo em ${dBR(i.prazo)}`) : `em aberto há ${diasDe(i.aberto_em)} dias`;
  const frase = ` Antes de tudo, a fiscalização: ${/^[A-ZÁÉÍÓÚ][a-záéíóúâêôãõç]/.test(i.titulo) ? i.titulo.charAt(0).toLowerCase() + i.titulo.slice(1) : i.titulo}, no ${nomeC(i.condominio_id)}, ${quando}${extra ? `, e há mais ${extra} pendência${extra > 1 ? "s" : ""} em cobrança` : ""}. Registre a previsão na tela de Fiscalização.`;
  return String(abertura || "").replace(/\s*Em que posso ajudar\?\s*$/, "") + frase;
};

/* Texto curto para o SINDICS saber o que está em aberto (variável da conversa) */
F.resumoVoz = function(){
  if (!F.itens.length) return "Nenhuma pendência na fiscalização.";
  return F.itens.slice(0, 12).map(i => `- [${NIV[i.nivel].rot}] ${nomeC(i.condominio_id)}: ${i.titulo}; prazo ${dBR(i.prazo)}; em aberto há ${diasDe(i.aberto_em)} dias; responsável ${i.responsavel_nome || "—"}${i.previsao ? `; previsão ${dBR(i.previsao)} (${i.justificativa || ""})` : ""}`).join("\n")
    + (F.itens.length > 12 ? `\n(+${F.itens.length - 12} itens)` : "");
};

/* Tela da fiscalização. Em modo cobrança: só o que venceu a cobrança; críticos precisam de resposta para fechar. */
let modoCobranca = false;
F.abrir = function(cobranca = false){
  modoCobranca = cobranca;
  if (typeof DRAWERS !== "undefined") DRAWERS.forEach(id => $(id).classList.remove("open"));
  $("fiscOverlay").hidden = false; $("fiscOverlay").scrollTop = 0;
  desenhar();
};
F.fechar = function(){
  if (bloqueado()) return;
  if (modoCobranca){ try{ localStorage.setItem("sindics-fisc-visto", hojeF()); }catch(_){} }
  $("fiscOverlay").hidden = true; modoCobranca = false;
  try{ if (location.search.includes("fiscalizacao")) history.replaceState(null, "", location.pathname); }catch(_){}
};
const pendentesBloqueio = () => F.itens.filter(i => i.nivel === "critico" && devido(i) && !respondidoHoje(i));
const bloqueado = () => modoCobranca && pendentesBloqueio().length > 0;

function desenhar(){
  const box = $("fiscLista"); box.innerHTML = "";
  const lista = modoCobranca ? F.itens.filter(i => devido(i) && !respondidoHoje(i)) : F.itens;
  const souSindico = PERFIL?.papel !== "gestor";
  $("fiscTitulo").textContent = modoCobranca ? "Cobrança do dia" : "Fiscalização";
  const bl = pendentesBloqueio().length;
  $("fiscIntro").textContent = modoCobranca
    ? (bl ? `Há ${bl} pendência${bl > 1 ? "s" : ""} crítica${bl > 1 ? "s" : ""}. Para continuar, resolva ou informe a nova previsão com a justificativa de cada uma.` : "A cada 5 dias o SINDICS cobra o que ainda está em aberto. Resolva ou informe a previsão.")
    : (souSindico ? "Tudo o que está em aberto nos seus condomínios, com o responsável, o prazo e o histórico de cobranças." : "O que está em aberto nos condomínios que você acompanha. Enquanto não for resolvido, o SINDICS continua cobrando a cada 5 dias.");
  $("fiscFechar").hidden = bloqueado();
  $("fiscTodos").hidden = !modoCobranca || bloqueado();
  if (!lista.length){ box.append(mk("p", "fisc-vazio", modoCobranca ? "Nada mais para responder hoje. Obrigado!" : "Nenhuma pendência. Tudo em dia ✓")); return; }
  lista.forEach(i => box.append(cartao(i, souSindico)));
}

function cartao(i, souSindico){
  const c = mk("div", "fisc-item " + i.nivel);
  const top = mk("div", "fisc-top");
  top.append(mk("span", "fisc-tag " + i.nivel, NIV[i.nivel].rot), mk("span", "fisc-orig", ORIG[i.origem] || ""), mk("span", "fisc-cond", nomeC(i.condominio_id)));
  const dias = diasDe(i.aberto_em);
  const info = [`Prazo ${dBR(i.prazo)}`, `em aberto há ${dias} dia${dias === 1 ? "" : "s"}`, `${i.cobrancas} cobrança${i.cobrancas === 1 ? "" : "s"}`];
  if (souSindico) info.push(`responsável: ${i.responsavel_nome || "—"}`);
  c.append(top, mk("p", "fisc-tit", i.titulo), mk("p", "fisc-det", i.detalhe), mk("small", "fisc-info", info.join(" · ")));
  if (i.previsao || i.justificativa) c.append(mk("small", "fisc-just", `Previsão ${dBR(i.previsao)}${i.justificativa ? ` — “${i.justificativa}”` : ""}${i.respondido_por ? ` (${i.respondido_por})` : ""}`));
  const ac = mk("div", "fisc-acoes"), msg = mk("small", "fisc-msg");
  const bRes = mk("button", "primary", "Resolver agora"); bRes.type = "button";
  const bAnd = mk("button", "", "Em andamento"); bAnd.type = "button";
  bRes.onclick = async () => {
    bRes.disabled = true;
    try{ await sb.rpc("fiscalizacao_responder", { p_id: i.id, p_acao: "resolvendo", p_previsao: null, p_justificativa: null }); }catch(_){}
    i.respondido_em = new Date().toISOString();
    modoCobranca = false; $("fiscOverlay").hidden = true;
    irParaSolucao(i).catch(err => { hintEl.textContent = err.message; });
  };
  bAnd.onclick = () => {
    ac.hidden = true;
    const f = mk("div", "fisc-form");
    const d = document.createElement("input"); d.type = "date"; d.min = hojeF(); d.value = i.previsao && i.previsao >= hojeF() ? i.previsao : "";
    const t = document.createElement("textarea"); t.rows = 2; t.maxLength = 500; t.placeholder = "O que já foi feito e por que ainda não resolveu (ex.: orçamento pedido a 2 empresas, técnico vem na sexta)";
    const ok = mk("button", "primary", "Salvar previsão"); ok.type = "button";
    const lb = mk("label", "", "Nova previsão para resolver");
    ok.onclick = async () => {
      ok.disabled = true; msg.textContent = "";
      const { data, error } = await sb.rpc("fiscalizacao_responder", { p_id: i.id, p_acao: "andamento", p_previsao: d.value || null, p_justificativa: t.value });
      if (error){ msg.textContent = (error.message || "").replace(/^.*?:\s*/, ""); msg.classList.add("err"); ok.disabled = false; return; }
      Object.assign(i, { previsao: d.value, justificativa: t.value.trim(), respondido_em: new Date().toISOString(), cobrar_em: data?.proxima_cobranca || i.cobrar_em, cobrancas: i.cobrancas + 1 });
      msg.classList.remove("err"); msg.textContent = `Registrado. Próxima cobrança em ${dBR(i.cobrar_em)}.`;
      setTimeout(() => { desenhar(); pintar(); }, 900);
    };
    f.append(lb, d, t, ok); c.insertBefore(f, msg); d.focus();
  };
  ac.append(bRes, bAnd); c.append(ac, msg);
  return c;
}

async function irParaSolucao(i){
  const nome = nomeC(i.condominio_id);
  if (i.origem === "documento" || i.origem === "documento_faltante") return abrirDocumentacao(nome);
  if (i.origem === "operacao") return abrirOperacao(nome);
  if (i.origem === "combinado") return abrirMemoria();
  if (i.chave === "ges:orcamento" && window.Gestao) return Gestao.abrir(nome);
  if ((i.origem === "contrato" || i.origem === "raiox") && window.RaioX) return RaioX.abrir(nome);
  return abrirCondominios();
}

$("fiscBar").addEventListener("click", () => F.abrir(false));
$("fiscBtn").addEventListener("click", () => F.carregar(false).then(() => F.abrir(false)));
$("fiscFechar").addEventListener("click", F.fechar);
$("fiscTodos").addEventListener("click", () => { modoCobranca = false; desenhar(); $("fiscFechar").hidden = false; });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("fiscOverlay").hidden) F.fechar(); });
setInterval(() => { if (typeof PERFIL !== "undefined" && PERFIL && !document.hidden) F.carregar(false); }, 30 * 60 * 1000);
})();
(function(){ const F = window.Fiscal;
/* o login pode terminar antes deste arquivo carregar: espera os condomínios aparecerem e carrega uma vez */
F.carregou = false;
const _carregarOrig = F.carregar;
F.carregar = function(...a){ F.carregou = true; return _carregarOrig.apply(this, a); };
(function esperar(n){
  if (F.carregou) return;
  if (typeof PERFIL !== "undefined" && PERFIL && (PERFIL.condominios || []).length){ F.carregar(); return; }
  if (n < 60) setTimeout(() => esperar(n + 1), 500);
})(0);
})();
