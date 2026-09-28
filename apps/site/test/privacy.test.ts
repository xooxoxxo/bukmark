import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { read, root, section, sourceFiles } from './source';

const privacy = read('apps/site/src/content/docs/docs/privacy.md');
const flat = (text: string) => text.replace(/\s+/g, ' ');

interface Manifest {
  permissions: string[];
  optional_permissions?: string[];
  host_permissions: string[];
  optional_host_permissions: string[];
  content_scripts?: unknown;
  browser_specific_settings?: {
    gecko?: { data_collection_permissions: { required: string[]; optional?: string[] } };
  };
}

// The manifests the build writes, from the function that writes them. Loaded by
// path at run time: a static import would make `astro check` type-check the
// extension, which needs the chrome types this package does not have.
const { manifestFor, TARGETS } = (await import(join(root, 'apps/extension/src/manifest.ts'))) as {
  manifestFor: (target: string) => Manifest;
  TARGETS: readonly string[];
};
const manifests = TARGETS.map((t) => manifestFor(t));

/** The extension's shipped code: every source file but the tests and their helpers in src/test. */
const extensionCode = sourceFiles('apps/extension/src', ['.ts'])
  .filter((f) => !f.startsWith('apps/extension/src/test/'))
  .map(read)
  .join('\n');

describe('the privacy page matches what the extension asks for and does', () => {
  it('lists exactly the permissions and host patterns the manifests declare', () => {
    const rows = section(privacy, 'Permissions')
      .split('\n')
      .filter((line) => /^\|\s*`/.test(line))
      .map((line) => line.split('|')[1]!);
    const listed = rows.flatMap((cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!));
    const declared = new Set(
      manifests.flatMap((m) => [
        ...m.permissions, ...(m.optional_permissions ?? []), ...m.host_permissions, ...m.optional_host_permissions,
      ]),
    );
    expect(listed.sort()).toEqual([...declared].sort());
  });

  it('calls optional only the host patterns that are optional', () => {
    const rows = section(privacy, 'Permissions').split('\n').filter((line) => /^\|\s*`/.test(line));
    for (const m of manifests) {
      for (const pattern of m.optional_host_permissions) {
        expect(rows.find((r) => r.split('|')[1]!.includes(`\`${pattern}\``))).toMatch(/Optional, and not granted at install/);
      }
      for (const pattern of m.host_permissions) {
        expect(rows.find((r) => r.split('|')[1]!.includes(`\`${pattern}\``))).not.toMatch(/Optional/);
      }
    }
  });

  it('says it has no content scripts, and no manifest declares any', () => {
    for (const m of manifests) {
      expect(m.content_scripts).toBeUndefined();
      expect(m.permissions).not.toContain('scripting');
      expect(m.permissions).not.toContain('webRequest');
    }
    expect(section(privacy, 'What it never does')).toContain('It has no content scripts');
  });

  it('contacts only the server a login or token belongs to', () => {
    // Every fetch builds its URL from the server it was given, never a fixed host.
    const fetches = [...extensionCode.matchAll(/\bfetch\(([^,)]*)/g)].map((m) => m[1]!.trim());
    expect(fetches.length).toBeGreaterThan(0);
    expect(fetches.filter((arg) => !/^`\$\{(?:auth\.server|server)\}/.test(arg))).toEqual([]);
    expect(section(privacy, 'The browser extension')).toMatch(/it contacts no other address/);
  });

  it('sends the page address with the popup check, as a query the server logs', () => {
    expect(read('apps/extension/src/lib/api.ts')).toContain('`/api/links/lookup?url=${encodeURIComponent(url)}`');
    expect(read('apps/extension/src/popup/main.ts')).toMatch(/lookupLink\(auth, tab\.url\)/);
    expect(privacy).toContain('`GET /api/links/lookup`');
    const redact = read('apps/server/src/app.ts');
    expect(redact).toContain("'req.headers.authorization'");
    expect(redact).toContain("'req.headers.cookie'");
    expect(flat(section(privacy, 'Logs'))).toContain("For the popup's check, that address includes the page's address. Tokens and cookies are left out.");
  });

  it('names every storage area the extension uses, and no other', () => {
    const used = new Set([...extensionCode.matchAll(/chrome\.storage\.(sync|local|session)\b/g)].map((m) => m[1]!));
    const named = new Set(
      [...section(privacy, 'What it keeps in your browser').matchAll(/`storage\.(\w+)`/g)].map((m) => m[1]!),
    );
    expect([...named].sort()).toEqual([...used].sort());
    // The token lives in local storage, the server address in sync.
    expect(read('apps/extension/src/lib/auth.ts')).toContain("chrome.storage.local.set({ auth })");
    expect(read('apps/extension/src/lib/settings.ts')).toContain('chrome.storage.sync');
  });

  it('reads bookmarks only on Import, and never writes them', () => {
    const calls = [...extensionCode.matchAll(/chrome\.bookmarks\.(\w+)\(/g)].map((m) => m[1]!);
    expect(calls).toEqual(['getTree']);
    const options = read('apps/extension/src/options/main.ts');
    const onImport = options.slice(options.indexOf("importEl.addEventListener('click'"));
    expect(onImport).toContain('chrome.bookmarks.getTree()');
    expect(onImport).toContain('runBackfill(');
    expect(flat(privacy)).toContain('Bookmarks are read at no other time, and never changed.');
    // Optional: asked for in the Import click, not granted at install.
    for (const m of manifests.filter((m) => m.optional_permissions?.includes('bookmarks'))) {
      expect(m.permissions).not.toContain('bookmarks');
    }
    expect(onImport.indexOf('allowBookmarkImport()')).toBeGreaterThan(-1);
    expect(onImport.indexOf('allowBookmarkImport()')).toBeLessThan(onImport.indexOf('await loadSettings()'));
    expect(flat(section(privacy, 'Permissions'))).toContain('`bookmarks` | Optional, and not granted at install.');
  });

  it('describes in words each kind of data the Firefox build declares', () => {
    const gecko = manifestFor('firefox').browser_specific_settings?.gecko?.data_collection_permissions;
    const declared = [...(gecko?.required ?? []), ...(gecko?.optional ?? [])];
    // Mozilla's data types, and the words the page uses for each.
    const words: Record<string, RegExp> = {
      browsingActivity: /sends that page's address/,
      websiteContent: /sends the page's address and\s+title/,
      bookmarksInfo: /every bookmark whose\s+address starts with/,
    };
    expect(declared.length).toBeGreaterThan(0);
    for (const type of declared) {
      expect(words[type], `no wording for ${type}; describe it on the privacy page`).toBeDefined();
      expect(section(privacy, 'What it sends, and when')).toMatch(words[type]!);
    }
  });
});

describe('the privacy page matches what the server does', () => {
  const checkLinks = read('apps/server/src/og/checkLinks.ts');
  const reading = flat(section(privacy, 'Reading saved pages'));

  it('names the switch that turns background page checks off, which is on by default', () => {
    expect(read('apps/server/src/config.ts')).toContain("checkPages: process.env.BUKMARK_CHECK_PAGES !== 'false'");
    expect(reading).toContain('`BUKMARK_CHECK_PAGES=false`');
  });

  it('gives the rate and the re-check interval the server uses', () => {
    const days = /RECHECK_DAYS = (\d+);/.exec(checkLinks)?.[1];
    const every = /intervalMs = 60_000, batch = (\d+)/.exec(checkLinks)?.[1];
    expect(days).toBeDefined();
    expect(every).toBeDefined();
    expect(reading).toContain(`about ${every} a minute, and again every ${days} days`);
  });

  it('says a save still fetches the page for its preview image with checks off', () => {
    // addLink fetches the og:image on every save; nothing there reads the switch.
    const addLink = read('apps/server/src/links/addLink.ts');
    expect(addLink).toContain('await fetchOgImage(url)');
    expect(addLink).not.toMatch(/checkPages|BUKMARK_CHECK_PAGES/);
    expect(reading).toContain('When you save a page, the server fetches the top of it once, to find its preview image.');
    expect(reading).toMatch(/`BUKMARK_CHECK_PAGES=false` stops the background checks[^.]*\. The server then fetches pages only when asked: when you save one, for its preview image/);
  });

  it('says only public addresses are fetched, by a client that names itself', () => {
    const fetchHead = read('apps/server/src/og/fetchHead.ts');
    expect(fetchHead).toMatch(/if \(host !== 'public'\)/);
    expect(/const UA = '([^']+)'/.exec(fetchHead)?.[1]).toMatch(/bukmark/);
    expect(reading).toContain('It fetches only public addresses.');
    expect(reading).toContain('which names itself as bukmark');
  });

  it('names the session cookie and how long a sign-in lasts', () => {
    const sessions = read('apps/server/src/auth/sessions.ts');
    const cookie = /SESSION_COOKIE = '([^']+)'/.exec(sessions)?.[1];
    const days = /maxAge: (\d+) \* 24 \* 60 \* 60/.exec(sessions)?.[1];
    expect(flat(section(privacy, 'The web app'))).toContain(`one cookie, \`${cookie}\`, for ${days} days`);
  });

  it('stores passwords, tokens and sessions only as hashes, with a short token prefix', () => {
    const schema = read('apps/server/src/db/schema.ts');
    const table = (name: string) => new RegExp(`pgTable\\('${name}', \\{([\\s\\S]*?)\\n\\}`).exec(schema)?.[1] ?? '';
    const columns = (name: string) => [...table(name).matchAll(/^\s+(\w+): /gm)].map((m) => m[1]!);
    expect(columns('api_tokens')).toContain('tokenHash');
    expect(columns('api_tokens')).not.toContain('token');
    expect(columns('sessions')).toContain('idHash');
    expect(columns('owner')).toContain('passwordHash');
    expect(read('apps/server/src/auth/tokens.ts')).toContain('const prefix = token.slice(0, 12);');
    expect(flat(section(privacy, 'Your bukmark server'))).toContain(
      'Your password, access tokens and sign-in sessions are stored only as hashes. The first 12 characters of each token are kept too',
    );
  });

  it('says a deleted link leaves only a SHA-256 hash of its address', () => {
    const links = read('apps/server/src/routes/links.ts');
    const remove = links.slice(links.indexOf("if (action === 'delete')"));
    expect(remove).toContain('.insert(deletedHashes)');
    expect(remove).toContain('tx.delete(links)');
    expect(read('packages/shared/src/normalize.ts')).toContain("createHash('sha256')");
    expect(flat(section(privacy, 'Deleting your data'))).toContain('keeps only a SHA-256 hash of its address');
  });

  it('deletes everything with the volume the compose file declares', () => {
    const compose = read('docker-compose.yml');
    expect(compose).toMatch(/volumes: \[pgdata:\/var\/lib\/postgresql\/data\]/);
    expect(compose).toMatch(/^volumes:\n\s+pgdata:/m);
    expect(section(privacy, 'Deleting your data')).toContain('`docker compose down -v`');
  });
});

describe('the privacy page names every outside service the site and the web app load', () => {
  /** Hosts a stylesheet imports, or a page links or loads a script from. */
  function loadedHosts(files: string[]): Set<string> {
    const hosts = new Set<string>();
    for (const file of files) {
      const src = read(file);
      for (const m of src.matchAll(/@import url\(['"]?https:\/\/([^/'")]+)/g)) hosts.add(m[1]!);
      for (const m of src.matchAll(/<link\b[^>]*href="https:\/\/([^/"]+)/g)) hosts.add(m[1]!);
      for (const m of src.matchAll(/<script\b[^>]*src="https:\/\/([^/"]+)/g)) hosts.add(m[1]!);
    }
    return hosts;
  }

  it('names each host this website loads from, and its host', () => {
    const hosts = loadedHosts([
      ...sourceFiles('apps/site/src', ['.css', '.astro', '.mjs', '.ts']),
      'apps/site/astro.config.mjs',
    ]);
    expect(hosts.size).toBeGreaterThan(0);
    const website = section(privacy, 'This website');
    for (const host of hosts) expect(website).toContain(`\`${host}\``);
    expect(read('apps/site/package.json')).toContain('wrangler pages deploy');
    expect(website).toContain('**Cloudflare Pages** hosts it');
  });

  it('names each host the web app loads from', () => {
    const hosts = loadedHosts([...sourceFiles('apps/web/src', ['.css', '.tsx', '.ts']), 'apps/web/index.html']);
    expect(hosts.size).toBeGreaterThan(0);
    const webApp = section(privacy, 'The web app');
    for (const host of hosts) expect(webApp).toContain(`\`${host}\``);
    for (const file of ['apps/web/src/components/LinkCard.tsx', 'apps/web/src/components/LinkRow.tsx']) {
      expect(read(file)).toContain('referrerPolicy="no-referrer"');
    }
  });

  it('keeps the theme choice in local storage under the key the landing page reads', () => {
    expect(read('apps/site/src/pages/index.astro')).toContain("localStorage.getItem('starlight-theme')");
    expect(section(privacy, 'This website')).toMatch(/light or dark theme in your browser's\s+local storage/);
  });
});

describe('the privacy page is linked and reachable', () => {
  it('gives the issue tracker of the repository the site links to as the contact', () => {
    const repo = /icon: 'github', label: 'GitHub', href: '([^']+)'/.exec(read('apps/site/astro.config.mjs'))?.[1];
    expect(repo).toBeDefined();
    expect(section(privacy, 'Changes and contact')).toContain(`](${repo}/issues)`);
  });

  it('is linked from the extension page, the docs index and the landing footer', () => {
    expect(read('apps/site/src/content/docs/docs/extension.md')).toContain('](/docs/privacy/)');
    expect(read('apps/site/src/content/docs/docs/index.md')).toContain('](/docs/privacy)');
    const footer = /<footer class="site-footer">([\s\S]*?)<\/footer>/.exec(read('apps/site/src/pages/index.astro'))?.[1];
    expect(footer).toContain('href="/docs/privacy/"');
  });
});
