// 使い方: このフォルダで  node fetch-employees.js  を実行すると、
// Airtable「求人DB（企業）」の 従業員数（原文）と 従業員数（数値）を
// data/employees.json に書き出します。
// そのあと  node rebuild.js  を実行すると、求人カード・求人詳細・絞り込みに反映されます。
//
// ★ このリポジトリは Public です。トークンをこのファイルに書かないでください。
//    トークンは次の順で探します:
//      1) 環境変数 AIRTABLE_TOKEN
//      2) このフォルダの airtable.local.json（{"token":"pat..."} ・.gitignore 済み）
//      3) ..\bes-crm\config.js（同じ端末に BES CRM がある場合）
//
// ⚠ なぜ jobs.json に書かずに別ファイルにするのか
//    ロゴ（fetch-logos.js → data/logos.json）と同じ理由。jobs.json は Airtable からの
//    「取り直すたび丸ごと入れ替わるスナップショット」なので、企業テーブル由来の情報を
//    そこに書くと取り直すたびに消える。企業名で引く別ファイルに持たせる。
//
// ⚠ 人数は Airtable の「従業員数（数値）」列が正。ここで原文から推測しない。
//    2026-09-05に企業テーブル側へ数値列を作って491社ぶん入れた。
//    数値が空の会社は「企業規模」で絞り込めない（＝サイトに段が出ない）。それが正しい状態で、
//    埋めるべきときは Airtable の列を埋める。
//
// ⚠ 原文（従業員数）も一緒に持つ。求人詳細に出すのは原文のまま。
//    「連結3,039名、単体835名」のような但し書きを落として1つの数字にすると、
//    当社が勝手に丸めた人数を企業の公表値のように見せることになる。

const fs = require('fs'), path = require('path');

const BASE_ID  = 'appYkc36EvioYoL1A';   // base「人材紹介事業」
const TABLE_ID = 'tblBNNH9sJjldPmZZ';   // table「求人DB（企業）」
const F_NAME   = 'fld03vEbeabi8IQDN';   // Name（企業名・primary）
const F_RAW    = 'flda7sYQBsb05X781';   // 従業員数（原文）
const F_NUM    = 'fldTazycQVisRgCpR';   // 従業員数（数値）
const dir = __dirname;

/* ---------- トークンの取得（fetch-logos.js と同じ） ---------- */
function findToken(){
  if(process.env.AIRTABLE_TOKEN) return process.env.AIRTABLE_TOKEN;
  const local = path.join(dir, 'airtable.local.json');
  if(fs.existsSync(local)){
    try{ const t = JSON.parse(fs.readFileSync(local, 'utf8')).token; if(t) return t.trim(); }catch(e){}
  }
  const crmConfig = path.join(dir, '..', 'bes-crm', 'config.js');
  if(fs.existsSync(crmConfig)){
    try{ const t = require(crmConfig).AIRTABLE_TOKEN; if(t) return t; }catch(e){}
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
  C) 同じ端末の ..\bes-crm\config.js に AIRTABLE_TOKEN がある状態にする

必要なスコープ: data.records:read
`.trim());
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchAll(){
  const out = [];
  let offset;
  do{
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('returnFieldsByFieldId', 'true');
    [F_NAME, F_RAW, F_NUM].forEach(f => url.searchParams.append('fields[]', f));
    if(offset) url.searchParams.set('offset', offset);
    const res = await fetch(url, { headers:{ Authorization:`Bearer ${TOKEN}` } });
    if(!res.ok){
      const body = await res.text().catch(()=> '');
      throw new Error(`Airtable API エラー ${res.status} ${res.statusText}\n${body}`);
    }
    const json = await res.json();
    out.push(...json.records);
    offset = json.offset;
    await sleep(210);
  }while(offset);
  return out;
}

/* ---------- 原文と数値列の照合（値としては使わない） ----------
   原文だけ直して「従業員数（数値）」を直し忘れた会社を見つけるためのもの。

   ⚠ 「原文の何番目の数字が正しいか」は判定しない。連結・単体の両方が書いてある会社では
      どちらを採るかが方針の問題（当社は連結・グループを採る）で、書き順では決まらないため。
      ここで見るのは「数値列の人数が、原文のどこにも出てこない」ケースだけ。
      例: 原文が「約37名（グループ含むと約180名）」で数値列が180 → 原文にあるので警告しない。
          原文を「250名」に直したのに数値列が180のまま → 原文に無いので警告する。
   ⚠ 原文に人数が1つも書かれていない会社は警告しない。estie のように、原文が「非公開」でも
      人数だけ別に聞いて入れている会社があり、原文からは正誤を判定できないため。 */
function numsIn(raw){
  if(!raw) return [];
  const s = String(raw).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[，、]/g, ',');
  const out = [];
  for(const m of s.matchAll(/([0-9][0-9,.\s]*?)\s*[名人]/g)){
    const n = parseInt(m[1].replace(/[,.\s]/g, ''), 10);
    if(n > 0 && n < 2000000) out.push(n);
  }
  /* 「名／人」が付いていない書き方（「259」「205（連結：253）名」）も候補に入れる。
     年月日・万・倍・％に続く数字は人数ではないので除く */
  for(const m of s.matchAll(/([0-9][0-9,]*)\s*([年月日万倍%％]?)/g)){
    if(m[2]) continue;
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    if(n > 0 && n < 2000000) out.push(n);
  }
  return out;
}

(async () => {
  /* 掲載している求人に出てくる企業だけに絞る（ロゴと同じ考え方） */
  const jobsPath = path.join(dir, 'data', 'jobs.json');
  if(!fs.existsSync(jobsPath)){
    console.error('data/jobs.json がありません。先に求人データを用意してください。');
    process.exit(1);
  }
  const jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
  const wanted = new Set(jobs.map(j => j.company).filter(Boolean));

  const records = await fetchAll();
  const map = {};
  const noNum = [], drift = [];
  for(const rec of records){
    const f = rec.fields || {};
    const name = (f[F_NAME] || '').trim();
    const raw  = (f[F_RAW]  || '').trim();
    const num  = (typeof f[F_NUM] === 'number') ? f[F_NUM] : null;
    if(!name || !wanted.has(name)) continue;
    if(!raw && num == null) continue;
    map[name] = num == null ? { raw } : { raw, n: num };
    if(raw && num == null) noNum.push([name, raw]);
    const found = numsIn(raw);
    if(num != null && raw && found.length && !found.includes(num)) drift.push([name, raw, num, found]);
  }

  const sorted = {};
  Object.keys(map).sort((a, b) => a.localeCompare(b, 'ja')).forEach(k => sorted[k] = map[k]);
  fs.writeFileSync(path.join(dir, 'data', 'employees.json'), JSON.stringify(sorted, null, 2) + '\n', 'utf8');

  const withNum = Object.values(map).filter(v => typeof v.n === 'number').length;
  console.log(`data/employees.json を書き出しました: ${Object.keys(map).length}社（うち人数あり ${withNum}社）/ 掲載企業 ${wanted.size}社`);

  const missing = [...wanted].filter(c => !map[c]);
  if(missing.length){
    console.log(`従業員数が未記入の企業 ${missing.length}社（Airtableの「従業員数」列を埋めてください）:`);
    missing.forEach(c => console.log(`   - ${c}`));
  }
  if(noNum.length){
    console.log(`原文はあるが「従業員数（数値）」が空の企業 ${noNum.length}社（企業規模で絞り込めません）:`);
    noNum.forEach(([n, r]) => console.log(`   - ${n} … ${r}`));
  }
  /* ⚠ 原文を直して数値列を直し忘れた会社は、ここで名指しされる。黙って古い人数で絞り込ませない */
  if(drift.length){
    console.log(`⚠ 数値列の人数が原文のどこにも出てこない企業 ${drift.length}社（Airtableの数値列を直してください）:`);
    drift.forEach(([n, r, num, found]) => console.log(`   - ${n} … 数値列 ${num} / 原文にある人数は ${found.join('・')}（${r}）`));
  }
  console.log('続けて  node rebuild.js  を実行すると求人カード・求人詳細・絞り込みに反映されます。');
})().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
