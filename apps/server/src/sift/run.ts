import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { askJev, jevCostUsd, JEV_MODEL, PILOT_LIMIT, publicBookmarkState } from './jev.js';
import { dispositions, handoffs, siftBookmark, type SiftBookmark } from './model.js';
import { BIN_RULES_VERSION, suggestBin } from './bins.js';
import { localSiftInput } from './evidence.js';

const USAGE = [
  'Usage: sift --input <OneTab store or Bookmarkt JSON export> [--select <sample JSON>] [--verify-public | --jev] [--out <report.json>]',
  'Selection JSON is an array of up to 16 entries with savedUrl and optional publicUrl and label.',
  'Only nominated and independently verified public pages enter the Jev pilot. --jev requires TYPESAFE_API_KEY.',
].join('\n');
type Selection = { savedUrl: string; publicUrl?: string; label?: string };
type RawBookmark = Partial<SiftBookmark> & {
  contentText?: unknown; httpStatus?: number | null; checkError?: string | null;
  dupeCount?: number; junk?: unknown; triage?: { keep?: boolean }; sessionProtected?: boolean; session_protected?: boolean;
};
type LocalBookmark = SiftBookmark & { sessionProtected: boolean };

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function bookmarks(value: unknown): LocalBookmark[] {
  if (!value || typeof value !== 'object' || !('links' in value) || !value.links || typeof value.links !== 'object') {
    throw new Error('Input must be a OneTab store or Bookmarkt JSON export.');
  }
  const rows = Object.values(value.links) as RawBookmark[];
  return rows.map((row) => {
    if (!row || typeof row.url !== 'string' || typeof row.title !== 'string') throw new Error('Input has an invalid bookmark.');
    if ((row.sessionProtected !== undefined && typeof row.sessionProtected !== 'boolean')
      || (row.session_protected !== undefined && typeof row.session_protected !== 'boolean')) throw new Error('Input has an invalid protection flag.');
    return { ...localSiftInput({url:row.url,title:row.title,
      status:row.status==='archived'||row.junk||row.triage?.keep===false?'archived':'active',
      contentText:row.contentText,httpStatus:row.httpStatus,checkError:row.checkError}),
      url: row.url, title: row.title, appearances: row.dupeCount,
      sessionProtected: row.sessionProtected === true || row.session_protected === true,
      status: row.status === 'archived' || row.junk || row.triage?.keep === false ? 'archived' : 'active',
    };
  });
}

function selections(value: unknown): Selection[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > PILOT_LIMIT) throw new Error(`Select between 1 and ${PILOT_LIMIT} bookmarks.`);
  const entries = value as Selection[];
  if (entries.some((entry) => !entry || typeof entry.savedUrl !== 'string'
    || (entry.publicUrl !== undefined && typeof entry.publicUrl !== 'string')
    || (entry.label !== undefined && typeof entry.label !== 'string'))
    || new Set(entries.map((entry) => entry.savedUrl)).size !== entries.length) throw new Error('Selection must contain distinct savedUrl entries.');
  return entries;
}

export async function runSift(args: string[], readPage?: Parameters<typeof publicBookmarkState>[2]) {
  const { values } = parseArgs({ args, options: {
    input: { type: 'string' }, select: { type: 'string' }, 'verify-public': { type: 'boolean' },
    jev: { type: 'boolean' }, out: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) { console.log(USAGE); return 0; }
  if (!values.input || ((values.jev || values['verify-public']) && !values.select)) throw new Error(USAGE);

  const library = bookmarks(await readJson(values.input));
  const selected = values.select ? selections(await readJson(values.select)) : undefined;
  const rows = selected ? selected.map((entry) => {
    const matches = library.filter((item) => item.url === entry.savedUrl);
    if (matches.length !== 1) throw new Error('A selected bookmark did not match exactly one saved URL.');
    return { bookmark: matches[0]!, entry };
  }) : library.map((bookmark) => ({ bookmark, entry: undefined }));

  const evaluated = rows.map(({ bookmark, entry }) => ({
    bookmark, entry, label: entry?.label ?? bookmark.title, local: { ...siftBookmark(bookmark), bin: suggestBin(bookmark) },
  }));
  const bins = Object.fromEntries([...dispositions, 'archived'].map((name) => [
    name, evaluated.filter(({ local }) => local.disposition === name).length,
  ]));
  const routes = Object.fromEntries(handoffs.map((route) => [
    route, evaluated.filter(({ local }) => local.handoff === route).length,
  ]));
  const examples = Object.fromEntries(Object.keys(bins).map((name) => [
    name, evaluated.filter(({ local }) => local.disposition === name).slice(0, 4).map(({ label, local }) => ({ label, ...local })),
  ]));

  let pilot: {
    publicReady: number; publicSkipped: number; model: string; attempted: number; completed: number; inputTokens: number;
    reportedCostUsd: number | null; error?: string; results: unknown[]; bins: Record<string, number>; review: string[];
  } | undefined;
  if (values.jev || values['verify-public']) {
    const eligible = evaluated.filter(({ entry, bookmark }) => entry?.publicUrl && !bookmark.sessionProtected);
    const verified = await Promise.all(eligible.map(async (row) => ({
      row, state: await publicBookmarkState(row.bookmark.url, row.entry!.publicUrl!, readPage),
    })));
    const ready = verified.filter(({ state }) => state !== null);
    const token = process.env.TYPESAFE_API_KEY?.trim();
    pilot = {
      publicReady: ready.length, publicSkipped: evaluated.length - ready.length, model: JEV_MODEL,
      attempted: 0, completed: 0, inputTokens: 0, reportedCostUsd: null, results: [],
      bins: Object.fromEntries(dispositions.map((name) => [name, 0])), review: [],
    };
    if (values.jev && !token) pilot.error = 'TYPESAFE_API_KEY is required for the live pilot.';
    for (const { row, state } of verified) {
      if (!state) { pilot.results.push({ label: row.label, status: 'public verification failed' }); continue; }
      if (!values.jev || !token || pilot.error) {
        pilot.results.push({ label: row.label, status: 'verified public', state });
        continue;
      }
      try {
        pilot.attempted++;
        const result = await askJev(state, token);
        pilot.completed++;
        pilot.inputTokens += result.inputTokens;
        pilot.reportedCostUsd = jevCostUsd(pilot.inputTokens);
        const disagreement = (row.local.disposition !== 'archived' && result.disposition?.value !== row.local.disposition)
          || result.handoff?.value !== row.local.handoff;
        const needsReview = result.needsReview || disagreement;
        const bin = needsReview ? 'needs_review' : result.disposition!.value;
        pilot.bins[bin] = (pilot.bins[bin] ?? 0) + 1;
        if (needsReview) pilot.review.push(row.label);
        pilot.results.push({ label: row.label, local: row.local, ...result, disagreement });
      } catch (error) {
        pilot.error = error instanceof Error ? error.message : 'Jev request failed.';
        pilot.results.push({ label: row.label, status: 'model request failed' });
      }
    }
  }
  const report = {
    rulesVersion: BIN_RULES_VERSION, sampled: evaluated.length, bins, handoffs: routes, examples,
    suggestedBins: evaluated.reduce<Record<string,number>>((counts,{local})=>{
      counts[local.bin.name]=(counts[local.bin.name]??0)+1;return counts;
    },{}),
    ...(selected ? { sample: evaluated.map(({ label, bookmark, local }) => ({ label, appearances: bookmark.appearances, ...local })) } : {}),
    pilot,
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  if (values.out) await writeFile(values.out, json, { mode: 0o600, flag: 'wx' });
  console.log(json.trimEnd());
  return pilot?.error ? 1 : 0;
}

if (process.argv[1]?.endsWith('/sift/run.ts')) {
  try { process.exitCode = await runSift(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Sifting failed.'); process.exitCode = 1; }
}
