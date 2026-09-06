// chatwork-admin v2 — Chatwork管理操作（me / contacts / create_room / members / add_member）
// 2026-09-04 住宅契約事前Checkルーム新設のために追加。トークンはEdge Secret CHATWORK_API_TOKEN。
// ※デプロイはMCP/CLI経由。このファイルが正本（2026-09-06版・本番と同一内容を保存）
const CW = Deno.env.get("CHATWORK_API_TOKEN");
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const H = () => ({ "X-ChatWorkToken": CW! });

Deno.serve(async (req) => {
  try {
    if (!CW) return json({ ok: false, error: "no CHATWORK_API_TOKEN" }, 400);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (action === "me") {
      const r = await fetch("https://api.chatwork.com/v2/me", { headers: H() });
      return json({ ok: r.ok, me: await r.json() });
    }
    if (action === "contacts") {
      const r = await fetch("https://api.chatwork.com/v2/contacts", { headers: H() });
      const c = await r.json();
      const list = Array.isArray(c) ? c.map((x: any) => ({ account_id: x.account_id, name: x.name, chatwork_id: x.chatwork_id })) : c;
      return json({ ok: r.ok, contacts: list });
    }
    if (action === "members") {
      const r = await fetch(`https://api.chatwork.com/v2/rooms/${body.room_id}/members`, { headers: H() });
      return json({ ok: r.ok, members: await r.json() });
    }
    if (action === "add_member") {
      const room = String(body.room_id ?? "");
      const add = Number(body.account_id ?? 0);
      if (!room || !add) return json({ ok: false, error: "room_id and account_id required" }, 400);
      const r0 = await fetch(`https://api.chatwork.com/v2/rooms/${room}/members`, { headers: H() });
      const cur = await r0.json();
      if (!r0.ok) return json({ ok: false, error: "members fetch failed", resp: cur });
      const admins = cur.filter((m: any) => m.role === "admin").map((m: any) => m.account_id);
      const members = cur.filter((m: any) => m.role === "member").map((m: any) => m.account_id);
      const readonly = cur.filter((m: any) => m.role === "readonly").map((m: any) => m.account_id);
      if (![...admins, ...members, ...readonly].includes(add)) members.push(add);
      const p = new URLSearchParams({ members_admin_ids: admins.join(",") });
      if (members.length) p.set("members_member_ids", members.join(","));
      if (readonly.length) p.set("members_readonly_ids", readonly.join(","));
      const r = await fetch(`https://api.chatwork.com/v2/rooms/${room}/members`, {
        method: "PUT", headers: { ...H(), "Content-Type": "application/x-www-form-urlencoded" }, body: p,
      });
      return json({ ok: r.ok, status: r.status, resp: await r.text() });
    }
    if (action === "create_room") {
      const name = String(body.name ?? "");
      const desc = String(body.description ?? "");
      const admins = (Array.isArray(body.admin_ids) ? body.admin_ids : []).join(",");
      const members = (Array.isArray(body.member_ids) ? body.member_ids : []).join(",");
      if (!name || !admins) return json({ ok: false, error: "name and admin_ids required" }, 400);
      const p = new URLSearchParams({ name, description: desc, icon_preset: "document", members_admin_ids: admins });
      if (members) p.set("members_member_ids", members);
      const r = await fetch("https://api.chatwork.com/v2/rooms", {
        method: "POST", headers: { ...H(), "Content-Type": "application/x-www-form-urlencoded" }, body: p,
      });
      return json({ ok: r.ok, status: r.status, resp: (await r.text()).slice(0, 300) });
    }
    return json({ ok: false, error: "unknown action (me|contacts|members|add_member|create_room)" }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e as any)?.message ?? e) }, 500);
  }
});
