'use strict';
const fs = require('fs');
const path = require('path');
const catalog = require('../media/images/catalog.json');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const themes = { '自治体別': 'municipal', '部署別': 'department', '選考対策': 'selection', '業界研究': 'industry', '制度とお金': 'money', '資格・スキル': 'skills' };
function visuals(meta) {
  const theme = themes[meta.kind];
  if (!theme) throw new Error('画像テーマ未設定: ' + meta.slug);
  let photo = { municipal: 'documents', department: 'collaboration', selection: 'documents', industry: 'collaboration', money: 'finance', skills: 'study' }[theme];
  if (/IT|システム|Web|データ|デジタル|エンジニア|プログラ/.test([meta.area, meta.theme, meta.title].join(' '))) photo = 'technology';
  return { hero: catalog.assets['generated-' + theme], photo: catalog.assets['photo-' + photo] };
}
function imageHtml(asset, role) {
  const hero = role === 'hero';
  return '<img src="images/' + esc(asset.id) + '-800.webp" srcset="images/' + esc(asset.id) + '-480.webp 480w, images/' + esc(asset.id) + '-800.webp 800w, images/' + esc(asset.id) + '-1200.webp 1200w" sizes="' + (role === 'thumb' ? '(max-width:640px) 45vw, 320px' : '(max-width:760px) calc(100vw - 28px), 720px') + '" width="1200" height="800" alt="' + (role === 'thumb' ? '' : esc(asset.alt)) + '" loading="' + (hero ? 'eager' : 'lazy') + '" decoding="async"' + (hero ? ' fetchpriority="high"' : '') + '>';
}
function figure(asset, role) {
  const credit = asset.type === 'generated'
    ? 'AI生成イラスト（テーマのイメージ）'
    : '写真：<a href="' + esc(asset.source) + '" target="_blank" rel="noopener noreferrer">' + esc(asset.author) + ' / Pexels</a>（<a href="https://www.pexels.com/license/" target="_blank" rel="noopener noreferrer">利用条件</a>）';
  return '<figure class="article-visual article-visual--' + role + '">' + imageHtml(asset, role) + '<figcaption>' + credit + '。記事で扱う自治体・企業・人物の実写ではありません。</figcaption></figure>\n';
}
function withInlineVisual(meta, html) {
  let count = 0;
  return html.replace(/<h2>/g, tag => ++count === 4 ? figure(visuals(meta).photo, 'inline') + tag : tag);
}
function validateAssets() {
  for (const asset of Object.values(catalog.assets)) {
    if (!asset.alt || !asset.type || (asset.type === 'stock' && (!asset.source || !asset.author || !asset.license))) throw new Error('画像情報が不足: ' + asset.id);
    for (const width of [480, 800, 1200]) if (!fs.existsSync(path.join(__dirname, '../media/images', asset.id + '-' + width + '.webp'))) throw new Error('画像がありません: ' + asset.id);
  }
}
module.exports = { visuals, imageHtml, figure, withInlineVisual, validateAssets };
