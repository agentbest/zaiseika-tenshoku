// data/*.json から data/article_plan.tsv（1,000行）を生成する。
// 記事を書くときはこの計画表の行を引いて out/{slug}.md を作る。
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, 'data');
const R = JSON.parse(fs.readFileSync(path.join(D, 'romaji.json'), 'utf8'));
const M = JSON.parse(fs.readFileSync(path.join(D, 'municipalities.json'), 'utf8'));
const AX = JSON.parse(fs.readFileSync(path.join(D, 'topics-axis.json'), 'utf8'));
const SENKO = JSON.parse(fs.readFileSync(path.join(D, 'topics-senko.json'), 'utf8'));
const SEIDO = JSON.parse(fs.readFileSync(path.join(D, 'topics-seido.json'), 'utf8'));
const SKILL = JSON.parse(fs.readFileSync(path.join(D, 'topics-skill.json'), 'utf8'));

const rows = [];
const errors = [];
const seen = new Set();

function add(kind, area, target, theme, rank, slug, title, note) {
  if (seen.has(slug)) errors.push('slug重複: ' + slug);
  seen.add(slug);
  rows.push([rows.length + 1, kind, area, target, theme, rank, slug, title, note || '']);
}

// 市名→都道府県
const prefOf = {};
for (const s of M.ranked) { const [n, p] = s.split('|'); prefOf[n] = p; }

function cityRomaji(name) {
  const base = name.replace(/市$/, '');
  const r = R._city[base];
  if (!r) errors.push('ローマ字なし（市）: ' + name);
  return r || 'TODO';
}

// ---- 1. 自治体別 350本 ----
const TH_LOCAL = '転職の進め方と、経験の活かし方';
for (const p of M.pref) {
  const r = R._pref[p]; if (!r) errors.push('ローマ字なし（県）: ' + p);
  add('自治体別', '都道府県', p, TH_LOCAL, 'S', `pref-${r}`,
      `${p}職員の転職｜経験の活かし方と求人の探し方`, '給与・定員管理等の状況／地方公務員給与実態調査');
}
for (const c of M.seirei) {
  add('自治体別', '政令指定都市', c, TH_LOCAL, 'S', `city-${cityRomaji(c)}`,
      `${c}職員の転職｜経験の活かし方と求人の探し方`, `${prefOf[c] || ''}／給与・定員管理等の状況`);
}
for (const k of M.ku) {
  const base = k.replace(/区$/, '');
  const r = R._ku[base]; if (!r) errors.push('ローマ字なし（区）: ' + k);
  add('自治体別', '特別区', k, TH_LOCAL, 'S', `ku-${r}`,
      `東京都${k}職員の転職｜経験の活かし方と求人の探し方`, '特別区人事委員会／給与・定員管理等の状況');
}
for (const c of M.chukaku) {
  add('自治体別', '中核市', c, TH_LOCAL, 'A', `city-${cityRomaji(c)}`,
      `${c}職員の転職｜経験の活かし方と求人の探し方`, `${prefOf[c] || ''}／給与・定員管理等の状況`);
}
for (const c of M.tokurei) {
  add('自治体別', '施行時特例市', c, TH_LOCAL, 'A', `city-${cityRomaji(c)}`,
      `${c}職員の転職｜経験の活かし方と求人の探し方`, `${prefOf[c] || ''}／給与・定員管理等の状況`);
}
const covered = new Set([...M.seirei, ...M.chukaku, ...M.tokurei]);
const others = M.ranked.map(s => s.split('|')[0]).filter(n => !covered.has(n)).slice(0, 175);
for (const c of others) {
  add('自治体別', '市', c, TH_LOCAL, 'B', `city-${cityRomaji(c)}`,
      `${c}職員の転職｜経験の活かし方と求人の探し方`, `${prefOf[c] || ''}／給与・定員管理等の状況`);
}

// ---- 2. 部署別 200本 ----
const DEPT_S = new Set(['zaisei', 'zeimu', 'joho', 'kikaku', 'kaikei', 'jinji', 'doro', 'keiyaku']);
for (const [dc, dn] of AX.dept) {
  for (const [tc, tn, tpl] of AX.deptTheme) {
    add('部署別', dn, dn, tn, DEPT_S.has(dc) ? 'S' : 'A', `dept-${dc}-${tc}`,
        tpl.replace('{X}', dn), '事務分掌規則／部署別 仕事ガイドから内部リンク');
  }
}

// ---- 3. 選考対策 150本 ----
for (const [sc, grp, title] of SENKO) {
  const rank = (grp === '職務経歴書' || grp === '面接') ? 'S' : 'A';
  add('選考対策', grp, grp, title, rank, `senko-${sc}`, title, '当社の面談知見（rules/insight.md）');
}

// ---- 4. 業界研究 150本 ----
for (const [ic, iname] of AX.industry) {
  for (const [tc, tn, tpl] of AX.industryTheme) {
    add('業界研究', iname, iname, tn, 'A', `industry-${ic}-${tc}`,
        tpl.replace('{X}', iname), '有価証券報告書／業界団体の公表資料');
  }
}

// ---- 5. 制度とお金 100本 ----
const SEIDO_S = new Set(['退職手当', '失業給付と税金', '年金']);
for (const [sc, grp, title] of SEIDO) {
  add('制度とお金', grp, grp, title, SEIDO_S.has(grp) ? 'S' : 'A', `seido-${sc}`, title,
      '地方公務員法／退職手当条例／共済組合・年金機構・国税庁の公式');
}

// ---- 6. 資格・スキル 50本 ----
for (const [sc, grp, title] of SKILL) {
  add('資格・スキル', grp, grp, title, 'B', `skill-${sc}`, title, '各試験の公式サイト');
}

// ---- 出力 ----
const HEAD = ['No', '種別', '領域', '対象', 'テーマ', '需要ランク', 'slug', '記事タイトル案', '備考'];
const tsv = [HEAD.join('\t'), ...rows.map(r => r.join('\t'))].join('\r\n') + '\r\n';
fs.writeFileSync(path.join(D, 'article_plan.tsv'), tsv);

const byKind = {};
for (const r of rows) byKind[r[1]] = (byKind[r[1]] || 0) + 1;
console.log('合計 ' + rows.length + '本');
for (const k of Object.keys(byKind)) console.log('  ' + k.padEnd(8) + byKind[k]);
if (errors.length) { console.log('\n★エラー ' + errors.length + '件'); errors.slice(0, 20).forEach(e => console.log('  ' + e)); process.exitCode = 1; }
else console.log('\nエラーなし（slug重複0・ローマ字欠落0）');
