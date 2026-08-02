#!/usr/bin/env node
// Regenerate the --f-* frame data-URI tokens in shared/theme.css from the source PNG art
// in app/public/frame/. Run after editing the frame art:  node scripts/gen-frame-css.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frameDir = path.join(root, 'app/public/frame');
const themeCss = path.join(root, 'shared/theme.css');

// CSS var -> source PNG (corners TL,TR,BL,BR then rails top,bottom,left,right).
const map = [
  ['--f-tl', 'iron-corner-tl.png'],
  ['--f-tr', 'iron-corner-tr.png'],
  ['--f-bl', 'iron-corner-bl.png'],
  ['--f-br', 'iron-corner-br.png'],
  ['--f-rt', 'rail-top.png'],
  ['--f-rb', 'rail-bottom.png'],
  ['--f-rl', 'rail-left.png'],
  ['--f-rr', 'rail-right.png'],
];

const vars = map
  .map(([v, f]) => {
    const b64 = readFileSync(path.join(frameDir, f)).toString('base64');
    return `  ${v}: url("data:image/png;base64,${b64}");`;
  })
  .join('\n');

const marker = '  /* __FRAME_VARS__ */';
const css = readFileSync(themeCss, 'utf8');
if (!css.includes(marker) && !/ {2}--f-tl:/.test(css)) {
  throw new Error('theme.css: no frame-vars marker or existing block to replace');
}
// Replace either the placeholder marker or a previously generated block (--f-tl … --f-rr line).
const next = css.includes(marker)
  ? css.replace(marker, vars.trim().replace(/^ {2}/, '  '))
  : css.replace(/ {2}--f-tl:[\s\S]*?--f-rr:[^\n]*\n/, vars + '\n');
writeFileSync(themeCss, next);
console.log(`gen-frame-css: wrote ${map.length} frame tokens to shared/theme.css`);
