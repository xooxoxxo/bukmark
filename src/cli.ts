import { parseArgs } from 'node:util';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ingestFile } from './ingest.js';
import { renderAll } from './render.js';
import { loadCanon, loadStore, saveCanon, saveStore } from './store.js';
import { collectResultFiles, mergeBatch, prepareBatches, validateBatch } from './triage.js';
import { defaultPaths, type Paths, type Source } from './types.js';

const SOURCES: Source[] = ['onetab_import', 'chrome_import', 'safari_import', 'extension_capture', 'manual'];

export async function runCli(argv: string[], paths: Paths = defaultPaths): Promise<number> {
  const [command, ...rest] = argv;
  const storeFile = join(paths.dataDir, 'store.json');
  const canonFile = join(paths.dataDir, 'categories.json');

  switch (command) {
    case 'ingest': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { source: { type: 'string', default: 'onetab' }, force: { type: 'boolean', default: false } },
      });
      const file = positionals[0];
      if (!file) { console.error('usage: ingest <file> [--source onetab] [--force]'); return 2; }
      const source = (`${values.source}_import`) as Source;
      if (!SOURCES.includes(source)) { console.error(`unknown source: ${values.source}`); return 2; }
      const r = ingestFile(paths, file, source, { force: values.force });
      if (r.alreadyIngested) {
        console.log(`already ingested (${r.fileSha256.slice(0, 12)}); use --force to redo`);
        return 0;
      }
      console.log(`captures ${r.captures} | added ${r.added} | dupes ${r.bumped} | junk ${r.junked} | malformed ${r.malformed}`);
      for (const s of r.malformedSamples) console.log(`  malformed: ${s}`);
      return 0;
    }

    case 'prepare': {
      const { values } = parseArgs({
        args: rest,
        options: {
          'batch-size': { type: 'string', default: '50' },
          retriage: { type: 'boolean', default: false },
        },
      });
      const store = loadStore(storeFile);
      const n = prepareBatches(store, paths.workDir, {
        batchSize: Number(values['batch-size']),
        includeTriaged: values.retriage,
      });
      console.log(n === 0 ? 'queue empty' : `${n} batch file(s) in ${paths.workDir}`);
      return 0;
    }

    case 'merge-triage': {
      const store = loadStore(storeFile);
      const canon = loadCanon(canonFile);
      const now = new Date().toISOString();
      let failed = 0;
      for (const file of collectResultFiles(paths.workDir)) {
        const v = validateBatch(store, file);
        if (!v.ok) {
          failed += 1;
          for (const e of v.errors) console.error(e);
          continue;
        }
        const merged = mergeBatch(store, canon, file, now);
        console.log(`batch ${file.batch}: merged ${merged}`);
        for (const suffix of ['.json', '.result.json']) {
          const p = join(paths.workDir, `batch-${file.batch}${suffix}`);
          if (existsSync(p)) unlinkSync(p);
        }
      }
      saveStore(storeFile, store);
      saveCanon(canonFile, canon);
      return failed === 0 ? 0 : 1;
    }

    case 'render': {
      const store = loadStore(storeFile);
      renderAll(store, loadCanon(canonFile), paths.outputDir);
      console.log(`rendered ${paths.outputDir}`);
      return 0;
    }

    case 'status': {
      const store = loadStore(storeFile);
      const links = Object.values(store.links);
      const junk = links.filter((l) => l.junk).length;
      const kept = links.filter((l) => !l.junk && l.triage?.keep).length;
      const tossed = links.filter((l) => !l.junk && l.triage && !l.triage.keep).length;
      const pending = links.filter((l) => !l.junk && !l.triage).length;
      const batches = collectResultFiles(paths.workDir).length;
      console.log(`links ${links.length} | kept ${kept} | tossed ${tossed} | junk ${junk} | pending ${pending} | result files waiting ${batches}`);
      return 0;
    }

    default:
      console.error('commands: ingest | prepare | merge-triage | render | status');
      return 2;
  }
}

const invokedDirectly = process.argv[1]?.endsWith('cli.ts');
if (invokedDirectly) {
  process.exitCode = await runCli(process.argv.slice(2));
}
