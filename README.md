# 財政課転職（zaiseikatenshoku.com）

自治体・官公庁で働いてきた人、とくに**財政課**に向けた求人サイト。
`jobsite`（jobs.agent-best.net）を複製し、**載せる求人を「公務員の経験が活きるもの」だけに絞った**もの。

- 公開URL: https://zaiseikatenshoku.com/
- サイト固有の作り（求人の絞り方・お仕事図鑑・2つの入口）は **`CLAUDE.md` の冒頭**にまとまっている。
  以下は jobsite から引き継いだ共通部分の説明で、**サイト名とドメイン以外はそのまま当てはまる**。

## フォルダ構成
- `index.html` … 完成した求人サイト（単一ファイル・中途422件を内蔵）
- `template.html` … その元テンプレート（`__JOBS_DATA__` が差し込み位置）
- `apply.html` … 転職支援サービスの申し込みフォーム（求人の「応募する」の遷移先）
- `apply-template.html` … その元テンプレート（`__JOBS_MINI__` が差し込み位置）
- `data/jobs.json` … Airtable から取得した求人データ 456 件（正規化済み・compact JSON）
  ⚠ このうち **中途 422 件だけ**が `index.html` に入る。`rebuild.js` の `midCareerOnly()` が新卒・インターンを落とす。
- `data/logos.json` … 企業ロゴの対応表（企業名 → `assets/logos/…` のパス・22社）
- `assets/logos/` … 企業ロゴの画像本体（Airtable「求人DB（企業）」の ロゴ 列から取り込み）
- `fetch-logos.js` … ロゴを取り込み直すスクリプト（実行: `node fetch-logos.js` → `node rebuild.js`）
- `data/employees.json` … 従業員数の対応表（企業名 → `{raw:原文, n:人数}`・24社）
- `fetch-employees.js` … 従業員数を取り込み直すスクリプト（実行: `node fetch-employees.js` → `node rebuild.js`）
  ⚠ 人数は Airtable の「従業員数（数値）」列が正。**サイト側で原文から推測しない**。空の企業は「企業規模」で絞り込めない。
- `SUPABASE_SETUP.md` … マイページに「会員登録・ログイン」を足すときの手順書
- `APPLY_SETUP.md` … **応募フォームの受け皿（Supabase の applications テーブル）を作る手順書**
- `rebuild.js` … `data/jobs.json` を各テンプレートに流し込んで HTML を再生成
  - 実行: このフォルダで `node rebuild.js`
  - デザインや機能を変えたいときは `template.html` / `apply-template.html` を編集 → `node rebuild.js`
  - ⚠ `index.html` と `apply.html` は生成物。**直接編集しても次回のビルドで消える**

## データの更新（最新化）手順
`data/jobs.json` は「取得時点のスナップショット」。最新化したいときは Claude（Airtable 連携）に
以下を伝えて `data/jobs.json` を作り直してもらい、`node rebuild.js` を実行する。

### Airtable 取得元
- Base: `人材紹介事業` / baseId `appYkc36EvioYoL1A`
- Table: `求人DB（求人票）` / tableId `tblyPZZasXTM2tcrV`（全 456 件。サイトに出るのは中途 422 件）
- 会社情報は Table `求人DB（企業）` / `tblBNNH9sJjldPmZZ` とリンク（会社名・会社情報・URL・会社住所・上場区分は lookup で取得済み）

### 企業ロゴの取得元（求人とは別テーブル）
Table `求人DB（企業）` / `tblBNNH9sJjldPmZZ` の **ロゴ**（`fld32OKkkAS1lJbr8`・添付）と
**企業ID**（`fldc00Oz8xvDq1r3T`・ファイル名に使う）。取り込みは `node fetch-logos.js`。
2026-08-31時点で**掲載中の求人が参照している24社すべて**にロゴがある（＝中途426件は全件にロゴが出る）。
⚠ `assets/logos/lts.png` と `bridgeone.png` は手でトリミングした版。`fetch-logos.js` を回すと
Airtable の原本（余白の多いOGPバナー等）で上書きされるので、回したあとは見え方を確認すること。

### 使用フィールド（fieldId → jobs.json のキー）
| fieldId | 内容 | jobs.json キー |
|---|---|---|
| fldp0GXKIkufwPQFF | 求人タイトル(表示) | title |
| fldoQsYnH5W90qiKW | 会社名(link) | company |
| fldwyqGnE2veXVaJo | 職種・募集ポジション | position |
| fldKceIwtiUSMmZaH | 雇用形態 | employment |
| fldZrrfEai4UaVtNV | 区分 | kubun |
| fld8g1uhuhAhkVxjS / fldIaQVH5rsmzoo9Y | 年収下限 / 上限 | salaryMin / salaryMax |
| fldeGeORYsBiYJNIF | 給与（原文） | salaryRaw |
| fldsIgsArolZDt1I5 | 勤務地 | location |
| fldrDT2UQOqO0L06f | 勤務時間 | workHours |
| fldK16PPXO2RZO011 | 休日 | holidays |
| fldUNtnN6ueSqeWvU | 福利厚生 | benefits |
| fldxZH1FmlN0WYMbK | 仕事内容 | jobContent |
| fld3mrIQScRgqWHox | 必須条件 | must |
| fldwxt81X7jzHvF5H | 歓迎条件 | welcome |
| fldy4cP88TI3Ihht1 | 求める人物像 | idealPerson |
| fldEQcK7fBwNps0tC | 選考プロセス | selectionProcess |
| flduLYPcGIpxSpFHg | 職種カテゴリ | jobCategory |
| fldBZFa0Fa2iS072D | 業界カテゴリ(link) | industry |
| fld4cEbkkOP57tEqT | 会社情報(lookup) | companyInfo |
| fldcZfB9BkIPXNi0Z | URL(lookup) | url |
| fldSfExGKjQUFanwx | 会社住所(lookup) | companyAddress |
| fld4KFQmkPBfCiczK | 上場区分(lookup) | listedStatus |
| fldPJIVJ0Tv4TQwaN | 対象卒業年（新卒・インターンのみ） | gradYear |

⚠ **`gradYear` は新卒サイト（shinsotsu.agent-best.net）が使う。**
jobs.json を作り直すときは、この列も必ず含めること（落とすと新卒サイトの卒業年の絞り込みが
求人名からの推測に戻り、精度が落ちる）。

`prefectures`（勤務地からの都道府県判定）と `remote`（在宅/リモート判定）は
`template.html` 内の JS で実行時に自動付与している（データには持たせていない）。

### 任意フィールド `createdAt`（入れると「新着順」と NEW バッジが出る）

`data/jobs.json` の各求人に `createdAt`（例 `"2026-08-01T09:00:00.000Z"`。Airtable の `createdTime` 相当）を
足すと、並び替えに**「新着順」**が増えて既定になり、掲載14日以内の求人に **NEW バッジ**が付く。
**入っていなければ、どちらも表示されない**（新しさを偽らないため）。いまの jobs.json には入っていない。

## 画面の形（ワークポート／JAC 型）

2026-08-21に、ワークポート（workport.co.jp）とJACの求人サイトの型に寄せた。

```
ヘッダー：ロゴ／グローバルナビ／キーワード検索／マイページ／「転職支援に申し込む 無料」
パンくず：ホーム › 求人情報一覧
┌─ 絞り込み ─┬─ 検索結果 ────────────────────┐
│ 働き方・年収 │ 現在の検索条件（チップ）              │
│             │ 5,732件の求人  並び替え▼  表示件数▼   │
│ 勤務地      │ ┌─ 求人1件＝横長カード1行 ───────┐ │
│  └関東 4,004 │ │ 企業名／業界              ★     │ │
│ 職種        │ │ 職種名（リンク）                 │ │
│  └エンジニア │ │ タグ／仕事内容の冒頭2行          │ │
│ 業界        │ │ 想定年収・勤務地                 │ │
│ 雇用形態    │ │        [詳細を見る] [応募する]   │ │
│ 企業規模    │ └────────────────────────┘ │
│ 上場区分    │      ‹ 前へ 1 2 3 … 16 次へ ›       │
│ タグ18箱    │                                      │
└───────────┴──────────────────────────┘
```

- **求人詳細は別ページ扱い**（`?job=<求人ID>`・pushState）。左に本文、右に「想定年収＋応募ボタン」の固定レール。
  スマホでは画面下に応募バーが張り付く。戻るボタン・URL共有が普通のページと同じように効く
- **「応募する」→ `apply.html`**（転職支援サービスの申し込みフォーム）。企業へ直接応募するのではなく、
  当社から推薦する形で選考が進む、という人材紹介の建て付けをフォーム側で明示している

## 実装している機能
- キーワード検索（職種・企業名・仕事内容など横断）
- 絞り込み（2026-09-06に作り替え）: リモート可 / 年収（下限・上限）/ 勤務地（ブロック9→都道府県47）/
  職種（大分類32→中分類107）/ 業界（大分類13→中分類33）/ 雇用形態 / 企業規模 / 上場区分 / タグ18カテゴリ
  - **件数は絞り込むたびに数え直す。0件になる選択肢は薄くして押せなくする**（押したら0件、を無くす）
  - 勤務地・職種・業界は**大分類→中分類の2段**。大分類そのものを1クリックで選べる
  - 同じ条件は左に1か所だけ（年収・リモート・勤務地・企業規模・上場区分と重複するタグは一覧に出さない。
    求人詳細のタグリンクからは今までどおり絞り込める）
  （「区分」は中途のみになったため 2026-08-28 に廃止）
- 並び替え: おすすめ / 年収が高い・低い / 企業名（＋データに `createdAt` があれば「新着順」）
- 表示件数 30 / 50 / 100 件のページネーション
- 求人詳細ページ（仕事内容などを Markdown 整形表示・企業サイトへのリンク・シェアボタン）
- 4ステップの申し込みフォーム `apply.html`（送信先は Supabase・入力途中は端末に一時保存）
- 求人カード・求人詳細の企業ロゴ … Airtable「求人DB（企業）」の ロゴ 列から取り込んだ画像
  （`assets/logos/`）。無い企業は社名の頭文字タイル。取り込みは `node fetch-logos.js`
  ⚠ **外部の favicon サービスは使わない**（訪問者がどの求人を見たかが第三者に渡るため）。
  ⚠ **Airtable の添付URLは数時間で失効する**ので直接は使えない
- ライト/ダークテーマ、スマホ対応
- **マイページ（気になる求人）** … 求人カード右上の★で保存 → ヘッダー「マイページ」から一覧
  - 初期状態は **localStorage（その端末だけ）** に保存。サーバー不要・費用ゼロ
  - `template.html` の `SUPABASE_URL` / `SUPABASE_ANON_KEY` を設定すると
    **メールでログイン（パスワード不要）** に切り替わり、端末をまたいで同期される
  - 手順は `SUPABASE_SETUP.md` を参照

## 問い合わせフォーム（相談の入口）

求人詳細の「電話で軽く話を聞きたい」「メールで質問する」の送信先です。
**応募フォームとは別物**で、履歴書・職務経歴書は受け取りません（意図的にそうしています）。

Airtable テーブル: **求人の問い合わせ（サイト）** `tbltITsj4OmX5B2PJ`（base `appYkc36EvioYoL1A`）

フォームビュー: **この求人について聞く** `viw2sJmpVaocBc9KK`
共有URL: `https://airtable.com/appYkc36EvioYoL1A/shrxmcjkaIdktH1Qk`（`INQUIRY_FORM_URL` に設定済み）

電話番号と電話のご希望時間帯は、「ご希望の連絡方法」が「電話で折り返してほしい」のときだけ出る**条件表示**にしてあります。メールで質問したいだけの人に電話番号を聞くと離脱するためです。送信があると `r_matsuoka@agent-best.net` に通知が飛びます。

### ⚠ 作り直すときは（フォームビューの共有URLはAPIから作れない）

テーブルとフィールドはAPIで作れますが、**フォームビューと共有URLはAirtableの画面でしか作れません。**
作り直す場合は下記のとおりに設定してください。**`INQUIRY_FORM_URL` を空にすると `mailto:` にフォールバック**するので、その間もリンクは死にません。

1. Airtable で **求人の問い合わせ（サイト）** を開く
2. 左のビュー一覧から **＋ → Form** で新しいフォームビューを作る
3. フォームに出す項目を、この順で並べる

   | 項目 | 設定 |
   |---|---|
   | ご希望の連絡方法 | **必須**（サイト側からプリフィルされるので、実質は確認用） |
   | 氏名 | **必須** |
   | メールアドレス | **必須** |
   | 電話番号 | 任意 ＋ **条件表示**：「ご希望の連絡方法」が「電話で折り返してほしい」のときだけ表示 |
   | 電話のご希望時間帯 | 任意 ＋ 同じ条件表示 |
   | ご質問・聞きたいこと | **任意**（必須にしない。書けない段階の人を落とさないため） |
   | 対象求人 / 企業名 | フォームには出さなくてよい（プリフィルで入る） |
   | 求人レコードID | **非表示**（`hide_` で隠している） |

4. 右上 **Share form** → 共有リンクをコピー
5. `template.html` の `INQUIRY_FORM_URL` に貼る → `node rebuild.js` → commit & push

### Slack 通知

問い合わせが入ると Slack の **#notification_siteoubo**（`C0BKL6YEDPV`）へ投稿します。
Airtable のオートメーション **「求人サイトの問い合わせを Slack へ通知」** `wflaOu5LOuWTDwia1`
（https://airtable.com/appYkc36EvioYoL1A/wflaOu5LOuWTDwia1 ）が担当します。

`#notification_siteoubo` は元々「求人応募（サイト）」の通知先でしたが、
**応募導線を削除したためこのチャンネルは無音になります。**
求人サイト由来の反応をここに集約する形にしました。

通知は「ご希望の連絡方法」を先頭に出しています。**電話の折り返し希望は早く気づく必要がある**ためです。

> ⚠ **オートメーションは作成しただけでは動きません。** Airtable の画面で内容を確認して
> **オンにする**必要があります（API から作成したものは必ず下書き状態になります）。
>
> ⚠ 選択肢フィールド（ご希望の連絡方法・電話のご希望時間帯）は `…["fldXXX","name"]` のように
> **`name` まで指定しないと保存できません**。オブジェクトが返るためです。

### ⚠ プリフィルはフィールド名と一致していないと効かない

`template.html` の `inquiryUrl()` が `prefill_ご希望の連絡方法` / `prefill_対象求人` /
`prefill_企業名` / `prefill_求人レコードID` を送っています。
**Airtable 側のフィールド名を変えると、黙って効かなくなります。**

選択肢の名前も同様です。`WAY_TEL` / `WAY_MAIL` は Airtable の
「ご希望の連絡方法」の選択肢と**一字一句同じ**にしてください。

## 応募フォーム（転職支援サービスの申し込み）

求人カード・求人詳細の「応募する」→ `apply.html?job=<求人ID>`。

4ステップ（①お名前・生年月日 ②直近の経験職種・都道府県・現年収 ③メール・携帯 ④面談方法・転職時期・状況・同意）。
面談日時は聞かず、送信後の完了画面で Calendly を案内する。

送信先は **Supabase の `public.applications`**（匿名キーで INSERT のみ許可）。
**このテーブルを作るまでフォームは送信時にエラーになる。** 手順・SQL・通知の設定は `APPLY_SETUP.md`。

⚠ `applications` に SELECT ポリシーを足さないこと。匿名キーは `apply.html` に書いてあるので、
1つでも足すと応募者の氏名・生年月日・電話番号が誰からでも読める。

## 既知の前提・検討中の項目（「考えたい」メモ）
- 年収 min/max 未設定が 45 件（表示は「応相談」）。扱いを検討。
- 応募を Airtable の CRM 側にも流すかは未決（`APPLY_SETUP.md` 第5項）。
- `createdAt` が無いので「新着順」と NEW バッジが出せていない。jobs.json を作り直すときに足すか要検討。
- データは常時同期ではなくスナップショット。常時同期・独自ドメイン・一般公開が必要なら
  Next.js 等の「本格 Web アプリ版」へ移行する（Airtable API キー + Vercel 等のデプロイが必要）。
- 軽量サンプル（60件版）は scratchpad の `index_sample.html` に生成済み（必要なら再作成可）。
