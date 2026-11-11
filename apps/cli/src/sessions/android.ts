import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeSessionArchive } from './archive.js';
import { connectAndroidUsb } from './android-transport.js';

function parseMetadata(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Chrome tab metadata is not valid JSON.');
  }
}

function writeAndroidArchive(source: Buffer, outPath: string, deviceFingerprint?: string) {
  const probe = parseMetadata(source.toString('utf8'));
  if (typeof probe !== 'object' || probe === null || !('version' in probe) || probe.version !== 1
    || !('browser' in probe) || typeof probe.browser !== 'string' || !/^Chrome\/[\d.]+$/.test(probe.browser)
    || !('pages' in probe) || !Array.isArray(probe.pages)) {
    throw new Error('Expected a Chrome Android USB probe with version 1.');
  }

  const hash = createHash('sha256').update(source);
  if (deviceFingerprint) hash.update('\0').update(deviceFingerprint);
  const sourceId = hash.digest('hex');
  const snapshotId = `android-chrome-usb:${sourceId}`;
  const ids = new Set<string>();
  const tabs = probe.pages.map((entry: unknown, index: number) => {
    if (typeof entry !== 'object' || entry === null || !('id' in entry) || typeof entry.id !== 'string'
      || !entry.id || entry.id.length > 512 || entry.id.includes('\0') || ids.has(entry.id)) {
      throw new Error(`Invalid or duplicate Chrome target ID at probe entry ${index + 1}.`);
    }
    ids.add(entry.id);
    return {
      type: 'tab', snapshotId, id: entry.id,
      url: 'url' in entry && typeof entry.url === 'string' ? entry.url : null,
      title: 'title' in entry && typeof entry.title === 'string' ? entry.title : null,
      position: null, groupId: null,
    };
  });
  if (!tabs.length) throw new Error('The Chrome Android USB probe contains no page entries.');

  writeSessionArchive(outPath, [
    { type: 'archive', format: 'bukmark-sessions', version: 1, source: 'android-chrome-usb', sourceId,
      browser: probe.browser, ...(deviceFingerprint && { deviceFingerprint }) },
    { type: 'snapshot', id: snapshotId, name: 'Android Chrome USB capture', tabCount: tabs.length,
      partial: true, coverage: { groups: 'unknown', positions: 'unknown', inactive: 'unverified' } },
    ...tabs,
  ]);
  return { tabs: tabs.length };
}

export function captureAndroidProbe(probePath: string, outPath: string) {
  return writeAndroidArchive(readFileSync(probePath), outPath);
}

export async function captureAndroidUsb(outPath: string, adb = 'adb') {
  const phone = connectAndroidUsb(adb);
  let source: Buffer;
  try {
    const version = await phone.json('/json/version');
    if (typeof version !== 'object' || version === null || !('Browser' in version)
      || ('Android-Package' in version && version['Android-Package'] !== 'com.android.chrome')) {
      throw new Error('This USB connection did not return Android Chrome’s version.');
    }
    const targets = await phone.json('/json/list');
    if (!Array.isArray(targets)) throw new Error('Chrome did not return a list of page entries.');
    const pages = targets.filter(target => target?.type === 'page').map(({ id, title, url }) => ({ id, title, url }));
    source = Buffer.from(JSON.stringify({ version: 1, browser: version.Browser, pages }));
  } finally {
    phone.disconnect();
  }
  return writeAndroidArchive(source, outPath, phone.fingerprint);
}
