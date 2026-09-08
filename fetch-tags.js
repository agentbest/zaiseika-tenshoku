// 使い方: このフォルダで  node fetch-tags.js  を実行すると、
// Airtable「タグ（求人票）」を取得して data/tags.json を書き出します。
// そのあと  node rebuild.js  で index.html に反映されます。
//
// data/tags.json は「タグの目録」です。求人1件ずつに付いているタグは data/jobs.json 側（tags）にあり、
// こちらはカテゴリ分け・並び順・スラッグを持ちます。絞り込みをカテゴリごとの箱に分けるために要ります。
// ⚠ 件数はここに書きません。中途だけに絞ったあとの件数はブラウザ側で数えます
//    （このファイルに書くと、新卒サイトと共有したときに数が合わなくなる）。
//
// ★ このリポジトリは Public です。トークンをこのファイルに書かないでください。

const fs = require('fs'), path = require('path');

const BASE_ID  = 'appYkc36EvioYoL1A';   // base「人材紹介事業」
const TABLE_ID = 'tblrDNuukfmi4gZFq';   // table「タグ（求人票）」
const dir = __dirname;

/* fieldId → tags.json のキー */
const F = {
  name:  'fldmd3qVogFiBf3Kc', // タグ名（求人票の「タグ」列の値と一致する。ここが結合キー）
  slug:  'fldgp3q9jc35lvOWp', // スラッグ（URL用。公開後は変えない）
  cat:   'fldUuQmW0FTNItn2Z', // タグカテゴリ（絞り込みの箱になる）
  order: 'fldjjheECvFGDfKSU', // 表示順
  pub:   'fldSidR4eFdeyFHcC', // サイト掲載
  desc:  'flde6GNyjm0Rw6gb7', // 説明
};

/* ---------- トークンの取得（fetch-jobs.js と同じ） ---------- */
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
  console.error('Airtableのトークンが見つかりません。airtable.local.json に {"token":"pat..."} を置いてください。');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const val = v => (v && typeof v === 'object' && !Array.isArray(v)) ? (v.name || '') : (v || '');

(async () => {
  const out = [];
  let offset;
  do{
    const u = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`);
    u.searchParams.set('pageSize', '100');
    u.searchParams.set('returnFieldsByFieldId', 'true');
    Object.values(F).forEach(f => u.searchParams.append('fields[]', f));
    u.searchParams.set('sort[0][field]', F.order);
    if(offset) u.searchParams.set('offset', offset);
    const res = await fetch(u, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const j = await res.json();
    if(!res.ok) throw new Error(`${res.status} ${JSON.stringify(j).slice(0, 300)}`);
    out.push(...j.records);
    offset = j.offset;
    process.stdout.write(`\r  取得中... ${out.length}件`);
    await sleep(210);
  }while(offset);
  process.stdout.write('\n');

  const all = out
    .map(r => ({
      name:  (r.fields[F.name]  || '').trim(),
      slug:  (r.fields[F.slug]  || '').trim(),
      cat:   val(r.fields[F.cat]),
      order: typeof r.fields[F.order] === 'number' ? r.fields[F.order] : 9999,
      pub:   val(r.fields[F.pub]),
      desc:  (r.fields[F.desc] || '').trim(),
    }))
    .filter(t => t.name && t.slug);

  const tags = all.filter(t => t.pub === '掲載する')
    .sort((a, b) => a.order - b.order)
    .map(t => ({ name: t.name, slug: t.slug, cat: t.cat, desc: t.desc }));

  /* スラッグが重複すると ?tag= の行き先が決まらない */
  const dup = tags.map(t => t.slug).filter((s, i, a) => a.indexOf(s) !== i);
  if(dup.length) throw new Error(`スラッグが重複しています: ${[...new Set(dup)].join(', ')}`);

  fs.writeFileSync(path.join(dir, 'data', 'tags.json'), JSON.stringify(tags), 'utf8');

  const byCat = {};
  tags.forEach(t => { byCat[t.cat || '(カテゴリなし)'] = (byCat[t.cat || '(カテゴリなし)'] || 0) + 1; });
  console.log(`\ndata/tags.json を書き出しました: ${tags.length}件 / ${Object.keys(byCat).length}カテゴリ`);
  Object.entries(byCat).forEach(([k, v]) => console.log(`  ${k}: ${v}件`));
  const hidden = all.length - tags.length;
  if(hidden) console.log(`  （サイト掲載が「掲載する」以外のタグ ${hidden}件は入れていません）`);
  const noCat = tags.filter(t => !t.cat);
  if(noCat.length) console.log(`  ⚠ タグカテゴリが空のタグ ${noCat.length}件: ${noCat.map(t => t.name).join(', ')}`);
  console.log('\n次は  node rebuild.js  を実行してください。');
})().catch(e => { console.error('\nERROR', e.message); process.exit(1); });
