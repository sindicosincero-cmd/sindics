/* ======================= GESTÃO E ORÇAMENTO (fases 2 e 3) =======================
   Previsão orçamentária do condomínio ligada aos índices de reajuste (Banco Central),
   projeção da taxa condominial e calendário legal automático.
   Usa funções globais do app.js: $, sb, PERFIL, sgs, br, dataBR, hojeISO, acharCondominio, souGestor, extrairTextoPDF. */
(function(){
const G = {};
window.Gestao = G;

const CAT = {
  pessoal:       { nome: "Pessoal (salários)",         idx: "dissidio" },
  encargos:      { nome: "Encargos e benefícios",      idx: "dissidio" },
  contratos:     { nome: "Contratos de serviços",      idx: "igpm" },
  manutencao:    { nome: "Manutenção e conservação",   idx: "ipca" },
  agua:          { nome: "Água e esgoto",              idx: "agua" },
  energia:       { nome: "Energia elétrica",           idx: "energia" },
  gas:           { nome: "Gás",                        idx: "ipca" },
  seguro:        { nome: "Seguro",                     idx: "ipca" },
  administracao: { nome: "Administração",              idx: "igpm" },
  consumo:       { nome: "Materiais de consumo",       idx: "ipca" },
  juridico:      { nome: "Jurídico, contábil e bancário", idx: "ipca" },
  outros:        { nome: "Outras despesas",            idx: "ipca" },
};
const IDX = { ipca: "IPCA", igpm: "IGP-M", inpc: "INPC", incc: "INCC", dissidio: "Dissídio", agua: "Tarifa de água", energia: "Tarifa de energia", fixo: "Sem reajuste" };
const REGRAS = [
  ["encargos", /\b(inss|fgts|pis\b|vale.?transporte|vale.?refei|vale.?alimenta|cesta b|plano de sa[uú]de|benef[ií]cio|encargo|rescis|contribui[cç][aã]o sindical|pcmso|aso\b|seguro de vida)/i],
  ["pessoal", /(sal[aá]rio|folha|ordenado|porteir|zelador|faxineir|vigia|funcion[aá]ri|f[eé]rias|13[ºo°]?\s*sal|d[eé]cimo|hora.?extra|adicional noturno)/i],
  ["agua", /(\b[aá]gua\b|sabesp|esgoto|saneamento)/i],
  ["energia", /(energia|\bluz\b|enel|eletropaulo|cpfl|light\b|cemig|copel|celesc|el[eé]trica)/i],
  ["gas", /(\bg[aá]s\b|comg[aá]s)/i],
  ["seguro", /seguro/i],
  ["juridico", /(jur[ií]dic|advoga|cont[aá]b|contador|auditoria|cart[oó]rio|banc[aá]ri|tarifa banc|boleto|despesas? banc)/i],
  ["administracao", /(administra|honor[aá]ri|s[ií]ndic|pr[oó].?labore)/i],
  ["contratos", /(terceiriz|portaria|limpeza terceir|seguran[cç]a|monitoramento|elevador|bomba|jardinag|piscin|desinsetiz|dedetiz|contrato|cftv|interfone|software|sistema|internet|telefone|manuten[cç][aã]o preventiva)/i],
  ["manutencao", /(manuten|conserto|reparo|pintura|obra|conserva|impermeabiliza)/i],
  ["consumo", /(material|produto|l[aâ]mpada|uniforme|escrit[oó]rio|consumo|limpeza)/i],
];
const PULAR = /(\btotal|subtotal|receita|arrecada|saldo|fundo de reserva|inadimpl|taxa condominial|rateio|previs[aã]o or[cç]ament|valor por unidade|fra[cç][aã]o ideal)/i;

let estado = { cond: null, orc: null, itens: [], I: null, carregando: false };
const brl = v => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = v => (v == null || isNaN(v) ? "—" : (v >= 0 ? "+" : "") + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%");
const el = (tag, attrs = {}, ...filhos) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)){ if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v); } filhos.flat().forEach(f => f != null && e.append(f)); return e; };
const addMeses = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1 + n, Math.min(d, 28))); return x.toISOString().slice(0, 10); };
const addDias = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/* ---------- Classificação e leitura de valores ---------- */
function classificar(desc){ for (const [cat, re] of REGRAS) if (re.test(desc)) return cat; return "outros"; }
G.classificar = classificar;
function lerValor(s){
  const t = String(s).replace(/R\$\s*/g, "").trim();
  if (/^-?\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t) || /^-?\d+,\d{1,2}$/.test(t)) return parseFloat(t.replace(/\./g, "").replace(",", "."));
  if (/^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) return parseFloat(t.replace(/,/g, ""));
  if (/^-?\d+(\.\d{1,2})?$/.test(t)) return parseFloat(t);
  return NaN;
}
/* Lê linhas de texto (PDF, planilha colada ou CSV) e devolve itens { descricao, categoria, valor } */
G.lerLinhas = function(texto, anual){
  const itens = []; let fundo = null;
  const DIN = /(?:R\$\s*)?-?(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})(?!\d)/g;
  for (let linha of String(texto).split(/\r?\n/)){
    linha = linha.replace(/\[Página \d+\]/g, "").trim(); if (!linha) continue;
    const fr = /fundo de reserva[^\d%]*(\d{1,2}(?:[.,]\d+)?)\s*%/i.exec(linha); if (fr) fundo = parseFloat(fr[1].replace(",", "."));
    if (PULAR.test(linha)) continue;
    const cels = linha.split(/\t|;/);
    let desc, valor;
    if (cels.length > 1){
      const nums = cels.map(c => lerValor(c)).map((v, i) => [v, i]).filter(([v]) => !isNaN(v));
      const txt = cels.find(c => /[A-Za-zÀ-ú]{3,}/.test(c) && isNaN(lerValor(c)));
      if (!nums.length || !txt) continue;
      desc = txt; valor = nums[nums.length - 1][0];
    } else {
      const ms = [...linha.matchAll(DIN)]; if (!ms.length) continue;
      valor = lerValor(ms[ms.length - 1][0]);
      desc = linha.slice(0, ms[0].index);
    }
    desc = desc.replace(/^[\s\d.)\-–—:•*]+/, "").replace(/[\s.:–—-]+$/, "").replace(/\s{2,}/g, " ").trim();
    if (desc.length < 3 || isNaN(valor) || valor <= 0) continue;
    if (anual) valor = valor / 12;
    itens.push({ descricao: desc.slice(0, 160), categoria: classificar(desc), valor: Math.round(valor * 100) / 100 });
  }
  return { itens: itens.slice(0, 200), fundo };
};

/* ---------- Índices do Banco Central (acumulado em 12 meses) ---------- */
let cacheIdx = null;
G.indices = async function(){
  if (cacheIdx && Date.now() - cacheIdx.t < 3600e3) return cacheIdx.v;
  const acum = d => (d.reduce((a, x) => a * (1 + Number(x.valor) / 100), 1) - 1) * 100;
  const pega = async (cod, n, fn) => { try{ const d = await sgs(cod, n); return { v: fn(d), ref: d[d.length - 1].data }; }catch(_){ return { v: null, ref: null }; } };
  const [ipca, igpm, inpc, incc] = await Promise.all([
    pega(13522, 1, d => Number(d[0].valor)), pega(189, 12, acum), pega(188, 12, acum), pega(192, 12, acum)
  ]);
  const v = { ipca: ipca.v, igpm: igpm.v, inpc: inpc.v, incc: incc.v, ref: { ipca: ipca.ref, igpm: igpm.ref, inpc: inpc.ref, incc: incc.ref } };
  cacheIdx = { t: Date.now(), v }; return v;
};

/* ---------- Projeção ---------- */
G.projetar = function(orc, cond, I){
  const P = orc.premissas || {};
  const taxaDe = k => {
    const m = { ipca: I.ipca, igpm: I.igpm, inpc: I.inpc, incc: I.incc, fixo: 0,
      dissidio: P.dissidio != null && P.dissidio !== "" ? Number(P.dissidio) : I.inpc,
      agua: P.agua != null && P.agua !== "" ? Number(P.agua) : I.ipca,
      energia: P.energia != null && P.energia !== "" ? Number(P.energia) : I.ipca };
    return m[k] == null || isNaN(m[k]) ? 0 : Number(m[k]);
  };
  const porCat = {}; let atual = 0, nova = 0;
  for (const it of orc.itens || []){
    const idx = it.indice || CAT[it.categoria]?.idx || "ipca";
    const r = taxaDe(idx), v = Number(it.valor) || 0, n = v * (1 + r / 100);
    const c = porCat[it.categoria] = porCat[it.categoria] || { atual: 0, nova: 0, indices: new Set() };
    c.atual += v; c.nova += n; c.indices.add(IDX[idx] + " " + pct(r)); atual += v; nova += n;
  }
  const fr = Number(orc.fundo_reserva_pct) || 0, unid = Number(cond.unidades) || 0;
  const arrecAtual = atual * (1 + fr / 100), arrecNova = nova * (1 + fr / 100);
  const taxaNec = unid ? arrecNova / unid : null, taxaHoje = orc.taxa_media ? Number(orc.taxa_media) : null;
  const receitaHoje = taxaHoje && unid ? taxaHoje * unid : null;
  return {
    porCat, atual, nova, variacao: atual ? (nova / atual - 1) * 100 : 0, fundoPct: fr, arrecAtual, arrecNova, unidades: unid,
    taxaNecessariaHoje: unid ? arrecAtual / unid : null, taxaNecessaria: taxaNec, taxaHoje, receitaHoje,
    saldoHoje: receitaHoje != null ? receitaHoje - arrecAtual : null,
    reajusteTaxa: taxaHoje && taxaNec ? (taxaNec / taxaHoje - 1) * 100 : null,
    premissas: { dissidio: taxaDe("dissidio"), agua: taxaDe("agua"), energia: taxaDe("energia") }
  };
};

/* ---------- Calendário legal ---------- */
G.calendario = function(cond, orc){
  const hoje = hojeISO(), it = [];
  if (cond.ata_data){
    let d = addMeses(cond.ata_data, 12); while (d < hoje) d = addMeses(d, 12);
    it.push({ tipo: "ago", data: d, titulo: "Assembleia geral ordinária anual", base: "Código Civil, art. 1.350: aprovar contas, orçamento e, se for o caso, eleger o síndico. Data estimada a partir da última assembleia; convoque com a antecedência da Convenção." });
  }
  if (cond.mandato_fim){
    const conv = addDias(cond.mandato_fim, -45);
    if (conv >= hoje) it.push({ tipo: "eleicao", data: conv, titulo: "Convocar assembleia para eleição do síndico", base: "O mandato termina em " + dataBR(cond.mandato_fim) + " (Código Civil, art. 1.347: até 2 anos, renovável)." });
    if (cond.mandato_fim >= hoje) it.push({ tipo: "mandato", data: cond.mandato_fim, titulo: "Fim do mandato do síndico", base: "Código Civil, art. 1.347." });
  }
  if (cond.dissidio_mes){
    const ano = Number(hoje.slice(0, 4)), mes = String(cond.dissidio_mes).padStart(2, "0");
    let d = `${ano}-${mes}-01`; if (d < hoje) d = `${ano + 1}-${mes}-01`;
    it.push({ tipo: "dissidio", data: d, titulo: "Data-base dos funcionários (dissídio)", base: "Aplicar o reajuste da convenção coletiva da categoria. Confira o percentual no sindicato antes de fechar a folha." });
  }
  if (orc && orc.vigencia_inicio){
    const fim = orc.vigencia_fim || addDias(addMeses(orc.vigencia_inicio, 12), -1);
    const prep = addDias(fim, -60);
    if (prep >= hoje) it.push({ tipo: "orcamento", data: prep, titulo: "Preparar a nova previsão orçamentária", base: "A previsão atual vale até " + dataBR(fim) + ". Leve a proposta à assembleia antes do fim da vigência." });
  }
  return it.sort((a, b) => a.data.localeCompare(b.data));
};
G.agendarCalendario = async function(cond, orc){
  const itens = G.calendario(cond, orc); if (!itens.length) return { criados: 0, existentes: 0 };
  const chaves = itens.map(x => `${x.tipo}:${cond.id}:${x.data}`);
  const { data: ja } = await sb.from("compromissos").select("chave").in("chave", chaves);
  const tem = new Set((ja || []).map(x => x.chave));
  const novos = itens.filter((x, i) => !tem.has(chaves[i])).map(x => {
    const ini = new Date(x.data + "T10:00:00-03:00"), fim = new Date(x.data + "T11:00:00-03:00");
    return { titulo: x.titulo, inicio: ini.toISOString(), fim: fim.toISOString(), condominio_id: cond.id, local: "", observacoes: x.base, lembrete_minutos: 10080, origem: "calendario_legal", chave: `${x.tipo}:${cond.id}:${x.data}` };
  });
  if (novos.length){ const { error } = await sb.from("compromissos").insert(novos); if (error) throw error; }
  if (typeof atualizarResumoTela === "function") atualizarResumoTela();
  return { criados: novos.length, existentes: itens.length - novos.length, itens };
};

/* ---------- Dados ---------- */
G.carregar = async function(condId){
  const [{ data: c, error: e1 }, { data: o }] = await Promise.all([
    sb.from("condominios").select("id, sindico_id, nome, cnpj, endereco, cidade, unidades, convencao_status, regulamento_status, ata_status, ata_data, mandato_fim, dissidio_mes").eq("id", condId).maybeSingle(),
    sb.from("orcamentos").select("*").eq("condominio_id", condId).maybeSingle()
  ]);
  if (e1 || !c) throw new Error("Condomínio não encontrado.");
  return { cond: c, orc: o || null };
};
G.status = function(cond, orc){
  const docs = [
    ["Regulamento Interno", cond.regulamento_status === "pronto"],
    ["Convenção", cond.convencao_status === "pronto"],
    ["Ata da eleição do síndico", cond.ata_status === "pronto"],
    ["Previsão orçamentária", !!(orc && (orc.itens || []).length)],
  ];
  return { docs, liberado: docs.slice(1).every(d => d[1]), faltam: docs.filter(d => !d[1]).map(d => d[0]) };
};
/* Resumo para a voz */
G.resumo = async function(cond){
  const { cond: c, orc } = await G.carregar(cond.id);
  const st = G.status(c, orc);
  if (!orc || !(orc.itens || []).length) return { condominio: c.nome, modulo_liberado: false, faltam: st.faltam, mensagem: "Ainda não há previsão orçamentária cadastrada. Ela é enviada em Condomínios › Editar, no campo Previsão orçamentária, ou em Menu › Gestão e Orçamento (o SINDICS lê o PDF ou a planilha)." };
  const I = await G.indices(), p = G.projetar(orc, c, I);
  const cats = Object.entries(p.porCat).sort((a, b) => b[1].atual - a[1].atual).slice(0, 6)
    .map(([k, v]) => ({ grupo: CAT[k]?.nome || k, mensal_atual: brl(v.atual), mensal_projetado: brl(v.nova), peso: Math.round(v.atual / p.atual * 100) + "%", indices: [...v.indices].join(", ") }));
  return {
    condominio: c.nome, modulo_liberado: st.liberado, faltam: st.faltam,
    vigencia: dataBR(orc.vigencia_inicio) + (orc.vigencia_fim ? " a " + dataBR(orc.vigencia_fim) : ""),
    despesa_mensal_atual: brl(p.atual), despesa_mensal_projetada_12m: brl(p.nova), variacao_despesa: pct(p.variacao),
    fundo_de_reserva: p.fundoPct + "%", apartamentos: p.unidades,
    taxa_media_atual: p.taxaHoje ? brl(p.taxaHoje) : "não informada",
    taxa_media_necessaria_hoje: p.taxaNecessariaHoje ? brl(p.taxaNecessariaHoje) : null,
    taxa_media_necessaria_12m: p.taxaNecessaria ? brl(p.taxaNecessaria) : null,
    reajuste_necessario_da_taxa: p.reajusteTaxa != null ? pct(p.reajusteTaxa) : "informe a taxa média atual para calcular",
    saldo_mensal_hoje: p.saldoHoje != null ? (p.saldoHoje < 0 ? "déficit de " : "sobra de ") + brl(Math.abs(p.saldoHoje)) + " por mês" : null,
    indices_12m: { IPCA: pct(I.ipca), "IGP-M": pct(I.igpm), INPC: pct(I.inpc), INCC: pct(I.incc), referencia: I.ref.ipca },
    premissas: { dissidio: pct(p.premissas.dissidio), agua: pct(p.premissas.agua), energia: pct(p.premissas.energia) },
    maiores_grupos: cats,
    calendario_legal: G.calendario(c, orc).map(x => ({ data: dataBR(x.data), o_que: x.titulo })),
    observacao: "Estimativa: usa a variação dos últimos 12 meses de cada índice como referência para os próximos 12. Confirme o dissídio no sindicato e os reajustes de contrato nas cláusulas."
  };
};

/* ---------- Tela ---------- */
const ov = () => $("gesOverlay"), folha = () => $("gesFolha");
G.abrir = async function(nomeCond){
  if (!PERFIL) throw new Error("Usuário não está logado.");
  const cs = PERFIL.condominios || []; if (!cs.length) throw new Error("Cadastre um condomínio antes.");
  const sel = $("gesCond"); sel.innerHTML = ""; cs.forEach(c => sel.append(el("option", { value: c.id, text: c.nome })));
  const alvo = nomeCond ? acharCondominio(nomeCond) : (estado.cond && cs.find(c => c.id === estado.cond.id)) || cs[0];
  sel.value = alvo.id;
  if (typeof fecharMenu === "function") fecharMenu();
  ov().hidden = false; ov().scrollTop = 0;
  await G.render(alvo.id);
  return alvo;
};
G.fechar = () => { ov().hidden = true; };

G.render = async function(condId){
  const f = folha(); f.innerHTML = ""; f.append(el("p", { class: "ges-carregando", text: "Carregando…" }));
  const { cond, orc } = await G.carregar(condId);
  estado.cond = cond; estado.orc = orc;
  estado.itens = (orc?.itens || []).map(x => ({ ...x }));
  estado.meta = { vigencia_inicio: orc?.vigencia_inicio || hojeISO().slice(0, 8) + "01", vigencia_fim: orc?.vigencia_fim || "", taxa_media: orc?.taxa_media ?? "", fundo_reserva_pct: orc?.fundo_reserva_pct ?? 10, premissas: { ...(orc?.premissas || {}) } };
  estado.I = await G.indices();
  desenhar();
};

function desenhar(){
  const f = folha(), { cond } = estado; f.innerHTML = "";
  const st = G.status(cond, estado.itens.length ? { itens: estado.itens } : estado.orc);
  f.append(el("header", {}, el("p", { class: "com-cond", text: cond.nome }), el("p", { class: "dados", text: [cond.cnpj ? "CNPJ " + mascaraCnpj(cond.cnpj) : "", cond.endereco, cond.cidade, cond.unidades + " apartamentos"].filter(Boolean).join(" · ") })));
  f.append(el("p", { class: "tipo", text: "Gestão e Orçamento" }), el("h1", { text: "Previsão orçamentária, índices e calendário legal" }));

  // 1) documentos de gestão
  const docs = el("div", { class: "ges-docs" }, st.docs.map(([n, ok]) => el("span", { class: ok ? "ok" : "falta", text: (ok ? "✓ " : "○ ") + n })));
  f.append(el("h3", { text: "Documentos de gestão" }), docs,
    el("p", { class: "ges-nota", text: st.liberado ? "Módulo completo: Convenção, ata da eleição e previsão orçamentária cadastradas." : "Para a análise completa faltam: " + st.faltam.join(", ") + ". Convenção, ata da eleição e previsão orçamentária são enviadas em Condomínios › Editar; a previsão também pode ser enviada aqui embaixo." }));

  // 2) previsão orçamentária (edição)
  const m = estado.meta, ed = true;
  const campo = (rot, inp) => el("label", { class: "ges-campo" }, el("span", { text: rot }), inp);
  const iIni = el("input", { type: "date", value: m.vigencia_inicio, onchange: e => { m.vigencia_inicio = e.target.value; recalcular(); } });
  const iFim = el("input", { type: "date", value: m.vigencia_fim || "", onchange: e => { m.vigencia_fim = e.target.value; recalcular(); } });
  const iTaxa = el("input", { type: "number", min: "0", step: "0.01", value: m.taxa_media, placeholder: "ex.: 650,00", onchange: e => { m.taxa_media = e.target.value; recalcular(); } });
  const iFr = el("input", { type: "number", min: "0", max: "50", step: "0.5", value: m.fundo_reserva_pct, onchange: e => { m.fundo_reserva_pct = e.target.value; recalcular(); } });
  f.append(el("h3", { text: "Previsão orçamentária (despesas mensais)" }),
    el("div", { class: "ges-meta" }, campo("Vigência: início", iIni), campo("Vigência: fim", iFim), campo("Taxa condominial média atual (R$ por apto)", iTaxa), campo("Fundo de reserva (% sobre as despesas)", iFr)));

  // importação
  const fArq = el("input", { type: "file", accept: ".pdf,.csv,.txt,application/pdf,text/csv,text/plain", class: "ges-arq" });
  const cAnual = el("input", { type: "checkbox" });
  const taCola = el("textarea", { rows: "3", placeholder: "Ou cole aqui as linhas copiadas da planilha (descrição e valor)…" });
  const msgImp = el("p", { class: "ges-msg", role: "status" });
  const bLer = el("button", { type: "button", class: "primary", text: "Ler e preencher", onclick: async () => {
    bLer.disabled = true; msgImp.textContent = "Lendo…";
    try{
      const n = await lerParaRevisao(fArq.files[0], taCola.value, cAnual.checked);
      if (!n){ msgImp.textContent = "Não encontrei linhas com descrição e valor. Confira o arquivo ou cole as linhas da planilha."; bLer.disabled = false; return; }
    }catch(err){ msgImp.textContent = err.message || String(err); }
    bLer.disabled = false;
  }});
  if (ed) f.append(el("div", { class: "ges-import ges-nao-imprimir" },
    el("p", { class: "ges-nota", text: "Envie a previsão orçamentária (PDF ou CSV) ou cole as linhas da planilha. O SINDICS separa as despesas por grupo e você confere antes de salvar." }),
    fArq, taCola, el("label", { class: "ges-check" }, cAnual, el("span", { text: "Os valores do arquivo são anuais (dividir por 12)" })), bLer, msgImp));

  // tabela de itens
  const tb = el("tbody");
  estado.itens.forEach((it, i) => {
    const sc = el("select", { onchange: e => { it.categoria = e.target.value; recalcular(); } }, Object.entries(CAT).map(([k, v]) => el("option", { value: k, text: v.nome })));
    sc.value = it.categoria;
    const si = el("select", { onchange: e => { it.indice = e.target.value || undefined; recalcular(); } }, el("option", { value: "", text: "Padrão do grupo" }), Object.entries(IDX).map(([k, v]) => el("option", { value: k, text: v })));
    si.value = it.indice || "";
    tb.append(el("tr", {},
      el("td", {}, el("input", { value: it.descricao, maxlength: "160", onchange: e => { it.descricao = e.target.value; } })),
      el("td", {}, sc), el("td", {}, si),
      el("td", { class: "num" }, el("input", { type: "number", min: "0", step: "0.01", value: it.valor, onchange: e => { it.valor = Number(e.target.value) || 0; recalcular(); } })),
      el("td", { class: "ges-nao-imprimir" }, ed ? el("button", { type: "button", class: "x", title: "Remover", text: "×", onclick: () => { estado.itens.splice(i, 1); desenhar(); } }) : null)));
  });
  f.append(el("table", { class: "ges-tab" }, el("thead", {}, el("tr", {}, el("th", { text: "Despesa" }), el("th", { text: "Grupo" }), el("th", { text: "Índice" }), el("th", { class: "num", text: "Valor mensal" }), el("th", { class: "ges-nao-imprimir" }))), tb));
  if (ed) f.append(el("div", { class: "ges-acoes ges-nao-imprimir" },
    el("button", { type: "button", text: "+ Adicionar despesa", onclick: () => { estado.itens.push({ descricao: "Nova despesa", categoria: "outros", valor: 0 }); desenhar(); } }),
    el("button", { type: "button", class: "primary", text: "Salvar previsão", onclick: salvar }),
    el("p", { class: "ges-msg", id: "gesMsgSalvar", role: "status" })));

  // 3) premissas e projeção
  const I = estado.I, P = m.premissas;
  const prem = (rot, k, pad) => el("label", { class: "ges-campo" }, el("span", { text: rot }),
    el("input", { type: "number", step: "0.1", value: P[k] ?? "", placeholder: pad == null ? "—" : String(pad.toFixed(1)).replace(".", ","), onchange: e => { P[k] = e.target.value === "" ? null : Number(e.target.value); recalcular(); } }));
  f.append(el("h3", { text: "Índices de reajuste (últimos 12 meses, Banco Central)" }),
    el("div", { class: "ges-idx" }, ["ipca", "igpm", "inpc", "incc"].map(k => el("div", {}, el("b", { text: pct(I[k]) }), el("span", { text: IDX[k] + (I.ref[k] ? " · até " + I.ref[k].slice(3) : "") })))),
    el("div", { class: "ges-meta" }, prem("Dissídio esperado (%) — vazio usa o INPC", "dissidio", I.inpc), prem("Reajuste da água (%) — vazio usa o IPCA", "agua", I.ipca), prem("Reajuste da energia (%) — vazio usa o IPCA", "energia", I.ipca)),
    el("div", { id: "gesProj" }));

  // 4) calendário legal
  f.append(el("h3", { text: "Calendário legal" }), el("div", { id: "gesCal" }));
  f.append(el("p", { class: "rel-nota", text: "Estimativa de apoio à gestão: usa a variação dos últimos 12 meses de cada índice como referência para os próximos 12 meses. Confirme o percentual do dissídio no sindicato da categoria, os reajustes nas cláusulas de cada contrato e leve os números à contabilidade antes da assembleia. Gerado pelo SINDICS em " + dataBR(hojeISO()) + "." }));
  recalcular();
}

/* Lê o arquivo (ou o texto colado), preenche a tabela para conferência e devolve quantas despesas achou */
async function lerParaRevisao(arq, colado, anual){
  let texto = colado || "", origem = "planilha";
  if (arq){
    if (/\.pdf$/i.test(arq.name) || arq.type === "application/pdf"){ texto = (await extrairTextoPDF(arq, "Previsão orçamentária")).texto; origem = "pdf"; $("cProg").hidden = true; }
    else texto = await arq.text();
  }
  const r = G.lerLinhas(texto, anual);
  if (!r.itens.length) return 0;
  if (arq) estado.arquivo = arq.name;
  estado.itens = r.itens; estado.origem = origem;
  if (r.fundo != null) estado.meta.fundo_reserva_pct = r.fundo;
  desenhar(); folha().querySelector(".ges-msg").textContent = `${r.itens.length} despesas lidas. Confira a descrição, o grupo e o valor de cada uma e toque em Salvar previsão.`;
  return r.itens.length;
}
/* Chamado pelo cadastro do condomínio: abre a Gestão e Orçamento já com o arquivo lido */
G.importarArquivo = async function(condId, arq, anual){
  const cs = PERFIL?.condominios || [];
  const sel = $("gesCond"); sel.innerHTML = "";
  (cs.some(c => c.id === condId) ? cs : [...cs, { id: condId, nome: "Condomínio" }]).forEach(c => sel.append(el("option", { value: c.id, text: c.nome })));
  sel.value = condId;
  DRAWERS.forEach(id => $(id).classList.remove("open"));
  ov().hidden = false; ov().scrollTop = 0;
  await G.render(condId);
  const n = await lerParaRevisao(arq, "", anual);
  if (!n) throw new Error("não encontrei linhas com descrição e valor no arquivo. Confira se é a previsão orçamentária ou cole as linhas da planilha na tela que abriu.");
  const tab = folha().querySelector(".ges-tab"); if (tab){ const r = tab.getBoundingClientRect(), o = ov(); o.scrollTop += r.top - o.getBoundingClientRect().top - 140; }
  return n;
};

function recalcular(){
  const { cond, I } = estado, m = estado.meta;
  const orc = { itens: estado.itens, fundo_reserva_pct: Number(m.fundo_reserva_pct) || 0, taxa_media: m.taxa_media === "" ? null : Number(m.taxa_media), premissas: m.premissas, vigencia_inicio: m.vigencia_inicio, vigencia_fim: m.vigencia_fim || null };
  const box = $("gesProj"); if (!box) return; box.innerHTML = "";
  if (!estado.itens.length){ box.append(el("p", { class: "ges-nota", text: "Cadastre a previsão orçamentária para ver a projeção." })); }
  else {
    const p = G.projetar(orc, cond, I);
    box.append(el("div", { class: "rel-kpis" },
      kpi(brl(p.atual), "despesa mensal hoje"), kpi(brl(p.nova), "despesa mensal em 12 meses (" + pct(p.variacao) + ")"),
      kpi(p.taxaNecessaria ? brl(p.taxaNecessaria) : "—", "taxa média necessária em 12 meses, com fundo de " + p.fundoPct + "%"),
      kpi(p.reajusteTaxa != null ? pct(p.reajusteTaxa) : "—", p.reajusteTaxa != null ? "reajuste necessário da taxa (hoje " + brl(p.taxaHoje) + ")" : "informe a taxa média atual")));
    if (p.saldoHoje != null) box.append(el("p", { class: p.saldoHoje < 0 ? "ges-alerta" : "ges-nota", text: p.saldoHoje < 0
      ? `Atenção: com a taxa atual, a arrecadação (${brl(p.receitaHoje)}) já fica ${brl(-p.saldoHoje)} abaixo das despesas mais o fundo de reserva (${brl(p.arrecAtual)}) por mês, sem contar inadimplência.`
      : `Hoje a arrecadação (${brl(p.receitaHoje)}) cobre as despesas mais o fundo de reserva (${brl(p.arrecAtual)}) com sobra de ${brl(p.saldoHoje)} por mês, sem contar inadimplência.` }));
    const linhas = Object.entries(p.porCat).sort((a, b) => b[1].atual - a[1].atual);
    box.append(el("table", { class: "ges-tab ges-proj" },
      el("thead", {}, el("tr", {}, el("th", { text: "Grupo" }), el("th", { text: "Índice usado" }), el("th", { class: "num", text: "Hoje" }), el("th", { class: "num", text: "Peso" }), el("th", { class: "num", text: "Em 12 meses" }))),
      el("tbody", {}, linhas.map(([k, v]) => el("tr", {}, el("td", { text: CAT[k]?.nome || k }), el("td", { text: [...v.indices].join("; ") }), el("td", { class: "num", text: brl(v.atual) }), el("td", { class: "num", text: Math.round(v.atual / p.atual * 100) + "%" }), el("td", { class: "num", text: brl(v.nova) })))),
      el("tfoot", {}, el("tr", {}, el("td", { text: "Total de despesas" }), el("td"), el("td", { class: "num", text: brl(p.atual) }), el("td", { class: "num", text: "100%" }), el("td", { class: "num", text: brl(p.nova) })),
        el("tr", {}, el("td", { text: "Com fundo de reserva (" + p.fundoPct + "%)" }), el("td"), el("td", { class: "num", text: brl(p.arrecAtual) }), el("td"), el("td", { class: "num", text: brl(p.arrecNova) })))));
  }
  const cal = $("gesCal"); if (!cal) return; cal.innerHTML = "";
  const itens = G.calendario(cond, estado.itens.length ? orc : null);
  if (!itens.length) cal.append(el("p", { class: "ges-nota", text: "Informe em Condomínios › Editar a data da assembleia de eleição, o fim do mandato e o mês do dissídio para o SINDICS montar o calendário legal." }));
  else {
    cal.append(el("div", { class: "ges-cal" }, itens.map(x => el("div", { class: "rel-item" }, el("div", { class: "q", text: dataBR(x.data) }), el("div", {}, el("div", { class: "t", text: x.titulo }), el("div", { class: "m", text: x.base }))))));
    const msg = el("p", { class: "ges-msg", role: "status" });
    cal.append(el("div", { class: "ges-acoes ges-nao-imprimir" }, el("button", { type: "button", class: "primary", text: "Colocar na agenda com alarme", onclick: async e => {
      e.target.disabled = true;
      try{ const r = await G.agendarCalendario(cond, estado.itens.length ? orc : null); msg.textContent = r.criados ? `${r.criados} data(s) colocada(s) na agenda, com aviso 7 dias antes.${r.existentes ? " " + r.existentes + " já estavam lá." : ""}` : "Todas essas datas já estão na agenda."; }
      catch(err){ msg.textContent = err.message; }
      e.target.disabled = false; } }), msg));
  }
}
const kpi = (v, t) => el("div", { class: "rel-kpi" }, el("b", { text: v }), el("span", { text: t }));

async function salvar(){
  const msg = $("gesMsgSalvar"), m = estado.meta, cond = estado.cond;
  const itens = estado.itens.map(x => ({ descricao: String(x.descricao || "").trim().slice(0, 160), categoria: x.categoria, valor: Math.round((Number(x.valor) || 0) * 100) / 100, ...(x.indice ? { indice: x.indice } : {}) })).filter(x => x.descricao && x.valor > 0);
  if (!itens.length){ msg.textContent = "Inclua pelo menos uma despesa com valor."; return; }
  if (!m.vigencia_inicio){ msg.textContent = "Informe o início da vigência."; return; }
  msg.textContent = "Salvando…";
  const reg = { condominio_id: cond.id, vigencia_inicio: m.vigencia_inicio, vigencia_fim: m.vigencia_fim || null, taxa_media: m.taxa_media === "" || m.taxa_media == null ? null : Number(m.taxa_media),
    fundo_reserva_pct: Number(m.fundo_reserva_pct) || 0, itens, premissas: m.premissas || {}, origem: estado.origem || estado.orc?.origem || "manual", arquivo_nome: estado.arquivo || estado.orc?.arquivo_nome || null, sindico_id: cond.sindico_id };
  const { data, error } = await sb.from("orcamentos").upsert(reg, { onConflict: "condominio_id" }).select("*").single();
  if (error){ msg.textContent = error.message; return; }
  estado.orc = data; estado.itens = data.itens.map(x => ({ ...x }));
  msg.textContent = "Previsão salva ✓ O SINDICS já usa estes números nas conversas.";
  setTimeout(() => { desenhar(); const mm = $("gesMsgSalvar"); if (mm) mm.textContent = "Previsão salva ✓"; }, 900);
}

/* ---------- Eventos ---------- */
$("gesCond").addEventListener("change", e => G.render(e.target.value).catch(err => { folha().textContent = err.message; }));
$("gesFechar").addEventListener("click", G.fechar);
$("gesImprimir").addEventListener("click", () => { document.body.classList.add("imprimindo-ges"); window.print(); });
addEventListener("afterprint", () => document.body.classList.remove("imprimindo-ges"));
$("gestaoBtn").addEventListener("click", () => G.abrir().catch(err => { if (typeof hintEl !== "undefined"){ hintEl.textContent = err.message; } }));
})();
