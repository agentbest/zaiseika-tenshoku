// 使い方: このフォルダで  node fetch-1day.js  を実行すると、
// Airtable「1day選考会」テーブルを取得して data/1day.json を書き出します。
// そのあと  node rebuild.js  を実行すると 1day.html に反映されます。
//
// ★ このリポジトリは Public です。トークンをこのファイルに書かないでください。
//    トークンは次の順で探します:
//      1) 環境変数 AIRTABLE_TOKEN
//      2) このフォルダの airtable.local.json（{"token":"pat..."} ・.gitignore 済み）
//      3) ..\bes-crm\config.js（同じ端末に BES CRM がある場合）

const fs = require('fs'), path = require('path');

const BASE_ID  = 'appYkc36EvioYoL1A';          // base「人材紹介事業」
const TABLE_ID = 'tbl1J80CGqiOTvuf7';          // table「1day選考会」
const dir = __dirname;

/* ---------- トークンの取得 ---------- */
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

/* ---------- 表示用の整形 ---------- */
const WD = ['日','月','火','水','木','金','土'];
function fmtDate(iso){
  if(!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if(!m) return iso;
  const [, y, mo, d] = m;
  // 端末のタイムゾーンに左右されないよう UTC で曜日を求める
  const wd = WD[new Date(Date.UTC(+y, +mo - 1, +d)).getUTCDay()];
  return `${+y}年${+mo}月${+d}日（${wd}）`;
}

const STATUS_MAP = { '募集中':'open', '残席わずか':'few', '受付終了':'closed' };

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

(async () => {
  const records = await fetchAll();

  const events = records
    .map(r => {
      const f = r.fields || {};
      const status = STATUS_MAP[f['公開ステータス']];
      if(!status) return null;                       // 「非公開」と未設定はサイトに出さない

      const companies = (f['参加企業名'] || []).filter(Boolean);
      return {
        id:        r.id,
        _iso:      f['開催日'] || '',                 // 並び替え用（出力前に消す）
        date:      fmtDate(f['開催日']),
        time:      f['時間'] || '',
        status,
        /* 「中途」= jobs.agent-best.net、「新卒・インターン」= shinsotsu.agent-best.net。
           ここでは落とさず、どちらに載せるかは各サイトの rebuild.js が決める
           （求人の kubun と同じ建て付け。data 側は素のまま持っておく）。 */
        kubun:     f['区分'] || '',
        title:     f['サイト掲載タイトル'] || '1day選考会',
        format:    f['開催形式'] || '',
        place:     f['会場・接続方法'] || '',
        target:    f['対象'] || '',
        seats:     f['定員'] || '',
        deadline:  fmtDate(f['申込締切']),
        companies,
        companyLabel: companies.length ? companies.join('・') : (f['サイト掲載タイトル'] || '1day選考会'),
        note:      f['備考'] || ''
      };
    })
    .filter(Boolean)
    // 受付中の回を先に、そのなかは開催日の近い順。受付終了は後ろに新しい順。
    .sort((a, b) => {
      const ac = a.status === 'closed', bc = b.status === 'closed';
      if(ac !== bc) return ac ? 1 : -1;
      return ac ? b._iso.localeCompare(a._iso) : a._iso.localeCompare(b._iso);
    })
    .map(({_iso, ...e}) => e);

  fs.mkdirSync(path.join(dir, 'data'), { recursive:true });
  fs.writeFileSync(path.join(dir, 'data', '1day.json'), JSON.stringify(events, null, 2) + '\n', 'utf8');

  const skipped = records.length - events.length;
  console.log(`data/1day.json を書き出しました: 掲載 ${events.length} 件` + (skipped ? `（非公開・下書き ${skipped} 件は除外）` : ''));
  console.log('続けて  node rebuild.js  を実行すると 1day.html に反映されます。');
})().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
