# メッセージ（スカウト・DM）を有効にする手順

> ## 進捗（2026-09-03）
> | 手順 | 状態 |
> |---|---|
> | 1. SQL（staff / messages / RLS / 既読関数） | **✅ 実行済み** |
> | 1-追加. 運営が書類を参照できるポリシー | **✅ 実行済み**（既存の本人用4本は無傷） |
> | 1-補. `profiles.email` の空を埋める | **✅ 実行済み**（1件。トリガー作成前の会員だった） |
> | 2. 運営アカウント作成＋ staff 登録 | **✅ 完了**（`r_matsuoka+scout@agent-best.net` / staff 登録済み） |
> | 3. Apps Script の貼り直し＋既存デプロイの更新 | **✅ 完了**（バージョン4・2026/09/03 18:15・URLは変わらず） |
> | 4. `messages_notify` ウェブフック | **✅ 作成済み**（profiles_notify と同じURL・同じ合言葉） |
> | 4-補. Redirect URLs に `http://127.0.0.1:8787/**` | **✅ 追加済み**（手元で会員ログインを試すため） |
> | 5. サイトの push | ⬜ 未 |
>
> **疎通確認済み**：`messages` に1件入れて通知メールが1秒で届くことを確認し、その行は削除しました
> （Supabase → ウェブフック → Apps Script → Gmail が一本につながっています）。
>
> 残りは **通しテスト** と **5（push）** だけです。
>
> | アカウント | 役割 |
> |---|---|
> | `r_matsuoka+scout@agent-best.net` | **運営**（管理画面のログイン・staff 登録済み・会員行なし） |
> | `ryouji919919@gmail.com` | **テスト会員**（受信同意は要ON） |
> | `r_matsuoka@agent-best.net` | 会員（2026-08-15の動作確認で作ったもの） |

マイページに **担当者 ↔ 会員の 1 対 1 のメッセージ機能**を足しました。

- **当社から会員へ** … 求人を添えてスカウトを送る（管理画面 `admin/` から）
- **会員から当社へ** … マイページから質問・返信を送る
- 会員に届いたら **メールで「メッセージが届いています」を通知**する（受信同意がある方のみ）

> ⚠ 求人企業が直接送る形ではありません。送り主は常に**当社（エージェントベスト）**です。
> 企業アカウントも企業側のログインもありません。

```
管理画面 admin/ ─┐
                 ├→ Supabase public.messages ─→ Database Webhook ─→ Apps Script ─→ メール通知
マイページ ───────┘                                （通知スクリプト.gs）
```

---

## 手順1. SQL を1回貼る（✅ 実行済み・作り直すとき用の記録）

Supabase ダッシュボード → **SQL Editor** → New query → 下をまるごと貼って Run。

```sql
-- ============================================================
-- メッセージ機能（担当者 ↔ 会員のDM／スカウト）
-- ============================================================

-- 運営メンバー。ここに載っている auth ユーザーだけが、
-- 全会員のプロフィールとメッセージを読み書きできる。※行は手で入れる（自己登録はできない）
create table if not exists public.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text,
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;

-- 自分がスタッフかどうかだけ確認できる（他人の行は見えない）
drop policy if exists "自分のスタッフ行のみ" on public.staff;
create policy "自分のスタッフ行のみ" on public.staff
  for select using (auth.uid() = user_id);

-- スタッフ判定。RLS の中から staff を直接 select すると再帰するので関数にする
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

-- メッセージ本体（会員1人＝1スレッド）
create table if not exists public.messages (
  id           bigint generated always as identity primary key,
  user_id      uuid        not null references auth.users(id) on delete cascade, -- 会員（＝スレッドの持ち主）
  from_staff   boolean     not null,          -- true＝当社から / false＝会員から
  body         text        not null,
  job_id       text,                          -- 添えた求人（任意）
  job_name     text,                          -- 求人が消えても文面が読めるように控えておく
  company      text,
  member_email text,                          -- 通知メールの宛先。同意が無い人には入れない
  member_name  text,
  created_at   timestamptz not null default now(),
  read_at      timestamptz                    -- 受け取った側が開いた時刻
);
create index if not exists messages_user_idx on public.messages (user_id, created_at);

alter table public.messages enable row level security;

-- 読む：本人のスレッド、またはスタッフ
drop policy if exists "本人かスタッフだけ読める" on public.messages;
create policy "本人かスタッフだけ読める" on public.messages
  for select using (auth.uid() = user_id or public.is_staff());

-- 書く：会員は「会員から」しか書けない／スタッフは「当社から」しか書けない
--       （＝会員が当社を名乗ることも、その逆もできない）
drop policy if exists "会員は自分の返信だけ" on public.messages;
create policy "会員は自分の返信だけ" on public.messages
  for insert with check (
    (auth.uid() = user_id and from_staff = false)
    or (public.is_staff() and from_staff = true)
  );

-- 既読は関数経由だけ（update ポリシーは張らない＝本文の書き換えができない）
create or replace function public.mark_messages_read()
returns void language sql security definer set search_path = public as $$
  update public.messages set read_at = now()
   where user_id = auth.uid() and from_staff = true and read_at is null;
$$;

create or replace function public.mark_thread_read(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'not staff'; end if;
  update public.messages set read_at = now()
   where user_id = p_user and from_staff = false and read_at is null;
end $$;

-- 運営は会員一覧を読める（会員自身のポリシーはそのまま残る）
drop policy if exists "運営は会員一覧を読める" on public.profiles;
create policy "運営は会員一覧を読める" on public.profiles
  for select using (public.is_staff());
```

> **なぜ update ポリシーを張らないか**：張ると、会員が自分のスレッドにある
> 「当社から」のメッセージの本文まで書き換えられてしまいます。既読を付けるだけなら
> `mark_messages_read()` で足ります。

---

## 手順2. 運営アカウントを作る（管理画面のログイン）

管理画面はメール＋**パスワード**でログインします（マジックリンクは手元のページに戻せないため）。
会員用のログインとは別のアカウントにしてください。

⚠ **会員として登録済みのメールアドレスは使えません**（`A user with this email address has already been
registered` になります）。`r_matsuoka@agent-best.net` はマイページの動作確認で会員登録済みなので、
**`r_matsuoka+scout@agent-best.net` のような別アドレス**にしてください（`+` 付きは同じ受信箱に届きます）。
会員アカウントと運営アカウントは、そもそも分けておいたほうが安全です。

1. Supabase ダッシュボード → **Authentication** → **Users** → 「Add user」→ **Create new user**
2. Email：`r_matsuoka@agent-best.net`（何でも可）／Password：**強いものを生成してパスワード管理ツールへ**
3. **Auto Confirm User を ON**（確認メールを踏まずにログインできるように）
4. 作成された行の **User UID** をコピー
5. SQL Editor で、その UID を運営として登録する

```sql
insert into public.staff (user_id, name)
values ('ここに User UID を貼る', '松岡')
on conflict (user_id) do nothing;
```

> ⚠ **staff に入れた人は、全会員の氏名・希望条件・メールアドレスを見られます。**
> 増やすときは必ずこの SQL を手で実行してください。画面から追加する導線はわざと作っていません。

### （任意）運営が履歴書・職務経歴書を開けるようにする

管理画面から書類を直接開きたい場合だけ実行します。実行しなくてもメッセージ機能は動きます
（Supabase のダッシュボード → Storage → documents からは今までどおり見られます）。

```sql
drop policy if exists "運営は書類を参照できる" on storage.objects;
create policy "運営は書類を参照できる" on storage.objects for select
  using (bucket_id = 'documents' and public.is_staff());
```

> 既存の「本人の書類のみ参照／登録／更新／削除」の4本は**絶対に消さないでください**。
> ここで足すのは参照の1本だけです。

---

## 手順3. メール通知のウェブフックを足す（ウェブフック側は ✅ 作成済み）

会員登録・応募の通知で使っている **Apps Script のウェブアプリURL**をそのまま使います
（作業一式は `C:\Users\user\jobsite-notify\`）。

1. `jobsite-notify\通知スクリプト.gs` を Apps Script に貼り直す（`messages` の分岐が入っています）
2. **「デプロイを管理」→ 既存のデプロイを編集 → 新バージョン**で更新する
   ⚠ 「新しいデプロイ」を作るとURLが変わり、会員登録の通知が止まります
3. ~~Supabase ダッシュボード → **Database** → **Webhooks** → Create a new hook~~
   **✅ `messages_notify` は作成済み。** 下の表は作り直すとき用。

| 項目 | 値 |
|---|---|
| Name | `messages_notify` |
| Table | `public.messages` |
| Events | **Insert** だけ |
| Type | HTTP Request → POST |
| URL | 会員登録通知と同じウェブアプリURL＋`?token=…`（同じ合言葉） |

送信先の振り分けは Apps Script 側でやります。

- `from_staff = true`（当社→会員）… **`member_email` が入っているときだけ**会員へ送る
- `from_staff = false`（会員→当社）… 担当者（`TO_ADDRESS`）へ送る

---

## 受信同意（特定電子メール法）の扱い

**`profiles.contact_consent` が `true` の会員にしか通知メールを送りません。**

仕組み上そうなるように、管理画面が送信時に `member_email` を入れるかどうかで決めています。

| 会員の同意 | サイト内のメッセージ | メール通知 |
|---|---|---|
| 受け取る（true） | 届く | **届く** |
| 受け取らない（false） | 届く | 送らない（`member_email` が空のまま） |

- 管理画面の会員一覧に「メール可／サイト内のみ」を出しています。送る前に必ず見えます。
- 通知メールには**送信者情報**と**配信停止の方法**（マイページのチェックを外す）を必ず入れています。
- 会員がチェックを外すと `contact_consent` が false になり、次回から通知が飛ばなくなります。

---

## ⚠ `profiles.email` が空だと通知が飛ばない

スカウトの通知メールは **`profiles.email`** を宛先にします（管理画面がここを読んで `messages.member_email` に入れる）。
ところが **`on_auth_user_created` トリガーを作る前に登録された会員は、この欄が空**です。
空のままだと、受信同意が付いていてもメールが飛びません。

```sql
-- 空のものを auth.users から埋め直す（2026-09-03に1件実行済み）
update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id and u.email is not null
   and (p.email is null or p.email <> u.email);
```

> この UPDATE は `profiles_notify` を起こすので、**更新した件数だけ「会員情報が更新されました」が届きます**。

---

## 退会したときのメッセージ

`messages.user_id` は `auth.users(id)` を **`on delete cascade`** で参照しています。
会員がマイページから退会すると `delete_own_account()` が `auth.users` の行を消すため、
**やりとりも一緒に消えます**（この関数には手を入れていません）。

> 利用規約 第5項・第6項と、プライバシーポリシー第10項に、この動きを書いてあります。
> **FK の `on delete cascade` を外すと、退会した人のメッセージだけが残ってしまい、記載と食い違います。**

---

## ⚠ 受信同意をDBで直接立てた行がある場合の扱い

`contact_consent` / `contact_consent_at` は「本人がいつ受け取ると言ったか」の記録です。
**通常はマイページのチェックボックス以外から立てないでください。**
画面を通さずにSQLで立てると、あとから「本人がチェックした同意」と区別がつかなくなります。

やむを得ず立てた場合（テスト協力者など、口頭で承諾を得た相手）は、**誰の分をいつ・なぜ立てたかをここに書き足してください。**

| 日付 | メールアドレス | 経緯 |
|---|---|---|
| （記入例）2026-09-03 | dxworkstyle@gmail.com | テスト協力者。口頭で承諾を得たうえでSQLで設定 |

> 配信停止の導線（マイページの「求人のご案内」のチェックを外す）は、この場合も必ず機能します。
> 相手から「もう要らない」と言われたら `contact_consent` を false に戻してください。

---

## ⚠ 運営アカウントにも会員プロフィールの行ができる

`auth.users` の作成トリガー `on_auth_user_created` は**運営アカウントにも `profiles` の行を作ります**。
そのままだと会員一覧に運営が混ざるので、staff に入れたら消してください。

```sql
delete from public.profiles where id in (select user_id from public.staff);
```

> 管理画面側でも自分のIDを一覧から除いています（`loadProfiles`）。両方入れてあるのは保険です。
> 運営アカウントを作ると「新しい会員登録がありました」の通知メールが1通飛びますが、無視して構いません。

---

## ⚠ Apps Script はどれか（同じ名前の「無題のプロジェクト」が複数ある）

**本物はこれ**（会社アカウント `r_matsuoka@agent-best.net`）:

https://script.google.com/u/1/home/projects/1Az6DGphzY8yDRBXcFCoofvPzC0tQAeWhXDLuvkUqDJV-MO8_h5wch7Fq/edit

見分け方は **デプロイIDがウェブフックのURLと一致するか**（`AKfycbwSPDbv…sQ2Ivgq0mqYK`）。
コードの冒頭が「jobs.agent-best.net / shinsotsu.agent-best.net の通知」の2サイト表記になっているのも目印。

⚠ **ブラウザの既定アカウントはプライベート（`ryouji919919@gmail.com`）。**
`script.google.com/home` を開くとそちらが出る。**会社アカウントは `/u/1/`** を付ける
（Search Console と同じ事情）。

⚠ プライベート側にも**古い通知スクリプトのコピー**が残っている（デプロイなし・[[jobsite-mypage-notify]] の
「最初プライベートアカウントで作ってしまい作り直した」の残骸）。**紛らわしいので消したほうがよい。**
2026-09-03に、これを本物と取り違えて一度上書きしてしまった（デプロイしていないので実害なし）。

---

## ローカル（`スカウト管理画面.bat`）で会員ログインを試すために

会員ログインのマジックリンクは、Supabase の **Redirect URLs** に載っている先にしか戻れません。
手元のコピー（`http://127.0.0.1:8787/`）で会員登録・ログインを試せるように、次を追加してあります。

**Authentication → URL Configuration → Redirect URLs**

| URL | 用途 |
|---|---|
| `https://jobs.agent-best.net/**` | 本番（元からある） |
| `http://127.0.0.1:8787/**` | **手元での動作確認用（2026-09-03追加）** |

> `127.0.0.1` は各自の端末の中だけを指すので、他人のリンクを横取りする経路にはなりません。
> 不要になったら消して構いませんが、消すとローカルでの会員ログインが試せなくなります。

> ⚠ **Site URL（`https://jobs.agent-best.net`）は変えないこと。** ここを 127.0.0.1 にすると、
> 本番の会員に届くログインリンクが手元のURLになります。

⚠ ダッシュボードのこの画面は**ページ倍率が100%でないとクリック位置がずれます**。
ブラウザ操作で入力するときは、座標ではなく要素を指定すること。

---

## 通知メールから戻ってくる導線

会員あての通知メールには `https://jobs.agent-best.net/?mypage=1` を載せています。
このURLで開くと**マイページが自動で開き**、`?mypage=1` はURLから取り除かれます
（`template.html` の末尾）。ログインが切れていればログイン欄が出て、ログインが成立した時点で描き直します。

---

## 動作確認

1. 自分のメールで会員登録し、マイページで「求人のご案内を受け取る」に**チェックを入れて保存**
2. `管理画面.bat` を起動 → 運営アカウントでログイン → その会員を選ぶ
3. 求人を添えてスカウトを送る → **通知メールが届く**
4. マイページを開く → メッセージが出る → 返信する
5. 担当者あてに「会員から返信がありました」が届く

うまく動かないときに見る場所：

| 症状 | 見るところ |
|---|---|
| 管理画面で会員が0件 | `staff` に自分の UID が入っているか／手順1のSQLを実行したか |
| 送信できない（403） | RLS の insert ポリシー。`from_staff` の値と `is_staff()` の組み合わせ |
| マイページにメッセージ欄が出ない | ブラウザのコンソール。`messages` テーブルが無いと欄ごと出ない作りです |
| スカウトは届くのにメールが来ない | `profiles.email` が空でないか。`on_auth_user_created` トリガーを作る前に登録された会員は空のままです（下記） |
| メールが届かない | 会員の `contact_consent`／ウェブフックの token／Apps Script のデプロイが新版か |
