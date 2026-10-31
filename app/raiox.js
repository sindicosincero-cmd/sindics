/* ======================= RAIO-X DO CONDOMÍNIO (fase 1) =======================
   Diagnóstico financeiro de entrada: prestações de contas (despesas por mês), receitas, saldos,
   inadimplência e contratos. Calcula os achados por frente, gera o relatório e o plano de ação
   (agenda + fiscalização). Lê a planilha modelo (.xlsx) sem bibliotecas externas.
   Usa do app.js: $, sb, PERFIL, br, dataBR, hojeISO, acharCondominio, mascaraCnpj, fecharMenu, DRAWERS. */
(function(){
const R = {};
window.RaioX = R;

const CAT = {
  pessoal: "Pessoal (salários)", encargos: "Encargos e benefícios", contratos: "Contratos de serviços",
  manutencao: "Manutenção e conservação", agua: "Água e esgoto", energia: "Energia elétrica", gas: "Gás",
  seguro: "Seguro", administracao: "Administração", consumo: "Materiais de consumo",
  juridico: "Jurídico, contábil e bancário", outros: "Outras despesas",
};
const IDX = { ipca: "IPCA", igpm: "IGP-M", inpc: "INPC", incc: "INCC", dissidio: "Dissídio", fixo: "Fixo", outro: "Outro" };
const FRENTES = [
  ["orcamento", "Orçado x realizado"], ["custos", "Estrutura de custos"], ["resultado", "Receitas e resultado"],
  ["inadimplencia", "Inadimplência"], ["caixa", "Caixa e fundos"], ["contratos", "Contratos"], ["alertas", "Sinais de alerta"],
];
const NIVEL = { critico: "Crítico", atencao: "Atenção", saudavel: "Saudável", sem_dados: "Sem dados" };
const PESO = { critico: 3, atencao: 2, saudavel: 1, sem_dados: 0 };

const brl = v => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl0 = v => "R$ " + Math.round(Number(v || 0)).toLocaleString("pt-BR");
const pctf = (v, s) => (v == null || !isFinite(v) ? "—" : (s && v > 0 ? "+" : "") + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%");
const el = (tag, attrs = {}, ...filhos) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)){ if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v); } filhos.flat().forEach(f => f != null && f !== false && e.append(f)); return e; };
const mesBR = m => { const [y, mm] = String(m).split("-"); return ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"][Number(mm) - 1] + "/" + y.slice(2); };
const soma = a => a.reduce((s, x) => s + (Number(x) || 0), 0);
const media = a => a.length ? soma(a) / a.length : 0;
const mediana = a => { const b = [...a].sort((x, y) => x - y); const n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : 0; };
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const addDias = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const dias = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
const classificar = d => (window.Gestao?.classificar ? Gestao.classificar(d) : "outros");

/* ---------- Leitor de .xlsx (zip + XML), sem bibliotecas ---------- */
async function inflar(bytes){
  const ds = new DecompressionStream("deflate-raw");
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}
async function lerZip(arrayBuffer){
  const u = new Uint8Array(arrayBuffer), dv = new DataView(arrayBuffer), arquivos = {};
  let fim = -1;
  for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50){ fim = i; break; }
  if (fim < 0) throw new Error("O arquivo não parece ser uma planilha .xlsx.");
  const total = dv.getUint16(fim + 10, true); let p = dv.getUint32(fim + 16, true);
  const dec = new TextDecoder();
  for (let k = 0; k < total; k++){
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const metodo = dv.getUint16(p + 10, true), tam = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), loc = dv.getUint32(p + 42, true);
    const nome = dec.decode(u.subarray(p + 46, p + 46 + nl));
    const lnl = dv.getUint16(loc + 26, true), lxl = dv.getUint16(loc + 28, true);
    const ini = loc + 30 + lnl + lxl, dados = u.subarray(ini, ini + tam);
    arquivos[nome] = { metodo, dados };
    p += 46 + nl + xl + cl;
  }
  return async nome => { const a = arquivos[nome]; if (!a) return null; return dec.decode(a.metodo === 8 ? await inflar(a.dados) : a.dados); };
}
const colIdx = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
R.lerXlsx = async function(arquivo){
  if (typeof DecompressionStream === "undefined") throw new Error("Este navegador não lê .xlsx. Atualize o navegador ou use o Google Chrome.");
  const ler = await lerZip(await arquivo.arrayBuffer());
  const xml = s => new DOMParser().parseFromString(s, "application/xml");
  const wb = xml(await ler("xl/workbook.xml") || "");
  const rels = xml(await ler("xl/_rels/workbook.xml.rels") || "");
  const alvo = {}; [...rels.getElementsByTagName("Relationship")].forEach(r => alvo[r.getAttribute("Id")] = r.getAttribute("Target"));
  const ss = await ler("xl/sharedStrings.xml");
  const strings = ss ? [...xml(ss).getElementsByTagName("si")].map(si => [...si.getElementsByTagName("t")].map(t => t.textContent).join("")) : [];
  const abas = {};
  for (const s of wb.getElementsByTagName("sheet")){
    const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    let t = alvo[rid] || ""; t = t.replace(/^\/?xl\//, ""); const txt = await ler("xl/" + t); if (!txt) continue;
    const linhas = [];
    for (const row of xml(txt).getElementsByTagName("row")){
      const lin = [];
      for (const c of row.getElementsByTagName("c")){
        const ref = c.getAttribute("r"), tipo = c.getAttribute("t"), v = c.getElementsByTagName("v")[0]?.textContent;
        let val;
        if (tipo === "s") val = strings[Number(v)] ?? "";
        else if (tipo === "inlineStr") val = [...c.getElementsByTagName("t")].map(x => x.textContent).join("");
        else if (tipo === "b") val = v === "1";
        else if (tipo === "str" || tipo === "e") val = v ?? "";
        else val = v == null || v === "" ? "" : Number(v);
        lin[ref ? colIdx(ref) : lin.length] = val;
      }
      linhas.push(lin);
    }
    abas[norm(s.getAttribute("name"))] = linhas;
  }
  return abas;
};

/* conversões de célula */
const num = v => { if (typeof v === "number") return v; const s = String(v ?? "").replace(/R\$\s*/g, "").trim(); if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(s) || /^-?\d+,\d+$/.test(s)) return parseFloat(s.replace(/\./g, "").replace(",", "."));
  const n = parseFloat(s); return isNaN(n) ? null : n; };
const serial = n => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
const data = v => { if (v == null || v === "") return null; if (typeof v === "number") return serial(v);
  const s = String(v).trim(); let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? m[0] : null; };
const mes = v => { if (v == null || v === "") return null; if (typeof v === "number") return v > 20000 ? serial(v).slice(0, 7) : null;
  const s = String(v).trim(); let m = /^(\d{4})-(\d{1,2})/.exec(s); if (m) return m[1] + "-" + m[2].padStart(2, "0");
  m = /^(\d{1,2})\/(\d{4})$/.exec(s); if (m) return m[2] + "-" + m[1].padStart(2, "0");
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); return m ? m[3] + "-" + m[2].padStart(2, "0") : null; };
const indice = v => { const s = norm(v).replace(/\s/g, ""); return { ipca: "ipca", igpm: "igpm", inpc: "inpc", incc: "incc", dissidio: "dissidio", fixo: "fixo", outro: "outro" }[s] || (s ? "outro" : null); };
const simnao = v => v === true || /^s/i.test(String(v || "").trim());

/* Planilha → { meses, contratos, avisos } */
R.interpretar = function(abas){
  const avisos = [], porMes = {};
  const pega = m => porMes[m] || (porMes[m] = { mes: m, despesas: {}, linhas: [] });
  const desp = abas["despesas"] || [], mensal = abas["mensal"] || [], ctr = abas["contratos"] || [];
  if (!desp.length && !mensal.length && !ctr.length) throw new Error("Não encontrei as abas Despesas, Mensal e Contratos. Use a planilha modelo do SINDICS.");
  desp.slice(1).forEach((l, i) => {
    const m = mes(l[0]), d = String(l[1] ?? "").trim(), v = num(l[2]);
    if (!m && !d && v == null) return;
    if (!m || !d || v == null){ avisos.push(`Despesas, linha ${i + 2}: falta mês (AAAA-MM), descrição ou valor.`); return; }
    if (v <= 0) return;
    const cat = classificar(d), o = pega(m);
    o.despesas[cat] = Math.round(((o.despesas[cat] || 0) + v) * 100) / 100;
    o.linhas.push({ d: d.slice(0, 120), v: Math.round(v * 100) / 100, c: cat });
  });
  mensal.slice(1).forEach((l, i) => {
    const m = mes(l[0]); if (!m){ if (l.some(x => x !== "" && x != null)) avisos.push(`Mensal, linha ${i + 2}: mês inválido (use AAAA-MM).`); return; }
    const o = pega(m);
    [["receita_prevista", 1], ["receita_arrecadada", 2], ["saldo_caixa", 3], ["fundo_reserva", 4], ["fundo_obras", 5], ["inadimplencia_valor", 6], ["inadimplencia_unidades", 7]]
      .forEach(([k, c]) => { const v = num(l[c]); if (v != null) o[k] = v; });
  });
  const contratos = [];
  ctr.slice(1).forEach((l, i) => {
    const f = String(l[0] ?? "").trim(); if (!f) return;
    const k = { fornecedor: f.slice(0, 120), servico: String(l[1] ?? "").trim().slice(0, 120), valor_mensal: num(l[2]), inicio: data(l[3]), fim: data(l[4]),
      indice: indice(l[5]), mes_reajuste: num(l[6]) ? Math.min(12, Math.max(1, Math.round(num(l[6])))) : null, renovacao_automatica: simnao(l[7]),
      aviso_previo_dias: num(l[8]) != null ? Math.min(365, Math.max(0, Math.round(num(l[8])))) : null, multa: String(l[9] ?? "").trim().slice(0, 200), observacao: String(l[10] ?? "").trim().slice(0, 500) };
    k.categoria = classificar(k.servico + " " + k.fornecedor); if (k.categoria === "outros") k.categoria = "contratos";
    if (k.inicio && k.fim && k.fim <= k.inicio){ avisos.push(`Contratos, linha ${i + 2}: o fim é antes do início; datas ignoradas.`); k.inicio = k.fim = null; }
    contratos.push(k);
  });
  const meses = Object.values(porMes).sort((a, b) => a.mes.localeCompare(b.mes)).slice(-36);
  return { meses, contratos, avisos };
};

/* ---------- Análise ---------- */
R.analisar = function({ meses, contratos, orc, cond }){
  const hoje = hojeISO(), A = [], F = {};
  const add = (frente, nivel, chave, titulo, detalhe, acao, prazo_dias) => A.push({ frente, nivel, chave, titulo, detalhe, acao: acao || "", prazo_dias: prazo_dias || (nivel === "critico" ? 30 : 60) });
  const ms = meses.filter(m => Object.keys(m.despesas || {}).length || m.receita_prevista != null);
  const comDesp = meses.filter(m => Object.keys(m.despesas || {}).length);
  const totalMes = m => soma(Object.values(m.despesas || {}));
  const despMedia = media(comDesp.map(totalMes));
  const K = { meses: meses.length, periodo: meses.length ? mesBR(meses[0].mes) + " a " + mesBR(meses[meses.length - 1].mes) : "", despesa_media: despMedia };

  // 1) orçado x realizado
  const orcCat = {}; (orc?.itens || []).forEach(it => orcCat[it.categoria] = (orcCat[it.categoria] || 0) + Number(it.valor || 0));
  const realCat = {}; Object.keys(CAT).forEach(c => { const v = comDesp.map(m => Number(m.despesas[c] || 0)); realCat[c] = comDesp.length ? media(v) : 0; });
  F.orcamento = { linhas: [] };
  if (!comDesp.length) F.orcamento.nivel = "sem_dados";
  else if (!Object.keys(orcCat).length){
    F.orcamento.nivel = "atencao";
    add("orcamento", "atencao", "orc-ausente", "Sem previsão orçamentária para comparar", "Os gastos não podem ser comparados com o que foi aprovado em assembleia.", "Cadastrar a previsão orçamentária vigente em Gestão e Orçamento.", 30);
  } else {
    const orcT = soma(Object.values(orcCat)), realT = soma(Object.values(realCat));
    K.orcado_total = orcT; K.realizado_total = realT; K.desvio_total = orcT ? (realT - orcT) / orcT * 100 : null;
    Object.keys(CAT).forEach(c => {
      const o = orcCat[c] || 0, r = realCat[c] || 0; if (!o && !r) return;
      const dsv = o ? (r - o) / o * 100 : null; F.orcamento.linhas.push({ cat: c, orcado: o, realizado: r, desvio: dsv });
      if (!o && r >= 300) add("orcamento", "atencao", "orc-fora:" + c, `${CAT[c]} sem previsão no orçamento`, `Média de ${brl(r)} por mês gasta em um grupo que não está na previsão aprovada.`, "Incluir o grupo na próxima previsão orçamentária ou verificar a classificação dos lançamentos.", 60);
      else if (o && dsv > 20 && r - o >= 300) add("orcamento", "critico", "orc-acima:" + c, `${CAT[c]}: ${pctf(dsv, 1)} acima do previsto`, `Previsto ${brl(o)} por mês; realizado em média ${brl(r)}.`, "Levantar as notas do grupo, entender a causa e renegociar ou rever a previsão com o conselho.", 30);
      else if (o && dsv > 10 && r - o >= 300) add("orcamento", "atencao", "orc-acima:" + c, `${CAT[c]}: ${pctf(dsv, 1)} acima do previsto`, `Previsto ${brl(o)} por mês; realizado em média ${brl(r)}.`, "Acompanhar mês a mês e ajustar na próxima previsão.", 60);
    });
    F.orcamento.linhas.sort((a, b) => b.realizado - a.realizado);
    if (K.desvio_total > 10) add("orcamento", K.desvio_total > 20 ? "critico" : "atencao", "orc-total", `Despesa total ${pctf(K.desvio_total, 1)} acima da previsão`, `Previsto ${brl(orcT)} por mês; realizado em média ${brl(realT)}.`, "Rever a previsão orçamentária e a taxa condominial com o conselho antes da próxima assembleia.", 30);
  }

  // 2) estrutura de custos (informativa) + tendência
  F.custos = { linhas: Object.keys(CAT).map(c => ({ cat: c, valor: realCat[c] || 0, peso: despMedia ? (realCat[c] || 0) / despMedia * 100 : 0 })).filter(x => x.valor > 0).sort((a, b) => b.valor - a.valor) };
  if (comDesp.length >= 6){
    const ini = media(comDesp.slice(0, 3).map(totalMes)), fim = media(comDesp.slice(-3).map(totalMes)), cr = ini ? (fim - ini) / ini * 100 : 0;
    K.crescimento_despesa = cr;
    if (cr > 15) add("custos", "atencao", "custo-cresce", `Despesa mensal subiu ${pctf(cr, 1)} no período`, `Média dos 3 primeiros meses ${brl(ini)}; dos 3 últimos ${brl(fim)}.`, "Identificar os grupos que mais cresceram e verificar se o aumento estava previsto.", 60);
  }
  F.custos.nivel = comDesp.length ? "saudavel" : "sem_dados";

  // 3) receitas e resultado
  const comRec = meses.filter(m => m.receita_arrecadada != null && Object.keys(m.despesas || {}).length);
  F.resultado = { linhas: comRec.map(m => ({ mes: m.mes, prevista: m.receita_prevista, arrecadada: m.receita_arrecadada, despesa: totalMes(m), resultado: m.receita_arrecadada - totalMes(m) })) };
  if (!comRec.length) F.resultado.nivel = "sem_dados";
  else {
    const res = F.resultado.linhas.map(x => x.resultado), ult = res.slice(-6), deficits = ult.filter(x => x < 0).length;
    K.resultado_medio = media(res); K.resultado_acumulado = soma(res); K.meses_deficit = deficits;
    const efic = meses.filter(m => m.receita_prevista > 0 && m.receita_arrecadada != null).map(m => m.receita_arrecadada / m.receita_prevista * 100);
    if (efic.length) K.arrecadacao_pct = media(efic.slice(-3));
    if (K.resultado_medio < 0) add("resultado", "critico", "res-deficit", "O condomínio gasta mais do que arrecada", `Déficit médio de ${brl(Math.abs(K.resultado_medio))} por mês (${deficits} de ${ult.length} últimos meses no vermelho).`, "Montar com o conselho um plano de equilíbrio: cortes, renegociação de contratos e revisão da taxa condominial.", 30);
    else if (deficits >= 3) add("resultado", "atencao", "res-deficit", `${deficits} dos últimos ${ult.length} meses fecharam no vermelho`, `Resultado médio do período: ${brl(K.resultado_medio)} por mês.`, "Acompanhar o fluxo de caixa mensal e antecipar despesas sazonais (13º, férias, seguro).", 60);
  }

  // 4) inadimplência
  const comInad = meses.filter(m => m.inadimplencia_valor != null);
  if (!comInad.length) F.inadimplencia = { nivel: "sem_dados" };
  else {
    const u = comInad[comInad.length - 1], recPrev = media(meses.filter(m => m.receita_prevista > 0).map(m => m.receita_prevista));
    const emMeses = recPrev ? u.inadimplencia_valor / recPrev : null, unid = u.inadimplencia_unidades;
    K.inadimplencia_valor = u.inadimplencia_valor; K.inadimplencia_unidades = unid; K.inadimplencia_receitas = emMeses;
    K.inadimplencia_pct_unid = unid != null && cond?.unidades ? unid / cond.unidades * 100 : null;
    F.inadimplencia = { mes: u.mes, valor: u.inadimplencia_valor, unidades: unid, emMeses };
    const pri = comInad[0].inadimplencia_valor, cresc = comInad.length >= 3 && pri > 0 ? (u.inadimplencia_valor - pri) / pri * 100 : null; K.inadimplencia_crescimento = cresc;
    const txt = `${brl(u.inadimplencia_valor)} em atraso em ${mesBR(u.mes)}` + (unid != null ? `, em ${unid} unidade(s)` : "") + (emMeses != null ? ` — equivale a ${br(emMeses, 1)} mês(es) de arrecadação.` : ".");
    if (emMeses != null && emMeses >= 1) add("inadimplencia", "critico", "inad-alta", "Inadimplência acima de um mês de arrecadação", txt, "Revisar a régua de cobrança, notificar as unidades com atraso acima de 90 dias e avaliar a cobrança judicial com o jurídico.", 30);
    else if ((emMeses != null && emMeses >= 0.5) || (cresc != null && cresc > 20)) add("inadimplencia", "atencao", "inad-alta", cresc > 20 ? `Inadimplência cresceu ${pctf(cresc, 1)} no período` : "Inadimplência acima de meio mês de arrecadação", txt, "Revisar a régua de cobrança e oferecer acordo às unidades em atraso.", 60);
  }

  // 5) caixa e fundos
  const comSaldo = meses.filter(m => m.saldo_caixa != null);
  if (!comSaldo.length) F.caixa = { nivel: "sem_dados" };
  else {
    const u = comSaldo[comSaldo.length - 1], cob = despMedia ? u.saldo_caixa / despMedia : null;
    K.saldo_caixa = u.saldo_caixa; K.caixa_meses = cob; K.fundo_reserva = u.fundo_reserva; K.fundo_obras = u.fundo_obras;
    F.caixa = { mes: u.mes, saldo: u.saldo_caixa, cobertura: cob, fundo: u.fundo_reserva, obras: u.fundo_obras };
    if (cob != null && cob < 1) add("caixa", "critico", "caixa-baixo", `O caixa cobre só ${br(cob, 1)} mês de despesa`, `Saldo de ${brl(u.saldo_caixa)} em ${mesBR(u.mes)} para uma despesa média de ${brl(despMedia)}.`, "Programar os pagamentos, evitar despesas não essenciais e avaliar chamada extra ou uso do fundo conforme a convenção.", 30);
    else if (cob != null && cob < 2) add("caixa", "atencao", "caixa-baixo", `O caixa cobre ${br(cob, 1)} mês de despesa`, `Saldo de ${brl(u.saldo_caixa)} em ${mesBR(u.mes)}.`, "Montar o fluxo de caixa dos próximos 3 meses, com 13º e férias.", 60);
    const fr = meses.filter(m => m.fundo_reserva != null);
    if (fr.length >= 3 && fr[0].fundo_reserva > 0){
      const q = (fr[fr.length - 1].fundo_reserva - fr[0].fundo_reserva) / fr[0].fundo_reserva * 100; K.fundo_variacao = q;
      if (q < -10) add("caixa", "atencao", "fundo-cai", `Fundo de reserva caiu ${pctf(Math.abs(q), 1)} no período`, `De ${brl(fr[0].fundo_reserva)} (${mesBR(fr[0].mes)}) para ${brl(fr[fr.length - 1].fundo_reserva)} (${mesBR(fr[fr.length - 1].mes)}).`, "Conferir na convenção e nas atas se o uso do fundo foi autorizado e para quê.", 60);
    }
  }

  // 6) contratos
  F.contratos = { linhas: [] };
  const linhasMes = meses.map(m => ({ mes: m.mes, linhas: m.linhas || [] }));
  const chaveForn = k => norm(k.fornecedor).split(" ").filter(w => w.length >= 4 && !/^(ltda|eireli|servicos|comercio|empresa|condominio|manutencao)$/.test(w))[0] || "";
  if (!contratos.length){
    F.contratos.nivel = "sem_dados";
    add("contratos", "atencao", "ctr-ausentes", "Nenhum contrato cadastrado", "Sem os contratos não dá para conferir vigência, reajuste nem o valor pago.", "Pedir à administradora ou ao síndico anterior a pasta de contratos e cadastrar no Raio-X.", 30);
  } else contratos.forEach(k => {
    const id = k.id || norm(k.fornecedor).replace(/ /g, "-"), linha = { ...k, pagoAcima: 0, mesesPagos: 0 };
    const w = chaveForn(k);
    if (w && k.valor_mensal){
      linhasMes.forEach(m => { const v = soma(m.linhas.filter(x => norm(x.d).includes(w)).map(x => x.v)); if (v > 0){ linha.mesesPagos++; if (v > k.valor_mensal * 1.05 + 1) linha.pagoAcima++; } });
      if (linha.pagoAcima) add("contratos", linha.pagoAcima >= 3 ? "critico" : "atencao", "ctr-acima:" + id, `${k.fornecedor}: pago acima do contratado em ${linha.pagoAcima} mês(es)`, `Contrato de ${brl(k.valor_mensal)} por mês.`, "Pedir ao fornecedor a memória de cálculo (reajuste, extras) e conferir com o contrato; cobrar devolução do que não tiver base.", 30);
    }
    if (!k.fim) add("contratos", "atencao", "ctr-semfim:" + id, `${k.fornecedor}: contrato sem data de término`, k.servico || "", "Localizar o contrato assinado e registrar a vigência e as condições de rescisão.", 60);
    else {
      const prazoAviso = k.renovacao_automatica && k.aviso_previo_dias ? addDias(k.fim, -k.aviso_previo_dias) : k.fim, d = dias(hoje, prazoAviso);
      linha.diasDecisao = d;
      if (dias(hoje, k.fim) < 0) add("contratos", "critico", "ctr-vencido:" + id, `${k.fornecedor}: contrato vencido em ${dataBR(k.fim)}`, (k.servico ? k.servico + ". " : "") + "O serviço pode estar sendo prestado sem contrato válido.", "Regularizar: renovar por escrito ou cotar outro fornecedor.", 30);
      else if (d <= 90) add("contratos", d <= 30 ? "critico" : "atencao", "ctr-prazo:" + id, k.renovacao_automatica ? `${k.fornecedor}: renova sozinho; avisar até ${dataBR(prazoAviso)}` : `${k.fornecedor}: termina em ${dataBR(k.fim)}`, (k.servico ? k.servico + ". " : "") + (k.multa ? "Multa de rescisão: " + k.multa + "." : ""), "Decidir: renovar, renegociar ou cotar 3 fornecedores.", Math.max(7, Math.min(60, d - 5)));
    }
    if (k.mes_reajuste){
      const mAtual = Number(hoje.slice(5, 7)), faltam = (k.mes_reajuste - mAtual + 12) % 12;
      if (faltam <= 2) add("contratos", "atencao", "ctr-reajuste:" + id, `${k.fornecedor}: reajuste em ${["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"][k.mes_reajuste - 1]}`, `Índice: ${IDX[k.indice] || "não informado"}.`, "Conferir o índice acumulado no Banco Central antes de aceitar o novo valor; tentar negociar abaixo do índice.", 45);
    }
    F.contratos.linhas.push(linha);
  });

  // 7) sinais de alerta: pagamentos recorrentes sem contrato e gastos fora do padrão
  F.alertas = {};
  if (comDesp.length >= 3){
    const porDesc = {};
    meses.forEach(m => (m.linhas || []).forEach(x => { const k = norm(x.d); (porDesc[k] = porDesc[k] || { d: x.d, c: x.c, v: [] }).v.push({ mes: m.mes, v: x.v }); }));
    const forns = contratos.map(chaveForn).filter(Boolean);
    Object.values(porDesc).forEach(g => {
      if (g.v.length >= 3 && g.c === "contratos" && !forns.some(w => norm(g.d).includes(w)) && media(g.v.map(x => x.v)) >= 300)
        add("alertas", "atencao", "sem-contrato:" + norm(g.d).slice(0, 40), `Pagamento recorrente sem contrato: ${g.d}`, `Aparece em ${g.v.length} meses, média de ${brl(media(g.v.map(x => x.v)))}.`, "Localizar o contrato ou formalizar o serviço; sem contrato não há garantia nem prazo.", 60);
      if (g.v.length >= 4){
        const md = mediana(g.v.map(x => x.v));
        g.v.forEach(x => { if (md > 0 && x.v > md * 3 && x.v - md >= 1000)
          add("alertas", "atencao", "fora-padrao:" + norm(g.d).slice(0, 30) + ":" + x.mes, `Gasto fora do padrão: ${g.d} em ${mesBR(x.mes)}`, `${brl(x.v)} contra o habitual de ${brl(md)}.`, "Pedir a nota fiscal e a justificativa desse lançamento.", 30); });
      }
    });
  }
  F.alertas.nivel = comDesp.length >= 3 ? "saudavel" : "sem_dados";

  // nível de cada frente = o pior achado
  FRENTES.forEach(([f]) => {
    const pior = A.filter(a => a.frente === f).reduce((p, a) => PESO[a.nivel] > PESO[p] ? a.nivel : p, F[f].nivel === "sem_dados" ? "sem_dados" : "saudavel");
    if (F[f].nivel !== "sem_dados" || pior !== "sem_dados") F[f].nivel = pior === "sem_dados" ? F[f].nivel : pior;
  });
  A.sort((a, b) => PESO[b.nivel] - PESO[a.nivel]);
  const geral = FRENTES.reduce((p, [f]) => PESO[F[f].nivel] > PESO[p] ? F[f].nivel : p, "sem_dados");
  return { frentes: F, achados: A.slice(0, 80), kpis: K, geral: geral === "sem_dados" ? "sem_dados" : geral };
};

/* ---------- Dados ---------- */
const atualizarFisc = async () => { try{ await sb.rpc("fiscalizacao_atualizar"); await window.Fiscal?.carregar?.(); }catch(_){ /* a fiscalização atualiza na próxima abertura */ } };
let E = { cond: null, rx: null, contratos: [], orc: null, analise: null, novos: null };
R.carregar = async function(condId){
  const [{ data: c }, { data: rx }, { data: ks }, { data: orc }] = await Promise.all([
    sb.from("condominios").select("id, sindico_id, nome, cnpj, endereco, cidade, unidades").eq("id", condId).maybeSingle(),
    sb.from("raiox").select("*").eq("condominio_id", condId).maybeSingle(),
    sb.from("contratos").select("*").eq("condominio_id", condId).order("fim", { ascending: true, nullsFirst: false }),
    sb.from("orcamentos").select("itens, fundo_reserva_pct, taxa_media").eq("condominio_id", condId).maybeSingle(),
  ]);
  if (!c) throw new Error("Condomínio não encontrado.");
  return { cond: c, rx: rx || null, contratos: ks || [], orc: orc || null };
};
function analisarAtual(){ E.analise = R.analisar({ meses: E.rx?.meses || [], contratos: E.contratos, orc: E.orc, cond: E.cond }); return E.analise; }

/* Resumo para a voz */
R.resumo = async function(cond){
  const d = await R.carregar(cond.id); Object.assign(E, d); const a = analisarAtual(), K = a.kpis;
  if (!(d.rx?.meses || []).length && !d.contratos.length) return { condominio: d.cond.nome, tem_dados: false, mensagem: "O Raio-X deste condomínio ainda não foi feito. Em Menu › Raio-X do Condomínio, baixe a planilha modelo, preencha com as prestações de contas e os contratos e importe." };
  return {
    condominio: d.cond.nome, tem_dados: true, periodo: K.periodo, situacao_geral: NIVEL[a.geral],
    frentes: FRENTES.map(([f, n]) => ({ frente: n, situacao: NIVEL[a.frentes[f].nivel] })),
    despesa_media_mensal: brl(K.despesa_media),
    desvio_do_orcamento: K.desvio_total != null ? pctf(K.desvio_total, 1) : "sem previsão para comparar",
    resultado_medio_mensal: K.resultado_medio != null ? (K.resultado_medio < 0 ? "déficit de " : "sobra de ") + brl(Math.abs(K.resultado_medio)) : "sem dados de receita",
    inadimplencia: K.inadimplencia_valor != null ? brl(K.inadimplencia_valor) + (K.inadimplencia_unidades != null ? " em " + K.inadimplencia_unidades + " unidades" : "") : "sem dados",
    caixa_cobre_meses: K.caixa_meses != null ? br(K.caixa_meses, 1) : "sem dados",
    contratos_cadastrados: d.contratos.length,
    principais_achados: a.achados.slice(0, 6).map(x => ({ nivel: NIVEL[x.nivel], achado: x.titulo, o_que_fazer: x.acao })),
    plano_de_acao_gerado: !!d.rx?.plano_em,
    observacao: "Diagnóstico de gestão feito com os números informados; não substitui auditoria contábil.",
  };
};

/* ---------- Tela ---------- */
const ov = () => $("rxOverlay"), folha = () => $("rxFolha");
R.abrir = async function(nomeCond){
  if (!PERFIL) throw new Error("Usuário não está logado.");
  const cs = PERFIL.condominios || []; if (!cs.length) throw new Error("Cadastre um condomínio antes.");
  const sel = $("rxCond"); sel.innerHTML = ""; cs.forEach(c => sel.append(el("option", { value: c.id, text: c.nome })));
  const alvo = nomeCond ? acharCondominio(nomeCond) : (E.cond && cs.find(c => c.id === E.cond.id)) || cs[0];
  sel.value = alvo.id;
  if (typeof fecharMenu === "function") fecharMenu();
  ov().hidden = false; ov().scrollTop = 0;
  await R.render(alvo.id);
  return alvo;
};
R.fechar = () => { ov().hidden = true; };
R.render = async function(condId){
  const f = folha(); f.innerHTML = ""; f.append(el("p", { class: "ges-carregando", text: "Carregando…" }));
  Object.assign(E, await R.carregar(condId), { novos: null });
  analisarAtual(); desenhar();
};

const selo = n => el("span", { class: "rx-selo rx-" + n, text: NIVEL[n] });
const kpi = (v, t) => el("div", { class: "rel-kpi" }, el("b", { text: v }), el("span", { text: t }));

function desenhar(){
  const f = folha(), { cond } = E, a = E.analise, K = a.kpis; f.innerHTML = "";
  f.append(el("header", {}, el("p", { class: "com-cond", text: cond.nome }), el("p", { class: "dados", text: [cond.cnpj ? "CNPJ " + mascaraCnpj(cond.cnpj) : "", cond.endereco, cond.cidade, cond.unidades + " apartamentos"].filter(Boolean).join(" · ") })));
  f.append(el("p", { class: "tipo", text: "Raio-X do Condomínio" }), el("h1", { text: "Diagnóstico financeiro de entrada" }));
  if (K.periodo) f.append(el("p", { class: "ges-nota", text: `Período analisado: ${K.periodo} (${K.meses} meses)` + (E.rx?.analisado_em ? " · atualizado em " + new Date(E.rx.analisado_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "") }));

  // importação
  const fArq = el("input", { type: "file", accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", class: "ges-arq", "aria-label": "Planilha do Raio-X" });
  const msg = el("p", { class: "ges-msg", role: "status", id: "rxMsg" });
  f.append(el("div", { class: "ges-import ges-nao-imprimir" },
    el("p", { class: "ges-nota", text: "1. Baixe a planilha modelo e preencha com as prestações de contas (até 36 meses), receitas, saldos, inadimplência (só unidades, nunca nomes) e contratos. 2. Importe aqui: o SINDICS separa as despesas por grupo e mostra a análise antes de salvar." }),
    el("a", { href: "modelos/sindics-raiox-modelo.xlsx", download: "sindics-raiox-modelo.xlsx", class: "rx-link", text: "Baixar planilha modelo (.xlsx)" }),
    fArq, el("button", { type: "button", class: "primary", text: "Importar planilha", onclick: async e => {
      if (!fArq.files[0]){ msg.textContent = "Escolha a planilha preenchida."; return; }
      e.target.disabled = true; msg.textContent = "Lendo a planilha…";
      try{ await importar(fArq.files[0]); }catch(err){ msg.textContent = err.message || String(err); }
      e.target.disabled = false;
    } }), msg));
  if (E.novos){
    f.append(el("div", { class: "rx-conferir ges-nao-imprimir" },
      el("p", { text: `Prévia: ${E.novos.meses.length} mês(es) e ${E.novos.contratos.length} contrato(s) lidos.` + (E.novos.avisos.length ? " Avisos: " + E.novos.avisos.slice(0, 4).join(" ") : "") + " Confira a análise abaixo e salve." }),
      el("div", { class: "ges-acoes" },
        el("button", { type: "button", class: "primary", text: "Salvar Raio-X", onclick: salvarImportacao }),
        el("button", { type: "button", text: "Descartar", onclick: () => R.render(cond.id) }))));
  }

  if (!K.meses && !E.contratos.length && !E.novos){
    f.append(el("p", { class: "ges-nota", text: "Ainda não há dados. Comece pela planilha modelo." }));
    return;
  }

  // visão geral
  f.append(el("h3", { text: "Visão geral" }),
    el("div", { class: "rx-geral" }, el("span", { text: "Situação geral" }), selo(a.geral)),
    el("div", { class: "rel-kpis" },
      kpi(K.despesa_media ? brl0(K.despesa_media) : "—", "despesa média por mês"),
      kpi(K.desvio_total != null ? pctf(K.desvio_total, 1) : "—", "realizado x orçado"),
      kpi(K.resultado_medio != null ? (K.resultado_medio < 0 ? "−" : "") + brl0(Math.abs(K.resultado_medio)) : "—", "resultado médio por mês (arrecadado − despesa)"),
      kpi(K.caixa_meses != null ? br(K.caixa_meses, 1) + " mês" : "—", "de despesa coberta pelo caixa")),
    el("div", { class: "rx-frentes" }, FRENTES.map(([k, n]) => el("div", { class: "rx-frente" }, el("span", { text: n }), selo(a.frentes[k].nivel)))));

  // achados
  f.append(el("h3", { text: "Achados e plano de ação" }));
  if (!a.achados.length) f.append(el("p", { class: "ges-nota", text: "Nenhum ponto de atenção com os dados informados." }));
  else {
    const salvos = Object.fromEntries((E.rx?.achados || []).map(x => [x.chave, x]));
    const lista = el("div", { class: "rx-achados" });
    a.achados.forEach(x => {
      const s = salvos[x.chave]; x.no_plano = s ? !!s.no_plano : x.nivel !== "saudavel"; if (s?.prazo_dias) x.prazo_dias = s.prazo_dias;
      const cb = el("input", { type: "checkbox", "aria-label": "Incluir no plano de ação" }); cb.checked = x.no_plano; cb.onchange = () => { x.no_plano = cb.checked; };
      const pz = el("select", { "aria-label": "Prazo", onchange: e => { x.prazo_dias = Number(e.target.value); } }, [7, 15, 30, 60, 90].map(d => el("option", { value: d, text: d + " dias" })));
      if (![7, 15, 30, 60, 90].includes(x.prazo_dias)) pz.append(el("option", { value: x.prazo_dias, text: x.prazo_dias + " dias" }));
      pz.value = String(x.prazo_dias);
      lista.append(el("div", { class: "rx-achado rx-borda-" + x.nivel },
        el("div", { class: "rx-ach-top" }, selo(x.nivel), el("b", { text: x.titulo })),
        x.detalhe ? el("p", { class: "m", text: x.detalhe }) : null,
        x.acao ? el("p", { class: "a", text: "O que fazer: " + x.acao }) : null,
        el("div", { class: "rx-ach-plano ges-nao-imprimir" }, el("label", { class: "ges-check" }, cb, el("span", { text: "No plano de ação" })), el("label", { class: "ges-check" }, el("span", { text: "Prazo" }), pz))));
    });
    f.append(lista);
    const pm = el("p", { class: "ges-msg", role: "status" });
    f.append(el("div", { class: "ges-acoes ges-nao-imprimir" },
      el("button", { type: "button", class: "primary", text: E.rx?.plano_em ? "Atualizar plano de ação" : "Gerar plano de ação", onclick: async e => {
        e.target.disabled = true; pm.textContent = "Gerando…";
        try{ const r = await gerarPlano(); pm.textContent = `Plano salvo: ${r.itens} ação(ões) na fiscalização` + (r.agenda ? ` e ${r.agenda} compromisso(s) novo(s) na agenda.` : ". A agenda já tinha esses compromissos."); }
        catch(err){ pm.textContent = err.message || String(err); }
        e.target.disabled = false;
      } }), pm),
      el("p", { class: "ges-nota ges-nao-imprimir", text: "As ações marcadas entram na agenda (no fim do prazo) e na Fiscalização, que cobra o responsável a cada 5 dias até resolver." }));
  }

  // detalhes por frente
  const F = a.frentes;
  if (F.orcamento.linhas?.length){
    f.append(el("h3", { text: "Orçado x realizado (média mensal)" }), el("table", { class: "ges-tab rx-tab" },
      el("thead", {}, el("tr", {}, el("th", { text: "Grupo" }), el("th", { class: "num", text: "Orçado" }), el("th", { class: "num", text: "Realizado" }), el("th", { class: "num", text: "Desvio" }))),
      el("tbody", {}, F.orcamento.linhas.map(l => el("tr", { class: l.desvio > 20 ? "rx-ruim" : l.desvio > 10 ? "rx-medio" : "" }, el("td", { text: CAT[l.cat] }), el("td", { class: "num", text: l.orcado ? brl(l.orcado) : "—" }), el("td", { class: "num", text: brl(l.realizado) }), el("td", { class: "num", text: l.desvio == null ? "fora do orçamento" : pctf(l.desvio, 1) })))),
      el("tfoot", {}, el("tr", {}, el("td", { text: "Total" }), el("td", { class: "num", text: brl(K.orcado_total) }), el("td", { class: "num", text: brl(K.realizado_total) }), el("td", { class: "num", text: pctf(K.desvio_total, 1) })))));
  }
  if (F.custos.linhas?.length){
    f.append(el("h3", { text: "Para onde vai o dinheiro" }), el("div", { class: "rx-barras" }, F.custos.linhas.map(l =>
      el("div", { class: "rx-barra" }, el("span", { text: CAT[l.cat] }), el("div", { class: "rx-trilho" }, el("i", { style: `width:${Math.max(1, Math.round(l.peso))}%` })), el("b", { text: Math.round(l.peso) + "%" }), el("em", { text: brl0(l.valor) })))));
  }
  if (F.resultado.linhas?.length){
    f.append(el("h3", { text: "Receitas e resultado por mês" }), el("table", { class: "ges-tab rx-tab" },
      el("thead", {}, el("tr", {}, el("th", { text: "Mês" }), el("th", { class: "num", text: "Prevista" }), el("th", { class: "num", text: "Arrecadada" }), el("th", { class: "num", text: "Despesa" }), el("th", { class: "num", text: "Resultado" }))),
      el("tbody", {}, F.resultado.linhas.map(l => el("tr", { class: l.resultado < 0 ? "rx-ruim" : "" }, el("td", { text: mesBR(l.mes) }), el("td", { class: "num", text: l.prevista != null ? brl0(l.prevista) : "—" }), el("td", { class: "num", text: brl0(l.arrecadada) }), el("td", { class: "num", text: brl0(l.despesa) }), el("td", { class: "num", text: (l.resultado < 0 ? "−" : "") + brl0(Math.abs(l.resultado)) }))))));
  }
  if (F.inadimplencia.valor != null || F.caixa.saldo != null){
    f.append(el("h3", { text: "Inadimplência, caixa e fundos" }), el("div", { class: "rel-kpis" },
      kpi(F.inadimplencia.valor != null ? brl0(F.inadimplencia.valor) : "—", "inadimplência acumulada" + (F.inadimplencia.mes ? " em " + mesBR(F.inadimplencia.mes) : "")),
      kpi(F.inadimplencia.unidades != null ? String(F.inadimplencia.unidades) : "—", "unidades em atraso" + (K.inadimplencia_pct_unid != null ? " (" + pctf(K.inadimplencia_pct_unid) + " do prédio)" : "")),
      kpi(F.caixa.saldo != null ? brl0(F.caixa.saldo) : "—", "saldo em conta" + (F.caixa.mes ? " em " + mesBR(F.caixa.mes) : "")),
      kpi(F.caixa.fundo != null ? brl0(F.caixa.fundo) : "—", "fundo de reserva" + (F.caixa.obras != null ? " · obras " + brl0(F.caixa.obras) : ""))));
  }

  // contratos (lista editável)
  f.append(el("h3", { text: "Contratos" }));
  const tb = el("tbody");
  E.contratos.forEach(k => tb.append(linhaContrato(k)));
  f.append(el("table", { class: "ges-tab rx-ctr" },
    el("thead", {}, el("tr", {}, el("th", { text: "Fornecedor e serviço" }), el("th", { class: "num", text: "Valor/mês" }), el("th", { text: "Vigência" }), el("th", { text: "Reajuste" }), el("th", { text: "Renovação" }), el("th", { class: "ges-nao-imprimir" }))), tb));
  if (!E.contratos.length) f.append(el("p", { class: "ges-nota", text: "Nenhum contrato cadastrado. Importe pela planilha ou adicione um a um." }));
  f.append(el("div", { class: "ges-acoes ges-nao-imprimir" }, el("button", { type: "button", text: "+ Adicionar contrato", onclick: () => editarContrato(null) })));
  f.append(el("p", { class: "rel-nota", text: "Diagnóstico de gestão feito pelo SINDICS com os números informados, em " + dataBR(hojeISO()) + ". Critérios: desvio do orçamento acima de 10% (atenção) ou 20% (crítico); caixa abaixo de 2 meses (atenção) ou 1 mês (crítico) de despesa média; inadimplência acima de meio mês (atenção) ou um mês (crítico) de arrecadação; contratos vencidos ou com decisão em até 90 dias. Não substitui auditoria contábil: diante de divergências relevantes, procure a contabilidade ou uma auditoria independente." }));
}

function linhaContrato(k){
  const vig = (k.inicio ? dataBR(k.inicio) : "?") + " a " + (k.fim ? dataBR(k.fim) : "sem fim");
  return el("tr", {},
    el("td", {}, el("b", { text: k.fornecedor }), k.servico ? el("div", { class: "m", text: k.servico }) : null),
    el("td", { class: "num", text: k.valor_mensal != null ? brl(k.valor_mensal) : "—" }),
    el("td", { text: vig }),
    el("td", { text: (IDX[k.indice] || "—") + (k.mes_reajuste ? " · mês " + k.mes_reajuste : "") }),
    el("td", { text: k.renovacao_automatica ? "Automática" + (k.aviso_previo_dias ? ` (aviso ${k.aviso_previo_dias} dias)` : "") : "Manual" }),
    el("td", { class: "ges-nao-imprimir" }, k.id ? el("button", { type: "button", text: "Editar", onclick: () => editarContrato(k) }) : el("span", { class: "m", text: "novo" })));
}

function editarContrato(k){
  const f = folha(), novo = !k; k = k ? { ...k } : { fornecedor: "", servico: "", valor_mensal: null, inicio: null, fim: null, indice: "igpm", mes_reajuste: null, renovacao_automatica: false, aviso_previo_dias: null, multa: "", observacao: "" };
  const campo = (rot, inp) => el("label", { class: "ges-campo" }, el("span", { text: rot }), inp);
  const i = {
    fornecedor: el("input", { value: k.fornecedor, maxlength: "120" }), servico: el("input", { value: k.servico, maxlength: "120" }),
    valor: el("input", { type: "number", min: "0", step: "0.01", value: k.valor_mensal ?? "" }),
    inicio: el("input", { type: "date", value: k.inicio || "" }), fim: el("input", { type: "date", value: k.fim || "" }),
    indice: el("select", {}, Object.entries(IDX).map(([v, t]) => el("option", { value: v, text: t }))),
    mes: el("input", { type: "number", min: "1", max: "12", value: k.mes_reajuste ?? "" }),
    renova: el("input", { type: "checkbox" }), aviso: el("input", { type: "number", min: "0", max: "365", value: k.aviso_previo_dias ?? "" }),
    multa: el("input", { value: k.multa || "", maxlength: "200" }),
  };
  i.indice.value = k.indice || "outro"; i.renova.checked = !!k.renovacao_automatica;
  const msg = el("p", { class: "ges-msg", role: "status" });
  const caixa = el("div", { class: "rx-form ges-nao-imprimir" },
    el("h3", { text: novo ? "Novo contrato" : "Editar contrato" }),
    el("div", { class: "ges-meta" }, campo("Fornecedor", i.fornecedor), campo("Serviço", i.servico), campo("Valor mensal (R$)", i.valor), campo("Início", i.inicio), campo("Fim", i.fim),
      campo("Índice de reajuste", i.indice), campo("Mês do reajuste (1-12)", i.mes), campo("Aviso prévio (dias)", i.aviso), campo("Multa de rescisão", i.multa)),
    el("label", { class: "ges-check" }, i.renova, el("span", { text: "Renova automaticamente" })),
    el("div", { class: "ges-acoes" },
      el("button", { type: "button", class: "primary", text: "Salvar contrato", onclick: async () => {
        const reg = { condominio_id: E.cond.id, sindico_id: E.cond.sindico_id, fornecedor: i.fornecedor.value.trim(), servico: i.servico.value.trim(), valor_mensal: i.valor.value === "" ? null : Number(i.valor.value),
          inicio: i.inicio.value || null, fim: i.fim.value || null, indice: i.indice.value, mes_reajuste: i.mes.value ? Number(i.mes.value) : null, renovacao_automatica: i.renova.checked,
          aviso_previo_dias: i.aviso.value === "" ? null : Number(i.aviso.value), multa: i.multa.value.trim() };
        if (reg.fornecedor.length < 2){ msg.textContent = "Informe o fornecedor."; return; }
        reg.categoria = classificar(reg.servico + " " + reg.fornecedor); if (reg.categoria === "outros") reg.categoria = "contratos";
        msg.textContent = "Salvando…";
        const q = novo ? sb.from("contratos").insert(reg) : sb.from("contratos").update(reg).eq("id", k.id);
        const { error } = await q; if (error){ msg.textContent = error.message; return; }
        await atualizarFisc();
        await R.render(E.cond.id);
      } }),
      !novo ? el("button", { type: "button", class: "x", text: "Excluir", onclick: async () => {
        const { error } = await sb.from("contratos").delete().eq("id", k.id); if (error){ msg.textContent = error.message; return; }
        await atualizarFisc(); await R.render(E.cond.id);
      } }) : null,
      el("button", { type: "button", text: "Cancelar", onclick: () => caixa.remove() }), msg));
  f.querySelector(".rx-form")?.remove();
  const tab = f.querySelector(".rx-ctr"); tab.after(caixa); caixa.scrollIntoView({ behavior: "smooth", block: "center" }); i.fornecedor.focus();
}

async function importar(arq){
  const abas = await R.lerXlsx(arq), r = R.interpretar(abas);
  if (!r.meses.length && !r.contratos.length) throw new Error("A planilha não tem linhas preenchidas. " + r.avisos.slice(0, 3).join(" "));
  // junta com o que já existe: meses novos substituem os do mesmo mês; contratos da planilha entram como novos (sem duplicar pelo fornecedor)
  const atuais = Object.fromEntries((E.rx?.meses || []).map(m => [m.mes, m]));
  r.meses.forEach(m => atuais[m.mes] = m);
  const meses = Object.values(atuais).sort((a, b) => a.mes.localeCompare(b.mes)).slice(-36);
  const ja = new Set(E.contratos.map(k => norm(k.fornecedor)));
  const ctrNovos = r.contratos.filter(k => !ja.has(norm(k.fornecedor)));
  E.novos = { meses: r.meses, contratos: ctrNovos, avisos: r.avisos, arquivo: arq.name, todosMeses: meses };
  E.rx = { ...(E.rx || {}), meses };
  E.contratos = [...E.contratos, ...ctrNovos];
  analisarAtual(); desenhar();
  folha().querySelector(".rx-conferir")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function salvarImportacao(){
  const msg = $("rxMsg"); msg.textContent = "Salvando…";
  const n = E.novos;
  if (n.contratos.length){
    const regs = n.contratos.map(k => ({ ...k, condominio_id: E.cond.id, sindico_id: E.cond.sindico_id }));
    const { error } = await sb.from("contratos").insert(regs); if (error){ msg.textContent = "Contratos: " + error.message; return; }
  }
  const reg = { condominio_id: E.cond.id, sindico_id: E.cond.sindico_id, meses: n.todosMeses, arquivo_nome: n.arquivo, analisado_em: new Date().toISOString(),
    achados: mesclarAchados(), resumo: resumoCurto() };
  const { error } = await sb.from("raiox").upsert(reg, { onConflict: "condominio_id" }); if (error){ msg.textContent = error.message; return; }
  await atualizarFisc();
  await R.render(E.cond.id);
  $("rxMsg").textContent = "Raio-X salvo ✓ Revise os achados e gere o plano de ação.";
}

/* achados atuais + marcações já salvas (no plano, prazo, resolvidos) */
function mesclarAchados(){
  const salvos = Object.fromEntries((E.rx?.achados || []).map(x => [x.chave, x]));
  return E.analise.achados.map(x => ({ chave: x.chave, frente: x.frente, nivel: x.nivel, titulo: x.titulo, acao: x.acao, prazo_dias: x.prazo_dias,
    no_plano: x.no_plano ?? salvos[x.chave]?.no_plano ?? false }));
}
function resumoCurto(){ const a = E.analise; return { geral: a.geral, frentes: Object.fromEntries(FRENTES.map(([f]) => [f, a.frentes[f].nivel])), kpis: a.kpis }; }

async function gerarPlano(){
  if (!E.rx?.id && !(E.rx?.meses || []).length && !E.contratos.length) throw new Error("Importe e salve o Raio-X antes.");
  const achados = mesclarAchados(), plano = achados.filter(x => x.no_plano);
  if (!plano.length) throw new Error("Marque pelo menos um achado para o plano de ação.");
  const agora = new Date().toISOString();
  const { error } = await sb.from("raiox").upsert({ condominio_id: E.cond.id, sindico_id: E.cond.sindico_id, meses: E.rx?.meses || [], achados, resumo: resumoCurto(), plano_em: agora, analisado_em: E.rx?.analisado_em || agora }, { onConflict: "condominio_id" });
  if (error) throw error;
  // agenda: um compromisso no fim do prazo de cada ação (sem duplicar)
  const chaves = plano.map(x => `rx:${E.cond.id}:${x.chave}`);
  const { data: ja } = await sb.from("compromissos").select("chave").in("chave", chaves);
  const tem = new Set((ja || []).map(x => x.chave));
  const novos = plano.filter((x, i) => !tem.has(chaves[i])).map(x => {
    const dia = addDias(hojeISO(), x.prazo_dias);
    return { titulo: "Raio-X: " + x.titulo.slice(0, 110), inicio: new Date(dia + "T10:00:00-03:00").toISOString(), fim: new Date(dia + "T11:00:00-03:00").toISOString(),
      condominio_id: E.cond.id, local: "", observacoes: x.acao, lembrete_minutos: 1440, origem: "raiox", chave: `rx:${E.cond.id}:${x.chave}` };
  });
  if (novos.length){ const { error: e2 } = await sb.from("compromissos").insert(novos); if (e2) throw e2; }
  await atualizarFisc();
  if (typeof atualizarResumoTela === "function") atualizarResumoTela();
  E.rx = { ...(E.rx || {}), achados, plano_em: agora };
  return { itens: plano.length, agenda: novos.length };
}

/* ---------- Eventos ---------- */
$("rxCond").addEventListener("change", e => R.render(e.target.value).catch(err => { folha().textContent = err.message; }));
$("rxFechar").addEventListener("click", R.fechar);
$("rxImprimir").addEventListener("click", () => { document.body.classList.add("imprimindo-rx"); window.print(); });
addEventListener("afterprint", () => document.body.classList.remove("imprimindo-rx"));
$("raioxBtn").addEventListener("click", () => R.abrir().catch(err => { if (typeof hintEl !== "undefined") hintEl.textContent = err.message; }));
})();
