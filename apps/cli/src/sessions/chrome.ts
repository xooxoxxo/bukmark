import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeSessionArchive } from './archive.js';
import { ChromeSessionError, readChromeSession } from './chrome-session.js';

const SESSION_FILE = /^Session_[0-9]+$/;
const WINDOWS_EPOCH_MICROS = 11_644_473_600_000_000n;

function fileTimestamp(file: string): string | null {
  const millis = (BigInt(file.slice('Session_'.length)) - WINDOWS_EPOCH_MICROS) / 1000n;
  const date = new Date(Number(millis));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function captureChrome(sessionsDir: string, outPath: string, profile: string | null = null) {
  const files = readdirSync(sessionsDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && SESSION_FILE.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  if (files.length === 0) throw new Error('No Session_* files found in the copied Chrome Sessions directory.');

  const records: object[] = [];
  const sessions: { file: string; id: string; fileCreatedAt: string | null; windows: number; partialReason: string | null }[] = [];
  const skippedFiles: { file: string; reason: string }[] = [];
  const partialFiles: { file: string; reason: string }[] = [];
  const report = { sessions: 0, windows: 0, groups: 0, tabs: 0, missingUrls: 0, partialWindows: 0, skippedFiles, partialFiles };
  for (const file of files) {
    const data = readFileSync(join(sessionsDir, file));
    let decoded;
    try {
      decoded = readChromeSession(data);
    } catch (error) {
      if (!(error instanceof ChromeSessionError)) throw error;
      skippedFiles.push({ file, reason: error.message });
      continue;
    }
    const { windows, partialReason } = decoded;
    if (partialReason) partialFiles.push({ file, reason: partialReason });
    const id = createHash('sha256').update(file).update('\0').update(data).digest('hex');
    const session = { file, id, fileCreatedAt: fileTimestamp(file), windows: windows.length, partialReason };
    sessions.push(session);
    for (const [position, window] of windows.entries()) {
      const snapshotId = `chrome:${id}:${window.id}`;
      const counts = {
        missingUrls: window.tabs.filter(tab => tab.url === null).length,
        missingPositions: window.tabs.filter(tab => tab.position === null).length,
        navigationFallbacks: window.tabs.filter(tab => tab.navigation === 'fallback').length,
        missingGroupMetadata: window.groups.filter(group => group.name === null).length,
      };
      const partial = partialReason !== null || counts.missingPositions > 0 || counts.missingGroupMetadata > 0;
      records.push({
        type: 'snapshot', id: snapshotId, name: window.name ?? `Window ${position + 1}`,
        profile: { id: null, name: profile }, sessionId: id, position,
        windowType: window.type, groups: window.groups, tabCount: window.tabs.length, counts, partial,
      });
      for (const tab of window.tabs) {
        records.push({ type: 'tab', ...tab, snapshotId, id: `${snapshotId}:${tab.id}` });
      }
      report.windows++;
      report.groups += window.groups.length;
      report.tabs += window.tabs.length;
      report.missingUrls += counts.missingUrls;
      report.partialWindows += Number(partial);
    }
  }
  if (sessions.length === 0) {
    throw new Error(`No readable Chrome sessions. ${skippedFiles.map(({ file, reason }) => `${file}: ${reason}`).join('; ')}`);
  }

  report.sessions = sessions.length;
  const sourceId = createHash('sha256').update(sessions.map(session => session.id).join('\n')).digest('hex');
  writeSessionArchive(outPath, [
    { type: 'archive', format: 'bukmark-sessions', version: 1, source: 'chrome-sessions', sourceId, sessions, skippedFiles },
    ...records,
  ]);
  return report;
}
