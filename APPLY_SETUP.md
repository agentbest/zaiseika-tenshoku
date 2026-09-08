# 応募（転職支援サービスの申し込み）フォームの受け皿

`apply.html` の送信先を作る手順。**このSQLを実行するまで、フォームは送信時にエラーになります**
（画面には「送信できませんでした。…r_matsuoka@agent-best.net あてにご連絡ください」と出るので、リンクが死ぬわけではありません）。

```
apply.html（jobs.agent-best.net）
  → Supabase の public.applications に INSERT（匿名キー・INSERTのみ許可）
  → Database Webhook が発火
  → Google Apps Script のウェブアプリ（jobsite-notify/通知スクリプト.gs）
  → Gmail で担当者へメール
```

Supabase プロジェクトはマイページと同じ **`jobsite-tokyo`（`jvdnabtpxcyfnogdulea`・東京）** を使います。

---

## 1. テーブルとRLSを作る（Supabase → SQL Editor で実行）

```sql
create table if not exists public.applications (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),

  -- どの求人から来たか（求人を指定せずに直接申し込んだ場合は null）
  job_id             text,
  job_name           text,
  company            text,

  -- 本人
  full_name          text not null,
  kana               text,
  birth_date         date,
  experience_job     text,
  prefecture         text,
  current_salary     text,
  email              text not null,
  phone              text,

  -- 面談・状況
  meeting_type       text,
  timing             text,
  job_hunting_status text,
  message            text,

  -- 同意（利用規約＋プライバシーポリシー）。false は入らない前提だが、記録として持つ
  consent            boolean not null default false,

  -- マイページにログイン中に申し込んだ場合だけ入る
  user_id            uuid references auth.users(id) on delete set null,
  source             text default 'jobsite',

  -- 対応状況（担当者が Supabase の画面で更新する）
  status             text default '未対応'
);

create index if not exists applications_created_at_idx on public.applications (created_at desc);
create index if not exists applications_email_idx      on public.applications (email);

alter table public.applications enable row level security;

-- サイトからは「入れる」だけ。読み出し・更新・削除のポリシーは作らない。
-- ＝ 匿名キーを持っていても、他人の申し込みは1件も読めない。
drop policy if exists "applications insert from site" on public.applications;
create policy "applications insert from site"
  on public.applications for insert
  to anon, authenticated
  with check (true);
```

### ⚠ ここは緩めない

- **SELECT / UPDATE / DELETE のポリシーを作らないこと。** 匿名キー（`sb_publishable_…`）は
  `index.html` にも `apply.html` にも書いてあり、誰でも読めます。**INSERT だけ**だから安全に置けています。
  SELECT を1つでも足すと、**応募者の氏名・生年月日・電話番号が全世界から読める**状態になります。
- `enable row level security` を外さないこと。外すと同じことが起きます。
- 担当者が中身を見るのは **Supabase の画面（Table Editor）** から。サイト側からは見ません。

---

## 2. メール通知（Database Webhook → Apps Script）

通知スクリプトはマイページの通知と**同じ Apps Script プロジェクト**を使います。
コードとトークンは `C:\Users\user\jobsite-notify\`（**Gitに入れない**。このリポジトリは Public）。

1. `jobsite-notify/通知スクリプト.gs` を Apps Script に貼り直して保存 →「デプロイ」→「デプロイを管理」→ 既存のデプロイを**編集して新バージョン**にする
   （※「新しいデプロイ」を作るとURLが変わり、`profiles` の通知が止まります）
2. Supabase → Database → Webhooks → **Create a new hook**

   | 項目 | 値 |
   |---|---|
   | 名前 | `applications_notify` |
   | テーブル | `public.applications` |
   | イベント | **INSERT のみ** |
   | 方式 | HTTP Request / POST / `Content-type: application/json` |
   | URL | Apps ScriptのウェブアプリURL ＋ `?token=`（合言葉。`通知スクリプト.gs` の `TOKEN`） |
   | タイムアウト | 10000ms |

3. `apply.html` からテスト送信して、メールが届くことを確認する

---

## 3. 動作確認のしかた

送信できたかどうかは Supabase の **Table Editor → applications** で確認します。

うまくいかないときの切り分け:

| 症状 | 見るところ |
|---|---|
| 「送信できませんでした」と出る | ブラウザのコンソール。`PGRST205` = テーブルが無い／`42501` = RLSで弾かれている |
| 行は増えるがメールが来ない | Supabase の Webhook 画面の送信ログ → Apps Script の「実行数」画面 |
| メールが二重に来る | Webhook のイベントに UPDATE が入っていないか確認（**INSERT のみ**にする） |

---

## 4. 迷惑送信への備え（今の状態）

- フォームに**ハニーポット**（画面外の `website` 入力欄）がある。埋まっていたら送信せず、完了画面だけ出す
- 同意チェックが必須
- それ以上の対策（reCAPTCHA、レート制限）は**入れていない**。
  実際に迷惑送信が来たら、Supabase の Edge Function を挟むか、Cloudflare Turnstile を足す

## 5. Airtable へ寄せたくなったら

いまの受け皿は Supabase だけです。Airtable の「求人応募（サイト）」`tblmHnF3Vq1WXT9ix` には**流れません**。
CRM側に集約したい場合は、上の Apps Script の中で Airtable API を叩いて1行足すのが一番手数が少ない
（Apps Script は非公開なのでトークンを置ける）。
