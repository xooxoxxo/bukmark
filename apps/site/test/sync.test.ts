import { describe, expect, it } from 'vitest';
import { read, section, sourceFiles } from './source';

const flat = (text: string) => text.replace(/\s+/g, ' ');
const sync = read('apps/extension/src/lib/sync.ts');
const docs = flat(section(read('apps/site/src/content/docs/docs/extension.md'), 'Sync with your bookmarks'));
const constant = (src: string, name: string) => new RegExp(`const ${name} = '([^']+)'`).exec(src)?.[1];

describe('the bookmark sync docs match the extension and the HTML export', () => {
  it('names the folder and Unsorted as sync and the export both make them', () => {
    const netscape = read('apps/server/src/export/netscape.ts');
    const [folder, unsorted] = [constant(sync, 'SYNC_FOLDER'), constant(sync, 'UNSORTED')];
    expect(folder).toBeDefined();
    expect(unsorted).toBeDefined();
    // Importing an export gives the layout sync keeps.
    expect(constant(netscape, 'ROOT')).toBe(folder);
    expect(constant(netscape, 'UNSORTED')).toBe(unsorted);
    expect(docs).toContain(`keeps a **${folder}** folder in your browser's Other bookmarks`);
    expect(docs).toContain(`**${unsorted}** for links in none`);
    const html = read('apps/site/src/content/docs/docs/export.md').split('\n').find((l) => l.startsWith('| `html` |'));
    expect(html).toContain(`one **${folder}** folder`);
    expect(html).toContain(`**${unsorted}** for links in no hub`);
  });

  it('names the switch the options page shows, only where Import is offered', () => {
    const label = /<input id="syncToggle"[^>]*\/>\s*([^<]+?)\s*<\/label>/.exec(read('apps/extension/options.html'))?.[1];
    expect(label).toBeDefined();
    expect(docs).toContain(`check **${label}** while logged in`);
    // canImportBookmarks: false in Safari and Firefox for Android.
    expect(read('apps/extension/src/options/main.ts')).toContain('syncSectionEl.hidden = !importable;');
    expect(docs).toContain('Safari and Firefox for Android give extensions no bookmarks, so they have no sync.');
  });

  it('pulls as often as it says, and first a minute after it is turned on', () => {
    const minutes = /SYNC_PERIOD_MINUTES = (\d+);/.exec(sync)?.[1];
    expect(docs).toContain(`every ${minutes} minutes, when the browser starts, and after a save from the popup or the shortcut`);
    // The Firefox note: the first alarm restarts a background whose bookmark listeners came late.
    expect(sync).toContain('chrome.alarms.create(SYNC_ALARM, { delayInMinutes: 1, periodInMinutes: SYNC_PERIOD_MINUTES });');
    expect(docs).toContain('In Firefox, a change made in the folder in the first minute after you turn sync on can be missed');
  });

  it('archives instead of deleting, and leaves the folder when turned off', () => {
    const code = sourceFiles('apps/extension/src', ['.ts'])
      .filter((f) => !f.startsWith('apps/extension/src/test/'))
      .map(read)
      .join('\n');
    // No request the extension makes deletes a link or a hub.
    expect(read('apps/extension/src/lib/api.ts')).toContain("method: 'POST' | 'PATCH'");
    expect(code).not.toMatch(/'DELETE'|action: 'delete'/);
    expect(sync).toContain("await updateLink(auth, change.linkId, { status: 'archived' }, timeout());");
    expect(sync).toContain("await updateHub(auth, hub.id, { status: 'archived' }, timeout());");
    const turnOff = /async function turnOff\([^)]*\): Promise<void> \{\n([\s\S]*?)\n\}/.exec(sync)?.[1];
    expect(turnOff).toContain('state.queue = [];');
    expect(turnOff).not.toContain('chrome.bookmarks');
    expect(docs).toContain('**Deleting** never deletes anything on the server.');
    expect(docs).toContain('The folder stays as it is; changes not yet sent are dropped.');
  });

  it('turns off on logging out or changing the server', () => {
    const background = read('apps/extension/src/background/index.ts');
    expect(background).toContain("if ((area === 'local' && 'auth' in changes) || changesSettings(changes, area)) void checkSyncLogin();");
    expect(sync).toMatch(/export function checkSyncLogin\(\)[\s\S]*?if \(state\?\.enabled && !\(await syncAuth\(state\)\)\) await turnOff\(state\);/);
    expect(docs).toContain('Logging out or changing the server turns sync off too.');
  });
});
