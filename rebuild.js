// 使い方: このフォルダで  node rebuild.js  を実行すると、
//   data/jobs.json（＋ data/logos.json） → template.html        → index.html
//   data/jobs.json  → apply-template.html  → apply.html   （求人の見出しだけを差し込む）
//   data/1day.json  → 1day-template.html   → 1day.html
// を再生成します。data/1day.json は  node fetch-1day.js  で Airtable から取得します。
const fs = require('fs'), path = require('path');
const dir = __dirname;

// <script> 内に安全に埋め込めるようエスケープする
const SEP = new RegExp('[\\u2028\\u2029]', 'g');
function embed(data){
  return JSON.stringify(data)
    .replace(/<\//g, '<\\/')
    .replace(SEP, m => '\\u' + m.charCodeAt(0).toString(16));
}

function build(dataFile, tplFile, outFile, placeholder, fallback, transform){
  const dataPath = path.join(dir, 'data', dataFile);
  const tplPath  = path.join(dir, tplFile);
  if(!fs.existsSync(tplPath)){
    console.log(`${tplFile} が無いのでスキップしました。`);
    return null;
  }
  let data = fallback;
  if(fs.existsSync(dataPath)){
    data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  }else if(dataFile === 'jobs.json' && fs.existsSync(path.join(dir, 'data', 'jobs'))){
    /* data/jobs.json は 50MB 超になったのでリポジトリに置かない（.gitignore）。
       無い端末では data/jobs/<求人ID>.json（＝掲載中の中途求人の全項目）から復元する。 */
    const d = path.join(dir, 'data', 'jobs');
    data = fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
    console.log(`data/jobs.json が無いので data/jobs/*.json から復元しました: ${data.length}件（新しい求人を載せるには node fetch-jobs.js）`);
  }else{
    console.log(`data/${dataFile} が無いので空で生成します。`);
  }
  if(transform) data = transform(data);
  const tpl = fs.readFileSync(tplPath, 'utf8');
  const out = tpl.replace(placeholder, () => embed(data));
  fs.writeFileSync(path.join(dir, outFile), out, 'utf8');
  return data;
}

/* このサイトは中途採用（転職）だけを載せる。
   Airtable 側に新卒・インターンが残っていても、ここで必ず落としてから埋め込む。
   ⚠ この関数を外すと、新卒・インターンの求人が「転職サイト」として公開される。 */
function midCareerOnly(jobs){
  /* ⚠ 区分が空の求人はここに落ちてくる（中途が9割なので既定は中途）。
     ただし黙って載せると誤掲載に気づけないので、必ず名指しで警告する。 */
  const noKubun = jobs.filter(j => !j.kubun);
  if(noKubun.length){
    console.log(`⚠ 区分が空の求人が ${noKubun.length}件あります。中途として載せます。Airtableで区分を入れてください:`);
    noKubun.slice(0, 10).forEach(j => console.log(`   - ${j.company || '企業名なし'} / ${j.position || j.title || j.id}`));
    if(noKubun.length > 10) console.log(`   …ほか ${noKubun.length - 10}件`);
  }
  const kept = jobs.filter(j => !j.kubun || j.kubun === '中途');
  const dropped = jobs.length - kept.length;
  if(dropped > 0){
    const by = {};
    jobs.forEach(j => { if(j.kubun && j.kubun !== '中途') by[j.kubun] = (by[j.kubun]||0)+1; });
    const detail = Object.entries(by).map(([k,v]) => `${k} ${v}件`).join(' / ');
    console.log(`中途以外を除外しました: ${dropped}件（${detail}）`);
  }
  return kept;
}

/* ===== このサイトの掲載範囲：公務員の経験が活きる求人だけ =====
   zaiseikatenshoku.com は「公務員（とくに財政課）から民間へ」の求人サイト。
   Airtable の求人は jobs / shinsotsu と同じ1本を共有しているので、
   ここで **行政・公共の文脈がある求人だけ** に絞ってから埋め込む。
   ⚠ この関数を外すと、行政と縁のない5,700件がそのまま「公務員の転職サイト」に並ぶ。

   点数の付け方（govScore）。見出し（職種名・ポジション名・業種）に出るほど重く見る。
     ・行政そのものを指す語（自治体・官公庁・省庁 …）  見出し 4点 / 本文 1.5点（各2〜4回まで）
     ・行政まわりの語（GovTech・公会計・地方創生 …）    見出し 4点 / 本文 1.5点（同上）
     ・応募条件に「公務員歓迎」等がある                 4点（2回まで）
   ⚠ 企業紹介文（companyInfo）は点に入れない。「自治体とも取引があります」だけの
     会社紹介で、行政と関係ない求人（不動産営業など）が大量に混ざるため。
   しきい値 4.5 は実データで調整した値。下げると精度が落ちる（4.0 で不動産営業が入る）。 */
const GOV_MIN_SCORE = 4.5;
/* 行政向けが本業の会社。求人1件ずつの文面が薄くても、会社ごと掲載してよい */
const GOV_COMPANIES = ['株式会社グラファー', '株式会社PoliPoli'];
const GOV_RE  = /自治体|官公庁|地方公共団体|中央省庁|省庁|行政機関|市役所|県庁|区役所/g;
const PUB_RE  = /GovTech|行政DX|自治体DX|公共政策|パブリックセクター|地方創生|公会計|地方財政|地方交付税|公共インフラ|スマートシティ|公共調達|企業版ふるさと納税|公営競技|防衛省|公共事業/g;
const EXP_RE  = /公務員|官公庁出身|自治体出身|行政経験|役所/g;
/* 財政課・会計課の経験がそのまま値段になる求人。トップの特集に出すための印 */
const FIN_RE  = /公会計|地方財政|地方交付税|予算編成|財政|CFO|経営企画|管理会計|財務|経理|IR|資金調達|補助金|交付金/;
function govScore(j){
  const hits = (s, re) => (String(s || '').match(re) || []).length;
  const head = [j.title, j.position, j.jobCategory, j.industry].filter(Boolean).join(' ');
  const body = [j.jobContent, j.must, j.welcome, j.idealPerson].filter(Boolean).join('\n');
  const cond = [j.must, j.welcome, j.idealPerson].filter(Boolean).join('\n');
  return Math.min(hits(head, GOV_RE), 2) * 4
       + Math.min(hits(body, GOV_RE), 4) * 1.5
       + Math.min(hits(head, PUB_RE), 2) * 4
       + Math.min(hits(body, PUB_RE), 4) * 1.5
       + Math.min(hits(cond, EXP_RE), 2) * 4;
}
function publicSectorOnly(jobs){
  const kept = [];
  for(const j of jobs){
    const s = govScore(j);
    const byCompany = GOV_COMPANIES.includes(j.company);
    if(s < GOV_MIN_SCORE && !byCompany) continue;
    j.govScore = Math.round(s * 10) / 10;
    /* 見出しに行政が出る＝行政が相手だと一目で分かる求人。カードに印を出す */
    j.govFront = /自治体|官公庁|省庁|公共|行政/.test([j.title, j.position, j.jobCategory].filter(Boolean).join(' '));
    /* 財政課・会計課の経験がそのまま効く求人。トップの特集に使う */
    j.finFit = FIN_RE.test([j.title, j.position, j.jobCategory, j.jobContent, j.must, j.welcome].filter(Boolean).join('\n'));
    kept.push(j);
  }
  kept.sort((a, b) => b.govScore - a.govScore);
  console.log(`公務員の経験が活きる求人だけに絞りました: ${jobs.length}件 → ${kept.length}件`
    + `（うち行政が相手と明記 ${kept.filter(j => j.govFront).length}件 / 財政・会計が効く ${kept.filter(j => j.finFit).length}件）`);
  if(!kept.length) console.log('⚠ 1件も残りませんでした。data/jobs.json が空か、点数の付け方が壊れています。');
  return kept;
}

/* 企業ロゴ。Airtable「求人DB（企業）」の ロゴ 列から取り込んだ画像を、
   data/logos.json（企業名 → リポジトリ内のパス）経由で求人1件ずつに差し込む。
   ⚠ ロゴを jobs.json 側に書かないのは、jobs.json が Airtable からの
     「取り直すたび丸ごと入れ替わるスナップショット」だから。書くと毎回消える。
   ⚠ Airtable の添付URLは数時間で失効するので、URLを直接持たせてはいけない。
     画像は assets/logos/ に置いて、そのパスを logos.json に書く（node fetch-logos.js）。
   企業名の完全一致で引く。Airtable 側で社名を変えたら logos.json も直すこと。 */
function attachLogos(jobs){
  const logoPath = path.join(dir, 'data', 'logos.json');
  if(!fs.existsSync(logoPath)){
    console.log('data/logos.json が無いので、ロゴは頭文字タイルのままにします。');
    return jobs;
  }
  const logos = JSON.parse(fs.readFileSync(logoPath, 'utf8'));
  /* ⚠ ファイルが実在しないパスを埋め込むと、カードに壊れた画像が出る。
     頭文字タイルの方がまだきれいなので、無いものは名指しで警告して落とす。 */
  const usable = {};
  for(const [company, rel] of Object.entries(logos)){
    if(fs.existsSync(path.join(dir, rel))) usable[company] = rel;
    else console.log(`⚠ ロゴ画像が見つかりません（頭文字タイルにします）: ${company} → ${rel}`);
  }
  let hit = 0;
  const missing = new Set();
  jobs.forEach(j => {
    const rel = usable[j.company];
    if(rel){ j.logo = rel; hit++; }
    else if(j.company) missing.add(j.company);
  });
  console.log(`企業ロゴ: ${hit}件の求人に表示（${Object.keys(usable).length}社）`);
  if(missing.size){
    console.log(`ロゴ未登録の企業 ${missing.size}社（頭文字タイルで表示）:`);
    [...missing].forEach(c => console.log(`   - ${c}`));
  }
  return jobs;
}

/* 従業員数。Airtable「求人DB（企業）」の 従業員数 列を、data/employees.json（企業名 → 原文）
   経由で求人1件ずつに差し込む（node fetch-employees.js で取得）。
   ⚠ ロゴと同じで jobs.json 側には書かない。jobs.json は Airtable からの
     「取り直すたび丸ごと入れ替わるスナップショット」なので、書くと毎回消える。
   ⚠ 人数（employeeCount）は Airtable の「従業員数（数値）」列が正。原文から推測しない。
     人数が空の会社は「企業規模」の段に入らない（＝絞り込みで出ない）。埋めるときは Airtable の列を埋める。
   ⚠ 原文（employees）は原文のまま渡す。求人詳細にはこちらをそのまま出す。
     段の切り方（EMP_BANDS）だけは template.html 側にあり、人数から計算している。
   企業名の完全一致で引く。Airtable 側で社名を変えたら employees.json も直すこと。 */
function attachEmployees(jobs){
  const empPath = path.join(dir, 'data', 'employees.json');
  if(!fs.existsSync(empPath)){
    console.log('data/employees.json が無いので、従業員数と「企業規模」の絞り込みは出しません。');
    return jobs;
  }
  const emp = JSON.parse(fs.readFileSync(empPath, 'utf8'));
  let hit = 0, withNum = 0;
  const missing = new Set(), noNum = new Set();
  jobs.forEach(j => {
    /* 値は {raw, n}。昔の「企業名 → 原文の文字列」だけの形も読めるようにしてある */
    const v = emp[j.company];
    if(!v){ if(j.company) missing.add(j.company); return; }
    const o = (typeof v === 'string') ? { raw: v } : v;
    if(o.raw){ j.employees = o.raw; hit++; }
    if(typeof o.n === 'number'){ j.employeeCount = o.n; withNum++; }
    else if(j.company) noNum.add(j.company);
  });
  console.log(`従業員数: ${hit}件の求人に表示（うち人数あり ${withNum}件・${Object.keys(emp).length}社）`);
  if(missing.size){
    console.log(`従業員数が未登録の企業 ${missing.size}社（「企業規模」で絞ると出ません）:`);
    [...missing].forEach(c => console.log(`   - ${c}`));
  }
  if(noNum.size){
    console.log(`人数が読めない企業 ${noNum.size}社（原文は出るが「企業規模」では絞り込めません）:`);
    [...noNum].forEach(c => console.log(`   - ${c}`));
  }
  return jobs;
}

/* ---------- 一覧用の軽い項目だけを index.html に埋め、本文は data/jobs/<求人ID>.json に分ける ----------
   2026-09-06 に掲載を422件→5,700件超に広げた。全項目を埋め込むと index.html が 20MB を超えるので、
   一覧・検索・絞り込みに要る項目（下の LIGHT_KEYS）だけを埋め、仕事内容・条件・企業情報などの長文は
   求人を開いたときにブラウザが data/jobs/<求人ID>.json を読む（template.html の loadDetail）。
   ⚠ 検索の対象は一覧側の項目＋タグ＋リード文（lead）。本文の全文検索はしない。 */
const PREFS = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];
/* template.html の areasOf() と同じ。**片方だけ直さないこと**（勤務地の絞り込みが食い違う） */
/* 都道府県が書かれていない求人（「取引先構内」「大阪市北区…」「東京」など）のための手掛かり。
   ⚠ 使うのは**都道府県名が1つも見つからなかったときだけ**。見つかったらそちらが正。
   ⚠ 他県にも同じ地名があるものは入れない（福島＝大阪市福島区、長崎＝豊島区長崎、
     北区・中央区・港区・西区＝政令市に同名の区がある）。誤検知は「別の県で探している人に
     関係ない求人を出す」ことになるので、拾える件数より正しさを優先する。 */
const AREA_HINT={};
{
  const BARE_NG=new Set(["福島県","長崎県","大分県","宮崎県","山口県"]);   /* 略称が他の地名と衝突する */
  PREFS.forEach(p=>{ if(p!=="北海道" && !BARE_NG.has(p)) AREA_HINT[p.replace(/[都府県]$/,"")]=p; });
  Object.assign(AREA_HINT,{
    "札幌":"北海道","仙台":"宮城県","盛岡":"岩手県","秋田市":"秋田県","山形市":"山形県",
    "郡山市":"福島県","いわき市":"福島県","福島市":"福島県","水戸":"茨城県","つくば":"茨城県",
    "宇都宮":"栃木県","前橋":"群馬県","高崎":"群馬県","さいたま":"埼玉県","川口市":"埼玉県",
    "船橋":"千葉県","柏市":"千葉県","横浜":"神奈川県","川崎市":"神奈川県","相模原":"神奈川県",
    "甲府":"山梨県","松本市":"長野県","金沢":"石川県","四日市":"三重県","浜松":"静岡県",
    "名古屋":"愛知県","豊田市":"愛知県","岡崎市":"愛知県","大津市":"滋賀県","堺市":"大阪府",
    "神戸":"兵庫県","西宮":"兵庫県","姫路":"兵庫県","下関":"山口県","山口市":"山口県",
    "高松":"香川県","松山市":"愛媛県","北九州":"福岡県","博多":"福岡県","天神":"福岡県",
    "長崎市":"長崎県","佐世保":"長崎県","大分市":"大分県","宮崎市":"宮崎県","那覇":"沖縄県",
  });
}
/* 東京23区のうち、他の政令市に同名の区が無いものだけ */
const TOKYO_WARDS=["千代田区","新宿区","文京区","台東区","墨田区","江東区","品川区","目黒区","大田区",
  "世田谷区","渋谷区","中野区","杉並区","豊島区","荒川区","板橋区","練馬区","足立区","葛飾区","江戸川区"];
function areasOf(loc){
  loc=String(loc||"");
  const hit=PREFS.filter(p=>loc.includes(p));
  if(hit.length) return hit;
  const out=new Set();
  if(TOKYO_WARDS.some(w=>loc.includes(w))) out.add("東京都");
  for(const k in AREA_HINT) if(loc.includes(k)) out.add(AREA_HINT[k]);
  return [...out];
}
/* template.html の plainLead() と同じ。カードの2行目に出すリード文（120字） */
function plainLead(src){
  if(!src) return '';
  const t = String(src).replace(/\r/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*・–—]\s*/gm, '')
    .replace(/[*_`>|\\]/g, '')
    .replace(/\s+/g, ' ').trim();
  return t.length > 120 ? t.slice(0, 120) + '…' : t;
}
/* 一覧用の項目。キーを行ごとに繰り返さず {k:[キー], r:[[値…]]} の表形式で埋める（5,700件で約1MB節約）。
   タグは名前ではなく data/tags.json の並び順の番号（t）で持つ（1件あたり平均27タグ。名前だと4MB超になる）。
   template.html 側で展開する（JOBS の定義と JOBS.forEach の中）。 */
const LIGHT_KEYS = ['id','company','position','title','employment','kubun','salaryMin','salaryMax','location',
  'jobCategory','industry','url','listedStatus','createdAt','gradYear','t','logo','employees','employeeCount','areas','remote','lead',
  'govScore','govFront','finFit'];
function lighten(full){
  const tagPath = path.join(dir, 'data', 'tags.json');
  const tagIdx = new Map();
  if(fs.existsSync(tagPath)) JSON.parse(fs.readFileSync(tagPath, 'utf8')).forEach((t, i) => tagIdx.set(t.name, i));
  const rows = full.map(j => {
    const o = {};
    LIGHT_KEYS.forEach(k => { if(j[k] !== undefined && j[k] !== null && j[k] !== '') o[k] = j[k]; });
    /* 求人タイトル(表示)は「会社名＋ポジション」なので、ポジションがあれば持たない（検索は会社名・ポジションで引ける） */
    if(o.position) delete o.title;
    /* 勤務地はカードでは県＋市区町村に整形されるだけなので長い原文は切る（詳細では原文が出る） */
    if(typeof o.location === 'string' && o.location.length > 70) o.location = o.location.slice(0, 70);
    if(typeof o.createdAt === 'string') o.createdAt = o.createdAt.slice(0, 10);
    o.t = (j.tags || []).map(n => tagIdx.get(n)).filter(i => i !== undefined);
    const loc = j.location || '';
    o.areas = areasOf(loc);
    o.remote = /在宅|リモート|テレワーク|フルリモート/.test(loc + ' ' + (j.jobContent || '') + ' ' + (j.benefits || ''));
    const lead = plainLead(j.jobContent || j.must || j.companyInfo || '');
    o.lead = lead.length > 72 ? lead.slice(0, 72) + '…' : lead;
    return LIGHT_KEYS.map(k => (o[k] === undefined ? null : o[k]));
  });
  /* 行末の null は落として短くする（展開側は足りない列を空として扱う） */
  rows.forEach(r => { while(r.length && r[r.length - 1] === null) r.pop(); });
  return { k: LIGHT_KEYS, r: rows };
}
function writeDetails(full){
  const d = path.join(dir, 'data', 'jobs');
  fs.mkdirSync(d, { recursive: true });
  const keep = new Set(full.map(j => `${j.id}.json`));
  let removed = 0;
  fs.readdirSync(d).forEach(f => { if(f.endsWith('.json') && !keep.has(f)){ fs.unlinkSync(path.join(d, f)); removed++; } });
  full.forEach(j => fs.writeFileSync(path.join(d, `${j.id}.json`), JSON.stringify(j), 'utf8'));
  console.log(`data/jobs/ に求人の詳細を書き出しました: ${full.length}件${removed ? `（掲載終了 ${removed}件を削除）` : ''}`);
}

const jobs = build('jobs.json', 'template.html', 'index.html', '__JOBS_DATA__', [],
  data => { const full = attachEmployees(attachLogos(publicSectorOnly(midCareerOnly(data)))); writeDetails(full); return lighten(full); });
const jobRows = jobs ? jobs.r.map(r => { const o = {}; jobs.k.forEach((k, i) => { if(r[i] != null) o[k] = r[i]; }); return o; }) : [];
if(jobs) console.log('index.html を再生成しました:', jobRows.length, '件（中途のみ・一覧用の項目だけ内蔵）');

/* タグの目録（data/tags.json ＝ node fetch-tags.js で取得）。
   絞り込みをカテゴリごとの箱に分けるための「名前・スラッグ・カテゴリ」だけを持つ。
   ⚠ 件数はここに入れない。中途だけに絞ったあとの件数はブラウザ側で数える。
   ⚠ 求人1件ずつのタグは data/jobs.json の tags 側にある。突き合わせは**タグ名の完全一致**。
     Airtableでタグ名を変えたら、求人側のタグも付け直す（node fetch-jobs.js からやり直す）。 */
function attachTags(){
  const indexPath = path.join(dir, 'index.html');
  if(!fs.existsSync(indexPath)) return;
  const tagPath = path.join(dir, 'data', 'tags.json');
  let tags = [];
  if(fs.existsSync(tagPath)) tags = JSON.parse(fs.readFileSync(tagPath, 'utf8'));
  else console.log('data/tags.json が無いので、タグの絞り込みは出しません（node fetch-tags.js）。');
  const html = fs.readFileSync(indexPath, 'utf8').replace('__TAGS_DATA__', () => embed(tags));
  fs.writeFileSync(indexPath, html, 'utf8');
  if(!tags.length) return;
  /* 目録にあるのに、どの求人にも付いていないタグを名指しで出す。
     絞り込みには0件として出るので、消したいときは Airtable の「サイト掲載」を落とす。 */
  const used = new Set();
  jobRows.forEach(j => (j.t || []).forEach(i => { if(tags[i]) used.add(tags[i].name); }));
  const unused = tags.filter(t => !used.has(t.name));
  const cats = new Set(tags.map(t => t.cat).filter(Boolean));
  console.log(`タグ: ${tags.length}件 / ${cats.size}カテゴリを絞り込みに出します`
    + `（掲載中の求人に付いているのは ${tags.length - unused.length}件）`);
  if(unused.length) console.log(`  0件のタグ ${unused.length}件（絞り込みには出ます）: ${unused.map(t => t.name).join(', ')}`);
  const noTag = jobRows.filter(j => !j.t || !j.t.length).length;
  if(noTag) console.log(`  ⚠ タグが1つも付いていない求人が ${noTag}件あります（node fetch-jobs.js からやり直してください）`);
}
attachTags();

/* 申し込みフォームは「どの求人から来たか」を見出しに出すだけなので、
   求人データ全部（3.5MB）ではなく ID・企業名・職種名・年収だけを持たせる。 */
function fmtSalary(j){
  const mn = j.salaryMin, mx = j.salaryMax;
  if(mn != null && mx != null) return mn === mx ? `${mn}万円` : `${mn}〜${mx}万円`;
  if(mx != null) return `〜${mx}万円`;
  if(mn != null) return `${mn}万円〜`;
  return '';
}
if(jobs){
  /* 表形式 [id, 会社名, 職種名, 年収]。apply-template.html 側で {id,company,name,salary} に展開する */
  const mini = jobRows.map(j => [j.id, j.company || '', j.position || j.jobCategory || j.title || '求人', fmtSalary(j)]);
  const tplPath = path.join(dir, 'apply-template.html');
  if(fs.existsSync(tplPath)){
    const out = fs.readFileSync(tplPath, 'utf8').replace('__JOBS_MINI__', () => embed(mini));
    fs.writeFileSync(path.join(dir, 'apply.html'), out, 'utf8');
    console.log('apply.html を再生成しました:', mini.length, '件の求人見出しを内蔵');
  }else{
    console.log('apply-template.html が無いのでスキップしました。');
  }
}

/* 1day選考会も求人と同じで、Airtableの1つのテーブルを jobs と shinsotsu が共有している。
   このサイトは中途の回だけを載せる。⚠ shinsotsu 側には鏡写しの newGradOnly() があり、
   片方だけ直すと同じ回が両サイトに出る／どちらにも出ない状態になる。 */
function midCareerEvents(events){
  /* ⚠ 区分が空の回はここに落ちてくる（求人と同じく既定は中途）。
     黙って載せると誤掲載に気づけないので、必ず名指しで警告する。 */
  const noKubun = events.filter(e => !e.kubun);
  if(noKubun.length){
    console.log(`⚠ 区分が空の1day選考会が ${noKubun.length}件あります。中途として載せます。Airtableで区分を入れてください:`);
    noKubun.forEach(e => console.log(`   - ${e.date || '日付なし'} / ${e.title || e.id}`));
  }
  const kept = events.filter(e => !e.kubun || e.kubun === '中途');
  const dropped = events.length - kept.length;
  if(dropped > 0) console.log(`中途以外の1day選考会を除外しました: ${dropped}件`);
  return kept;
}

const events = build('1day.json', '1day-template.html', '1day.html', '__EVENTS_DATA__', [], midCareerEvents);
if(events) console.log('1day.html を再生成しました:', events.length, '件（中途のみ）');

/* 1day選考会は専用ページをナビから外し、検索結果の1位のPR枠に一本化した。
   index.html にはPR枠に出すぶん（直近3件の日程・タイトル・参加企業）だけを渡す。
   ⚠ 1day.json を更新したら rebuild.js を回すこと。回さないと一覧のPR枠が古いままになる。 */
function onedayMini(list){
  const today = new Date().toISOString().slice(0, 10);
  return (list || [])
    .filter(e => e.status !== 'closed')
    .filter(e => !e._iso || e._iso >= today)
    .slice(0, 3)
    .map(e => ({
      date: e.date || '',
      title: e.title || '1day選考会',
      company: e.companyLabel || '',
    }));
}
{
  const indexPath = path.join(dir, 'index.html');
  if(fs.existsSync(indexPath)){
    const mini = onedayMini(events);
    const html = fs.readFileSync(indexPath, 'utf8').replace('__ONEDAY_MINI__', () => embed(mini));
    fs.writeFileSync(indexPath, html, 'utf8');
    console.log('検索結果1位のPR枠:', mini.length ? `次回 ${mini[0].date}（掲載 ${mini.length}件）` : '開催なし（案内を受け取る導線を表示）');
  }
}
