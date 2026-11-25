'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), media = path.join(root, 'media');
const { parseFront } = require('../build-articles');
const { visuals, validateAssets } = require('./article-visuals');
validateAssets();
const errors = [];
const files = fs.readdirSync(path.join(root, 'out')).filter(f => f.endsWith('.md'));
for (const file of files) {
  const { meta } = parseFront(fs.readFileSync(path.join(root, 'out', file), 'utf8'));
  const html = fs.readFileSync(path.join(media, meta.slug + '.html'), 'utf8');
  const figures = [...html.matchAll(/<figure class="article-visual [\s\S]*?<\/figure>/g)].map(m => m[0]);
  if (figures.length !== 2 || !figures[0].includes('AI生成イラスト') || !figures[1].includes('https://www.pexels.com/license/')) errors.push(meta.slug + ': figures/credits');
  const expected = visuals(meta);
  if (!figures[0]?.includes(expected.hero.id) || !figures[1]?.includes(expected.photo.id)) errors.push(meta.slug + ': wrong assets');
  if (!figures[0]?.includes('fetchpriority="high"') || !figures[1]?.includes('loading="lazy"')) errors.push(meta.slug + ': loading');
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap(m => JSON.parse(m[1]));
  const article = ld.find(x => x['@type'] === 'Article');
  if (!article?.image?.[0]?.endsWith(expected.hero.id + '-1200.webp')) errors.push(meta.slug + ': structured image');
  if (!html.includes('property="og:image" content="https://zaiseikatenshoku.com/media/images/' + expected.hero.id)) errors.push(meta.slug + ': OG image');
}
for (const file of fs.readdirSync(media).filter(f => f.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(media, file), 'utf8');
  for (const m of html.matchAll(/<img\b[^>]*src="(images\/[^\"]+)"[^>]*>/g)) {
    if (!/width="\d+"/.test(m[0]) || !/height="\d+"/.test(m[0]) || !/alt="[^"]*"/.test(m[0])) errors.push(file + ': image accessibility/dimensions');
    const urls = [m[1], ...[...m[0].matchAll(/(images\/[^\s",]+\.webp)/g)].map(x => x[1])];
    for (const url of urls) if (!fs.existsSync(path.join(media, url))) errors.push(file + ': missing ' + url);
  }
}
console.log(JSON.stringify({ articles: files.length, editorialImages: files.length * 2, errors }, null, 2));
if (files.length !== 2000 || errors.length) process.exitCode = 1;
