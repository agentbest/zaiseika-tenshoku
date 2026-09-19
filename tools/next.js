// 自動運転で次に書く記事を引く。data/article_plan.tsv のうち media/{slug}.html が無い行を、レーンの順で出す。
//   node tools/next.js A        … レーンAの次の3本
//   node tools/next.js B 5      … レーンBの次の5本
//   node tools/next.js          … レーンごとの残り本数だけ
//
// レーンの割当は PROGRESS.md「並行運転」の表が正。ここはその写し。
// 種別の順に書き切る（部署別のように「1部署5本」で組んだ種別を途中で止めない）。同じ種別の中は S → A → B の順。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// レーン → 担当する種別の優先順
const LANES = {
  A: ['部署別', '制度とお金', '業界研究', '資格・スキル'],
  B: ['選考対策', '自治体別']
};
const RANK = { S: 0, A: 1, B: 2 };

const rows = fs.readFileSync(path.join(ROOT, 'data', 'article_plan.tsv'), 'utf8')
  .split(/\r?\n/).filter(Boolean).slice(1).map(r => {
    const c = r.split('\t');
    return { no: +c[0], kind: c[1], area: c[2], target: c[3], theme: c[4], rank: c[5], slug: c[6], title: c[7] };
  });
const todo = rows.filter(r => !fs.existsSync(path.join(ROOT, 'media', r.slug + '.html')));

const lane = (process.argv[2] || '').toUpperCase();
const n = +(process.argv[3] || 3);

if (!LANES[lane]) {
  for (const [k, kinds] of Object.entries(LANES)) {
    const mine = todo.filter(r => kinds.includes(r.kind));
    const byRank = {};
    for (const r of mine) byRank[r.rank] = (byRank[r.rank] || 0) + 1;
    console.log('レーン' + k + '  残り ' + mine.length + ' 本  ' +
      Object.entries(byRank).sort().map(([r, c]) => r + ' ' + c).join(' / ') + '  （' + kinds.join(' → ') + '）');
  }
  console.log('全体  残り ' + todo.length + ' 本');
  process.exit(0);
}

const kinds = LANES[lane];
const mine = todo.filter(r => kinds.includes(r.kind))
  .sort((a, b) => (kinds.indexOf(a.kind) - kinds.indexOf(b.kind)) || (RANK[a.rank] - RANK[b.rank]) || (a.no - b.no));
for (const r of mine.slice(0, n)) {
  console.log([r.no, r.kind, r.rank, r.slug, r.title].join('\t'));
}
if (!mine.length) console.log('レーン' + lane + ' は書き切りました。PROGRESS.md「並行運転」の表を見て、もう一方のレーンの後ろから引き取ってください');
