# 住宅契約事前Check ボード（hazemoto-keiyaku-board）

契約前の書類（契約書・見積・図面・仕様書）をAI秘書こはぜが突合し、
指摘→修正→差分再チェックの履歴を社内共有するアプリ。ハゼモト建設株式会社 社内専用。

**⚠️ このリポジトリはPrivate運用が前提。Publicにしないこと**（閲覧トークンがソースに含まれる。
施主情報・原価情報は含まれていない）。

## 構成

| 層 | 場所 | 正本ファイル |
|---|---|---|
| 画面 | Vercel `hazemoto-keiyaku-board`（チーム: hazemoto） | `web/index.html` |
| API | Supabase kenPJ (`rrfeqnzxhbxntyewgeyj`) Edge Functions | `supabase/functions/keiyaku-board/index.ts`（一覧・署名URL・アップ受付・Chatwork通知）<br>`supabase/functions/chatwork-admin/index.ts`（ルーム管理） |
| DB | Supabase | `supabase/schema.sql`（keiyaku_checks / keiyaku_uploads / skill_growth） |
| ファイル | Supabase Storage | `keiyaku-reports`（非公開・署名URL60分）／`keiyaku-public`（未使用・HTML降格のため） |
| 通知 | Chatwork | ルーム446972310「住宅契約事前Check」。APIトークンはEdge Secret `CHATWORK_API_TOKEN` |

- 本番URL: https://hazemoto-keiyaku-board-hazemoto.vercel.app
- 閲覧トークン: `keiyaku-board/index.ts` の `TOKEN` 定数（＝Chatworkルーム概要欄に掲示している値）

## 運用（誰が何をするか）

1. 営業・設計がボードの「書類アップロード」タブへPDFを入れる
2. Chatworkルームへ自動通知（Edge Function内の定型文）
3. 社長→こはぜ「ボードの新着をチェック」→ 突合・数量検算・単価判定
4. 報告書PDFがChatworkへ（CLAUDE.md 例外3）＋ ボードに第N回として履歴掲載（前回比つき）
5. 修正版を再アップ → 🔴重大0になってから契約

チェックのロジック本体はこのリポジトリではなく、こはぜのスキル
（ClaudeBOX/.claude/skills/keiyaku-seigo-check ほか）にある。

## デプロイ手順（変更時）

**原則：このリポジトリのファイルを直して → デプロイ → 差分照合。本番直編集・手写し禁止。**

- 画面: `web/index.html` を編集 → Vercelへデプロイ（MCP `deploy_to_vercel` または Vercel CLI。
  project=hazemoto-keiyaku-board, target=production）→ 本番URLをブラウザで表示確認
- API: `supabase/functions/*/index.ts` を編集 → Supabaseへデプロイ（MCP `deploy_edge_function`
  または supabase CLI）→ デプロイ後にGET/POSTを1本ずつ叩いて確認
- DB変更: `schema.sql` に追記してから `execute_sql` で適用（schema.sqlが履歴を兼ねる）

## トークンの差し替え（漏えい時）

1. `supabase/functions/keiyaku-board/index.ts` の `TOKEN` を新しい値に変更（`openssl rand -hex 10`）
2. デプロイ → 旧トークンは即失効
3. Chatworkルーム概要欄の掲示を更新（利用者は次回アクセス時に再入力）

## 宿題（TODO）

- [ ] `TOKEN` をEdge Secret `BOARD_TOKEN` へ移す（supabase CLIのセットアップ後。コードは
      `Deno.env.get("BOARD_TOKEN")` に変更し、このREADMEから本節を消す）
- [ ] GitHub→Vercel自動デプロイの接続（現在は手動デプロイ。接続時はプロジェクトを作り直さず
      既存プロジェクトにGitを紐付けること——URLが変わるとチーム掲示が無効になる）
- [ ] 外販時: マルチテナント化（案件テーブルに会社ID・トークンを会社ごとに分離・実名データの排除）

## 履歴

- 2026-09-04 初版（ボードv1: 一覧のみ）
- 2026-09-06 v2: 回次履歴・前回比diff・書類アップロード（受領箱→Chatwork自動通知）・成長ログ
- 2026-09-06 リポジトリ化（本番と同一ソースを保存）
