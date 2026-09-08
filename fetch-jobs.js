// 使い方: このフォルダで  node fetch-jobs.js  を実行すると、
// Airtable「求人DB（求人票）」を取得して data/jobs.json を書き出します。
// そのあと  node rebuild.js  で index.html / apply.html に反映されます。
//
// ★ このリポジトリは Public です。トークンをこのファイルに書かないでください。
//    トークンは次の順で探します:
//      1) 環境変数 AIRTABLE_TOKEN
//      2) このフォルダの airtable.local.json（{"token":"pat..."} ・.gitignore 済み）
//      3) ..\bes-crm\config.js（同じ端末に BES CRM がある場合）

const fs = require('fs'), path = require('path');

const BASE_ID   = 'appYkc36EvioYoL1A';   // base「人材紹介事業」
const TABLE_ID  = 'tblyPZZasXTM2tcrV';   // table「求人DB（求人票）」
const dir = __dirname;

/* ---------- トークンの取得（fetch-1day.js と同じ） ---------- */
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

/* ---------- fieldId → jobs.json のキー（README の対応表どおり） ---------- */
const F = {
  title:            'fldp0GXKIkufwPQFF', // 求人タイトル(表示)・数式
  company:          'fldoQsYnH5W90qiKW', // 会社名（リンク）→ 名前に解決する
  position:         'fldwyqGnE2veXVaJo',
  employment:       'fldKceIwtiUSMmZaH',
  kubun:            'fldZrrfEai4UaVtNV',
  salaryMin:        'fld8g1uhuhAhkVxjS',
  salaryMax:        'fldIaQVH5rsmzoo9Y',
  salaryRaw:        'fldeGeORYsBiYJNIF',
  location:         'fldsIgsArolZDt1I5',
  workHours:        'fldrDT2UQOqO0L06f',
  holidays:         'fldK16PPXO2RZO011',
  benefits:         'fldUNtnN6ueSqeWvU',
  jobContent:       'fldxZH1FmlN0WYMbK',
  must:             'fld3mrIQScRgqWHox',
  welcome:          'fldwxt81X7jzHvF5H',
  idealPerson:      'fldy4cP88TI3Ihht1',
  selectionProcess: 'fldEQcK7fBwNps0tC',
  jobCategory:      'flduLYPcGIpxSpFHg',
  industry:         'fldBZFa0Fa2iS072D', // 業界カテゴリ（リンク）→ 名前に解決する
  companyInfo:      'fld4cEbkkOP57tEqT',
  url:              'fldcZfB9BkIPXNi0Z',
  companyAddress:   'fldSfExGKjQUFanwx',
  listedStatus:     'fld4KFQmkPBfCiczK',
  gradYear:         'fldPJIVJ0Tv4TQwaN', // 新卒サイトが使う。落とさないこと
  tags:             'fldYNSqarLLDERI0a', // タグ（複数選択）。タグ検索の元。落とさないこと
};
const CO_TABLE = 'tblBNNH9sJjldPmZZ', CO_NAME = 'fld03vEbeabi8IQDN';
const IND_TABLE = 'tblfn5HIG6pPiQ2LE', IND_NAME = 'fldXKyZtMheTlkX1r';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function listAll(table, fields){
  const out = [];
  let offset;
  do{
    const u = new URL(`https://api.airtable.com/v0/${BASE_ID}/${table}`);
    u.searchParams.set('pageSize', '100');
    u.searchParams.set('returnFieldsByFieldId', 'true');
    fields.forEach(f => u.searchParams.append('fields[]', f));
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
  return out;
}

// ルックアップ列は配列で返る。中身をひとつの文字列にする
function flat(v){
  if(v === undefined || v === null) return null;
  const a = (Array.isArray(v) ? v : [v]).filter(x => x !== null && x !== undefined && x !== '');
  if(!a.length) return null;
  return a.map(x => (typeof x === 'object' ? (x.name || '') : x)).join(' / ') || null;
}

(async () => {
  console.log('求人DB（企業）を取得しています');
  const cos = await listAll(CO_TABLE, [CO_NAME]);
  const coName = new Map(cos.map(r => [r.id, r.fields[CO_NAME] || '']));

  console.log('業界マスタを取得しています');
  const inds = await listAll(IND_TABLE, [IND_NAME]);
  const indName = new Map(inds.map(r => [r.id, r.fields[IND_NAME] || '']));

  console.log('求人DB（求人票）を取得しています');
  const recs = await listAll(TABLE_ID, Object.values(F));

  const jobs = [];
  let skipped = 0;
  for(const r of recs){
    const f = r.fields;
    const title = (f[F.title] || '').trim();
    // CSVのヘッダー行が混入したレコードなどは載せない
    if(!title || title === '求人タイトル' || title.replace(/^﻿/, '') === '求人タイトル'){ skipped++; continue; }
    const job = {
      id: r.id,
      title,
      company: (f[F.company] || []).map(id => coName.get(id)).filter(Boolean).join(' / ') || null,
      position: f[F.position] ?? null,
      employment: flat(f[F.employment]),
      kubun: flat(f[F.kubun]),
      salaryMin: f[F.salaryMin] ?? null,
      salaryMax: f[F.salaryMax] ?? null,
      salaryRaw: f[F.salaryRaw] ?? null,
      location: f[F.location] ?? null,
      workHours: f[F.workHours] ?? null,
      holidays: f[F.holidays] ?? null,
      benefits: f[F.benefits] ?? null,
      jobContent: f[F.jobContent] ?? null,
      must: f[F.must] ?? null,
      welcome: f[F.welcome] ?? null,
      idealPerson: f[F.idealPerson] ?? null,
      selectionProcess: f[F.selectionProcess] ?? null,
      jobCategory: flat(f[F.jobCategory]),
      industry: (f[F.industry] || []).map(id => indName.get(id)).filter(Boolean),
      companyInfo: flat(f[F.companyInfo]),
      url: flat(f[F.url]),
      companyAddress: flat(f[F.companyAddress]),
      listedStatus: flat(f[F.listedStatus]),
      createdAt: r.createdTime,
    };
    const gy = (f[F.gradYear] || []).map(x => (typeof x === 'object' ? x.name : x)).filter(Boolean);
    if(gy.length) job.gradYear = gy;
    /* タグ。Airtableの複数選択なので配列で返る。data/tags.json（node fetch-tags.js）と組で使う */
    const tg = (f[F.tags] || []).map(x => (typeof x === 'object' ? x.name : x)).filter(Boolean);
    if(tg.length) job.tags = tg;
    jobs.push(job);
  }

  const out = path.join(dir, 'data', 'jobs.json');
  fs.writeFileSync(out, JSON.stringify(jobs), 'utf8');
  const by = {};
  jobs.forEach(j => { by[j.kubun || '(区分なし)'] = (by[j.kubun || '(区分なし)'] || 0) + 1; });
  console.log(`\ndata/jobs.json を書き出しました: ${jobs.length}件（${(fs.statSync(out).size/1024/1024).toFixed(1)}MB）`);
  console.log('  区分:', Object.entries(by).map(([k,v]) => `${k} ${v}件`).join(' / '));
  if(skipped) console.log(`  ⚠ 求人タイトルが空／ヘッダー行のレコードを ${skipped}件 除外しました（Airtableで削除してください）`);
  console.log('  会社名リンクなし:', jobs.filter(j => !j.company).length, '件');
  const tagged = jobs.filter(j => j.tags && j.tags.length);
  console.log('  タグあり:', tagged.length, '件（1件あたり平均',
    tagged.length ? (tagged.reduce((a, j) => a + j.tags.length, 0) / tagged.length).toFixed(1) : 0, 'タグ）');
  if(jobs.length - tagged.length){
    console.log(`  ⚠ タグが空の求人が ${jobs.length - tagged.length}件あります。` +
      '端末0\\【求人DB】AirTable｜DB加工用\\05_タグ自動付与_20260906\\ の 03_apply-tags.js を回してください。');
  }
  console.log('\n次は  node fetch-tags.js  →  node rebuild.js  を実行してください。');
})().catch(e => { console.error('\nERROR', e.message); process.exit(1); });
