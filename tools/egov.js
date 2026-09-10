// e-Gov法令APIから条文を取り出す。記事で条番号を引くときは必ずこれで現物を確認する。
//   node tools/egov.js <法令ID> <条番号> [条番号...]
//   例: node tools/egov.js 322AC0000000067 211 233 149
//   条番号を省略すると、その法令の収録条数と条番号の一覧を出す。
//
// ⚠ e-Gov の HTML ページ（laws.e-gov.go.jp/law/...）は JavaScript で本文を描画するため、
//    取得しても中身が読めない。条文を確認するときは必ずこの API を使うこと。
//
// 法令IDの例:
//   地方自治法 322AC0000000067 / 地方公務員法 325AC0000000261
//   国家公務員退職手当法 328AC0000000182 / 雇用保険法 349AC0000000116
//   国家公務員法 322AC0000000120 / 地方税法 325AC0000000226
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const CACHE = path.join(os.tmpdir(), 'egov-cache');

function get(url) {
  return new Promise((ok, ng) => {
    https.get(url, r => {
      if (r.statusCode !== 200) return ng(new Error('HTTP ' + r.statusCode + ' : ' + url));
      const b = [];
      r.on('data', c => b.push(c));
      r.on('end', () => ok(Buffer.concat(b).toString('utf8')));
    }).on('error', ng);
  });
}

async function lawXml(lawId) {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, lawId + '.xml');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  const xml = await get('https://laws.e-gov.go.jp/api/1/lawdata/' + lawId);
  if (xml.indexOf('<LawFullText>') < 0) throw new Error('法令IDが違うか、APIが本文を返していません: ' + lawId);
  fs.writeFileSync(f, xml);
  return xml;
}

const strip = s => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// <Tag> でも <Tag Kana="..."> でも拾えるようにする
function pick(inner, tag) {
  const a = inner.indexOf('<' + tag);
  if (a < 0) return '';
  const gt = inner.indexOf('>', a);
  if (gt < 0) return '';
  const b = inner.indexOf('</' + tag + '>', gt);
  if (b < 0) return '';
  return strip(inner.slice(gt + 1, b));
}

// 条番号は Num 属性そのまま（枝番は 211_2 のような形）。
// 正規表現を文字列から組み立てるとエスケープ事故が起きるので素直に走査する。
function article(xml, num) {
  const open = '<Article Num="' + num + '">';
  const close = '</Article>';
  const out = [];
  let i = 0;
  for (;;) {
    const a = xml.indexOf(open, i);
    if (a < 0) break;
    const b = xml.indexOf(close, a);
    if (b < 0) break;
    const inner = xml.slice(a + open.length, b);
    out.push({
      title: pick(inner, 'ArticleTitle') || ('第' + num + '条'),
      caption: pick(inner, 'ArticleCaption'),
      text: strip(inner)
    });
    i = b + close.length;
  }
  return out;
}

function allNums(xml) {
  const key = '<Article Num="';
  const out = [];
  let i = 0;
  for (;;) {
    const a = xml.indexOf(key, i);
    if (a < 0) break;
    const b = xml.indexOf('"', a + key.length);
    out.push(xml.slice(a + key.length, b));
    i = b;
  }
  return out;
}

function lawName(xml) {
  return { name: pick(xml, 'LawTitle') || '(不明)', num: pick(xml, 'LawNum') || '' };
}

// 法令名から法令IDを探す。IDは推測せず必ずこれで引くこと（AC0とAC1の違いなどで簡単に外す）。
async function findLaw(word) {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, '_lawlist.xml');
  let xml;
  if (fs.existsSync(f)) xml = fs.readFileSync(f, 'utf8');
  else { xml = await get('https://laws.e-gov.go.jp/api/1/lawlists/1'); fs.writeFileSync(f, xml); }
  const items = xml.split('<LawNameListInfo>').slice(1);
  const out = [];
  for (const it of items) {
    if (it.indexOf(word) < 0) continue;
    const g = (t) => { const a = it.indexOf('<' + t + '>'); if (a < 0) return ''; const b = it.indexOf('</' + t + '>', a); return it.slice(a + t.length + 2, b); };
    out.push({ id: g('LawId'), name: g('LawName'), no: g('LawNo') });
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const lawId = argv[0];
  const nums = argv.slice(1);
  if (!lawId) {
    console.log('使い方: node tools/egov.js <法令ID> <条番号...>');
    console.log('      : node tools/egov.js --find <法令名の一部>   … 法令IDを探す');
    console.log('例    : node tools/egov.js 322AC0000000067 211 233 149');
    return;
  }
  if (lawId === '--find') {
    const word = nums.join(' ');
    if (!word) { console.log('探したい法令名を指定してください'); return; }
    const hits = await findLaw(word);
    console.log('「' + word + '」を含む法令: ' + hits.length + '件');
    for (const h of hits.slice(0, 30)) console.log('  ' + h.id + '  ' + h.name + '  ' + h.no);
    return;
  }
  const xml = await lawXml(lawId);
  const L = lawName(xml);
  console.log('【' + L.name + '】' + L.num);
  console.log('');
  if (!nums.length) {
    const all = allNums(xml);
    console.log('収録条数: ' + all.length);
    console.log(all.join(' '));
    return;
  }
  for (const n of nums) {
    const hits = article(xml, n);
    if (!hits.length) {
      console.log('第' + n + '条: 見つかりません（枝番は 211_2 の形で指定します）');
      console.log('');
      continue;
    }
    for (const h of hits) {
      console.log('■ ' + h.title + (h.caption ? ' ' + h.caption : ''));
      console.log(h.text.length > 800 ? h.text.slice(0, 800) + ' …' : h.text);
      console.log('');
    }
  }
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { lawXml, article, lawName, allNums };
