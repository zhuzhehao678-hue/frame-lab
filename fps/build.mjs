// Bundles src/ (three.js included) and inlines it into one self-contained
// index.html that runs from file:// with no network access.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const dev = process.argv.includes('--dev');
const res = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: !dev, format: 'esm', target: 'es2022',
  write: false, legalComments: 'none',
});
let js = res.outputFiles[0].text;
// keep the HTML parser from ending/escaping the inline script early
js = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const tpl = readFileSync('src/index.template.html', 'utf8');
const tag = '<script type="module" src="./game.js"></script>';
if (!tpl.includes(tag)) throw new Error('script tag not found in template');
const html = tpl.replace(tag, () => `<script type="module">\n${js}\n</script>`);
writeFileSync('index.html', html);
console.log(`index.html ${(html.length / 1024).toFixed(0)} KB`);
