// 生成後の media/*.html を機械で検査する。build-articles.js の後、push の前に必ず流す。
//   node tools/hrefcheck.js            … 全ファイル
//   node tools/hrefcheck.js slug slug  … 指定した記事だけ
//
// 見るもの:
//   MISS      … 記事内の相対リンク（pref-aichi.html / ../zukan.html / ../?gov=1）の実ファイルが無い
//               ＝未執筆の記事にリンクしている。「別の記事に整理します」に戻して PROGRESS.md に保留として書く
//   JSONLD_NG … 構造化データ（Article・BreadcrumbList・FAQPage）が JSON.parse を通らない
//   BOLD      … out/*.md の1行に `**` が奇数個ある＝生成HTMLに `**` が素で出る（警告。既存の自治体別23本に残っていて未修正）
//   ALIEN     … ハングル・キリル・タイ文字の混入（check-articles.js と同じ）
//   MISLINK   … `(./?` の誤リンク（記事は media/ 配下なので `../?gov=1` が正しい）
// 全部ゼロで「OK」。npm 依存なし。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MEDIA = path.join(ROOT, 'media');
const OUT = path.join(ROOT, 'out');

const only = process.argv.slice(2);
const htmls = fs.readdirSync(MEDIA).filter(f => f.endsWith('.html'))
  .filter(f => !only.length || only.includes(f.replace(/\.html$/, '')));

let miss = 0, jl = 0, bold = 0, alien = 0, mislink = 0;

for (const f of htmls) {
  const h = fs.readFileSync(path.join(MEDIA, f), 'utf8');
  for (const m of h.matchAll(/href="([^"#?]+)(\?[^"]*)?"/g)) {
    const u = m[1];
    if (/^https?:|^mailto:/.test(u)) continue;
    let p = u.startsWith('../') ? u.slice(3) : 'media/' + u;
    if (p === '' || p === 'media/') p = 'index.html';
    if (p.endsWith('/')) p += 'index.html';
    if (!fs.existsSync(path.join(ROOT, p))) { miss++; console.log('MISS     ' + f + ' -> ' + u); }
  }
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch (e) { jl++; console.log('JSONLD_NG ' + f + ' : ' + e.message); }
  }
}

const mds = fs.readdirSync(OUT).filter(f => f.endsWith('.md'))
  .filter(f => !only.length || only.includes(f.replace(/\.md$/, '')));
for (const f of mds) {
  const raw = fs.readFileSync(path.join(OUT, f), 'utf8');
  raw.split('\n').forEach((l, i) => {
    const n = (l.match(/\*\*/g) || []).length;
    if (n % 2) { bold++; console.log('BOLD     ' + f + ' L' + (i + 1) + ' (' + n + ') ' + JSON.stringify(l.slice(-40))); }
  });
  const a = raw.match(/[가-힣ᄀ-ᇿЀ-ӿ฀-๿]/g);
  if (a) { alien++; console.log('ALIEN    ' + f + ' : ' + [...new Set(a)].join(' ')); }
  const ml = raw.match(/\(\.\/\?/g);
  if (ml) { mislink++; console.log('MISLINK  ' + f + ' : `(./?` が ' + ml.length + ' 箇所'); }
}

const bad = miss + jl + alien + mislink; // BOLD は警告扱い（既存23本が直るまで）
console.log('\nhtml ' + htmls.length + ' / md ' + mds.length +
  '  MISS=' + miss + ' JSONLD_NG=' + jl + ' BOLD=' + bold + ' ALIEN=' + alien + ' MISLINK=' + mislink +
  (bad ? '  → NG' : '  → OK'));
process.exit(bad ? 1 : 0);
