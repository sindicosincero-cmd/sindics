// SINDICS — equipe do síndico: convida, reenvia acesso e remove gestores auxiliares (até 3 por assinatura).
import { createClient } from "jsr:@supabase/supabase-js@2";

const ORIGENS = ["https://sindics.com.br", "https://www.sindics.com.br", "https://sindicosincero-cmd.github.io"];
const SITE_URL = "https://sindics.com.br/app/";
const LIMITE = Number(Deno.env.get("SINDICS_LIMITE_GESTORES") || "3");

function cors(origin: string | null) {
  const allow = origin && ORIGENS.includes(origin) ? origin : ORIGENS[0];
  return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}
// Senha temporária do convite: entra no e-mail, vale 72 horas e precisa ser trocada no primeiro acesso.
const VALIDADE_TEMP_H = 72;
function senhaTemporaria(): string {
  const M = "ABCDEFGHJKLMNPQRSTUVWXYZ", m = "abcdefghijkmnpqrstuvwxyz", d = "23456789", todos = M + m + d;
  const r = crypto.getRandomValues(new Uint32Array(12));
  const c = Array.from(r, (x, i) => (i === 0 ? M : i === 1 ? m : i === 2 ? d : todos)[x % (i === 0 ? M.length : i === 1 ? m.length : i === 2 ? d.length : todos.length)]);
  for (let i = c.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [c[i], c[j]] = [c[j], c[i]]; }
  const t = c.join(""); return `${t.slice(0, 4)}-${t.slice(4, 8)}-${t.slice(8)}`;
}
const metaTemp = (senha: string) => ({ senha_temporaria: senha, trocar_senha: true, senha_temp_expirada: false, senha_temp_expira: new Date(Date.now() + VALIDADE_TEMP_H * 3600000).toISOString() });

const json = (b: unknown, s: number, o: string | null) => new Response(JSON.stringify(b), { status: s, headers: { ...cors(o), "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405, origin);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = token ? await admin.auth.getUser(token) : { data: null as any };
  if (!u?.user) return json({ erro: "Faça login." }, 401, origin);
  const uid = u.user.id;
  const { data: eu } = await admin.from("perfis").select("id, nome, tratamento, papel, ativo, email").eq("id", uid).maybeSingle();
  if (!eu?.ativo) return json({ erro: "Conta não liberada." }, 403, origin);
  if (eu.papel === "gestor") return json({ erro: "Somente o síndico gerencia a equipe." }, 403, origin);
  let b: any = {}; try { b = await req.json(); } catch (_) { /* */ }

  try {
    if (b.acao === "convidar") {
      const nome = String(b.nome || "").trim().replace(/\s+/g, " ");
      const email = String(b.email || "").trim().toLowerCase();
      const conds: string[] = Array.isArray(b.condominios) ? b.condominios.map(String) : [];
      if (nome.length < 3) return json({ erro: "Informe o nome do gestor." }, 400, origin);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ erro: "E-mail do gestor inválido." }, 400, origin);
      if (email === (eu.email || "").toLowerCase()) return json({ erro: "Use o e-mail do gestor, não o seu." }, 400, origin);
      if (!conds.length) return json({ erro: "Escolha pelo menos um condomínio para o gestor cuidar." }, 400, origin);
      const { count } = await admin.from("gestores").select("id", { count: "exact", head: true }).eq("sindico_id", uid).eq("status", "ativo");
      if ((count ?? 0) >= LIMITE) return json({ erro: `Seu plano inclui até ${LIMITE} gestores. Remova um para convidar outro.` }, 409, origin);
      const { data: ja } = await admin.from("gestores").select("id").eq("sindico_id", uid).eq("status", "ativo").ilike("email", email).maybeSingle();
      if (ja) return json({ erro: "Este gestor já faz parte da sua equipe." }, 409, origin);

      // conta existente?
      const { data: existente } = await admin.from("perfis").select("id, papel").ilike("email", email).maybeSingle();
      if (existente && existente.papel !== "gestor") return json({ erro: "Este e-mail já tem uma conta de síndico no SINDICS. Use outro e-mail para o gestor." }, 409, origin);

      const sindicoNome = (eu.tratamento || "").trim() || eu.nome || "";
      const { data: linha, error: e1 } = await admin.from("gestores").insert({ sindico_id: uid, nome, email, condominios: conds, sindico_nome: sindicoNome }).select("id").single();
      if (e1) return json({ erro: e1.message }, 400, origin);

      let gid = existente?.id || null, aviso = "", comSenha = false, senha = "";
      if (!gid) {
        senha = senhaTemporaria();
        const meta = { nome, convite: "gestor", ...metaTemp(senha) };
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: SITE_URL, data: meta });
        if (error) {
          // e-mail não saiu (ex.: servidor de e-mail ainda não configurado): cria a conta mesmo assim
          // e o síndico repassa a senha temporária ao gestor
          console.error("convite email", error.message);
          const { data: cu, error: ec } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: meta });
          if (ec || !cu?.user) { await admin.from("gestores").delete().eq("id", linha.id); return json({ erro: "Não consegui criar o acesso: " + (ec?.message || error.message) }, 502, origin); }
          gid = cu.user.id; aviso = " (o e-mail não saiu: repasse a senha temporária abaixo ao gestor)";
        } else gid = data.user.id;
        // a mesma senha do e-mail passa a valer para entrar (e-mail confirmado pelo próprio convite)
        if (!aviso) {
          const { error: ep } = await admin.auth.admin.updateUserById(gid, { password: senha, email_confirm: true });
          if (ep) { console.error("senha temporaria", ep.message); aviso = " (a senha temporária não foi ativada; o gestor entra pelo link do e-mail)"; }
          else comSenha = true;
        } else comSenha = true;
      } else {
        const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL });
        if (error) aviso = " (o e-mail de acesso não saiu; use Reenviar acesso)";
      }
      await admin.from("perfis").update({ papel: "gestor", ativo: true, plano: "gestor" }).eq("id", gid);
      await admin.from("gestores").update({ gestor_id: gid }).eq("id", linha.id);
      // a senha temporária volta também para o síndico, que pode repassá-la pessoalmente ou por WhatsApp
      return json({ ok: true, senha_temporaria: comSenha ? senha : undefined, validade_horas: VALIDADE_TEMP_H, mensagem: comSenha
        ? `${aviso ? "Acesso criado para " + email + aviso : "Convite enviado para " + email + ", com uma senha temporária válida por " + VALIDADE_TEMP_H + " horas"}. No primeiro acesso, ${nome} cria a própria senha e já entra nos condomínios autorizados.`
        : `Convite enviado para ${email}${aviso}. ${nome} cria a senha pelo e-mail e já entra com acesso aos condomínios autorizados.` }, 200, origin);
    }

    const { data: g } = await admin.from("gestores").select("*").eq("id", b.id || "").eq("sindico_id", uid).maybeSingle();
    if (!g) return json({ erro: "Gestor não encontrado na sua equipe." }, 404, origin);

    if (b.acao === "remover") {
      await admin.from("gestores").update({ status: "removido" }).eq("id", g.id);
      return json({ ok: true, mensagem: `${g.nome} não tem mais acesso aos seus condomínios.` }, 200, origin);
    }
    if (b.acao === "reenviar") {
      if (g.status !== "ativo") return json({ erro: "Este gestor foi removido." }, 400, origin);
      // Gestor que ainda não criou a própria senha: recebe uma senha temporária nova (a anterior deixa de valer).
      // Quem já usa o SINDICS recebe só o link de troca de senha, sem perder o acesso atual.
      let novaTemp = "";
      if (g.gestor_id) {
        const { data: gu } = await admin.auth.admin.getUserById(g.gestor_id);
        const meta = gu?.user?.user_metadata || {};
        if (gu?.user && (!gu.user.last_sign_in_at || meta.trocar_senha)) {
          novaTemp = senhaTemporaria();
          const { error: ep } = await admin.auth.admin.updateUserById(g.gestor_id, { password: novaTemp, email_confirm: true, user_metadata: { ...meta, ...metaTemp(novaTemp) } });
          if (ep) { console.error("senha temporaria", ep.message); novaTemp = ""; }
        }
      }
      const { error } = g.gestor_id
        ? await admin.auth.resetPasswordForEmail(g.email, { redirectTo: SITE_URL })
        : await admin.auth.admin.inviteUserByEmail(g.email, { redirectTo: SITE_URL, data: { nome: g.nome, convite: "gestor" } });
      if (error && !novaTemp) return json({ erro: "O e-mail não saiu: " + error.message }, 502, origin);
      if (error) return json({ ok: true, senha_temporaria: novaTemp, validade_horas: VALIDADE_TEMP_H, mensagem: `O e-mail não saiu, mas a nova senha temporária já vale (por ${VALIDADE_TEMP_H} horas): repasse-a ao gestor. A senha anterior deixou de valer.` }, 200, origin);
      return json({ ok: true, senha_temporaria: novaTemp || undefined, validade_horas: VALIDADE_TEMP_H, mensagem: novaTemp
        ? `Enviei para ${g.email} uma nova senha temporária (válida por ${VALIDADE_TEMP_H} horas) e o link de acesso. A senha anterior deixou de valer.`
        : `Enviei para ${g.email} um link para criar ou trocar a senha.` }, 200, origin);
    }
    return json({ erro: "Ação desconhecida." }, 400, origin);
  } catch (e) {
    console.error(e);
    return json({ erro: (e as Error).message || "Erro ao processar." }, 500, origin);
  }
});
