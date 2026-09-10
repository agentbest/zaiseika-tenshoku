// out/*.md → media/*.html を生成し、media/index.html と sitemap.xml を更新する。
// npm の依存は使わない（Node標準のみ）。Markdown は下記の限定サブセットのみ対応。
//
//   ## 見出し / ### 小見出し / 段落 / - 箇条書き / 1. 番号付き
//   | 表 | 形式 |    **太字**    [文字](URL)
//   :::insight ... :::   エージェントベストの見解ブロック（1記事2箇所・必須）
//   :::cta ... :::       本文中CTA
//   :::note ... :::      注記
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'out');
const MEDIA = path.join(ROOT, 'media');
const SITE = 'https://zaiseikatenshoku.com';
const LINE_URL = 'https://line.me/R/ti/p/@697nxhbt';
const PROFILE_URL = 'https://www.agent-best.net/profile';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- frontmatter ----------
function parseFront(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('frontmatter がありません');
  const meta = { sources: [] };
  const lines = m[1].split(/\r?\n/);
  let key = null;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const top = raw.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (top) {
      key = top[1];
      const v = top[2].trim();
      const isList = (key === 'sources' || key === 'related');
      if (v === '' || v === '[]') { meta[key] = isList ? [] : ''; }
      else meta[key] = v.replace(/^["']|["']$/g, '');
      continue;
    }
    const item = raw.match(/^\s+-\s+(.*)$/);
    if (item && key === 'sources') {
      const nm = item[1].match(/^name:\s*(.*)$/);
      if (nm) meta.sources.push({ name: nm[1].replace(/^["']|["']$/g, ''), url: '' });
      continue;
    }
    const sub = raw.match(/^\s+([A-Za-z_]+):\s*(.*)$/);
    if (sub && key === 'sources' && meta.sources.length) {
      meta.sources[meta.sources.length - 1][sub[1]] = sub[2].replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body: m[2] };
}

// ---------- markdown（限定サブセット） ----------
function inline(s) {
  let t = esc(s);
  // 相対リンクは ./ と ../ の両方を受ける。記事は media/ の下なので、
  // 求人一覧など サイト直下へのリンクは ../ で書く（rules/cta.md）。
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\.?[^)\s]*\.html[^)\s]*|\.{1,2}\/[^)\s]*)\)/g,
    (mm, txt, url) => {
      const ext = /^https?:/.test(url) && !url.startsWith(SITE);
      return `<a href="${esc(url)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${txt}</a>`;
    });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  return t;
}

function md2html(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const flushList = (tag, items) => out.push(`<${tag}>`, ...items.map(x => `<li>${inline(x)}</li>`), `</${tag}>`);

  while (i < lines.length) {
    const L = lines[i];

    if (!L.trim()) { i++; continue; }

    // ::: ブロック
    const bm = L.match(/^:::(insight|cta|note)\s*$/);
    if (bm) {
      const kind = bm[1];
      const buf = [];
      i++;
      while (i < lines.length && !/^:::\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      const inner = md2html(buf.join('\n'));
      const label = kind === 'insight' ? 'エージェントベストの見解' : (kind === 'note' ? '注記' : '');
      out.push(`<aside class="blk blk--${kind}">${label ? `<p class="blk__lbl">${label}</p>` : ''}${inner}</aside>`);
      continue;
    }

    // 見出し
    let h = L.match(/^###\s+(.*)$/);
    if (h) { out.push(`<h3>${inline(h[1])}</h3>`); i++; continue; }
    h = L.match(/^##\s+(.*)$/);
    if (h) { out.push(`<h2>${inline(h[1])}</h2>`); i++; continue; }

    // 表
    if (/^\|/.test(L) && i + 1 < lines.length && /^\|[\s:|-]+\|/.test(lines[i + 1])) {
      const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(L);
      i += 2;
      const body = [];
      while (i < lines.length && /^\|/.test(lines[i])) { body.push(cells(lines[i])); i++; }
      out.push('<div class="tw"><table>');
      out.push('<thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>');
      for (const r of body) out.push('<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>');
      out.push('</tbody></table></div>');
      continue;
    }

    // 箇条書き
    if (/^-\s+/.test(L)) {
      const items = [];
      while (i < lines.length && /^-\s+/.test(lines[i])) { items.push(lines[i].replace(/^-\s+/, '')); i++; }
      flushList('ul', items); continue;
    }
    if (/^\d+\.\s+/.test(L)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, '')); i++; }
      flushList('ol', items); continue;
    }

    // 段落
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|-\s|\d+\.\s|\||:::)/.test(lines[i])) { para.push(lines[i]); i++; }
    out.push(`<p>${inline(para.join(''))}</p>`);
  }
  return out.join('\n');
}


// ---------- FAQ 抽出（構造化データ用） ----------
// 構造化データは素のテキストで出す。markdown記号を残すと、検索結果に ** や
// [文字](URL) がそのまま出る。
function plainText(s) {
  return s
    .replace(/\[([^\]]+)\]\([^)\s]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1');
}

function extractFaq(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const faq = [];
  let inFaq = false, q = null, a = [];
  const push = () => { if (q && a.length) faq.push({ q: plainText(q), a: plainText(a.join('')) }); q = null; a = []; };
  for (const L of lines) {
    if (/^##\s+/.test(L)) { push(); inFaq = /よくある質問/.test(L); continue; }
    if (!inFaq) continue;
    const h = L.match(/^###\s+(.*)$/);
    if (h) { push(); q = h[1].trim(); continue; }
    if (L.trim() && q) a.push(L.trim());
  }
  push();
  return faq;
}

// ---------- 共通パーツ ----------
const CSS = [
':root{--paper:#F5F7FA;--surface:#FFFFFF;--surface-2:#EEF1F6;--ink:#161A26;--ink-2:#4A5261;--ink-3:#6E7686;',
'--line:#DDE2EA;--line-2:#EAEEF4;--accent:#1E3A8A;--accent-soft:#E9EDF9;--accent-ink:#1B3374;',
'--cta:#D6362A;--cta-ink:#FFF;--cta-hover:#B22A20;--r-card:14px;--r-pill:999px;',
'--sans:"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic","YuGothic","Noto Sans JP",Meiryo,system-ui,sans-serif;--maxw:800px}',
'@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--paper:#0F131A;--surface:#171C26;--surface-2:#1F2530;',
'--ink:#EAEEF5;--ink-2:#B4BCCA;--ink-3:#828C9E;--line:#2A313D;--line-2:#232A35;--accent:#8FA6F0;',
'--accent-soft:#1B2338;--accent-ink:#BFCDFA;--cta:#D6392C;--cta-hover:#E44D3D}}',
':root[data-theme="dark"]{--paper:#0F131A;--surface:#171C26;--surface-2:#1F2530;--ink:#EAEEF5;--ink-2:#B4BCCA;',
'--ink-3:#828C9E;--line:#2A313D;--line-2:#232A35;--accent:#8FA6F0;--accent-soft:#1B2338;--accent-ink:#BFCDFA;--cta:#D6392C;--cta-hover:#E44D3D}',
'*{box-sizing:border-box}',
'body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);line-height:1.9;-webkit-text-size-adjust:100%}',
'a{color:var(--accent-ink)}',
'.topbar{background:var(--surface);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20}',
'.topbar__inner{max-width:1080px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:16px}',
'.brand{display:flex;align-items:center;gap:9px;text-decoration:none;color:inherit}',
'.brand__mark{width:30px;height:30px;border-radius:7px}',
'.brand__name{display:block;font-weight:800;font-size:15px;letter-spacing:.02em}',
'.brand__sub{display:block;font-size:10px;color:var(--ink-3);letter-spacing:.12em}',
'.gnav{display:flex;gap:16px;margin-left:auto;flex-wrap:wrap}',
'.gnav a{font-size:13.5px;color:var(--ink-2);text-decoration:none}',
'.gnav a[aria-current]{color:var(--accent-ink);font-weight:700}',
'.btn-head{background:var(--cta);color:var(--cta-ink);text-decoration:none;font-size:13px;font-weight:700;padding:8px 14px;border-radius:var(--r-pill);white-space:nowrap}',
'.wrap{max-width:var(--maxw);margin:0 auto;padding:22px 16px 56px}',
'.crumb{font-size:12px;color:var(--ink-3);margin-bottom:14px}',
'.crumb a{color:var(--ink-3)}',
'.post__eyebrow{display:inline-block;font-size:11.5px;letter-spacing:.08em;color:var(--accent-ink);background:var(--accent-soft);padding:4px 10px;border-radius:var(--r-pill);margin:0 0 10px}',
'h1{font-size:27px;line-height:1.5;letter-spacing:.01em;margin:0 0 12px}',
'.post__meta{font-size:12px;color:var(--ink-3);margin:0 0 26px;padding-bottom:16px;border-bottom:1px solid var(--line)}',
'h2{font-size:20px;line-height:1.55;margin:38px 0 12px;padding-left:11px;border-left:4px solid var(--accent)}',
'h3{font-size:16.5px;margin:26px 0 8px}',
'p{margin:0 0 16px}',
'ul,ol{margin:0 0 18px;padding-left:1.35em}',
'li{margin-bottom:7px}',
'.tw{overflow-x:auto;margin:0 0 20px}',
'table{border-collapse:collapse;width:100%;font-size:14px;min-width:420px}',
'th,td{border:1px solid var(--line);padding:9px 11px;text-align:left;vertical-align:top}',
'th{background:var(--surface-2);font-weight:700}',
'.blk{border-radius:var(--r-card);padding:16px 18px;margin:24px 0}',
'.blk p:last-child{margin-bottom:0}',
'.blk__lbl{font-size:11.5px;letter-spacing:.08em;font-weight:800;margin:0 0 7px}',
'.blk--insight{background:var(--accent-soft);border:1px solid var(--accent)}',
'.blk--insight .blk__lbl{color:var(--accent-ink)}',
'.blk--note{background:var(--surface-2);border:1px solid var(--line)}',
'.blk--note .blk__lbl{color:var(--ink-3)}',
'.blk--cta{background:var(--surface);border:1px dashed var(--accent)}',
'.sources{margin:34px 0 0;padding:15px 17px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card)}',
'.sources h2{font-size:14px;margin:0 0 8px;padding:0;border:0}',
'.sources ol{margin:0;font-size:13px;color:var(--ink-2)}',
'.author{margin:30px 0 0;padding:16px 18px;border:1px solid var(--line);border-radius:var(--r-card);background:var(--surface)}',
'.author__lbl{font-size:11px;letter-spacing:.1em;color:var(--ink-3);margin:0 0 3px}',
'.author__name{font-size:16px;font-weight:800;margin:0 0 7px}',
'.author__bio{font-size:13px;line-height:1.85;color:var(--ink-2);margin:0}',
'.related{margin:34px 0 0}',
'.related h2{font-size:15px;margin:0 0 10px;padding:0;border:0}',
'.related ul,.idx__grp ul{list-style:none;padding:0;margin:0}',
'.related li,.idx__grp li{border-bottom:1px solid var(--line-2);padding:9px 0;margin:0}',
'.related a,.idx__grp a{font-size:14px;text-decoration:none}',
'.related a:hover,.idx__grp a:hover{text-decoration:underline}',
'.cta{margin:38px 0 0;padding:22px 20px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);text-align:center}',
'.cta h2{font-size:18px;margin:0 0 9px;padding:0;border:0}',
'.cta p{font-size:13.5px;color:var(--ink-2)}',
'.cta__btns{display:flex;gap:9px;justify-content:center;flex-wrap:wrap;margin-top:14px}',
'.cta__pri{background:var(--cta);color:#fff;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:var(--r-pill)}',
'.cta__sec{background:var(--surface-2);color:var(--ink);text-decoration:none;font-weight:700;padding:11px 18px;border-radius:var(--r-pill)}',
'.site-foot{background:var(--surface);border-top:1px solid var(--line);margin-top:44px}',
'.foot__inner{max-width:1080px;margin:0 auto;padding:24px 16px;font-size:12.5px;color:var(--ink-2)}',
'.foot__links{display:flex;flex-wrap:wrap;gap:12px;margin:11px 0}',
'.foot__links a{color:var(--ink-2);text-decoration:none}',
'.foot__copy{color:var(--ink-3);margin:0}',
'.idx__grp{margin:30px 0 0}',
'.idx__grp h2{font-size:17px}',
'.idx__cnt{font-size:12px;color:var(--ink-3);font-weight:400;margin-left:8px}',
'@media(max-width:640px){h1{font-size:22px}h2{font-size:18px}.wrap{padding:18px 14px 44px}}'
].join('\n');

const GA = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-1XXMP8Y1B4"></' + 'script>\n'
  + '<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}'
  + "gtag('js',new Date());gtag('config','G-1XXMP8Y1B4');</" + 'script>';

// media/ 配下からの相対パス（記事ページ・一覧ページはどちらも media/ の中）
function header() {
  return '<header class="topbar"><div class="topbar__inner">\n'
    + '<a class="brand" href="../" aria-label="財政課転職トップ">\n'
    + '<img class="brand__mark" src="../assets/mark.png" alt="" aria-hidden="true">\n'
    + '<span><span class="brand__name">財政課転職</span><span class="brand__sub">PUBLIC &rarr; PRIVATE</span></span></a>\n'
    + '<nav class="gnav" aria-label="メインメニュー">\n'
    + '<a href="../">求人を探す</a>\n'
    + '<a href="../zukan.html">部署別 仕事ガイド</a>\n'
    + '<a href="./" aria-current="page">記事</a>\n'
    + '<a href="../apply.html">転職支援サービス</a></nav>\n'
    + '<a class="btn-head" href="../apply.html">無料で相談する</a></div></header>';
}

function footer() {
  return '<footer class="site-foot"><div class="foot__inner">\n'
    + '<strong>財政課転職 — 公務員のための求人サイト</strong><br>\n'
    + '<span>人材紹介サービス「エージェントベスト」が運営しています。ご利用はすべて無料です（紹介手数料は採用企業からいただきます）。</span>\n'
    + '<nav class="foot__links"><a href="../">求人を探す</a><a href="../zukan.html">部署別 仕事ガイド</a>\n'
    + '<a href="./">記事</a><a href="../apply.html">転職支援サービス</a><a href="../terms.html">利用規約</a>\n'
    + '<a href="../privacy.html">プライバシーポリシー（人材紹介）</a><a href="../privacy-ad.html">プライバシーポリシー（求人広告）</a>\n'
    + '<a href="https://www.agent-best.net/" target="_blank" rel="noopener">運営会社サイト</a></nav>\n'
    + '<p class="foot__copy">&copy; 株式会社エージェントベスト</p></div></footer>';
}

const AUTHOR = '<div class="author"><p class="author__lbl">監修</p>\n'
  + '<p class="author__name"><a href="' + PROFILE_URL + '" target="_blank" rel="noopener">松岡 良次</a></p>\n'
  + '<p class="author__bio">株式会社エージェントベスト代表。大手人材会社およびスタートアップ人材企業にて、'
  + 'IT・スタートアップ・メガベンチャー企業の採用支援に従事。独立後はIT・スタートアップ・コンサル領域に特化し、'
  + '20〜30代のキャリア支援を行う。（厚生労働大臣許可 13-ユ-316964）</p></div>';

const CTA_END = '<section class="cta"><h2>「自分の経験に、どこで値段が付くのか」から相談できます</h2>\n'
  + '<p>在職中でも、情報収集だけでも構いません。応募する求人が決まっていない段階のほうが、むしろ整理する意味があります。ご利用はすべて無料です。</p>\n'
  + '<div class="cta__btns"><a class="cta__pri" href="../apply.html">無料で相談する</a>\n'
  + '<a class="cta__sec" href="../">求人を見る</a>\n'
  + '<a class="cta__sec" href="' + LINE_URL + '" target="_blank" rel="noopener noreferrer" data-line-cta="media-cta">LINEで相談する</a></div></section>';

function ldJson(obj) {
  // </script> の閉じ判定を壊さないようエスケープする
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

// ---------- 記事ページ ----------
function renderArticle(meta, bodyHtml, faq, related) {
  const url = SITE + '/media/' + meta.slug + '.html';
  const ld = [{
    '@context': 'https://schema.org', '@type': 'Article', headline: meta.title,
    description: meta.description || '', mainEntityOfPage: url,
    author: { '@type': 'Organization', name: '株式会社エージェントベスト' },
    publisher: { '@type': 'Organization', name: '財政課転職' }
  }, {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '財政課転職', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: '記事', item: SITE + '/media/' },
      { '@type': 'ListItem', position: 3, name: meta.title, item: url }]
  }];
  if (faq.length) ld.push({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
  });

  const srcHtml = (meta.sources && meta.sources.length)
    ? '<section class="sources"><h2>出典</h2><ol>' + meta.sources.map(function (s) {
      return '<li>' + (s.url
        ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.name) + '</a>'
        : esc(s.name)) + '</li>';
    }).join('') + '</ol></section>'
    : '';

  const relHtml = related.length
    ? '<section class="related"><h2>関連する記事</h2><ul>' + related.map(function (r) {
      return '<li><a href="' + r.slug + '.html">' + esc(r.title) + '</a></li>';
    }).join('') + '</ul></section>'
    : '';

  const asof = meta.asof
    ? esc(meta.asof) + '時点の公開情報にもとづきます。制度や募集要項は変わることがあるため、手続きの前に各機関の公式情報をご確認ください。'
    : '';

  return '<!doctype html>\n<html lang="ja">\n<head>\n'
    + '<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<meta name="robots" content="index,follow">\n'
    + '<title>' + esc(meta.title) + '｜財政課転職</title>\n'
    + '<link rel="icon" href="../assets/favicon.ico" sizes="any">\n'
    + '<link rel="icon" type="image/png" href="../assets/icon-192.png">\n'
    + '<link rel="apple-touch-icon" href="../assets/apple-touch-icon.png">\n'
    + '<link rel="canonical" href="' + url + '">\n'
    + '<meta name="description" content="' + esc(meta.description || '') + '">\n'
    + '<meta property="og:type" content="article">\n'
    + '<meta property="og:site_name" content="財政課転職">\n'
    + '<meta property="og:title" content="' + esc(meta.title) + '">\n'
    + '<meta property="og:description" content="' + esc(meta.description || '') + '">\n'
    + '<meta property="og:url" content="' + url + '">\n'
    + '<meta property="og:locale" content="ja_JP">\n'
    + '<meta property="og:image" content="' + SITE + '/assets/ogp.jpg">\n'
    + '<meta name="twitter:card" content="summary_large_image">\n'
    + '<meta name="twitter:image" content="' + SITE + '/assets/ogp.jpg">\n'
    + GA + '\n'
    + '<style>' + CSS + '</style>\n'
    + '<script type="application/ld+json">' + ldJson(ld) + '</' + 'script>\n'
    + '</head>\n<body>\n'
    + header() + '\n'
    + '<main class="wrap">\n'
    + '<nav class="crumb"><a href="../">財政課転職</a> &rsaquo; <a href="./">記事</a> &rsaquo; ' + esc(meta.kind || '') + '</nav>\n'
    + '<article class="post">\n'
    + '<p class="post__eyebrow">' + esc(meta.kind || '')
    + (meta.area && meta.area !== meta.kind ? ' / ' + esc(meta.area) : '') + '</p>\n'
    + '<h1>' + esc(meta.title) + '</h1>\n'
    + '<p class="post__meta">' + asof + '</p>\n'
    + bodyHtml + '\n'
    + srcHtml + '\n'
    + '</article>\n'
    + AUTHOR + '\n'
    + relHtml + '\n'
    + CTA_END + '\n'
    + '</main>\n'
    + footer() + '\n'
    + '</body>\n</html>';
}

// ---------- 記事一覧 ----------
function renderIndex(arts) {
  const order = ['自治体別', '部署別', '選考対策', '業界研究', '制度とお金', '資格・スキル'];
  const groups = {};
  for (const a of arts) (groups[a.meta.kind] = groups[a.meta.kind] || []).push(a);
  const kinds = order.filter(k => groups[k]).concat(Object.keys(groups).filter(k => order.indexOf(k) < 0));
  const body = kinds.map(function (k) {
    const list = groups[k].sort((a, b) => (+a.meta.no) - (+b.meta.no));
    return '<section class="idx__grp"><h2>' + esc(k) + '<span class="idx__cnt">' + list.length + '本</span></h2>\n<ul>'
      + list.map(a => '<li><a href="' + a.meta.slug + '.html">' + esc(a.meta.title) + '</a></li>').join('')
      + '</ul></section>';
  }).join('\n');

  return '<!doctype html>\n<html lang="ja">\n<head>\n'
    + '<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<meta name="robots" content="index,follow">\n'
    + '<title>記事一覧｜財政課転職</title>\n'
    + '<link rel="icon" href="../assets/favicon.ico" sizes="any">\n'
    + '<link rel="canonical" href="' + SITE + '/media/">\n'
    + '<meta name="description" content="自治体・官公庁で働いてきた方に向けて、経験の言い換え方、選考の進め方、退職手当や共済といった制度の扱いを整理した記事の一覧です。">\n'
    + '<meta property="og:type" content="website">\n'
    + '<meta property="og:site_name" content="財政課転職">\n'
    + '<meta property="og:title" content="記事一覧｜財政課転職">\n'
    + '<meta property="og:url" content="' + SITE + '/media/">\n'
    + '<meta property="og:image" content="' + SITE + '/assets/ogp.jpg">\n'
    + '<meta name="twitter:card" content="summary_large_image">\n'
    + GA + '\n'
    + '<style>' + CSS + '</style>\n'
    + '</head>\n<body>\n'
    + header() + '\n'
    + '<main class="wrap">\n'
    + '<nav class="crumb"><a href="../">財政課転職</a> &rsaquo; 記事</nav>\n'
    + '<h1>記事一覧</h1>\n'
    + '<p class="post__meta">庁内では当たり前だった仕事が、民間側で何と呼ばれ、どう評価されるのか。制度の手続きまで含めて整理しています。</p>\n'
    + body + '\n'
    + CTA_END + '\n'
    + '</main>\n'
    + footer() + '\n'
    + '</body>\n</html>';
}

// ---------- sitemap ----------
function updateSitemap(slugs) {
  const p = path.join(ROOT, 'sitemap.xml');
  let xml = fs.readFileSync(p, 'utf8');
  xml = xml.replace(/[ \t]*<url><loc>https:\/\/zaiseikatenshoku\.com\/media\/[^<]*<\/loc>[\s\S]*?<\/url>\r?\n?/g, '');
  const add = ['  <url><loc>' + SITE + '/media/</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>']
    .concat(slugs.map(s => '  <url><loc>' + SITE + '/media/' + s + '.html</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>'));
  xml = xml.replace('</urlset>', add.join('\r\n') + '\r\n</urlset>');
  fs.writeFileSync(p, xml);
}

// ---------- main ----------
function main() {
  if (!fs.existsSync(OUT)) { console.log('out/ がありません。記事を書いてから実行してください。'); return; }
  const files = fs.readdirSync(OUT).filter(f => f.endsWith('.md'));
  if (!files.length) { console.log('out/ に記事がありません。'); return; }
  fs.mkdirSync(MEDIA, { recursive: true });

  const arts = [];
  for (const f of files) {
    const parsed = parseFront(fs.readFileSync(path.join(OUT, f), 'utf8'));
    if (!parsed.meta.slug) throw new Error(f + ': slug がありません');
    arts.push({ meta: parsed.meta, body: parsed.body, faq: extractFaq(parsed.body) });
  }

  // related: 同じ領域 → 同じ種別 の順に最大6本
  for (const a of arts) {
    const same = arts.filter(b => b !== a && b.meta.area === a.meta.area);
    const kin = arts.filter(b => b !== a && b.meta.kind === a.meta.kind && same.indexOf(b) < 0);
    a.related = same.concat(kin).slice(0, 6).map(b => ({ slug: b.meta.slug, title: b.meta.title }));
  }

  for (const a of arts) {
    const html = renderArticle(a.meta, md2html(a.body), a.faq, a.related);
    fs.writeFileSync(path.join(MEDIA, a.meta.slug + '.html'), html.replace(/\r?\n/g, '\r\n'));
  }
  fs.writeFileSync(path.join(MEDIA, 'index.html'), renderIndex(arts).replace(/\r?\n/g, '\r\n'));
  updateSitemap(arts.map(a => a.meta.slug).sort());
  console.log('記事 ' + arts.length + '本 → media/*.html を生成、media/index.html と sitemap.xml を更新しました');
}

if (require.main === module) main();
module.exports = { parseFront, md2html, extractFaq, renderArticle, renderIndex, main };
