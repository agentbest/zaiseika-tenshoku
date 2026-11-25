// 記事の本文中に「この記事に合う求人」を差し込む（2026-11-25 ハチワレさん指示）。
//
// 掲載中の求人（job/<求人ID>/ がある＝rebuild.js が公開した求人）から、記事ごとに3件を選ぶ。
//   部署別・業界研究 … 部署名・業界名から作った語（下の TERMS）で職種名・本文を照合
//   自治体別       … 記事本文に最初に出る都道府県（特別区は東京都）と勤務地を照合
//   制度とお金・選考対策・資格 … 記事の領域・題名から拾える語で照合。弱ければ「公務員の経験が活きる求人」
// 同じ点数の求人は記事ごとに順番を散らす（2,000本が同じ3件を指さないように）。
// 1社1件まで。差し込む位置は本文の真ん中あたりの見出し（h2）の手前。よくある質問より後ろには入れない。
//
// ⚠ 求人は毎朝入れ替わる。update-jobs.yml で rebuild.js の後に build-articles.js も回して、
//   掲載が終わった求人へのリンクが記事に残らないようにしている。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県',
  '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県',
  '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県',
  '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];
const REGION = {
  北海道: ['北海道'], 東北: ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'],
  関東: ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '山梨県'],
  中部: ['新潟県', '富山県', '石川県', '福井県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県'],
  近畿: ['滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'],
  中国四国: ['鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県'],
  九州沖縄: ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'],
};
const regionOf = p => Object.keys(REGION).find(r => REGION[r].includes(p));

// 部署・業界・領域 → 求人側で照合する語。ここに無い領域は、領域名を「・」で割って末尾の「課」などを落とした語で照合する。
// ⚠ 2文字の英字（IT・PR・IR）は誤爆しやすいので、必ず他の語と組にする。
const TERMS = {
  '財政課': ['財政', '予算', '経営企画', '管理会計', 'FP&A', '財務', '公会計', '地方財政'],
  '会計課・出納室': ['会計', '経理', '財務', '出納', '公会計'],
  '税務課': ['税務', '税理士', '経理', '税'], '市民税課': ['税務', '経理', '給与計算', '税'],
  '資産税課': ['固定資産', '不動産', '鑑定', '税務'], '納税課・収納課': ['債権', '回収', '収納', '税務', '督促'],
  '情報政策課・DX推進': ['DX', '情報システム', '社内SE', 'デジタル', 'IT', 'システム'],
  '企画課・政策企画': ['企画', '事業企画', '経営企画', '政策', 'コンサル'],
  '行政改革・行政経営': ['業務改革', 'BPR', 'コンサル', '経営企画', '業務改善'],
  '人事課': ['人事', '採用', '労務', '組織'], '総務課': ['総務', '法務', 'バックオフィス'],
  '政策法務課': ['法務', 'コンプライアンス', '契約', '政策'], '秘書課': ['秘書', 'アシスタント', '総務'],
  '広報広聴課': ['広報', 'PR', 'マーケティング', 'コミュニケーション'],
  '監査委員事務局': ['監査', '内部監査', '内部統制', 'リスク'],
  '契約検査課': ['調達', '入札', '契約', '購買'], '管財課': ['ファシリティ', '不動産', '施設', '資産'],
  '営繕課': ['施工管理', '建築', '設備', 'ファシリティ'], '用地課': ['用地', '不動産', '補償', '測量'],
  '都市計画課': ['都市計画', 'まちづくり', '都市開発', '建設コンサル'],
  '道路課': ['道路', '土木', '建設コンサル', '施工管理'], '河川・砂防課': ['河川', '土木', '防災', '建設コンサル'],
  '下水道課': ['下水道', '上下水道', '土木', '水処理'], '水道局': ['上下水道', '水道', '水処理', 'インフラ'],
  '上下水道の営業・料金': ['料金', 'カスタマー', 'インフラ', '上下水道'],
  '公園緑地課': ['公園', '造園', '緑地', 'まちづくり'], '建築指導課': ['建築', '確認検査', '設計', '審査'],
  '住宅課': ['住宅', '不動産', '賃貸'], '住宅政策・空き家対策': ['住宅', '空き家', '不動産', 'まちづくり'],
  '交通政策課': ['交通', 'モビリティ', 'MaaS', '鉄道'], '交通・公営企業': ['交通', '鉄道', 'バス', 'インフラ'],
  '港湾・空港': ['港湾', '空港', '物流', 'インフラ'],
  '危機管理・防災課': ['防災', '危機管理', 'BCP', 'レジリエンス'], '消防本部の事務': ['防災', '消防', '危機管理'],
  '感染症対策': ['感染症', '医療', 'ヘルスケア', '保健'], '保健所・衛生課': ['保健', '医療', '衛生', 'ヘルスケア'],
  '健康増進課・保健センター': ['健康', '保健', 'ヘルスケア', '医療'], '国保年金課': ['保険', '年金', '医療', 'レセプト'],
  '福祉事務所・生活保護': ['福祉', '生活支援', '相談', '就労支援'], '障害福祉課': ['障害', '福祉', '就労支援'],
  '高齢福祉・介護保険課': ['介護', '高齢', '福祉', 'ヘルスケア'], '介護認定・地域包括支援': ['介護', 'ケアマネ', '福祉', '相談'],
  '児童相談所': ['児童', '子ども', '福祉', '相談'], 'こども家庭センター': ['子ども', '子育て', '福祉', '保育'],
  '子育て支援課': ['子育て', '保育', '子ども', '教育'], '保育課': ['保育', '子育て', '幼児教育'],
  '学校事務': ['学校', '教育', '事務'], '学校教育課・指導課': ['教育', '学校', 'EdTech', '教材'],
  '教育委員会事務局': ['教育', '学校', 'EdTech'], '生涯学習・社会教育課': ['教育', '学習', '研修', '文化'],
  '公民館・図書館': ['図書館', '施設運営', '文化', '教育'], '博物館・文化財': ['文化', '博物館', '施設運営'],
  '文化振興課': ['文化', 'イベント', '施設運営'], 'スポーツ振興課': ['スポーツ', '施設運営', 'イベント'],
  '産業振興課': ['地方創生', '中小企業', '産業', '地域'], '商工観光課': ['観光', '地方創生', '地域', '中小企業'],
  '農政課': ['農業', '食品', '一次産業'], '農村整備課': ['農業', '土木', '農村'], '林務・水産課': ['林業', '水産', '一次産業'],
  '環境課': ['環境', '脱炭素', 'GX'], '環境保全・脱炭素推進': ['脱炭素', 'GX', '環境', 'エネルギー'],
  '廃棄物・清掃課': ['廃棄物', 'リサイクル', '環境'],
  '市民課・戸籍住民課': ['窓口', 'BPO', '住民', 'カスタマー'], '支所・出張所': ['窓口', '住民', '地域', 'カスタマー'],
  '消費生活センター': ['消費者', '相談', 'カスタマー'], '国際交流・多文化共生': ['国際', '外国人', '多文化', 'グローバル'],
  '男女共同参画': ['ダイバーシティ', '人事', '女性活躍'], '地域振興・自治会担当': ['地域', 'まちづくり', '地方創生', 'コミュニティ'],
  '議会事務局': ['議会', '政策', 'パブリックアフェアーズ'], '選挙管理委員会事務局': ['選挙', '政策', '公共'],
  // 業界研究
  '自治体向けSaaS・GovTech': ['GovTech', '自治体', 'SaaS', '行政DX'], 'SaaS企業（一般）': ['SaaS', 'カスタマーサクセス'],
  'ITコンサルティング': ['ITコンサル', 'DX', 'コンサル'], '総合コンサルティング': ['コンサル', '公共'],
  'シンクタンク・調査研究': ['シンクタンク', '調査', 'リサーチ', '政策'], '建設コンサルタント': ['建設コンサル', '土木', '設計'],
  '監査法人': ['監査', '会計', 'アドバイザリー'], '会計事務所・税理士法人': ['会計', '税理士', '税務'],
  '事業会社の経理・財務部門': ['経理', '財務', '会計'], '内部監査・リスク管理部門': ['内部監査', 'リスク', '内部統制'],
  '事業会社の情報システム部門': ['情報システム', '社内SE'], 'SIer・システム開発': ['SIer', 'システム開発', 'SE'],
  'システム運用・保守（MSP）': ['運用', '保守', 'インフラ'], '人材紹介会社': ['人材紹介', 'キャリアアドバイザー', 'リクルーティング'],
  '人材サービス': ['人材', 'キャリア'], '人材派遣会社': ['人材派遣', 'コーディネーター'],
  '社労士事務所・労務コンサル': ['労務', '社労士', '人事'], '企業法務・法律事務所': ['法務', 'リーガル', '契約'],
  'まちづくり・都市開発': ['まちづくり', '都市開発', '再開発'], '再生可能エネルギー': ['再生可能エネルギー', '再エネ', '脱炭素'],
  '環境・GX': ['GX', '脱炭素', '環境'], '観光・地域振興': ['観光', '地方創生', '地域'], '地域商社・DMO': ['地域商社', 'DMO', '観光', '地方創生'],
  '第三セクター': ['第三セクター', '公共', '地域'], '指定管理者（施設運営会社）': ['指定管理', '施設運営'],
  '上下水道・道路のインフラ運営': ['上下水道', 'インフラ', 'PFI', 'コンセッション'], '国際機関・JICA関連': ['国際', 'ODA', '開発'],
  'NPO・公益法人': ['NPO', '公益', '財団', 'ソーシャル'], '教育・EdTech': ['EdTech', '教育'], 'IT教育・研修会社': ['研修', '教育'],
  '地方銀行・信用金庫': ['銀行', '金融', '融資'], 'メガバンク・信託銀行': ['銀行', '金融'], '証券会社': ['証券', '金融'],
  '医療・ヘルスケア': ['医療', 'ヘルスケア'], '病院の事務部門': ['病院', '医療事務', '医療'],
  '介護・福祉': ['介護', '福祉'], '介護施設の運営会社': ['介護', '施設運営'], '保育': ['保育'], '保育園の運営会社': ['保育'],
  '広告・PR会社': ['広告', 'PR', 'マーケティング'], '出版・Webメディア': ['メディア', '編集'], '放送・報道': ['放送', 'メディア'],
  'コールセンター・カスタマーサポート': ['コールセンター', 'カスタマー', 'BPO'], '警備・BPO': ['BPO', '警備'],
};
// 制度とお金・選考対策・資格は領域ではなく題名から拾う語
const TITLE_TERMS = [
  ['簿記', ['経理', '会計', '財務']], ['税理士', ['税務', '税理士', '会計']], ['会計士', ['監査', '会計']],
  ['FP', ['金融', '保険', 'ファイナンシャル']], ['宅建', ['不動産', '宅地建物']], ['社労士', ['労務', '人事', '社労士']],
  ['行政書士', ['法務', '許認可']], ['中小企業診断士', ['コンサル', '中小企業']], ['情報処理', ['IT', 'システム', 'DX']],
  ['ITパスポート', ['IT', 'DX', 'システム']], ['エクセル', ['経理', '企画', 'データ']], ['Excel', ['経理', '企画', 'データ']],
  ['データ', ['データ', '分析']], ['英語', ['英語', 'グローバル']], ['TOEIC', ['英語', 'グローバル']],
  ['プロジェクト', ['PM', 'プロジェクト']], ['営業', ['営業', 'セールス']], ['企画', ['企画']], ['法務', ['法務']],
  ['技術職', ['土木', '建築', '施工管理']], ['土木', ['土木', '建設']], ['保健師', ['保健', 'ヘルスケア']],
  ['事務職', ['事務', 'バックオフィス', '総務']], ['国家公務員', ['官公庁', '省庁', '政策']], ['財政', ['財政', '経営企画', '予算']],
];
const SUFFIX = /(課|室|局|担当|事務局|センター|部門)$/;

function termsFor(meta) {
  const area = meta.area || '';
  if (TERMS[area]) return TERMS[area];
  const t = [];
  if (meta.kind === '部署別' || meta.kind === '業界研究') {
    for (const p of area.split(/[・（）()]/)) { const s = p.replace(SUFFIX, '').trim(); if (s.length >= 2) t.push(s); }
  }
  const title = meta.title || '';
  for (const [k, v] of TITLE_TERMS) if (title.includes(k)) t.push(...v);
  return [...new Set(t)];
}

let JOBS = null;
function loadJobs() {
  if (JOBS) return JOBS;
  JOBS = [];
  const dir = path.join(ROOT, 'job');
  if (!fs.existsSync(dir)) return JOBS;
  for (const id of fs.readdirSync(dir)) {
    const f = path.join(ROOT, 'data', 'jobs', id + '.json');
    if (!fs.existsSync(f)) continue;
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    j._head = [j.title, j.position, j.jobCategory, j.industry].filter(Boolean).join(' ');
    j._body = [j.jobContent, j.must, j.welcome, j.idealPerson].filter(Boolean).join('\n');
    j._remote = /フルリモート|完全リモート|全国どこでも|在宅勤務可|リモートワーク可/.test([j.location, j.workHours, j.benefits].join(' '));
    JOBS.push(j);
  }
  return JOBS;
}

function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const count = (s, w) => { if (!w) return 0; let n = 0, i = 0; while ((i = s.indexOf(w, i)) >= 0) { n++; i += w.length; } return n; };

function prefOf(meta, body) {
  if (meta.area === '特別区') return '東京都';
  if (meta.kind === '自治体別' && PREFS.includes(meta.target)) return meta.target;
  if (meta.kind !== '自治体別') return '';
  let best = '', at = Infinity;
  for (const p of PREFS) { const i = body.indexOf(p); if (i >= 0 && i < at) { at = i; best = p; } }
  return best;
}

// 返り値 { heading, lead, jobs[], more:{href,label} } または null
function pick(meta, body, n) {
  n = n || 3;
  const jobs = loadJobs();
  if (!jobs.length) return null;
  const terms = termsFor(meta);
  const pref = prefOf(meta, body);
  const region = pref ? regionOf(pref) : '';
  const salt = hash(meta.slug || meta.title || '');
  const finArticle = /財政|会計|出納|税|監査|経理/.test((meta.area || '') + (meta.title || ''));

  const scored = jobs.map(j => {
    let topic = 0;
    for (const w of terms) topic += Math.min(count(j._head, w), 2) * 3 + Math.min(count(j._body, w), 3);
    let s = topic * 2;
    if (pref) {
      const ps = j.prefs || [];
      if (ps.includes(pref)) s += 20;
      else if (ps.some(p => regionOf(p) === region)) s += 8;
      else if (j._remote) s += 6;
    }
    if (finArticle && j.finFit) s += 4;
    if (j.govFront) s += 2;
    s += Math.min(j.govScore || 0, 20) / 5;
    // 同点のときの並びを記事ごとに散らす
    // 話題で選べない記事（制度とお金・選考対策の多く）は、公共度の高い求人の中で大きく散らす
    s += ((hash(j.id) ^ salt) % 1000) / 1000 * (terms.length || pref ? 1 : 12);
    return { j, s, topic };
  }).sort((a, b) => b.s - a.s);

  const out = [], seen = new Set();
  for (const x of scored) {
    if (out.length >= n) break;
    if (seen.has(x.j.company)) continue;
    seen.add(x.j.company); out.push(x);
  }
  if (!out.length) return null;

  const strong = out.filter(x => x.topic >= 3).length >= 2;
  const local = pref && out.filter(x => (x.j.prefs || []).includes(pref)).length;
  let heading, lead, more;
  if (meta.kind === '自治体別' && local) {
    heading = pref + 'で働ける、公務員の経験が活きる求人';
    lead = '勤務地に' + pref + 'を含む求人から、行政・公共の仕事に近いものを選んでいます。';
    more = { href: '../?q=' + encodeURIComponent(pref.replace(/[都府県]$/, '')), label: pref + 'の求人をもっと見る' };
  } else if (meta.kind === '部署別' && strong) {
    heading = (meta.area || '') + 'の経験が活きる求人';
    lead = (meta.area || '') + 'でしてきた仕事と、職種や仕事内容が重なる求人です。';
    more = finArticle ? { href: '../?fin=1', label: '財政・会計が効く求人をもっと見る' } : { href: '../?gov=1', label: '行政が相手の求人をもっと見る' };
  } else if (meta.kind === '業界研究' && strong) {
    heading = (meta.area || '') + 'に関わる求人';
    lead = 'この業界・職種に近い求人のうち、公務員の経験が活きるものです。';
    more = { href: '../?q=' + encodeURIComponent(terms[0] || ''), label: '関連する求人をもっと見る' };
  } else if (strong) {
    heading = 'この記事の内容に近い求人';
    lead = '記事で扱った仕事・資格と関わりのある求人です。';
    more = { href: '../?q=' + encodeURIComponent(terms[0] || ''), label: '関連する求人をもっと見る' };
  } else {
    heading = '公務員の経験が活きる求人';
    lead = '行政・公共の仕事に近い求人から選んでいます。';
    more = { href: finArticle ? '../?fin=1' : '../?gov=1', label: '求人をもっと見る' };
  }
  return { heading, lead, more, jobs: out.map(x => x.j) };
}

function salaryLabel(j) {
  if (j.salaryMin && j.salaryMax) return j.salaryMin + '〜' + j.salaryMax + '万円';
  if (j.salaryMin) return j.salaryMin + '万円〜';
  return '';
}

function cardHtml(j) {
  const pos = (j.position || String(j.title || '').split('｜').pop() || '').trim();
  const loc = (j.prefs || []).slice(0, 2).join('・');
  const tags = [];
  if (j.govFront) tags.push('行政が相手');
  if (j.finFit) tags.push('財政・会計が効く');
  if (j._remote) tags.push('リモート可');
  const sal = salaryLabel(j);
  return '<a class="ajob" href="../job/' + esc(j.id) + '/">'
    + '<span class="ajob__co">' + esc(j.company) + '</span>'
    + '<span class="ajob__t">' + esc(pos.length > 70 ? pos.slice(0, 70) + '…' : pos) + '</span>'
    + '<span class="ajob__m">' + [j.jobCategory, loc, sal].filter(Boolean).map(esc).join('<i aria-hidden="true">／</i>') + '</span>'
    + (tags.length ? '<span class="ajob__tags">' + tags.map(t => '<b>' + t + '</b>').join('') + '</span>' : '')
    + '<span class="ajob__go">求人を見る &rarr;</span></a>';
}

function blockHtml(p) {
  return '<aside class="ajobs" aria-label="' + esc(p.heading) + '">'
    + '<p class="ajobs__h">' + esc(p.heading) + '</p>'
    + '<p class="ajobs__lead">' + esc(p.lead) + '</p>'
    + '<div class="ajobs__list">' + p.jobs.map(cardHtml).join('') + '</div>'
    + '<p class="ajobs__more"><a href="' + esc(p.more.href) + '">' + esc(p.more.label) + ' &rarr;</a></p>'
    + '</aside>';
}

// 本文HTMLの真ん中あたりの h2 の手前に差し込む。よくある質問・出典より後ろには入れない。
function insert(bodyHtml, meta, mdBody) {
  const p = pick(meta, mdBody || '');
  if (!p) return bodyHtml;
  const block = blockHtml(p);
  const hs = [];
  const re = /<h2[\s>][\s\S]*?<\/h2>/g;
  let m;
  while ((m = re.exec(bodyHtml))) {
    if (/よくある質問|まとめ|出典|参考/.test(m[0])) break;
    hs.push(m.index);
  }
  if (hs.length >= 2) {
    const at = hs[Math.ceil(hs.length / 2)] != null ? hs[Math.ceil(hs.length / 2)] : hs[hs.length - 1];
    return bodyHtml.slice(0, at) + block + '\n' + bodyHtml.slice(at);
  }
  return bodyHtml + '\n' + block;
}

const CSS = [
  '.ajobs{margin:36px 0;padding:20px 20px 14px;background:var(--surface-2);border:1px solid var(--line);border-radius:12px}',
  '.ajobs__h{margin:0;font-size:17px;font-weight:700;color:var(--ink);line-height:1.5}',
  '.ajobs__lead{margin:4px 0 14px;font-size:13px;color:var(--ink-3);line-height:1.7}',
  '.ajobs__list{display:grid;gap:10px}',
  '.ajob{display:block;padding:14px 16px;background:var(--surface);border:1px solid var(--line);border-radius:10px;text-decoration:none;color:var(--ink);transition:border-color .15s}',
  '.ajob:hover,.ajob:focus-visible{border-color:var(--accent)}',
  '.ajob>span{display:block}',
  '.ajob__co{font-size:12px;color:var(--ink-3);line-height:1.5}',
  '.ajob__t{font-size:15px;font-weight:700;line-height:1.55;margin:2px 0 4px}',
  '.ajob__m{font-size:12.5px;color:var(--ink-2);line-height:1.6}.ajob__m i{font-style:normal;margin:0 4px;opacity:.5}',
  '.ajob__tags{margin-top:6px}.ajob__tags b{display:inline-block;font-weight:600;font-size:11px;padding:1px 8px;margin:0 6px 4px 0;border-radius:99px;background:var(--accent-soft);color:var(--accent-ink)}',
  '.ajob__go{margin-top:4px;font-size:12.5px;font-weight:700;color:var(--accent-ink)}',
  '.ajobs__more{margin:12px 0 0;text-align:right;font-size:13px}.ajobs__more a{font-weight:700}',
].join('');

module.exports = { insert, pick, CSS };
