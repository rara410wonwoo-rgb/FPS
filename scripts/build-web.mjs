// Static web build (solo only): bundles the in-browser server simulation into dist/web.
// three.js is loaded from jsDelivr at a pinned version (for static hosting). The local server version uses no CDN.
// Usage: npm run build:web
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let esbuild;
try { esbuild = require('esbuild'); } catch { esbuild = require(process.env.ESBUILD_PATH); }

const THREE_VERSION = process.env.THREE_VERSION || '0.186.1';
const out = path.join(root, 'dist', 'web');
await mkdir(out, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, 'public', 'web-entry.js')],
  bundle: true,
  format: 'esm',
  external: ['three', 'three/addons/*'],
  minify: true,
  target: 'es2020',
  outfile: path.join(out, 'game.bundle.js'),
  legalComments: 'none',
});

const html = await readFile(path.join(root, 'public', 'index.html'), 'utf8');
const css = await readFile(path.join(root, 'public', 'styles.css'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace('<script type="module" src="/game.js"></script>', '<script type="module" src="game.bundle.js"></script>');

const page = `<title>PolyZone: Tactics</title>
<style>
:root { color-scheme: dark; }
${css}
</style>
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/"
} }
</script>
${body.trim()}
`;
await writeFile(path.join(out, 'index.html'), page);
// also copy the CC0 assets (textures, HDRI, models) to assets/ next to index.html
await cp(path.join(root, 'public', 'assets'), path.join(out, 'assets'), { recursive: true });
console.log(`dist/web build done (three@${THREE_VERSION})`);
