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

    // 引用（「> 」）。職務経歴書の文例などで使う。行の区切りに意味があるので
    // 各行は <br> でつなぎ、「>」だけの行で段落を分ける。
    // ⚠ これが無いと段落扱いになり、「>」が &gt; のまま本文に出る（2026-10 に394本で発生）。
    if (/^>/.test(L)) {
      const buf = [];
      while (i < lines.length && /^>/.test(lines[i])) { buf.push(lines[i].replace(/^> ?/, '')); i++; }
      const paras = [];
      let cur = [];
      for (const q of buf) {
        if (q.trim()) cur.push(q.trim());
        else if (cur.length) { paras.push(cur); cur = []; }
      }
      if (cur.length) paras.push(cur);
      out.push('<blockquote>' + paras.map(p => `<p>${p.map(inline).join('<br>')}</p>`).join('') + '</blockquote>');
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
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|-\s|\d+\.\s|\||:::|>)/.test(lines[i])) { para.push(lines[i]); i++; }
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
'blockquote{margin:0 0 20px;padding:12px 16px;border-left:4px solid var(--line);background:var(--surface-2);border-radius:0 8px 8px 0;color:var(--ink-2)}',
'blockquote p:last-child{margin-bottom:0}',
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
'@media(max-width:640px){h1{font-size:22px}h2{font-size:18px}.wrap{padding:18px 14px 44px}}',
// ---- ポータル風レイアウト（記事トップ・記事ページ共通。2026-11-14） ----
'.wrap--wide{max-width:1080px}',
'.layout{display:grid;gap:36px;grid-template-columns:minmax(0,1fr)}',
'.layout>*{min-width:0}',
'@media(min-width:1024px){.layout{grid-template-columns:minmax(0,1fr) 300px}.layout--post{grid-template-columns:minmax(0,720px) 300px;justify-content:space-between}}',
'.tabs{display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:thin;margin:0 0 22px;padding:2px 0 8px;border-bottom:1px solid var(--line)}',
'.tabs a{flex:0 0 auto;font-size:13px;font-weight:700;color:var(--ink-2);text-decoration:none;background:var(--surface);border:1px solid var(--line);padding:6px 13px;border-radius:var(--r-pill);white-space:nowrap}',
'.tabs a:hover{color:var(--accent-ink);border-color:var(--accent)}',
'.tabs a[aria-current]{background:var(--accent);border-color:var(--accent);color:var(--surface)}',
'.tabs__n{font-weight:400;opacity:.75;margin-left:4px;font-size:11.5px}',
'.sec{margin:0 0 38px}',
'.sec__h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;font-size:18px;line-height:1.5;margin:0 0 14px;padding:0 0 8px;border:0;border-bottom:2px solid var(--ink)}',
'.sec__h .idx__cnt{margin-left:0}',
'.sec__more{margin-left:auto;font-size:13px;font-weight:700;text-decoration:none;white-space:nowrap}',
'.sec__more:hover{text-decoration:underline}',
'.sec__dot{display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--th);align-self:center}',
// サムネイル（CSSだけ。カテゴリごとに固定色）
'.th{position:relative;aspect-ratio:16/9;border-radius:10px;overflow:hidden;color:#fff;background:var(--th);background:linear-gradient(135deg,var(--th),color-mix(in srgb,var(--th) 62%,#000));display:flex;flex-direction:column;justify-content:flex-end;padding:10px 12px}',
'.th__cat{position:absolute;top:9px;left:10px;font-size:10.5px;font-weight:800;letter-spacing:.06em;background:rgba(255,255,255,.2);padding:2px 8px;border-radius:var(--r-pill)}',
'.th__ch{position:absolute;right:-6px;bottom:-22px;font-size:96px;font-weight:900;line-height:1;opacity:.14}',
'.th__kw{position:relative;font-size:17px;font-weight:800;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}',
'.card{display:flex;flex-direction:column;gap:9px;text-decoration:none;color:inherit;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);padding:10px}',
'.card:hover{border-color:var(--accent)}',
'.card:hover .card__t{text-decoration:underline}',
'.card__meta{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:11.5px;color:var(--ink-3);margin:0}',
'.lbl{font-weight:700;color:var(--accent-ink)}',
'.card__t{font-size:14px;font-weight:700;line-height:1.6;margin:0;color:var(--ink);overflow-wrap:anywhere}',
'.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,210px),1fr));gap:14px}',
// 注目枠（大1＋小）
'.feat{display:grid;gap:14px;grid-template-columns:minmax(0,1fr)}',
'@media(min-width:720px){.feat{grid-template-columns:minmax(0,1.35fr) minmax(0,1fr)}}',
'.feat__big .th{aspect-ratio:16/9}',
'.feat__big .th__kw{font-size:24px}',
'.feat__big .card__t{font-size:17px}',
'.feat__list{display:grid;gap:10px;align-content:start}',
'.mini{display:grid;grid-template-columns:104px minmax(0,1fr);gap:11px;align-items:start;text-decoration:none;color:inherit;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:8px}',
'.mini:hover{border-color:var(--accent)}',
'.mini:hover .card__t{text-decoration:underline}',
'.mini .th{padding:6px 7px;border-radius:7px}',
'.mini .th__cat{display:none}',
'.mini .th__ch{font-size:54px;bottom:-12px}',
'.mini .th__kw{font-size:12px}',
'.mini .card__t{font-size:13px;line-height:1.55}',
'.mini .card__meta{margin:0 0 3px}',
// すべての記事（折りたたみ）
'.more{margin:14px 0 0;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card)}',
'.more>summary{cursor:pointer;padding:11px 16px;font-size:13.5px;font-weight:700;color:var(--accent-ink)}',
'.more__body{padding:0 16px 10px}',
'.more__body h3{font-size:14px;margin:16px 0 4px;scroll-margin-top:70px}',
'.more__body ul{list-style:none;padding:0;margin:0}',
'.more__body li{border-bottom:1px solid var(--line-2);padding:7px 0;margin:0;font-size:14px;line-height:1.7}',
'.more__body a{text-decoration:none}',
'.more__body a:hover{text-decoration:underline}',
'[id^="cat-"]{scroll-margin-top:70px}',
// サイドバー
'.side{display:flex;flex-direction:column;gap:22px}',
'.side__box{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);padding:14px 16px}',
'.side__h{font-size:14px;font-weight:800;margin:0 0 8px;padding:0 0 7px;border:0;border-bottom:1px solid var(--line)}',
'.side__rank{list-style:none;counter-reset:r;padding:0;margin:0}',
'.side__rank li{counter-increment:r;display:grid;grid-template-columns:24px minmax(0,1fr);gap:8px;padding:8px 0;margin:0;border-bottom:1px solid var(--line-2);font-size:13px;line-height:1.6}',
'.side__rank li:last-child{border-bottom:0}',
'.side__rank li::before{content:counter(r);font-weight:900;color:var(--accent-ink);font-size:15px;line-height:1.4}',
'.side__rank a,.side__cats a{text-decoration:none;color:var(--ink)}',
'.side__rank a:hover,.side__cats a:hover{text-decoration:underline;color:var(--accent-ink)}',
'.side__cats{list-style:none;padding:0;margin:0}',
'.side__cats li{display:flex;justify-content:space-between;gap:8px;padding:7px 0;margin:0;border-bottom:1px solid var(--line-2);font-size:13.5px}',
'.side__cats li:last-child{border-bottom:0}',
'.side__cats span{color:var(--ink-3);font-size:12px}',
'.side__mini{display:grid;gap:9px}',
'.side__mini .mini{grid-template-columns:84px minmax(0,1fr);padding:6px;border-radius:10px}',
'.side__mini .th__kw{font-size:11px}',
'.side__mini .card__t{font-size:12.5px}',
'.chips{display:flex;flex-wrap:wrap;gap:6px}',
'.chips a{font-size:12px;color:var(--ink-2);text-decoration:none;background:var(--surface-2);padding:4px 10px;border-radius:var(--r-pill)}',
'.chips a:hover{color:var(--accent-ink);text-decoration:underline}',
'.side__cta{background:var(--accent-soft);border-color:var(--accent)}',
'.side__cta p{font-size:13px;line-height:1.75;color:var(--ink-2);margin:0 0 10px}',
'.side__cta .cta__pri,.side__cta .cta__sec{display:block;text-align:center;font-size:13.5px;padding:9px 12px;margin-top:7px}',
'@media(min-width:1024px){.side__sticky{position:sticky;top:76px}}',
'.post__tags{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin:0 0 10px}',
'.post__tags .post__eyebrow{margin:0}',
'.post__date{font-size:12px;color:var(--ink-3)}',
'.related .cards{margin-top:4px}',
'.related__more{margin:14px 0 0;text-align:right;font-size:13.5px;font-weight:700}',
'.related__more a{text-decoration:none}',
'.related__more a:hover{text-decoration:underline}'
].join('\n');

// ---------- ポータル部品 ----------
// カテゴリ（記事の種別）→ アンカーと色。色は固定表（毎回同じ）。表に無い種別は名前のハッシュで決める
const KIND_ORDER = ['自治体別', '部署別', '選考対策', '業界研究', '制度とお金', '資格・スキル'];
const KIND_INFO = {
  '自治体別': { id: 'cat-city', color: '#1E3A8A' },
  '部署別': { id: 'cat-dept', color: '#0F766E' },
  '選考対策': { id: 'cat-senkou', color: '#B4530A' },
  '業界研究': { id: 'cat-industry', color: '#6D28D9' },
  '制度とお金': { id: 'cat-seido', color: '#047857' },
  '資格・スキル': { id: 'cat-skill', color: '#BE185D' }
};
const EXTRA_COLORS = ['#0E7490', '#9A3412', '#4D7C0F', '#7C2D12', '#1D4ED8', '#86198F'];
function kindInfo(k) {
  if (KIND_INFO[k]) return KIND_INFO[k];
  let h = 0;
  for (const ch of String(k)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return { id: 'cat-x' + h.toString(36), color: EXTRA_COLORS[h % EXTRA_COLORS.length] };
}

// asof（「2026年9月」「2026-11」）の表示と並べ替え。値が無ければ何も出さない
function asofLabel(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{1,2})$/);
  return (m ? m[1] + '年' + (+m[2]) + '月' : String(v)) + '時点';
}
function asofKey(v) {
  const m = String(v || '').match(/(\d{4})\D+(\d{1,2})/);
  return m ? (+m[1]) * 100 + (+m[2]) : 0;
}
// 情報時点の新しい順 → 同じなら No の小さい順（決定的）
function byFresh(a, b) {
  return (asofKey(b.meta.asof) - asofKey(a.meta.asof)) || ((+a.meta.no) - (+b.meta.no));
}

function thumbKeyword(meta) {
  const t = String(meta.target || '');
  return (t && t.length <= 14) ? t : (meta.area || meta.kind || '');
}
function thumbHtml(meta) {
  const ki = kindInfo(meta.kind);
  const kw = thumbKeyword(meta);
  return '<div class="th" style="--th:' + ki.color + '" aria-hidden="true">'
    + '<span class="th__cat">' + esc(meta.kind || '') + '</span>'
    + '<span class="th__ch">' + esc(Array.from(kw)[0] || '') + '</span>'
    + '<span class="th__kw">' + esc(kw) + '</span></div>';
}
function metaLine(meta) {
  const d = asofLabel(meta.asof);
  return '<p class="card__meta"><span class="lbl">' + esc(meta.kind || '') + '</span>'
    + (d ? '<span>' + esc(d) + '</span>' : '') + '</p>';
}
function cardHtml(meta, cls) {
  return '<a class="' + (cls || 'card') + '" href="' + meta.slug + '.html">' + thumbHtml(meta)
    + '<div>' + metaLine(meta) + '<p class="card__t">' + esc(meta.title) + '</p></div></a>';
}
function miniHtml(meta) { return cardHtml(meta, 'mini'); }

function kindsOf(arts) {
  const groups = {};
  for (const a of arts) (groups[a.meta.kind] = groups[a.meta.kind] || []).push(a);
  const kinds = KIND_ORDER.filter(k => groups[k]).concat(Object.keys(groups).filter(k => KIND_ORDER.indexOf(k) < 0));
  return { groups, kinds };
}

function tabsHtml(kinds, groups, current) {
  return '<nav class="tabs" aria-label="記事のカテゴリ">'
    + '<a href="./"' + (current === '' ? ' aria-current="page"' : '') + '>すべて</a>'
    + kinds.map(k => '<a href="./#' + kindInfo(k).id + '">' + esc(k)
      + '<span class="tabs__n">' + groups[k].length + '</span></a>').join('')
    + '</nav>';
}

function sideCatsHtml(kinds, groups) {
  return '<section class="side__box"><h2 class="side__h">カテゴリ</h2><ul class="side__cats">'
    + kinds.map(k => '<li><a href="./#' + kindInfo(k).id + '">' + esc(k) + '</a><span>' + groups[k].length + '本</span></li>').join('')
    + '</ul></section>';
}

// 既存の相談CTA（記事末尾の CTA_END）と同じ行き先・文言の小型版
const SIDE_CTA = '<section class="side__box side__cta"><h2 class="side__h">転職の相談</h2>'
  + '<p>在職中でも、情報収集だけでも構いません。ご利用はすべて無料です。</p>'
  + '<a class="cta__pri" href="../apply.html">無料で相談する</a>'
  + '<a class="cta__sec" href="../">求人を見る</a>'
  + '<a class="cta__sec" href="' + LINE_URL + '" target="_blank" rel="noopener noreferrer" data-line-cta="media-side">LINEで相談する</a></section>';

const GA = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-1XXMP8Y1B4"></' + 'script>\n'
  + '<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}'
  + "gtag('js',new Date());gtag('config','G-1XXMP8Y1B4');</" + 'script>';

// media/ 配下からの相対パス（記事ページ・一覧ページはどちらも media/ の中）
function header() {
  return '<header class="topbar"><div class="topbar__inner">\n'
    + '<a class="brand" href="../" aria-label="エージェントベストジョブ財政課転職トップ">\n'
    + '<img class="brand__mark" src="../assets/mark.png" alt="" aria-hidden="true">\n'
    + '<span><span class="brand__name"><span style="display:block;font-size:10px;line-height:1.5">エージェントベストジョブ</span>財政課転職</span><span class="brand__sub">PUBLIC &rarr; PRIVATE</span></span></a>\n'
    + '<nav class="gnav" aria-label="メインメニュー">\n'
    + '<a href="../">求人を探す</a>\n'
    + '<a href="../zukan.html">部署別 仕事ガイド</a>\n'
    + '<a href="./" aria-current="page">記事</a>\n'
    + '<a href="../apply.html">転職支援サービス</a></nav>\n'
    + '<a class="btn-head" href="../apply.html">無料で相談する</a></div></header>';
}

function footer() {
  return '<footer class="site-foot"><div class="foot__inner">\n'
    + '<strong>エージェントベストジョブ財政課転職 — 公務員のための求人サイト</strong><br>\n'
    + '<span>人材紹介サービス「エージェントベスト」が運営しています。ご利用はすべて無料です（紹介手数料は採用企業からいただきます）。</span>\n'
    + '<nav class="foot__links"><a href="../">求人を探す</a><a href="../zukan.html">部署別 仕事ガイド</a>\n'
    + '<a href="./">記事</a><a href="../apply.html">転職支援サービス</a><a href="../terms.html">利用規約</a>\n'
    + '<a href="../privacy.html">プライバシーポリシー（人材紹介）</a><a href="../privacy-ad.html">プライバシーポリシー（求人広告）</a>\n'
    + '<a href="https://www.agent-best.net/" target="_blank" rel="noopener">運営会社サイト</a></nav>\n'
    + '<p class="foot__copy">&copy; 株式会社エージェントベスト</p><!-- ab-network:start --><nav class="abn" aria-label="エージェントベストのサイト一覧"><style>.abn{margin:32px 0 0;padding:24px 0 0;border-top:1px solid rgba(127,127,127,.28);font-size:13px;line-height:1.6;text-align:left;color:inherit}.abn-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:20px 32px}.abn-h{margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.06em;opacity:.9}.abn ul{list-style:none;margin:0;padding:0}.abn li{margin:0 0 4px;padding:0}.abn li:before{content:none}.abn a{color:inherit;opacity:.78;text-decoration:none;border:0;background:none}.abn a:hover,.abn a:focus-visible{opacity:1;text-decoration:underline}.abn-op{margin:16px 0 0;font-size:12px;opacity:.75}</style><div class="abn-grid"><div><p class="abn-h">転職のご相談（特化サイト）</p><ul><li><a href="https://lp.pmtenshoku.com/" target="_blank" rel="noopener">PM・プロジェクトマネージャーの転職</a></li><li><a href="https://eng.agent-best.net/" target="_blank" rel="noopener">エンジニアからコンサルへの転職</a></li><li><a href="https://lp.matenshoku.com/" target="_blank" rel="noopener">未経験からM&amp;A業界へ</a></li><li><a href="https://lp.consultenshoku.com/" target="_blank" rel="noopener">未経験からコンサルへ</a></li><li><a href="https://engineertenshoku.com/" target="_blank" rel="noopener">未経験からエンジニアへ</a></li><li><a href="https://lp.kumikomitenshoku.com/" target="_blank" rel="noopener">IoT・組込みエンジニアの転職</a></li><li><a href="https://fde.agent-best.net/" target="_blank" rel="noopener">FDE（フォワードデプロイドエンジニア）</a></li><li><a href="https://consultingcareerchange50.agent-best.net/" target="_blank" rel="noopener">コンサルファーム出身者の次のキャリア</a></li><li><a href="https://student.agent-best.net/" target="_blank" rel="noopener">学生のキャリア支援</a></li></ul></div><div><p class="abn-h">求人・情報を探す</p><ul><li><a href="https://jobs.agent-best.net/" target="_blank" rel="noopener">中途・ハイクラスの求人</a></li><li><a href="https://skill.agent-best.net/" target="_blank" rel="noopener">未経験・第二新卒の求人</a></li><li><a href="https://shinsotsu.agent-best.net/" target="_blank" rel="noopener">新卒・インターンの求人</a></li><li><a href="https://freelanceanken.com/" target="_blank" rel="noopener">フリーランス案件（エンジニア・コンサル）</a></li><li><a href="https://www.pmtenshoku.com/" target="_blank" rel="noopener">PM転職の求人検索</a></li><li><a href="https://www.consultenshoku.com/" target="_blank" rel="noopener">コンサル転職の求人検索</a></li><li><a href="https://www.matenshoku.com/" target="_blank" rel="noopener">M&amp;A転職の求人検索</a></li><li><a href="https://www.eigyotenshoku.com/" target="_blank" rel="noopener">営業転職の求人検索</a></li><li><a href="https://www.kumikomitenshoku.com/" target="_blank" rel="noopener">IoT・組込み転職の求人検索</a></li><li><a href="https://jobs.agent-best.net/media/" target="_blank" rel="noopener">転職メディア</a></li><li><a href="https://jobs.agent-best.net/cases/" target="_blank" rel="noopener">転職事例集</a></li><li><a href="https://www.agent-hi-kaku.com/" target="_blank" rel="noopener">転職エージェント比較</a></li></ul></div><div><p class="abn-h">採用ご担当者さまへ</p><ul><li><a href="https://www.agent-best.net/business/" target="_blank" rel="noopener">人材紹介（求人のご依頼）</a></li><li><a href="https://scout.agent-best.net/" target="_blank" rel="noopener">スカウト代行</a></li><li><a href="https://offerboxapp.com/" target="_blank" rel="noopener">OfferBox運用代行</a></li><li><a href="https://green.agent-best.net/" target="_blank" rel="noopener">Green運用代行</a></li><li><a href="https://infra.agent-best.net/" target="_blank" rel="noopener">長期インターン採用（Infra）</a></li><li><a href="https://saiyo-media.agent-best.net/" target="_blank" rel="noopener">求人広告代理店（求人媒体の比較・申込）</a></li><li><a href="https://eraberusaiyodaiko.com/" target="_blank" rel="noopener">採用代行の担当者を選ぶ「エラベル」</a></li></ul></div></div><p class="abn-op">運営：<a href="https://www.agent-best.net/" target="_blank" rel="noopener">株式会社エージェントベスト</a></p></nav><!-- ab-network:end --></div></footer>';
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
function renderArticle(meta, bodyHtml, faq, related, ctx) {
  const url = SITE + '/media/' + meta.slug + '.html';
  const ld = [{
    '@context': 'https://schema.org', '@type': 'Article', headline: meta.title,
    description: meta.description || '', mainEntityOfPage: url,
    author: { '@type': 'Organization', name: '株式会社エージェントベスト' },
    publisher: { '@type': 'Organization', name: 'エージェントベストジョブ財政課転職' }
  }, {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'エージェントベストジョブ財政課転職', item: SITE + '/' },
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

  // related は {slug,title} か、カード用に meta を持つもの（main() で meta を渡している）
  ctx = ctx || null;
  const kid = kindInfo(meta.kind).id;
  const relHtml = related.length
    ? '<section class="related"><h2>関連する記事</h2><div class="cards">' + related.map(function (r) {
      return r.meta ? cardHtml(r.meta) : '<a class="card" href="' + r.slug + '.html"><p class="card__t">' + esc(r.title) + '</p></a>';
    }).join('') + '</div>'
    + (ctx ? '<p class="related__more"><a href="./#' + kid + '">' + esc(meta.kind || '') + 'の記事をもっと見る &rarr;</a></p>' : '')
    + '</section>'
    : '';

  const sideHtml = ctx
    ? '<aside class="side" aria-label="サイドバー">\n'
      + (ctx.sameKind.length
        ? '<section class="side__box"><h2 class="side__h">' + esc(meta.kind || '') + 'の記事</h2><div class="side__mini">'
          + ctx.sameKind.map(miniHtml).join('') + '</div>'
          + '<p class="related__more"><a href="./#' + kid + '">もっと見る &rarr;</a></p></section>\n'
        : '')
      + sideCatsHtml(ctx.kinds, ctx.groups) + '\n'
      + '<div class="side__sticky">' + SIDE_CTA + '</div>\n'
      + '</aside>\n'
    : '';
  const dateLbl = asofLabel(meta.asof);

  const asof = meta.asof
    ? esc(meta.asof) + '時点の公開情報にもとづきます。制度や募集要項は変わることがあるため、手続きの前に各機関の公式情報をご確認ください。'
    : '';

  return '<!doctype html>\n<html lang="ja">\n<head>\n'
    + '<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<meta name="robots" content="index,follow">\n'
    + '<title>' + esc(meta.title) + '｜エージェントベストジョブ財政課転職</title>\n'
    + '<link rel="icon" href="../assets/favicon.ico" sizes="any">\n'
    + '<link rel="icon" type="image/png" href="../assets/icon-192.png">\n'
    + '<link rel="apple-touch-icon" href="../assets/apple-touch-icon.png">\n'
    + '<link rel="canonical" href="' + url + '">\n'
    + '<meta name="description" content="' + esc(meta.description || '') + '">\n'
    + '<meta property="og:type" content="article">\n'
    + '<meta property="og:site_name" content="エージェントベストジョブ財政課転職">\n'
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
    + '<main class="wrap' + (ctx ? ' wrap--wide' : '') + '">\n'
    + (ctx ? tabsHtml(ctx.kinds, ctx.groups, null) + '\n' : '')
    + '<nav class="crumb"><a href="../">エージェントベストジョブ財政課転職</a> &rsaquo; <a href="./">記事</a> &rsaquo; '
    + (ctx ? '<a href="./#' + kid + '">' + esc(meta.kind || '') + '</a>' : esc(meta.kind || '')) + '</nav>\n'
    + (ctx ? '<div class="layout layout--post">\n<div>\n' : '')
    + '<article class="post">\n'
    + '<div class="post__tags"><p class="post__eyebrow">' + esc(meta.kind || '')
    + (meta.area && meta.area !== meta.kind ? ' / ' + esc(meta.area) : '') + '</p>'
    + (dateLbl ? '<span class="post__date">' + esc(dateLbl) + 'の情報</span>' : '') + '</div>\n'
    + '<h1>' + esc(meta.title) + '</h1>\n'
    + '<p class="post__meta">' + asof + '</p>\n'
    + bodyHtml + '\n'
    + srcHtml + '\n'
    + '</article>\n'
    + AUTHOR + '\n'
    + relHtml + '\n'
    + CTA_END + '\n'
    + (ctx ? '</div>\n' + sideHtml + '</div>\n' : '')
    + '</main>\n'
    + footer() + '\n'
    + '<!-- ab-chat:start --><script src="/ab-chat.js" defer data-ab-chat data-site="zaiseika" data-mode="seeker" data-label="財政課転職"></script><!-- ab-chat:end --></body>\n</html>';
}

// ---------- 記事一覧 ----------
// 構成（記事が少ないときは各枠を自動で縮める／空の枠は出さない）
//   カテゴリのタブ → 注目の記事（大1＋小最大4。各カテゴリの情報時点がいちばん新しい記事）
//   → 情報が新しい記事（カード最大8） → カテゴリ別（カード最大6＋「すべて見る」に全記事を領域別で）
//   右サイドバー（1024px以上。未満は本文の下）：注目の記事（番号付き）・カテゴリ・相談CTA・テーマ
// ⚠ アクセス数のデータは無いので「人気」「ランキング」「よく読まれている」とは書かない
// ⚠ 全記事へのリンクは「すべて見る」の中に残す（一覧から張っている内部リンクを減らさない）
function renderIndex(arts) {
  const { groups, kinds } = kindsOf(arts);
  for (const k of kinds) groups[k].sort(byFresh);
  const shown = new Set();
  const take = (list, n) => { const r = []; for (const a of list) { if (r.length >= n) break; if (!shown.has(a)) { r.push(a); shown.add(a); } } return r; };

  // 注目の記事：各カテゴリの先頭（情報時点が新しい → No順）を1本ずつ
  const feat = arts.length >= 5 ? take(kinds.map(k => groups[k][0]), 5) : [];
  const featHtml = feat.length
    ? '<section class="sec" aria-labelledby="h-feat"><h2 class="sec__h" id="h-feat">注目の記事</h2><div class="feat">'
      + '<div class="feat__big">' + cardHtml(feat[0].meta) + '</div>'
      + (feat.length > 1 ? '<div class="feat__list">' + feat.slice(1).map(a => miniHtml(a.meta)).join('') + '</div>' : '')
      + '</div></section>'
    : '';

  // 情報が新しい記事（全体を情報時点の新しい順に）。記事が少ないときは出さない
  const fresh = arts.length > 12 ? take(arts.slice().sort(byFresh), 8) : [];
  const freshHtml = fresh.length
    ? '<section class="sec" aria-labelledby="h-fresh"><h2 class="sec__h" id="h-fresh">情報が新しい記事</h2><div class="cards">'
      + fresh.map(a => cardHtml(a.meta)).join('') + '</div></section>'
    : '';

  // カテゴリ別
  const areaIds = {};
  const body = kinds.map(function (k, ki) {
    const ki2 = kindInfo(k);
    const list = groups[k];
    const pick = take(list, 6);
    const cards = (pick.length ? pick : list.slice(0, 6));
    // 全記事は領域ごとに No 順で（従来の一覧と同じリンクをすべて持つ）
    const byArea = {};
    const areaOrder = [];
    for (const a of list.slice().sort((x, y) => (+x.meta.no) - (+y.meta.no))) {
      const ar = a.meta.area || k;
      if (!byArea[ar]) { byArea[ar] = []; areaOrder.push(ar); }
      byArea[ar].push(a);
    }
    const allHtml = '<details class="more" id="all-' + ki2.id + '"><summary>' + esc(k) + 'の記事をすべて見る（' + list.length + '本）</summary><div class="more__body">'
      + areaOrder.map(function (ar, ai) {
        const id = 'a-' + ki + '-' + ai;
        areaIds[k + '\u0000' + ar] = { id, area: ar, kind: k, n: byArea[ar].length };
        return (areaOrder.length > 1 ? '<h3 id="' + id + '">' + esc(ar) + '<span class="idx__cnt">' + byArea[ar].length + '本</span></h3>' : '')
          + '<ul>' + byArea[ar].map(a => '<li><a href="' + a.meta.slug + '.html">' + esc(a.meta.title) + '</a></li>').join('') + '</ul>';
      }).join('') + '</div></details>';
    return '<section class="sec" id="' + ki2.id + '" style="--th:' + ki2.color + '"><h2 class="sec__h"><span class="sec__dot" aria-hidden="true"></span>' + esc(k)
      + '<span class="idx__cnt">' + list.length + '本</span>'
      + (list.length > cards.length ? '<a class="sec__more" href="#all-' + ki2.id + '">もっと見る &rarr;</a>' : '') + '</h2>\n'
      + '<div class="cards">' + cards.map(a => cardHtml(a.meta)).join('') + '</div>\n'
      + (list.length > cards.length ? allHtml : '')
      + '</section>';
  }).join('\n');

  // サイドバー：注目の記事（番号付き。各カテゴリの2本目以降から、本文に出ていないもの）
  const sidePick = [];
  for (let r = 1; sidePick.length < 6 && r < 50; r++) {
    for (const k of kinds) { const a = groups[k][r]; if (a && !feat.includes(a) && !fresh.includes(a) && sidePick.length < 6 && !sidePick.includes(a)) sidePick.push(a); }
    if (kinds.every(k => groups[k].length <= r)) break;
  }
  // テーマ：領域が少なめのカテゴリ（15以下）の領域を、全記事リストの見出しへ
  const themes = Object.values(areaIds).filter(t => {
    const n = Object.values(areaIds).filter(u => u.kind === t.kind).length;
    return n > 1 && n <= 15;
  });
  const side = '<aside class="side" aria-label="サイドバー">\n'
    + (sidePick.length ? '<section class="side__box"><h2 class="side__h">注目の記事</h2><ol class="side__rank">'
      + sidePick.map(a => '<li><a href="' + a.meta.slug + '.html">' + esc(a.meta.title) + '</a></li>').join('') + '</ol></section>\n' : '')
    + sideCatsHtml(kinds, groups) + '\n'
    + SIDE_CTA + '\n'
    + (themes.length ? '<section class="side__box"><h2 class="side__h">テーマから探す</h2><div class="chips">'
      + themes.map(t => '<a href="#' + t.id + '">' + esc(t.area) + '</a>').join('') + '</div></section>\n' : '')
    + '</aside>\n';

  // 「もっと見る」「テーマ」から飛んだとき、閉じている「すべて見る」を開く
  const openJs = '<script>(function(){function o(){var h=decodeURIComponent(location.hash.slice(1));if(!h)return;'
    + 'var e=document.getElementById(h);if(!e)return;var d=e.tagName==="DETAILS"?e:e.closest("details");'
    + 'if(d&&!d.open){d.open=true;e.scrollIntoView();}}'
    + 'window.addEventListener("hashchange",o);o();'
    + 'document.addEventListener("click",function(ev){var a=ev.target.closest&&ev.target.closest(\'a[href^="#"]\');'
    + 'if(a&&a.getAttribute("href")===location.hash)setTimeout(o,0);});})();</' + 'script>';

  return '<!doctype html>\n<html lang="ja">\n<head>\n'
    + '<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<meta name="robots" content="index,follow">\n'
    + '<title>記事一覧｜エージェントベストジョブ財政課転職</title>\n'
    + '<link rel="icon" href="../assets/favicon.ico" sizes="any">\n'
    + '<link rel="canonical" href="' + SITE + '/media/">\n'
    + '<meta name="description" content="自治体・官公庁で働いてきた方に向けて、経験の言い換え方、選考の進め方、退職手当や共済といった制度の扱いを整理した記事の一覧です。">\n'
    + '<meta property="og:type" content="website">\n'
    + '<meta property="og:site_name" content="エージェントベストジョブ財政課転職">\n'
    + '<meta property="og:title" content="記事一覧｜エージェントベストジョブ財政課転職">\n'
    + '<meta property="og:url" content="' + SITE + '/media/">\n'
    + '<meta property="og:image" content="' + SITE + '/assets/ogp.jpg">\n'
    + '<meta name="twitter:card" content="summary_large_image">\n'
    + GA + '\n'
    + '<style>' + CSS + '</style>\n'
    + '</head>\n<body>\n'
    + header() + '\n'
    + '<main class="wrap wrap--wide">\n'
    + '<nav class="crumb"><a href="../">エージェントベストジョブ財政課転職</a> &rsaquo; 記事</nav>\n'
    + '<h1>記事一覧</h1>\n'
    + '<p class="post__meta">庁内では当たり前だった仕事が、民間側で何と呼ばれ、どう評価されるのか。制度の手続きまで含めて整理しています。</p>\n'
    + tabsHtml(kinds, groups, '') + '\n'
    + '<div class="layout">\n<div>\n'
    + featHtml + '\n'
    + freshHtml + '\n'
    + body + '\n'
    + CTA_END + '\n'
    + '</div>\n'
    + side
    + '</div>\n'
    + '</main>\n'
    + footer() + '\n'
    + openJs + '\n'
    + '<!-- ab-chat:start --><script src="/ab-chat.js" defer data-ab-chat data-site="zaiseika" data-mode="seeker" data-label="財政課転職"></script><!-- ab-chat:end --></body>\n</html>';
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
    a.related = same.concat(kin).slice(0, 6).map(b => ({ slug: b.meta.slug, title: b.meta.title, meta: b.meta }));
  }

  // サイドバー用：同じ種別の記事を No 順に並べ、自分の次から5本（関連記事と重ならないもの）
  const { groups, kinds } = kindsOf(arts);
  const byNo = {};
  for (const k of kinds) byNo[k] = groups[k].slice().sort((x, y) => (+x.meta.no) - (+y.meta.no));

  for (const a of arts) {
    const list = byNo[a.meta.kind];
    const at = list.indexOf(a);
    const relSlugs = new Set(a.related.map(r => r.slug));
    const sameKind = [];
    for (let i = 1; i < list.length && sameKind.length < 5; i++) {
      const b = list[(at + i) % list.length];
      if (!relSlugs.has(b.meta.slug)) sameKind.push(b.meta);
    }
    const ctx = { kinds, groups, sameKind };
    const html = renderArticle(a.meta, md2html(a.body), a.faq, a.related, ctx);
    fs.writeFileSync(path.join(MEDIA, a.meta.slug + '.html'), html.replace(/\r?\n/g, '\r\n'));
  }
  fs.writeFileSync(path.join(MEDIA, 'index.html'), renderIndex(arts).replace(/\r?\n/g, '\r\n'));
  updateSitemap(arts.map(a => a.meta.slug).sort());
  console.log('記事 ' + arts.length + '本 → media/*.html を生成、media/index.html と sitemap.xml を更新しました');
}

if (require.main === module) main();
module.exports = { parseFront, md2html, extractFaq, renderArticle, renderIndex, main };
