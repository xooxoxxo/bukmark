import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../../', import.meta.url);
const out = new URL('packaging/dist/bukmark-sessions.mjs', root);
await mkdir(new URL('.', out), { recursive: true });
await build({
  absWorkingDir: new URL('.', import.meta.url).pathname,
  entryPoints: ['src/sessions/main.ts'], outfile: out.pathname,
  bundle: true, platform: 'node', target: 'node22.13', format: 'esm',
  minify: true, legalComments: 'eof', sourcemap: false,
});
const hash = createHash('sha256').update(await readFile(out)).digest('hex');
await writeFile(new URL('packaging/dist/bukmark-sessions.sha256', root), `${hash}  bukmark-sessions.mjs\n`);
const command = await readFile(new URL('packaging/bin/bukmark', root), 'utf8');
if (!command.includes(`BUKMARK_SESSIONS_SHA256=${hash}\n`)) {
  throw new Error(`Session bundle changed. Set BUKMARK_SESSIONS_SHA256=${hash} in packaging/bin/bukmark, then rebuild.`);
}
console.log(`Built local sessions helper (${hash}).`);
