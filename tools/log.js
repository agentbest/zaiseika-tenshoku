// PROGRESS.md の自分のレーンの作業ログの先頭に、1ブロック差し込む。
//   node tools/log.js A entry.md     … entry.md の中身をレーンAの節の先頭に入れる
//   echo "..." | node tools/log.js B … 標準入力からも読める
//
// 改行コードは PROGRESS.md 側に合わせる（端末によって CRLF / LF が混ざるため）。
// ブロックの形式は PROGRESS.md「作業ログ」の説明どおり:
//   ### 最終更新：自動運転N回目（No.x-y）レーンA
//   - slug／柱にした条文／構成の要点 …
'use strict';
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..', 'PROGRESS.md');

const lane = (process.argv[2] || '').toUpperCase();
if (!/^[AB]$/.test(lane)) { console.error('使い方: node tools/log.js <A|B> [entry.md]'); process.exit(1); }
const src = process.argv[3] ? fs.readFileSync(process.argv[3], 'utf8') : fs.readFileSync(0, 'utf8');

let s = fs.readFileSync(P, 'utf8');
const crlf = s.includes('\r\n');
s = s.replace(/\r\n/g, '\n');
let entry = src.replace(/\r\n/g, '\n').trim() + '\n\n\n';

const re = new RegExp('^### レーン' + lane + '（[^）]*）の作業ログ\\n\\n', 'm');
const m = s.match(re);
if (!m) { console.error('PROGRESS.md にレーン' + lane + 'の節が見つかりません'); process.exit(1); }
const at = m.index + m[0].length;
// 節の直下の「（まだ無し…）」の1行は最初の記入で消す
const rest = s.slice(at).replace(/^（まだ無し[^\n]*\n\n/, '');
s = s.slice(0, at) + entry + rest;
if (crlf) s = s.replace(/\n/g, '\r\n');
fs.writeFileSync(P, s);
console.log('PROGRESS.md レーン' + lane + ' に追記しました');
