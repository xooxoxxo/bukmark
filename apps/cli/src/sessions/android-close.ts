import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { parseArgs, isDeepStrictEqual } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { sha256Hex } from '@bukmark/shared';
import { connectAndroidUsb, readAndroidTargets, type AndroidTarget } from './android-transport.js';
import { inspectSessions } from './inspect.js';
import { verifySessionItems } from './selection-command.js';

const stateOf = (targets: AndroidTarget[]) => new Map(targets.map(row => [row.id, [row.type, sha256Hex(row.url)]]));
const loaded = (targets: AndroidTarget[]) => stateOf(targets.filter(row => row.type === 'tab'));

export async function closeVerifiedAndroid(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    destination: { type: 'string' }, adb: { type: 'string' }, log: { type: 'string' },
    preview: { type: 'boolean' }, apply: { type: 'boolean' }, 'confirm-no-incognito': { type: 'boolean' },
  } });
  if (positionals.length !== 1 || !values.destination || !values['confirm-no-incognito']
    || Boolean(values.preview) === Boolean(values.apply) || (values.apply && !values.log)) {
    throw new Error('Choose one Android archive, --destination, --preview or --apply, and --confirm-no-incognito. Apply also needs --log.');
  }
  const archive = positionals[0]!;
  const contents = readFileSync(archive, 'utf8');
  let header;
  try { header = JSON.parse(contents.split('\n', 1)[0]!); }
  catch { throw new Error('Invalid Android archive header.'); }
  if (header?.source !== 'android-chrome-usb' || !/^[a-f0-9]{64}$/.test(header.deviceFingerprint ?? '')) {
    throw new Error('Cleanup requires an Android USB archive with its handset fingerprint.');
  }
  const token = process.env.BUKMARK_TOKEN;
  if (!token) throw new Error('Set BUKMARK_TOKEN before verifying the import.');
  const inspection = inspectSessions([archive], []);
  if (!inspection.items.length) throw new Error('The archive contains no importable tab occurrences.');
  const receipts = await verifySessionItems(values.destination, token, inspection.items);
  const verified = new Map(receipts.map(row => [row.occurrenceId, row.urlHash]));
  if (inspection.snapshots.length !== 1 || verified.size !== receipts.length) {
    throw new Error('Cleanup requires one snapshot with unique tab IDs.');
  }

  const phone = connectAndroidUsb(values.adb);
  let file: number | undefined;
  function record(event: object) {
    if (file === undefined) throw new Error('The cleanup log is not open.');
    writeSync(file, JSON.stringify({ ...event, at: new Date().toISOString() }) + '\n');
    fsyncSync(file);
  }
  try {
    if (phone.fingerprint !== header.deviceFingerprint) throw new Error('The connected phone differs from the archive.');
    const version = await phone.json('/json/version') as { 'Android-Package'?: string };
    if (version?.['Android-Package'] !== 'com.android.chrome') throw new Error('The connection is not Android Chrome.');
    // Only this build's unloaded-tab close behavior has been validated on USB.
    if (values.apply && (version as { Browser?: string }).Browser !== 'Chrome/157.0.8103.48') {
      throw new Error('Cleanup has not been validated for this Chrome build. Preview is still available.');
    }
    phone.assertSwitcher();
    let targets = readAndroidTargets(await phone.json('/json/list?for_tab'));
    const anchor = loaded(targets);
    if (!anchor.size) throw new Error('Could not identify a loaded tab to preserve.');
    const keepUrls = new Set(targets.filter(row => row.type === 'tab').map(row => sha256Hex(row.url)));
    const candidates = targets.filter(row => /^\d+$/.test(row.id) && row.type === 'page'
      && verified.get(row.id) === sha256Hex(row.url) && !keepUrls.has(sha256Hex(row.url)));
    console.log(`${candidates.length} current tabs exactly match saved occurrences; ${anchor.size} loaded targets are preserved.`);
    if (values.preview) return 0;

    const log = values.log!;
    const identity = { archiveHash: sha256Hex(contents), destination: new URL(values.destination).origin,
      phoneFingerprint: phone.fingerprint };
    const previous = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { throw new Error('The cleanup log is incomplete.'); }
    }) : [];
    if (previous.length && !isDeepStrictEqual(previous[0].identity, identity)) {
      throw new Error('The cleanup log belongs to a different archive, destination or handset.');
    }
    const closed = new Set(previous.filter(row => row.event === 'closed').map(row => row.id));
    if (targets.some(row => closed.has(row.id))) throw new Error('A previously closed tab ID has reappeared.');
    file = openSync(log, previous.length ? 'a' : 'wx', 0o600);
    if (!previous.length) record({ event: 'start', identity });
    let count = 0;
    for (const candidate of candidates) {
      if (count % 25 === 0) phone.assertSwitcher();
      const current = readAndroidTargets(await phone.json('/json/list?for_tab'));
      if (!isDeepStrictEqual(stateOf(current), stateOf(targets)) || !isDeepStrictEqual(loaded(current), anchor)) {
        throw new Error('Chrome tabs changed outside the verified cleanup.');
      }
      record({ event: 'close-requested', id: candidate.id, urlHash: verified.get(candidate.id) });
      await phone.close(candidate.id);
      const expected = stateOf(current.filter(row => row.id !== candidate.id));
      let after: AndroidTarget[] = [];
      for (let attempt = 0; attempt < 12; attempt++) {
        after = readAndroidTargets(await phone.json('/json/list?for_tab'));
        if (!after.some(row => row.id === candidate.id)) break;
        await setTimeout(100);
      }
      if (!isDeepStrictEqual(stateOf(after), expected) || !isDeepStrictEqual(loaded(after), anchor)) {
        throw new Error('Chrome state changed unexpectedly after the close request. Check the cleanup log.');
      }
      targets = after;
      count++;
      record({ event: 'closed', id: candidate.id, urlHash: verified.get(candidate.id) });
      if (count % 100 === 0) console.log(`${count} tab closures verified.`);
    }
    phone.assertSwitcher();
    // Closing a tab can schedule later model changes. Reconcile again after
    // checking the switcher, before recording a successful completion.
    for (let pass = 0; pass < 3; pass++) {
      await setTimeout(250);
      const settled = readAndroidTargets(await phone.json('/json/list?for_tab'));
      if (!isDeepStrictEqual(stateOf(settled), stateOf(targets)) || !isDeepStrictEqual(loaded(settled), anchor)) {
        throw new Error('Chrome tabs changed during the final check. Check the cleanup log before retrying.');
      }
    }
    record({ event: 'complete', closed: count, remainingTargets: targets.length });
    console.log(`${count} exact imported tabs closed and verified.`);
    return 0;
  } catch (error) {
    if (file !== undefined) record({ event: 'stopped', reason: 'cleanup-did-not-complete' });
    throw error;
  } finally {
    if (file !== undefined) closeSync(file);
    phone.disconnect();
  }
}
