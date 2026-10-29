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

/* ---------- トークンの取得 ---------- */
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
  prefs:            'flddnoD5qZtuAISOO', // 勤務地（都道府県）。複数選択。エリア絞り込みの正データ（2026-09-22新設）
  status:           'fldLFxYGKjXQPoZsd', // 募集状況（空／募集中／募集停止）。募集停止はサイトに載せない（2026-10-11新設）
  hidden:           'fldHvKsNpzFCEEjRV', // サイトに掲載しない（チェック）。募集中のまま公開だけしない求人（2026-10-16新設）
};
const CO_TABLE = 'tblBNNH9sJjldPmZZ', CO_NAME = 'fld03vEbeabi8IQDN';
const IND_TABLE = 'tblfn5HIG6pPiQ2LE', IND_NAME = 'fldXKyZtMheTlkX1r';

/* 本文の「募集終了日時 2026-09-30 …」「募集終了日：2026年9月30日」を YYYY-MM-DD で返す。無ければ null */
function endDateOf(text){
  const m = String(text).match(/募集終了日時?\s*[:：]?\s*(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 求職者に見せない文言を落とす（2026-10-20） ----------
   求人票には媒体・エージェント向けの控えが紛れ込むことがある（例「■募集元情報 求人票更新日：…／企業№：…（パーソルキャリア経由の求人票）」
   「担当者：○○」「（評価制度の全体像についてはエージェント経由で採用資料を取得し、ご参照ください）」）。
   本来は Airtable 側で消すが、サイトに出る前の最後の網としてここでも落とす。落としたら件数とIDを表示するので Airtable を直すこと。 */
const STRIP_PARA = /^[■□◆◇●【]?\s*(募集元情報|媒体情報|エージェント向け|紹介会社向け|エージェント様へ|紹介会社様へ)/;
const STRIP_LINE = /^\s*(求人票更新日|求人票作成日|求人票№|求人票No|企業№|企業No\.?|企業番号|担当者|募集開始|募集終了|担当RA|担当CA|紹介手数料|手数料|返金規定)\s*[:：]/;
// 取り込み時に書かれた内部メモ（出典・原文に記載なし・要確認 など）。求職者には出さない
const STRIP_NOTE = /^[・※]?\s*(公開情報(より|から)補完|原文に(は)?[^\n]*記載|詳細は求人票ファイルを参照|以下は[^\n]*掲載しましょう|以下は[^\n]*整理したもの|[^\n]*求人票上は記載なし|エージェント向けページに|選考会の日程は[^\n]*エージェント向けページ|紹介会社向け情報|候補者にはオフレコ)/;
const STRIP_INLINE = [
  /[（(][^）)]*(?:エージェント|紹介会社|紹介元)経由[^）)]*[）)]/g,   // （…エージェント経由で採用資料を取得し…）
  /[（(][^）)]*経由の求人票[）)]/g,                                    // （パーソルキャリア経由の求人票）
];
// タイトルに付く媒体向けの括り（【面接確約条件あり】※面接確約※ など）。タイトル・職種名だけに当てる
const STRIP_TITLE = [
  /[◆■]?[【＜<][ 　]*★?面[接談]確約(?:条件)?(?:あり)?★?[ 　]*[】＞>][ 　]*/g,
  /※[ 　]*面[接談]確約(?:条件)?(?:あり)?[ 　]*※[ 　]*/g,
  /^面[接談]確約条件あり[ 　]*/g,
];
// 面談確約・面接確約の条件（媒体向け。例「＜面談確約条件＞ 年齢：35歳以下／面接確約継続条件：…5推薦以上…」backlog #35）。
// 見出しの段落と、直後の「項目：値」だけの段落を丸ごと落とす。本文中の「面接確約」を含む行も落とす（タイトルは上の STRIP_INLINE で括りだけ外す）
const STRIP_KAKUYAKU = /^[＜<【■◆●★※]?\s*面[接談]確約(?:条件|継続条件)?[＞>】]?\s*$/;
const STRIP_KAKUYAKU_LINE = /面[接談]確約/;
const sanitized = [];
function sanitize(text, id, key){
  if(typeof text !== 'string' || !text) return text;
  const hit = [];
  const oneLine = key === 'title' || key === 'position';
  let out = text;
  if(oneLine) for(const re of STRIP_TITLE) out = out.replace(re, m => { hit.push(m); return ''; });
  const paras = out.split(/\n{2,}/), kept = [];
  for(let i = 0; i < paras.length; i++){
    const p = paras[i].trim();
    if(STRIP_KAKUYAKU.test(p)){
      hit.push(p);
      const next = (paras[i + 1] || '').trim();
      if(next && next.split('\n').every(l => /^[^：:\n]{1,12}[：:]/.test(l.trim()))){ hit.push(next.split('\n')[0]); i++; }
      continue;
    }
    if(STRIP_PARA.test(p)){ hit.push(p.split('\n')[0]); continue; }
    kept.push(paras[i]);
  }
  out = kept.join('\n\n');
  out = out.split('\n').filter(l => { const ng = STRIP_LINE.test(l) || STRIP_NOTE.test(l.trim()) || (!oneLine && STRIP_KAKUYAKU_LINE.test(l)); if(ng) hit.push(l.trim()); return !ng; }).join('\n');
  for(const re of STRIP_INLINE) out = out.replace(re, m => { hit.push(m); return ''; });
  if(!hit.length) return text;   // 何も落としていなければ原文のまま（空白の整形もしない）
  out = out.replace(/[ 　]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  sanitized.push(`${id} ${key}: ${hit.map(h => h.slice(0, 40)).join(' / ')}`);
  return out || null;
}
const TEXT_KEYS = ['title', 'position', 'salaryRaw', 'location', 'workHours', 'holidays', 'benefits', 'jobContent', 'must', 'welcome', 'idealPerson', 'selectionProcess', 'companyInfo'];

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
  /* 募集停止の扱い（2026-10-11）。行は消さずに「募集状況」を募集停止にする運用。
     本文に「募集終了日時 YYYY-MM-DD」があって過ぎている求人も載せない（キャリアバンク由来の書式）。 */
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);   // JST
  const closed = [], expired = [], hidden = [];
  for(const r of recs){
    const f = r.fields;
    const title = (f[F.title] || '').trim();
    // CSVのヘッダー行が混入したレコードなどは載せない
    if(!title || title === '求人タイトル' || title.replace(/^﻿/, '') === '求人タイトル'){ skipped++; continue; }
    if(flat(f[F.status]) === '募集停止'){ closed.push(r.id); continue; }
    if(f[F.hidden] === true){ hidden.push(`${r.id} ${title.slice(0, 40)}`); continue; }
    const end = endDateOf([f[F.jobContent], f[F.title], f[F.selectionProcess]].filter(Boolean).join('\n'));
    if(end && end < today){ expired.push(`${r.id} ${end} ${title.slice(0, 40)}`); continue; }
    const job = {
      id: r.id,
      title,
      company: (f[F.company] || []).map(id => coName.get(id)).filter(Boolean).join(' / ') || null,
      companyId: (f[F.company] || [])[0] || null,   // 企業ページ（company/<企業ID>/）へのリンク。data/companies.json の id と突き合わせる
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
    /* 勤務地（都道府県）。⚠ サイトはこの列が入っている求人では本文からの推測をしない */
    const pf = (f[F.prefs] || []).map(x => (typeof x === 'object' ? x.name : x)).filter(Boolean);
    if(pf.length) job.prefs = pf;
    for(const k of TEXT_KEYS) job[k] = sanitize(job[k], r.id, k);
    jobs.push(job);
  }
  if(sanitized.length){
    console.log(`  ⚠ 媒体・エージェント向けの文言（募集元情報・担当者・企業№ など）を ${sanitized.length}箇所 落としました。Airtable の原文も直してください:`);
    sanitized.forEach(x => console.log('    ' + x));
  }

  if(closed.length) console.log(`  募集停止の求人を ${closed.length}件 除外しました（Airtable の「募集状況」）`);
  if(hidden.length){
    console.log(`  「サイトに掲載しない」にチェックの付いた求人を ${hidden.length}件 除外しました:`);
    hidden.forEach(x => console.log('    ' + x));
  }
  if(expired.length){
    console.log(`  ⚠ 本文の募集終了日時を過ぎた求人を ${expired.length}件 除外しました。Airtable で「募集状況」を募集停止にしてください:`);
    expired.forEach(x => console.log('    ' + x));
  }

  const out = path.join(dir, 'data', 'jobs.json');
  fs.writeFileSync(out, JSON.stringify(jobs), 'utf8');
  const by = {};
  jobs.forEach(j => { by[j.kubun || '(区分なし)'] = (by[j.kubun || '(区分なし)'] || 0) + 1; });
  console.log(`\ndata/jobs.json を書き出しました: ${jobs.length}件（${(fs.statSync(out).size/1024/1024).toFixed(1)}MB）`);
  console.log('  区分:', Object.entries(by).map(([k,v]) => `${k} ${v}件`).join(' / '));
  if(skipped) console.log(`  ⚠ 求人タイトルが空／ヘッダー行のレコードを ${skipped}件 除外しました（Airtableで削除してください）`);
  console.log('  会社名リンクなし:', jobs.filter(j => !j.company).length, '件');
  const noPref = jobs.filter(j => !(j.prefs || []).length).length;
  console.log(`  勤務地（都道府県）あり: ${jobs.length - noPref}件 / 空 ${noPref}件`
    + (noPref ? '（空の求人はサイトが勤務地の原文から推測します。エリアで正しく出したい求人はこの列を埋めてください）' : ''));
  const tagged = jobs.filter(j => j.tags && j.tags.length);
  console.log('  タグあり:', tagged.length, '件（1件あたり平均',
    tagged.length ? (tagged.reduce((a, j) => a + j.tags.length, 0) / tagged.length).toFixed(1) : 0, 'タグ）');
  if(jobs.length - tagged.length){
    console.log(`  ⚠ タグが空の求人が ${jobs.length - tagged.length}件あります。` +
      '端末0\\【求人DB】AirTable｜DB加工用\\05_タグ自動付与_20260906\\ の 03_apply-tags.js を回してください。');
  }
  console.log('\n次は  node fetch-tags.js  →  node rebuild.js  を実行してください。');
})().catch(e => { console.error('\nERROR', e.message); process.exit(1); });
