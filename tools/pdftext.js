// PDFからテキストを取り出す。自治体の公表資料（給与・定員管理等の状況）を読むために使う。
//   node tools/pdftext.js <PDFのパス> [開始ページ] [終了ページ]
//
// ⚠ このツールだけ pdfjs-dist を使う。**リポジトリには入れない**
//    （サイトのビルドは Node 標準だけで通す約束のため）。
//    作業用ディレクトリに一度だけ入れて、場所を環境変数 PDFJS で渡す:
//
//      mkdir -p ~/pdftool && cd ~/pdftool && npm i pdfjs-dist@4.2.67
//      PDFJS=~/pdftool/node_modules/pdfjs-dist/legacy/build/pdf.mjs \
//        node tools/pdftext.js 資料.pdf 1 3
//
//    PDFJS を指定しなければ、通常の解決（同じ階層に入っている場合）を試みる。
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadPdfjs() {
  const p = process.env.PDFJS;
  if (p) return import(pathToFileURL(path.resolve(p)).href);
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

async function main() {
  const file = process.argv[2];
  const from = Number(process.argv[3] || 1);
  const to = Number(process.argv[4] || 0);
  if (!file) { console.log('使い方: node tools/pdftext.js <PDFのパス> [開始ページ] [終了ページ]'); return; }

  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const last = to > 0 ? Math.min(to, doc.numPages) : doc.numPages;

  console.log('【' + path.basename(file) + '】全 ' + doc.numPages + ' ページ');
  for (let i = from; i <= last; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    // 同じ行のものをまとめる（yが近いものを1行に）
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      let key = y;
      for (const k of rows.keys()) { if (Math.abs(k - y) <= 2) { key = k; break; } }
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ x: it.transform[4], s: it.str });
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, arr]) => arr.sort((a, b) => a.x - b.x).map(o => o.s).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    console.log('');
    console.log('===== p.' + i + ' =====');
    console.log(lines.join('\n'));
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
