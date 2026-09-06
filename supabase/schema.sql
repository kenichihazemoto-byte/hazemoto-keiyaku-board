-- 住宅契約事前Check ボード スキーマ（Supabase kenPJ rrfeqnzxhbxntyewgeyj）
-- 適用履歴を兼ねる。変更時はここに追記してから execute_sql で適用する。
-- RLSは全表で有効・ポリシー無し＝アクセスはEdge Function（service role）経由のみ。

-- 2026-09-04 チェック履歴（1回のチェック＝1行。回を重ねたら行を追加、上書きしない）
create table if not exists keiyaku_checks (
  id bigint generated always as identity primary key,
  project text not null,
  round int not null default 1,
  check_date date not null,
  status text not null default '指摘中',
  counts jsonb not null default '{}'::jsonb,   -- {red,yellow,blue,ok, diff:{resolved,new,continued}}
  findings jsonb not null default '[]'::jsonb, -- [{rank:red|yellow|blue, title, status, change:resolved|new|continued}]
  files jsonb not null default '[]'::jsonb,    -- [{path,label}] path=keiyaku-reports内キー(ASCIIのみ)
  note text,
  updated_at timestamptz not null default now(),
  unique(project, round)
);
alter table keiyaku_checks enable row level security;

-- 2026-09-06 書類受領箱（ボードのアップロードタブから）
create table if not exists keiyaku_uploads (
  id bigint generated always as identity primary key,
  project text not null,
  uploaded_by text not null default '',
  original_name text not null,               -- 日本語ファイル名はここに保持
  storage_path text not null,                -- uploads/<ts>_<rand>.<ext>（ASCIIのみ）
  note text default '',
  status text not null default '未チェック',  -- → 'チェック済（第N回に反映）'
  created_at timestamptz not null default now()
);
alter table keiyaku_uploads enable row level security;

-- 2026-09-06 こはぜ成長ログ（検出パターンの増加履歴）
create table if not exists skill_growth (
  id bigint generated always as identity primary key,
  learned_on date not null,
  case_name text not null,
  title text not null,
  detail text default ''
);
alter table skill_growth enable row level security;

-- Storage バケット
insert into storage.buckets (id, name, public) values
  ('keiyaku-reports','keiyaku-reports', false)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values
  ('keiyaku-public','keiyaku-public', true)   -- HTML降格のため現在未使用
on conflict (id) do nothing;
