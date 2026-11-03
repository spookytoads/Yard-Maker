// Builds dist/yard-maker.html: one self-contained page (CSS and app code inlined,
// three.js from the CDN) for publishing as a Claude artifact or hosting anywhere.
// The Claude artifact host adds its own <!doctype>/<head>/<body>, so this page is
// written without them.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('css/styles.css', 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"')).trim();
const importmap = html.match(/<script type="importmap">[\s\S]*?<\/script>/)[0];
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];

const out = await build({
  entryPoints: ['js/main.js'],
  bundle: true,
  format: 'esm',
  external: ['three', 'three/addons/*'],
  minify: true,
  write: false,
  target: 'es2020',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const page = `<title>Yard Maker</title>
${fonts}
<style>
${css}
</style>
${importmap}
${body}
<script type="module">
${js}
</script>
`;
mkdirSync('dist', { recursive: true });
writeFileSync('dist/yard-maker.html', page);
console.log(`dist/yard-maker.html  ${(page.length / 1024).toFixed(0)} KB`);
