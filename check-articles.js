// out/*.md を公開前に検査する。警告ゼロになるまで直してから build-articles.js を回す。
//   node check-articles.js            … out/ 全部
//   node check-articles.js dept-zaisei-honyaku   … slug 指定
'use strict';
const fs = require('fs');
const path = require('path');
const { parseFront, extractFaq } = require('./build-articles.js');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'out');
const PLAN = path.join(ROOT, 'data', 'article_plan.tsv');

// 種別ごとの文字数レンジ（ARTICLE_SPEC.md と揃える）
const LEN = {
  '自治体別': [5000, 7000],
  '部署別': [5000, 7000],
  '業界研究': [5000, 7000],
  '選考対策': [4000, 6000],
  '制度とお金': [4000, 6000],
  '資格・スキル': [4000, 6000]
};

const REQUIRED = ['no', 'kind', 'area', 'target', 'theme', 'title', 'slug', 'description', 'asof'];

// CLAUDE.md / rules/common.md で禁じている言い回し
const BANNED = [
  [/通用しない/, '「通用しない」— 公務員を否定する前提の文言は書かない'],
  [/市場価値が下がり/, '不安を煽る表現'],
  [/圧倒的/, '「圧倒的」は使わない'],
  [/絶対に(?!守|書か)/, '「絶対」は使わない'],
  [/今すぐ/, '「今すぐ」— 時間を煽る表現'],
  [/公務員のお仕事図鑑/, '外部記事のタイトルなので使えない'],
  [/必ず転職できます|確実に内定/, '成果を断定する表現']
];

function plan() {
  if (!fs.existsSync(PLAN)) return null;
  const rows = fs.readFileSync(PLAN, 'utf8').split(/\r?\n/).filter(Boolean).slice(1);
  const m = {};
  for (const r of rows) {
    const c = r.split('\t');
    m[c[6]] = { no: c[0], kind: c[1], area: c[2], target: c[3], theme: c[4], title: c[7] };
  }
  return m;
}

// Markdown記号を落として本文の文字数を数える
function countChars(body) {
  return body
    .replace(/^---[\s\S]*?---/, '')
    .replace(/:::[a-z]*/g, '')
    .replace(/[#>|*\-`\[\]()]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s/g, '')
    .length;
}

function checkOne(file, P) {
  const raw = fs.readFileSync(path.join(OUT, file), 'utf8');
  const warn = [];
  let meta, body;
  try {
    const r = parseFront(raw);
    meta = r.meta; body = r.body;
  } catch (e) {
    return { file, warn: ['frontmatter が読めません: ' + e.message] };
  }

  for (const k of REQUIRED) {
    if (!meta[k] || String(meta[k]).trim() === '') warn.push('frontmatter に ' + k + ' がありません');
  }

  // 計画表との突き合わせ
  if (P && meta.slug) {
    const p = P[meta.slug];
    if (!p) warn.push('slug が article_plan.tsv にありません: ' + meta.slug);
    else {
      if (String(meta.no) !== String(p.no)) warn.push('no が計画表と違います（計画表: ' + p.no + '）');
      if (meta.kind !== p.kind) warn.push('kind が計画表と違います（計画表: ' + p.kind + '）');
    }
  }

  // 文字数
  const n = countChars(body);
  const range = LEN[meta.kind];
  if (range) {
    if (n < range[0]) warn.push('本文が短い: ' + n + '字（下限 ' + range[0] + '）');
    if (n > range[1]) warn.push('本文が長い: ' + n + '字（上限 ' + range[1] + '）');
  }

  // 見解ブロック2箇所
  const insight = (body.match(/^:::insight\s*$/gm) || []).length;
  if (insight < 2) warn.push('エージェントベストの見解ブロックが ' + insight + ' 箇所（2箇所必要）');

  // FAQ
  const faq = extractFaq(body);
  if (faq.length < 3) warn.push('よくある質問が ' + faq.length + ' 件（3件必要）');

  // 出典
  if (!meta.sources || !meta.sources.length) warn.push('sources が空です');
  else for (const s of meta.sources) {
    if (!s.url) warn.push('出典にURLがありません: ' + s.name);
    else if (!/^https?:\/\//.test(s.url)) warn.push('出典URLの形式が不正: ' + s.url);
  }

  // 本文にH1を書いていないか
  if (/^#\s+/m.test(body)) warn.push('本文に H1（# ）があります。タイトルはテンプレートが出します');

  // 中間CTAの文言
  if (/:::cta[\s\S]*?無料で相談する[\s\S]*?:::/.test(body)) {
    warn.push('中間CTAに「無料で相談する」が入っています（記事末尾のCTAと重複）');
  }

  // 禁止表現
  for (const [re, msg] of BANNED) {
    const m = body.match(re);
    if (m) warn.push('禁止表現: ' + msg + '（該当: ' + m[0] + '）');
  }

  // 見出し重複
  const heads = (body.match(/^##\s+(.*)$/gm) || []).map(s => s.replace(/^##\s+/, '').trim());
  const dup = heads.filter((h, i) => heads.indexOf(h) !== i);
  if (dup.length) warn.push('H2が重複: ' + [...new Set(dup)].join(' / '));

  // description の長さ
  if (meta.description && meta.description.length > 120) {
    warn.push('description が ' + meta.description.length + '字（120字以内）');
  }

  return { file, slug: meta.slug, chars: n, insight, faq: faq.length, warn };
}

function main() {
  if (!fs.existsSync(OUT)) { console.log('out/ がありません。'); return; }
  const only = process.argv[2];
  let files = fs.readdirSync(OUT).filter(f => f.endsWith('.md'));
  if (only) files = files.filter(f => f === only + '.md' || f === only);
  if (!files.length) { console.log('検査対象がありません。'); return; }

  const P = plan();
  if (!P) console.log('（article_plan.tsv が無いので計画表との突き合わせは省略します）\n');

  let ok = 0, ng = 0;
  const seen = {};
  for (const f of files) {
    const r = checkOne(f, P);
    if (r.slug) {
      if (seen[r.slug]) r.warn.push('slug が重複: ' + r.slug);
      seen[r.slug] = true;
    }
    if (r.warn.length) {
      ng++;
      console.log('NG ' + f + '  ' + (r.chars ? r.chars + '字' : ''));
      r.warn.forEach(w => console.log('   - ' + w));
    } else {
      ok++;
      console.log('OK ' + f + '  ' + r.chars + '字 / 見解' + r.insight + ' / FAQ' + r.faq);
    }
  }
  console.log('\nOK' + ok + ' / NG' + ng);
  if (ng) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { checkOne };
