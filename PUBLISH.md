# zaiseikatenshoku.com の公開手順（DNS設定）

> **2026-09-09に完了。** SquarespaceのDNSを書き換え済み（プリセット「Squarespaceの既定値」を削除→
> カスタムレコードにA×4・AAAA×4・CNAME `www`→`agentbest.github.io`）。
> 証明書発行済み・Enforce HTTPS 有効。https://zaiseikatenshoku.com/ で公開中。
> `www` は apex へ 301、http は https へ 301。
>
> ⚠ Squarespaceの管理画面は**書き込みのたびにGoogleの再認証ダイアログ**が出る。
> このダイアログの［続行］はブラウザ自動化からは押せない（別ウィンドウが要る）ので、必ず人が押す。
> メールのSPF/DMARC/DKIMと Domain Connect のプリセットは残してある。

配信は **GitHub Pages**。ただし `agent-best.net` のサブドメインではなく**独自ドメインのルート（apex）**なので、
DNSの設定方法が既存LPと違います。**エラベル（eraberusaiyodaiko.com）と同じ手順です。**

apexドメインには CNAME を置けない（RFC上、ルートに CNAME は置けない）ので、**Aレコード4本**になります。

---

## 松岡さんにお願いする設定

**DNSは Squarespace で管理されています**（ネームサーバーが `nse1〜4.squarespacedns.com`）。
agent-best.net・eraberusaiyodaiko.com と同じ画面です。

https://account.squarespace.com/domains/managed/zaiseikatenshoku.com/dns/dns-settings

### まず、いま入っているレコードを消す

いまこのドメインは **Squarespaceの準備中ページに向いています**。実際に次のIPが返ってきています。

```
198.185.159.144 / 198.185.159.145 / 198.49.23.144 / 198.49.23.145
```

**このAレコード4本を削除してください。** 残したままGitHubのAレコードを足すと、アクセスするたびに
Squarespaceの画面と財政課転職のページが交互に出る状態になります。
`www` の CNAME（`ext-cust.squarespace.com` など）も入っていれば削除してください。

### 次に、GitHub Pages 向けのレコードを足す

「Custom Records」に、以下を追加します。

**Aレコード（必須・4本すべて）**

| タイプ | ホスト（HOST） | 値（DATA） |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |

**AAAAレコード（推奨・無くても表示されます）**

| タイプ | ホスト | 値 |
|---|---|---|
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |

**CNAMEレコード（www用・推奨）**

| タイプ | ホスト | 値 |
|---|---|---|
| CNAME | `www` | `agentbest.github.io` |

> **末尾にリポジトリ名を付けないでください。**`agentbest.github.io/xxx` ではなく `agentbest.github.io` だけです。

## 気をつけること

- **古いAレコードを消し忘れるのがいちばん多い失敗です。** 残っていると、同じURLでSquarespaceの画面と
  こちらのページが交互に出ます。ブラウザのキャッシュのせいだと思って気づきにくいので、先に消してください。
- Squarespace側で「このドメインをSquarespaceのサイトに接続」する設定が入っていると、レコードを消しても
  復活することがあります。その場合は接続を解除してください。
- 反映には数分〜数時間かかります。まれに24時間ほど。

---

## 設定できたか確認する

設定後にお知らせください。こちらで反映を確認します。手元で確かめる場合は次を実行すると、
上の4つのIP（185.199.108〜111.153）が返ってくるはずです。

```
nslookup zaiseikatenshoku.com
```

---

## 全体の順番

| # | やること | 誰が |
|---|---|---|
| 1 | GitHubリポジトリ `agentbest/zaiseika-tenshoku` を作って中身を置く | こちら（**要ご承認**） |
| 2 | GitHub Pages を有効にする（Custom domain に `zaiseikatenshoku.com`） | こちら |
| 3 | **上のDNSレコードを設定する** | **松岡さん** |
| 4 | 反映を確認する | こちら |
| 5 | HTTPS（Enforce HTTPS）を有効にする | こちら |

DNSは1と2が終わっていなくても先に設定できます。先に入れておいていただいて構いません。

> 証明書が出ないことがあります。その場合はAPIでカスタムドメインを一度クリアして再設定すると発行が走ります
> （既存LPと shinsotsu で一度ずつありました）。こちらで対応します。

---

## リポジトリを Public にしてよいか

jobsite・shinsotsu と同じ構成なので、**入るのは求人データ・テンプレート・ビルドスクリプトだけ**です。
`.gitignore` で次を除外しています（jobsite から引き継ぎ）。

- `airtable.local.json` / `.env`（Airtableのトークン）
- `admin/` と `スカウト管理画面.bat`（運営側の管理画面）
- `data/jobs.json`（56MBの作業用スナップショット。掲載分の実体は `data/jobs/<求人ID>.json` に入る）

⚠ Supabase の匿名キー（`sb_publishable_…`）はサイトに埋まっていますが、これは公開前提の鍵で、
jobsite と同じものです。**Secret key / service_role が入っていないことだけ、push前に必ず grep で確認します。**
