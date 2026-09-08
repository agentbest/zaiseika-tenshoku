// 使い方: このフォルダで  node fetch-logos.js  を実行すると、
// Airtable「求人DB（企業）」の ロゴ 列の画像を assets/logos/ に取り込み、
// data/logos.json（企業名 → 画像パス）を書き出します。
// そのあと  node rebuild.js  を実行すると求人カード・求人詳細に反映されます。
//
// ★ このリポジトリは Public です。トークンをこのファイルに書かないでください。
//    トークンは次の順で探します:
//      1) 環境変数 AIRTABLE_TOKEN
//      2) このフォルダの airtable.local.json（{"token":"pat..."} ・.gitignore 済み）
//      3) ..\bes-crm\config.js（同じ端末に BES CRM がある場合）
//
// ⚠ なぜ画像をリポジトリに取り込むのか
//    Airtable の添付URL（v5.airtableusercontent.com/...）は数時間で失効する。
//    静的サイトから直接参照すると、翌日にはロゴが全部消える。だから落として持つ。
//
// ⚠ 落とす対象は data/jobs.json に出てくる企業だけ。
//    Airtable には掲載していない企業のロゴも入っているので、全部落とすと無駄に重くなる。

const fs = require('fs'), path = require('path');

const BASE_ID  = 'appYkc36EvioYoL1A';          // base「人材紹介事業」
const TABLE_ID = 'tblBNNH9sJjldPmZZ';          // table「求人DB（企業）」
const F_NAME   = 'Name';                       // 企業名（primary）
const F_CID    = '企業ID';                     // 例 loglass。ファイル名に使う
const F_LOGO   = 'ロゴ';                       // fld32OKkkAS1lJbr8
const OUT_DIR  = path.join(__dirname, 'assets', 'logos');
const dir = __dirname;

/* ---------- トークンの取得（fetch-1day.js と同じ） ---------- */
function findToken(){
  if(process.env.AIRTABLE_TOKEN) return process.env.AIRTABLE_TOKEN;

  const local = path.join(dir, 'airtable.local.json');
  if(fs.existsSync(local)){
    try{
      const t = JSON.parse(fs.readFileSync(local, 'utf8')).token;
      if(t) return t;
    }catch(e){ /* 壊れていたら次へ */ }
  }

  const crmConfig = path.join(dir, '..', 'bes-crm', 'config.js');
  if(fs.existsSync(crmConfig)){
    try{
      const t = require(crmConfig).AIRTABLE_TOKEN;
      if(t) return t;
    }catch(e){ /* 次へ */ }
  }
  return null;
}

const TOKEN = findToken();
if(!TOKEN){
  console.error(`
Airtable のトークンが見つかりませんでした。次のどれかを用意してください。

  A) 環境変数に入れる
       PowerShell:  $env:AIRTABLE_TOKEN = "pat..."
  B) このフォルダに airtable.local.json を作る（gitignore 済み・push されません）
       {"token": "pat..."}
  C) 同じ端末の ..\\bes-crm\\config.js に AIRTABLE_TOKEN がある状態にする

必要なスコープ: data.records:read
`.trim());
  process.exit(1);
}

/* ---------- Airtable から全件取得 ---------- */
async function fetchAll(){
  const out = [];
  let offset;
  do{
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`);
    url.searchParams.set('pageSize', '100');
    if(offset) url.searchParams.set('offset', offset);

    const res = await fetch(url, { headers:{ Authorization:`Bearer ${TOKEN}` } });
    if(!res.ok){
      const body = await res.text().catch(()=> '');
      throw new Error(`Airtable API エラー ${res.status} ${res.statusText}\n${body}`);
    }
    const json = await res.json();
    out.push(...json.records);
    offset = json.offset;
  }while(offset);
  return out;
}

/* ---------- ファイル名 ---------- */
const EXT_BY_TYPE = {
  'image/png':'.png', 'image/jpeg':'.jpg', 'image/svg+xml':'.svg',
  'image/webp':'.webp', 'image/gif':'.gif'
};
function extOf(att){
  const i = (att.filename || '').lastIndexOf('.');
  const fromName = i > 0 ? att.filename.slice(i).toLowerCase() : '';
  return EXT_BY_TYPE[att.type] || fromName || '.png';
}
/* 企業IDが空の会社もあるので、無ければ添付のファイル名から作る。
   日本語のファイル名は URL で扱いにくいので、英数字が取れないときはレコードIDにする。 */
function slugOf(rec, att){
  const cid = (rec.fields[F_CID] || '').trim().toLowerCase();
  if(/^[a-z0-9][a-z0-9._-]*$/.test(cid)) return cid;
  const base = (att.filename || '').replace(/\.[^.]*$/, '').toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return base || rec.id.toLowerCase();
}

(async () => {
  /* 掲載中の求人に出てくる企業だけに絞る */
  const jobsPath = path.join(dir, 'data', 'jobs.json');
  if(!fs.existsSync(jobsPath)){
    console.error('data/jobs.json がありません。先に求人データを用意してください。');
    process.exit(1);
  }
  const jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
  const wanted = new Set(jobs.map(j => j.company).filter(Boolean));

  const records = await fetchAll();
  const targets = records.filter(r => {
    const f = r.fields || {};
    return wanted.has(f[F_NAME]) && Array.isArray(f[F_LOGO]) && f[F_LOGO].length;
  });

  fs.mkdirSync(OUT_DIR, { recursive:true });
  const map = {};
  const used = new Set();
  for(const rec of targets){
    const att = rec.fields[F_LOGO][0];            // 複数入っていても1枚目だけ使う
    const file = slugOf(rec, att) + extOf(att);
    const res = await fetch(att.url);
    if(!res.ok){
      console.log(`⚠ 取得に失敗（このまま頭文字タイルになります）: ${rec.fields[F_NAME]} ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(OUT_DIR, file), buf);
    map[rec.fields[F_NAME]] = 'assets/logos/' + file;
    used.add(file);
    console.log(`  ${rec.fields[F_NAME]} → assets/logos/${file}（${(buf.length/1024).toFixed(1)}KB）`);
  }

  /* 企業名の五十音順ではなくパス順に並べる（差分が読みやすい） */
  const sorted = {};
  Object.keys(map).sort((a,b) => map[a].localeCompare(map[b])).forEach(k => sorted[k] = map[k]);
  fs.writeFileSync(path.join(dir, 'data', 'logos.json'), JSON.stringify(sorted, null, 2) + '\n', 'utf8');

  const noLogo = [...wanted].filter(c => !map[c]);
  console.log(`\ndata/logos.json を書き出しました: ${Object.keys(map).length}社`);
  if(noLogo.length){
    console.log(`ロゴが未登録の企業 ${noLogo.length}社（Airtableの「ロゴ」列に画像を入れてください）:`);
    noLogo.forEach(c => console.log(`   - ${c}`));
  }
  /* 使わなくなった画像は自動で消さない（消したつもりの無い削除は事故のもと）。名指しだけする。 */
  const stale = fs.readdirSync(OUT_DIR).filter(f => !used.has(f));
  if(stale.length) console.log(`いま使っていない画像 ${stale.length}件（不要なら手で削除）: ${stale.join(', ')}`);
  console.log('続けて  node rebuild.js  を実行すると求人カード・求人詳細に反映されます。');
})().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
