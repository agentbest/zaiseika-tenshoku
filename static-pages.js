/* 検索エンジン向けの静的ページを作る（2026-10-29〜）。rebuild.js の最後に呼ばれる。
//
//   job/<求人ID>/index.html … 求人1件のページ（job-template.html）。JobPosting 構造化データ・求人ごとの title / OGP
//   assets/site.css         … template.html の <style> の写し（静的ページの見た目を検索画面とそろえる）
//   sitemap-jobs.xml / robots.txt（記事の sitemap.xml は build-articles.js が作るので、求人は別ファイルにする）
//
// index.html は1枚の HTML で求人詳細を JS（?job=）で開くため、Google からはトップ1ページしか見えず、
// 求人は検索に載っていなかった。shinsotsu の static-pages.js（もとは jobsite）を移植したもの。
// ⚠ 生成物（job/・sitemap-jobs.xml・robots.txt・assets/site.css）は直接編集しない。直すのはこのファイルと job-template.html。
// ⚠ クラス名は template.html の求人詳細と同じ（.dt-grid .pd-sec …）。template.html のクラス名を変えたらここも直す。 */
const fs = require('fs'), path = require('path');

const SITE = 'https://zaiseikatenshoku.com';
const RELATED_MAX = 6;      /* 「ほかの求人」の件数 */

/* template.html の定数を読む（応募先・Calendly・LINE を2か所に持たないため。jobsite と同じ作り） */
function readConst(tpl, name){
  const m = tpl.match(new RegExp(`const ${name}\\s*=\\s*("([^"\\\\]|\\\\.)*"|'([^'\\\\]|\\\\.)*')`));
  if(!m) throw new Error(`template.html に const ${name} が見つかりません`);
  return new Function(`return ${m[1]}`)();
}
function readFragment(tpl, cls){
  const m = tpl.match(new RegExp(`<p class="${cls}">[\\s\\S]*?</p>`));
  if(!m) throw new Error(`template.html に <p class="${cls}"> が見つかりません`);
  if(/\$\{/.test(m[0])) throw new Error(`template.html の <p class="${cls}"> に \${…} が含まれています（静的ページでは展開できません）`);
  return m[0];
}

/* ---------- template.html と同じ整形 ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MD_ESC = /\\([!-\/:-@\[-\x60{-~])/g;
const MD_ESC_HTML = /\\(&amp;|&quot;|&#39;|&lt;|&gt;|[!-\/:-@\[-\x60{-~])/g;
const YEN = /\\(?=[0-9])/g;
const mdUnesc = s => String(s == null ? '' : s).replace(YEN, '￥').replace(MD_ESC, '$1');
function rich(src){
  if(!src) return '';
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  let html = '', listBuf = [], para = [];
  const inline = s => {
    s = esc(s);
    s = s.replace(/&lt;(https?:\/\/[^\s&>]+)&gt;/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/(^|[^"=\/])(https?:\/\/[^\s<)）"]+)/g, (m, p, u) => p + '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<strong>$2</strong>');
    return s.replace(YEN, '￥').replace(MD_ESC_HTML, '$1');
  };
  const flushList = () => { if(listBuf.length){ html += '<ul>' + listBuf.map(x => '<li>' + inline(x) + '</li>').join('') + '</ul>'; listBuf = []; } };
  const flushPara = () => { if(para.length){ html += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; } };
  for(const raw of lines){
    const line = raw.replace(/\s+$/, '').replace(/\\+$/, '').trim();
    if(!line){ flushList(); flushPara(); continue; }
    const hm = line.match(/^(#{2,4})\s+(.*)$/);
    if(hm){ flushList(); flushPara(); const tag = hm[1].length >= 4 ? 'h5' : 'h4'; html += '<' + tag + '>' + inline(hm[2]) + '</' + tag + '>'; continue; }
    const bm = line.match(/^(?:[-*＊]|・|●|◦|‣)\s*(.*)$/);
    if(bm){ flushPara(); listBuf.push(bm[1]); continue; }
    flushList(); para.push(line);
  }
  flushList(); flushPara();
  return html;
}
function plain(src, max){
  const t = String(src || '').replace(/\r/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '').replace(/^\s*[-*・–—]\s*/gm, '').replace(/[*_`>|\\]/g, '')
    .replace(/\s+/g, ' ').trim();
  return max && t.length > max ? t.slice(0, max) + '…' : t;
}
function fmtSalary(j){
  const mn = j.salaryMin, mx = j.salaryMax;
  if(mn != null && mx != null) return mn === mx ? `${mn}万円` : `${mn}〜${mx}万円`;
  if(mx != null) return `〜${mx}万円`;
  if(mn != null) return `${mn}万円〜`;
  return '応相談';
}
const EMP_TYPES = ['正社員','契約社員','業務委託','無期雇用派遣','派遣社員','アルバイト・パート','インターン'];
function empList(j){
  const s = (j && j.employment) ? String(j.employment).trim() : '';
  if(!s) return [];
  const hit = EMP_TYPES.filter(t => s.includes(t));
  return hit.length ? hit : [s];
}
const EMP_SCHEMA = {'正社員':'FULL_TIME','契約社員':'CONTRACTOR','業務委託':'CONTRACTOR','無期雇用派遣':'TEMPORARY','派遣社員':'TEMPORARY','アルバイト・パート':'PART_TIME','インターン':'INTERN'};
function jobName(j){ return j.position || j.jobCategory || j.title || '求人'; }
const CO_TRIM = /^(株式会社|有限会社|合同会社|一般社団法人|特定非営利活動法人)\s*|\s*(株式会社|有限会社|合同会社)$/g;
function coInitial(name){
  const s = (name || '').replace(CO_TRIM, '').trim();
  if(!s) return '?';
  const m = s.match(/[A-Za-z0-9]{1,2}|[^\s]/);
  return m ? m[0].toUpperCase() : '?';
}
function logoHtml(j, extra){
  const cls = 'jrow__logo' + (extra ? ' ' + extra : '');
  if(j.logo) return `<span class="${cls} jrow__logo--img"><img src="/${esc(j.logo)}" alt="" loading="lazy" decoding="async"></span>`;
  return `<span class="${cls}" aria-hidden="true">${esc(coInitial(j.company))}</span>`;
}
function fmtPosted(d){ const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}年${+m[2]}月${+m[3]}日` : ''; }

/* JobPosting の jobLocation。都道府県は Airtable の「勤務地（都道府県）」（prefs）、無ければ勤務地の原文から拾う。
   原文は住所になっていないことが多いので streetAddress には入れない（jobsite と同じ方針） */
const PREFS = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
  '新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
  '鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
function prefsOf(j){
  const p = (j.prefs || []).filter(x => PREFS.includes(x));
  if(p.length) return p;
  const loc = String(j.location || '');
  return PREFS.filter(x => loc.includes(x));
}
function jobPlaces(j){
  const out = prefsOf(j).slice(0, 10).map(p => ({ '@type': 'Place', address: { '@type': 'PostalAddress', addressCountry: 'JP', addressRegion: p } }));
  return out.length ? out : [{ '@type': 'Place', address: { '@type': 'PostalAddress', addressCountry: 'JP' } }];
}
const VALID_THROUGH = (() => { const d = new Date(Date.now() + 9 * 3600e3); const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0)); return e.toISOString().slice(0, 10) + 'T23:59:59+09:00'; })();

const jobPath = j => `/job/${encodeURIComponent(j.id)}/`;

/* ---------- 求人1件のページ ---------- */
function jobPage(C, tpl, j, related){
  const name = jobName(j);
  const co = j.company || '企業非公開';
  const canon = SITE + jobPath(j);
  const apply = `/${C.APPLY_PAGE}?job=${encodeURIComponent(j.id)}`;

  const tags = [];
  if(j.jobCategory) tags.push(`<span class="tag tag--cat">${esc(j.jobCategory)}</span>`);
  empList(j).forEach(t => tags.push(`<span class="tag">${esc(t)}</span>`));
  (j.industry || []).forEach(i => tags.push(`<span class="tag">${esc(i)}</span>`));

  const sec = (title, body) => body ? `<div class="pd-sec"><h3>${esc(title)}</h3><div class="rich">${rich(body)}</div></div>` : '';
  const metaRow = (k, v) => v ? `<dt>${esc(k)}</dt><dd>${esc(mdUnesc(v))}</dd>` : '';
  const url = (typeof j.url === 'string' && /^https?:\/\//.test(j.url)) ? j.url : null;
  const siteRow = url ? `<dt>企業サイト</dt><dd><a href="${esc(url)}" target="_blank" rel="noopener nofollow">${esc(url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></dd>` : '';
  const coMeta = [metaRow('所在地', j.companyAddress), metaRow('従業員数', j.employees), metaRow('上場区分', j.listedStatus), siteRow].join('');
  const coBody = j.companyInfo ? `<div class="rich">${rich(j.companyInfo)}</div>` : '';
  const coSec = (coBody || coMeta) ? `<div class="pd-sec"><h3>企業情報</h3>${coBody}${coMeta ? `<dl class="pd-meta">${coMeta}</dl>` : ''}</div>` : '';
  const reqMeta = [metaRow('給与（原文）', j.salaryRaw), metaRow('勤務地', j.location), metaRow('勤務時間', j.workHours), metaRow('休日・休暇', j.holidays), metaRow('福利厚生', j.benefits)].join('');

  const consult = (() => {
    const p = new URLSearchParams(); p.set('a1', `求人サイトを見て相談したいこと：${co}${co && name ? ' / ' : ''}${name}`);
    return C.CONSULT_URL + (C.CONSULT_URL.includes('?') ? '&' : '?') + p.toString();
  })();
  const inquiry = way => {
    const p = new URLSearchParams();
    p.set('prefill_ご希望の連絡方法', way); p.set('prefill_対象求人', name); p.set('prefill_企業名', j.company || '');
    p.set('prefill_求人レコードID', j.id); p.set('hide_求人レコードID', 'true');
    return C.INQUIRY_FORM_URL + (C.INQUIRY_FORM_URL.includes('?') ? '&' : '?') + p.toString();
  };
  const lineMsg = (() => {
    const msg = `財政課転職（求人サイト）を見てご連絡しました。下記の求人について相談したいです。\n■求人：${name}\n■企業：${j.company || ''}\n■ページ：${canon}\n`;
    return `https://line.me/R/oaMessage/${encodeURIComponent(C.LINE_OA_ID)}/?${encodeURIComponent(msg)}`;
  })();
  const ARROW = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const cta = `<div class="pd-cta">
      <a class="btn-apply" href="${esc(apply)}" data-apply="${esc(j.id)}">この求人に応募する ${ARROW}</a>
      <a class="btn-ghost" href="${esc(consult)}" target="_blank" rel="noopener">まず話だけ聞いてみる</a>
      <a class="btn-ghost" href="${esc(inquiry(C.WAY_TEL))}" target="_blank" rel="noopener">電話で軽く話を聞きたい</a>
      <a class="btn-ghost" href="${esc(inquiry(C.WAY_MAIL))}" target="_blank" rel="noopener">メールで質問する</a>
    </div>
    <div class="pd-line">
      <p class="pd-line__ttl">${C.LINE_ICON}LINEで相談する・応募する</p>
      <p class="pd-line__lead">フォーム入力も経歴書も不要です。<b>「${esc(name)}」について聞きたい</b>とLINEで送っていただければ、担当（松岡）が直接お返事します。<b>質問だけ・情報収集だけでもかまいません。</b></p>
      <div class="pd-line__btns">
        <a class="pd-line__btn" href="${esc(C.LINE_ADD_URL)}" target="_blank" rel="noopener noreferrer" data-line-cta="zaiseika-static-add">${C.LINE_ICON}① 友だち追加する</a>
        <a class="pd-line__btn pd-line__btn--sub" href="${esc(lineMsg)}" target="_blank" rel="noopener noreferrer" data-line-cta="zaiseika-static-msg">② この求人について送る</a>
      </div>
      <ol class="pd-line__steps"><li>友だち追加</li><li>この求人について送信</li><li>担当から返信</li><li>そのままLINEでやり取り</li></ol>
      <p class="pd-line__note">すでに友だちの方は②だけでかまいません（求人名が入った状態でLINEが開きます）。うまく開かないときは、LINEで ID <b>${esc(C.LINE_OA_ID)}</b> を検索してください。</p>
    </div>
    ${C.CTA_NOTE}
    <p class="pd-ctamail">「電話で軽く話を聞きたい」は<b>日程を決めずに、こちらから折り返す</b>形です。ご希望の時間帯だけ伺います。</p>`;

  /* ほかの求人（内部リンク。検索エンジンが求人から求人へ辿れるように）。同じ会社 → 公共関連度（govScore）の高い順 */
  const relSec = related.length ? `<div class="pd-sec"><h3>ほかの公務員経験が活きる求人</h3><ul class="rel">${related.map(r => `<li><span class="co">${esc(r.company || '企業非公開')}</span><a href="${esc(jobPath(r))}">${esc(jobName(r))}</a><div class="m"><b>${esc(fmtSalary(r))}</b>${r.location ? ' ・ ' + esc(String(r.location).split(/\n/)[0].slice(0, 30)) : ''}</div></li>`).join('')}</ul>
      <div class="pd-more"><a href="/">求人をすべて見る</a><a href="/zukan.html">部署別 仕事ガイド</a><a href="/media/">記事</a></div></div>` : '';

  const author = `<div class="pd-author">
      <p class="lbl">この求人を担当するエージェント</p>
      <p class="name"><a href="${esc(C.PROFILE_URL)}" target="_blank" rel="noopener">松岡 良次</a></p>
      ${C.AUTHOR_BIO}
    </div>`;

  const main = `<div class="dt-head">
      <div class="dt-co-row">${logoHtml(j, 'jrow__logo--lg')}<p class="dt-co">${esc(co)}</p></div>
      <h1 class="dt-title">${esc(name)}</h1>
      ${j.createdAt ? `<p class="dt-posted">掲載開始日 ${esc(fmtPosted(j.createdAt))}</p>` : ''}
      <div class="pd-tags">${tags.join('')}</div>
    </div>
    ${coSec}
    ${sec('仕事内容', j.jobContent)}
    ${sec('必須条件', j.must)}
    ${sec('歓迎条件', j.welcome)}
    ${sec('求める人物像', j.idealPerson)}
    ${reqMeta ? `<div class="pd-sec"><h3>募集要項</h3><dl class="pd-meta">${reqMeta}</dl></div>` : ''}
    ${sec('選考プロセス', j.selectionProcess)}
    <div class="pd-sec"><h3>この求人に応募する</h3>${cta}</div>
    ${relSec}
    ${author}`;

  const side = `<div class="dt-card">
    <span class="k">想定年収</span><span class="v">${esc(fmtSalary(j))}</span>
    <a class="btn-apply" href="${esc(apply)}" data-apply="${esc(j.id)}">この求人に応募する</a>
    <a class="btn-detail" href="${esc(consult)}" target="_blank" rel="noopener">まず話だけ聞いてみる</a>
    <a class="line-btn" href="${esc(C.LINE_ADD_URL)}" target="_blank" rel="noopener noreferrer" data-line-cta="zaiseika-static-side">${C.LINE_ICON}<span>LINEで相談する</span></a>
    <p class="dt-card__note">押した先は<b>転職支援サービスの申し込み</b>です。企業へは<b>当社から推薦する形</b>で選考が進みます。<b>ご利用は無料</b>（手数料は採用企業負担）。</p>
    <span class="dt-open"><a href="/?job=${encodeURIComponent(j.id)}">検索画面で開く</a>（気になる求人に保存・条件を変えて探す）</span>
  </div>`;
  const bar = `<span class="sal"><small>想定年収</small>${esc(fmtSalary(j))}</span>
    <a class="line-btn" href="${esc(C.LINE_ADD_URL)}" target="_blank" rel="noopener noreferrer" data-line-cta="zaiseika-static-bar" aria-label="LINEで相談する">${C.LINE_ICON}<span>LINE</span></a>
    <a class="btn-apply" href="${esc(apply)}" data-apply="${esc(j.id)}">この求人に応募する</a>`;

  /* JobPosting 構造化データ（Google しごと検索）。directApply は false（企業へ直接応募ではなく当社から推薦する形のため） */
  const descHtml = [j.jobContent && `<h4>仕事内容</h4>${rich(j.jobContent)}`, j.must && `<h4>必須条件</h4>${rich(j.must)}`, j.welcome && `<h4>歓迎条件</h4>${rich(j.welcome)}`].filter(Boolean).join('');
  const emp = new Set(empList(j).map(e => EMP_SCHEMA[e] || 'OTHER'));
  const ld = {
    '@context': 'https://schema.org', '@type': 'JobPosting',
    title: name,
    description: descHtml || plain(j.companyInfo, 500) || name,
    identifier: { '@type': 'PropertyValue', name: '株式会社エージェントベスト', value: j.id },
    hiringOrganization: Object.assign({ '@type': 'Organization', name: co }, url ? { sameAs: url } : {}),
    jobLocation: (pl => pl.length === 1 ? pl[0] : pl)(jobPlaces(j)),
    employmentType: [...emp],
    directApply: false,
    url: canon,
    validThrough: VALID_THROUGH,
  };
  if(j.createdAt) ld.datePosted = j.createdAt.slice(0, 10);
  if(j.logo) ld.hiringOrganization.logo = `${SITE}/${j.logo}`;
  if(j.salaryMin != null || j.salaryMax != null){
    const v = { '@type': 'QuantitativeValue', unitText: 'YEAR' };
    if(j.salaryMin != null) v.minValue = j.salaryMin * 10000;
    if(j.salaryMax != null) v.maxValue = j.salaryMax * 10000;
    if(j.salaryMin != null && j.salaryMax == null) v.value = j.salaryMin * 10000;
    ld.baseSalary = { '@type': 'MonetaryAmount', currency: 'JPY', value: v };
  }
  const crumbLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'ホーム', item: SITE + '/' },
    { '@type': 'ListItem', position: 2, name, item: canon },
  ]};

  const title = `${name}｜${co}（${fmtSalary(j)}） - 財政課転職`;
  const desc = plain(j.jobContent || j.must || j.companyInfo, 110) || `${co}の${name}の求人。`;
  return tpl
    .replace('__TITLE__', () => esc(title.length > 70 ? `${name}｜${co} - 財政課転職` : title))
    .replace(/__OGTITLE__/g, () => esc(`${name}｜${co}（${fmtSalary(j)}）`))
    .replace(/__DESC__/g, () => esc(desc))
    .replace(/__CANON__/g, () => esc(canon))
    .replace('__JSONLD__', () => JSON.stringify([ld, crumbLd]).replace(/<\//g, '<\\/'))
    .replace(/__APPLY__/g, () => esc(apply))
    .replace(/__ID__/g, () => esc(j.id))
    .replace('__CRUMB__', () => `<a href="/">ホーム</a><span class="sep">›</span><span class="cur">${esc(name)}</span>`)
    .replace('__MAIN__', () => main)
    .replace('__SIDE__', () => side)
    .replace('__BAR__', () => bar);
}

/* job/ の下を今回の掲載分に合わせる（掲載が終わった求人のページは消す＝404。終わった求人を検索に残さない） */
function syncDir(dir, keep){
  if(!fs.existsSync(dir)) return 0;
  let n = 0;
  for(const d of fs.readdirSync(dir)){
    if(keep.has(d)) continue;
    fs.rmSync(path.join(dir, d), { recursive: true, force: true }); n++;
  }
  return n;
}

function build(root, jobs){
  const tplMain = fs.readFileSync(path.join(root, 'template.html'), 'utf8');
  const jobTpl = fs.readFileSync(path.join(root, 'job-template.html'), 'utf8');
  const C = {};
  ['APPLY_PAGE', 'INQUIRY_FORM_URL', 'WAY_TEL', 'WAY_MAIL', 'CONSULT_URL', 'PROFILE_URL', 'LINE_ADD_URL', 'LINE_OA_ID', 'LINE_ICON']
    .forEach(k => { C[k] = readConst(tplMain, k); });
  C.CTA_NOTE = readFragment(tplMain, 'pd-ctanote');
  C.AUTHOR_BIO = readFragment(tplMain, 'bio');

  /* 見た目は検索画面と同じ CSS（template.html の <style> の中身） */
  const css = tplMain.match(/<style>([\s\S]*?)<\/style>/);
  if(!css) throw new Error('template.html に <style> が見つかりません');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'site.css'), css[1].trim() + '\n', 'utf8');

  const byNew = jobs.slice().sort((a, b) => (b.govScore || 0) - (a.govScore || 0));
  const jobRoot = path.join(root, 'job');
  const keep = new Set();
  jobs.forEach(j => {
    const sameCo = byNew.filter(r => r.id !== j.id && r.company && r.company === j.company);
    const sameKind = byNew.filter(r => r.id !== j.id && r.company !== j.company);
    const related = sameCo.concat(sameKind).slice(0, RELATED_MAX);
    const dir = path.join(jobRoot, j.id);
    fs.mkdirSync(dir, { recursive: true });
    const html = jobPage(C, jobTpl, j, related);
    const file = path.join(dir, 'index.html');
    if(!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== html) fs.writeFileSync(file, html, 'utf8');
    keep.add(j.id);
  });
  const removed = syncDir(jobRoot, keep);
  console.log(`求人ページを書き出しました: ${keep.size}件${removed ? `（掲載終了で ${removed}件削除）` : ''}`);

  /* sitemap-jobs.xml / robots.txt。トップ・記事は build-articles.js の sitemap.xml 側に入っている。求人の lastmod は掲載開始日 */
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const urls = [].concat(jobs.map(j => ({ loc: SITE + jobPath(j), lastmod: String(j.createdAt || today).slice(0, 10), pri: '0.6' })));
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map(u => `<url><loc>${esc(u.loc)}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.pri}</priority></url>`).join('\n') + '\n</urlset>\n';
  fs.writeFileSync(path.join(root, 'sitemap-jobs.xml'), xml, 'utf8');
  /* 応募フォーム（apply.html?job=…）と ?job= / ?tag= / ?q= / ?gov= 付きのトップは、どれも canonical でまとめられるだけのURLなので巡回させない（jobs・skill と同じ）。
     「/?」はクエリ付きのトップだけに当たり、トップ自体（/）は対象外 */
  fs.writeFileSync(path.join(root, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /apply.html\nDisallow: /?\n\nSitemap: ${SITE}/sitemap.xml\nSitemap: ${SITE}/sitemap-jobs.xml\n`, 'utf8');
  console.log(`sitemap-jobs.xml を書き出しました: ${urls.length} URL`);
}

module.exports = { build };
