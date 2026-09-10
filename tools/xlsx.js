// xlsx を読んでタブ区切りで出す。総務省の「地方公共団体給与情報等公表システム」の
// 集約Excel（団体別のラスパイレス指数・平均給与月額・退職手当など）を読むために使う。
//
//   node tools/xlsx.js <ファイル>                … シート一覧
//   node tools/xlsx.js <ファイル> <シート番号>    … そのシートを全部出す
//   node tools/xlsx.js <ファイル> <番号> <検索語> … その語を含む行だけ出す
//
// ⚠ npm の依存は使わない（zip の展開は zlib、XML は素直な走査でやる）。
//    書式や数式は解決しない。数式セルはキャッシュされた値を返す。
'use strict';
const fs = require('fs');
const zlib = require('zlib');

// ---------- zip ----------
function unzip(buf) {
  // End of Central Directory を末尾から探す
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 70000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip の終端が見つかりません');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const fnLen = buf.readUInt16LE(p + 28);
    const exLen = buf.readUInt16LE(p + 30);
    const cmLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + fnLen).toString('utf8');
    p += 46 + fnLen + exLen + cmLen;

    if (buf.readUInt32LE(local) !== 0x04034b50) continue;
    const lfn = buf.readUInt16LE(local + 26);
    const lex = buf.readUInt16LE(local + 28);
    const start = local + 30 + lfn + lex;
    const raw = buf.slice(start, start + csize);
    files[name] = method === 8 ? zlib.inflateRawSync(raw) : raw;
  }
  return files;
}

// ---------- xml ----------
const unescapeXml = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

// <si> ごとに、中の <t> を全部つなぐ（リッチテキスト対応）。
// ⚠ <rPh> はふりがな。中に <t> があるので、先に落とさないと「都道府県名トドウフケンメイ」になる。
function sharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  for (const si of xml.split('<si>').slice(1)) {
    const end = si.indexOf('</si>');
    let body = end >= 0 ? si.slice(0, end) : si;
    body = body.replace(/<rPh[\s\S]*?<\/rPh>/g, '').replace(/<phoneticPr[^>]*\/?>/g, '');
    let s = '';
    for (const m of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += unescapeXml(m[1]);
    out.push(s);
  }
  return out;
}

function colIndex(ref) {
  const m = ref.match(/^([A-Z]+)/);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sheetRows(xml, ss) {
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cm[1];
      const body = cm[2];
      const refM = attrs.match(/r="([A-Z]+\d+)"/);
      const idx = refM ? colIndex(refM[1]) : cells.length;
      const tM = attrs.match(/t="([^"]+)"/);
      const type = tM ? tM[1] : 'n';
      let val = '';
      if (type === 'inlineStr') {
        for (const t of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) val += unescapeXml(t[1]);
      } else {
        const vM = body.match(/<v>([\s\S]*?)<\/v>/);
        if (vM) {
          const raw = unescapeXml(vM[1]);
          val = (type === 's') ? (ss[Number(raw)] || '') : raw;
        }
      }
      cells[idx] = val;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

function open(file) {
  const files = unzip(fs.readFileSync(file));
  const wb = files['xl/workbook.xml'] ? files['xl/workbook.xml'].toString('utf8') : '';
  const names = [...wb.matchAll(/<sheet\s[^>]*name="([^"]*)"[^>]*\/?>/g)].map(m => unescapeXml(m[1]));
  const ss = sharedStrings(files['xl/sharedStrings.xml'] ? files['xl/sharedStrings.xml'].toString('utf8') : '');
  const sheetFiles = Object.keys(files)
    .filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  return { names, ss, files, sheetFiles };
}

function main() {
  const file = process.argv[2];
  const idx = process.argv[3];
  const needle = process.argv.slice(4).join(' ');
  if (!file) {
    console.log('使い方: node tools/xlsx.js <ファイル> [シート番号] [検索語]');
    return;
  }
  const wb = open(file);
  if (!idx) {
    console.log('シート ' + wb.sheetFiles.length + '枚');
    wb.sheetFiles.forEach((f, i) => console.log('  ' + (i + 1) + ': ' + (wb.names[i] || f)));
    return;
  }
  const n = Number(idx) - 1;
  if (!wb.sheetFiles[n]) { console.log('そのシートはありません'); return; }
  const rows = sheetRows(wb.files[wb.sheetFiles[n]].toString('utf8'), wb.ss);
  let shown = 0;
  for (const r of rows) {
    const line = r.join('\t').replace(/\t+$/, '');
    if (needle && line.indexOf(needle) < 0) continue;
    if (!line.trim()) continue;
    console.log(line);
    shown++;
  }
  if (!shown) console.log('（該当なし。行数 ' + rows.length + '）');
}

if (require.main === module) main();
module.exports = { open, sheetRows, unzip };
