// keiyaku-board v5 — 契約前チェック共有ボードAPI（営業チーム向け・トークン保護）
// GET ?token=T → checks(全回次履歴)+uploads(書類受領箱)+growth(こはぜ成長ログ)+署名URL60分
// POST sign_upload→署名付きURL発行(ブラウザがStorageへ直接PUT・base64不使用=大容量OK) / register_doc→受領登録+Chatwork定型通知
// (upload_docは旧方式・base64経由のため15MB付近で546 WORKER_LIMITになる。互換のため残置)
// 原価情報は扱わない。StorageキーはASCIIのみ（日本語名はoriginal_nameに保持）
// ※デプロイはMCP/CLI経由。このファイルが正本（2026-09-06版・本番と同一内容を保存）
const TOKEN = Deno.env.get("BOARD_TOKEN") ?? ""; // 閲覧トークンはEdge Secret BOARD_TOKEN（コードに秘密を置かない）
const URL_ = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CW = Deno.env.get("CHATWORK_API_TOKEN") ?? "";
const CW_ROOM = "446972310";
const H = { apikey: SRK, Authorization: `Bearer ${SRK}` };
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" } });

async function sign(path: string): Promise<string | null> {
  const r = await fetch(`${URL_}/storage/v1/object/sign/keiyaku-reports/${path}`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 3600 }),
  });
  const j = await r.json().catch(() => null);
  return j?.signedURL ? `${URL_}/storage/v1${j.signedURL}` : null;
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return json({ ok: true });
    const u = new URL(req.url);
    if (req.method === "GET") {
      if (!TOKEN || u.searchParams.get("token") !== TOKEN) return json({ ok: false, error: "unauthorized" }, 401);
      const [rc, ru, rg] = await Promise.all([
        fetch(`${URL_}/rest/v1/keiyaku_checks?select=*&order=project.asc,round.desc`, { headers: H }),
        fetch(`${URL_}/rest/v1/keiyaku_uploads?select=*&order=created_at.desc&limit=50`, { headers: H }),
        fetch(`${URL_}/rest/v1/skill_growth?select=*&order=learned_on.desc,id.desc`, { headers: H }),
      ]);
      const rows = await rc.json();
      const uploads = await ru.json();
      const growth = await rg.json();
      for (const row of rows) {
        const signed: { label: string; url: string }[] = [];
        for (const f of (row.files ?? [])) {
          const p = typeof f === "string" ? f : f.path;
          const label = typeof f === "string" ? p.split("/").pop() : (f.label ?? p);
          const s = await sign(p);
          if (s) signed.push({ label, url: s });
        }
        row.links = signed; delete row.files;
      }
      for (const up of uploads) {
        const s = await sign(up.storage_path);
        if (s) up.url = s;
        delete up.storage_path;
      }
      return json({ ok: true, generated_at: new Date().toISOString(), rows, uploads, growth });
    }
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      if (!TOKEN || b.token !== TOKEN) return json({ ok: false, error: "unauthorized" }, 401);
      if (b.action === "upload" || b.action === "upload_public") {
        const bucket = b.action === "upload" ? "keiyaku-reports" : "keiyaku-public";
        const bin = Uint8Array.from(atob(String(b.content_base64 ?? "")), (c) => c.charCodeAt(0));
        const r = await fetch(`${URL_}/storage/v1/object/${bucket}/${String(b.path)}`, {
          method: "POST", headers: { ...H, "Content-Type": String(b.content_type ?? "application/octet-stream"), "x-upsert": "true" }, body: bin,
        });
        return json({ ok: r.ok, status: r.status, resp: (await r.text()).slice(0, 200) });
      }
      if (b.action === "sign_upload") {
        const orig = String(b.filename ?? "file").slice(0, 120);
        const ext = (orig.match(/\.[A-Za-z0-9]{1,6}$/) ?? [""])[0].toLowerCase();
        const path = `uploads/${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext || ".bin"}`;
        const r = await fetch(`${URL_}/storage/v1/object/upload/sign/keiyaku-reports/${path}`, {
          method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: "{}",
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.url) return json({ ok: false, error: "sign failed " + r.status }, 500);
        return json({ ok: true, path, upload_url: `${URL_}/storage/v1${j.url}` });
      }
      if (b.action === "register_doc") {
        const project = String(b.project ?? "").slice(0, 100);
        const by = String(b.uploaded_by ?? "").slice(0, 40);
        const orig = String(b.filename ?? "file").slice(0, 120);
        const note = String(b.note ?? "").slice(0, 300);
        const path = String(b.path ?? "");
        if (!project || !path.startsWith("uploads/")) return json({ ok: false, error: "project and path required" }, 400);
        const ins = await fetch(`${URL_}/rest/v1/keiyaku_uploads`, {
          method: "POST", headers: { ...H, "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify({ project, uploaded_by: by, original_name: orig, storage_path: path, note }),
        });
        const row = (await ins.json())?.[0];
        if (CW && !b.silent) {
          const msg = `[info][title]\u{1F4E5} 契約チェックボードに書類が届きました[/title]案件：${project}\nファイル：${orig}\n登録者：${by || "未記入"}\nメモ：${note || "なし"}\n\n→ 社長からこはぜへ「ボードの新着をチェック」と依頼すると差分チェックが走ります（この通知は定型文の自動通知です）[/info]`;
          await fetch(`https://api.chatwork.com/v2/rooms/${CW_ROOM}/messages`, {
            method: "POST", headers: { "X-ChatworkToken": CW, "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ body: msg }),
          }).catch(() => {});
        }
        return json({ ok: true, id: row?.id });
      }
      if (b.action === "upload_doc") {
        const project = String(b.project ?? "").slice(0, 100);
        const by = String(b.uploaded_by ?? "").slice(0, 40);
        const orig = String(b.filename ?? "file").slice(0, 120);
        const note = String(b.note ?? "").slice(0, 300);
        if (!project || !b.content_base64) return json({ ok: false, error: "project and content_base64 required" }, 400);
        const ext = (orig.match(/\.[A-Za-z0-9]{1,6}$/) ?? [""])[0].toLowerCase();
        const safe = `uploads/${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext || ".bin"}`;
        const bin = Uint8Array.from(atob(String(b.content_base64)), (c) => c.charCodeAt(0));
        if (bin.length > 15 * 1024 * 1024) return json({ ok: false, error: "file too large (15MB上限)" }, 400);
        const ct = String(b.content_type ?? "application/octet-stream");
        const r = await fetch(`${URL_}/storage/v1/object/keiyaku-reports/${safe}`, {
          method: "POST", headers: { ...H, "Content-Type": ct, "x-upsert": "true" }, body: bin,
        });
        if (!r.ok) return json({ ok: false, error: "storage " + r.status, resp: (await r.text()).slice(0, 150) });
        const ins = await fetch(`${URL_}/rest/v1/keiyaku_uploads`, {
          method: "POST", headers: { ...H, "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify({ project, uploaded_by: by, original_name: orig, storage_path: safe, note }),
        });
        const row = (await ins.json())?.[0];
        if (CW) {
          const msg = `[info][title]\u{1F4E5} 契約チェックボードに書類が届きました[/title]案件：${project}\nファイル：${orig}\n登録者：${by || "未記入"}\nメモ：${note || "なし"}\n\n→ 社長からこはぜへ「ボードの新着をチェック」と依頼すると差分チェックが走ります（この通知は定型文の自動通知です）[/info]`;
          await fetch(`https://api.chatwork.com/v2/rooms/${CW_ROOM}/messages`, {
            method: "POST", headers: { "X-ChatworkToken": CW, "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ body: msg }),
          }).catch(() => {});
        }
        return json({ ok: true, id: row?.id });
      }
      return json({ ok: false, error: "unknown action" }, 400);
    }
    return json({ ok: false, error: "method" }, 405);
  } catch (e) {
    return json({ ok: false, error: String((e as any)?.message ?? e) }, 500);
  }
});
