import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { docPages, read, section } from './source';

const phone = read('apps/site/src/content/docs/docs/phone.md');
const install = read('apps/site/src/content/docs/docs/install.md');
const extension = read('apps/site/src/content/docs/docs/extension.md');
const api = read('apps/site/src/content/docs/docs/api.md');
const webManifest = JSON.parse(read('apps/web/public/manifest.webmanifest')) as {
  share_target: { action: string; method: string; params: Record<string, string> };
};

describe('phone capture docs match what the web app and server ship', () => {
  it('sends the Share sheet to the page the web app manifest names', () => {
    const { action, method, params } = webManifest.share_target;
    expect(method).toBe('GET');
    expect(Object.values(params).sort()).toEqual(['text', 'title', 'url']);
    expect(read('apps/web/src/App.tsx')).toContain(`<Route path="${action.slice(1)}" element={<SavePage />}`);
    expect(section(phone, 'The save page')).toContain(`\`https://<your-server>${action}?url=…&title=…\``);
  });

  it('has Android users pick Install, not Create shortcut', () => {
    // A home-screen shortcut gets nothing that needs an installed app, the
    // share target included (web.dev/learn/pwa/installation).
    const android = section(phone, 'Android share sheet');
    expect(android).toMatch(/offers \*\*Install\*\* and\s+\*\*Create shortcut\*\*, pick \*\*Install\*\*/);
    expect(android).toMatch(/a shortcut doesn't appear in the\s+Share sheet/);
  });

  it('builds the iOS Shortcut on an endpoint that takes a token and the fields it sends', () => {
    const shortcut = section(phone, 'iOS Shortcut');
    const links = read('apps/server/src/routes/links.ts');
    expect(links).toContain("app.post('/links'");
    expect(shortcut).toContain('`https://<your-server>/api/links`');
    expect(shortcut).toContain('**Method:** `POST`');
    expect(shortcut).toContain('`Authorization` with the value `Bearer <your-token>`');
    const body = /app\.post\('\/links',[\s\S]*?body: Type\.Object\(\{([\s\S]*?)\}\),/.exec(links)?.[1] ?? '';
    const accepted = [...body.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]!);
    expect(accepted).toContain('url');
    const named = [...shortcut.matchAll(/text field `(\w+)`|`(\w+)`(?=[,\s]*(?:—|`\w+`))/g)].map((m) => m[1] ?? m[2]!);
    expect(named.length).toBeGreaterThan(1);
    expect(named.filter((f) => !accepted.includes(f))).toEqual([]);
  });

  it('marks the Shortcut header step as untested on a device', () => {
    expect(section(phone, 'iOS Shortcut')).toMatch(/:::caution\[[^\]]*header step[^\]]*device test\]/);
  });

  it('warns that a shared Shortcut shares its token, which can create more tokens', () => {
    // Creating a token asks only that the caller is signed in, so a bearer token will do.
    const route = /app\.post\('\/tokens',[\s\S]*?\n {2}\}\);/.exec(read('apps/server/src/auth/protectedRoutes.ts'))?.[0];
    expect(route).toBeDefined();
    expect(route).not.toMatch(/authOf\(|req\.auth\b/);
    const caution = /:::caution\[Don't share this shortcut\]\n([\s\S]*?)\n:::/.exec(section(phone, 'iOS Shortcut'))?.[1];
    expect(caution).toBeDefined();
    expect(caution).toMatch(/iCloud link\s+or AirDrop/);
    expect(caution).toMatch(/create more tokens/);
    expect(caution).toMatch(/revoke that token under \*\*Settings → Access tokens\*\*, along with any token\s+there you don't recognise/);
  });

  it('says only the Share sheet and the bookmarklet stop at the save page', () => {
    // Both open /save; the Shortcut posts to /api/links and saves at once.
    expect(webManifest.share_target.action).toBe('/save');
    expect(read('apps/web/src/save/bookmarklet.ts')).toContain('/save?url=');
    expect(section(phone, 'iOS Shortcut')).toMatch(/saves it straight away,\s+with no form to confirm/);
    const savePage = section(phone, 'The save page');
    expect(savePage).not.toMatch(/all of the above/i);
    expect(savePage).toContain('`/save`');
    const entries = savePage.slice(0, savePage.indexOf('`/save`'));
    expect(entries).toMatch(/Share sheet and the bookmarklet/);
    expect(entries).not.toMatch(/Shortcut/);
    expect(savePage).toMatch(/iOS Shortcut\s+skips this page/);
  });

  it('points to the bookmarklet where the web app shows it', () => {
    const tokensPage = read('apps/web/src/pages/TokensPage.tsx');
    const bookmarklet = section(phone, 'Bookmarklet');
    expect(tokensPage).toContain('<h3>Bookmarklet</h3>');
    const label = /\*\*(Save to bukmark)\*\* link/.exec(bookmarklet)?.[1];
    expect(label).toBeDefined();
    expect(tokensPage).toMatch(new RegExp(`>\\s*${label}\\s*</a>`));
    expect(bookmarklet).toContain('**Settings → Access tokens**');
  });

  it('tells you to log out on a borrowed computer, for as long as a sign-in lasts', () => {
    const sessions = read('apps/server/src/auth/sessions.ts');
    const lifetimes = new Set(
      [...sessions.matchAll(/interval '(\d+) days'|maxAge: (\d+) \* 24 \* 60 \* 60/g)].map((m) => m[1] ?? m[2]!),
    );
    expect(lifetimes.size).toBe(1);
    const bookmarklet = section(phone, 'Bookmarklet');
    expect(bookmarklet).toMatch(/computer that isn't yours, log out/);
    expect(bookmarklet).toContain('**Settings → Log out**');
    expect(bookmarklet).toMatch(new RegExp(`sign-in lasts\\s+${[...lifetimes][0]}\\s+days`));
  });
});

describe('install docs say what needs HTTPS', () => {
  const https = section(install, 'HTTPS');

  it('says the web app installs only over HTTPS, since the web app ships a manifest', () => {
    expect(read('apps/web/index.html')).toContain('rel="manifest"');
    expect(https).toMatch(/install[\s\S]*only from an `https:\/\/` address/);
    expect(https).toMatch(/cannot be installed/);
    expect(section(phone, 'Android share sheet')).toMatch(/needs\s+HTTPS/);
  });

  it('says the session cookie is Secure only over HTTPS, as the server sets it', () => {
    expect(read('apps/server/src/auth/sessions.ts')).toContain("secure: req.protocol === 'https'");
    expect(https).toMatch(/`Secure` only when\s+the request arrived over HTTPS/);
  });
});

describe('reverse-proxy docs keep the tab login code out of access logs', () => {
  const authorizePage = read('apps/server/src/auth/authorizePage.ts');
  const done = /AUTHORIZE_DONE_PATH = '([^']+)'/.exec(authorizePage)?.[1];
  const proxy = section(install, 'Behind a reverse proxy');

  it('names the path a tab login lands on, which the server logs without its query', () => {
    expect(done).toBe('/authorize/done');
    expect(authorizePage).toContain('url: AUTHORIZE_DONE_PATH,');
    expect(proxy).toContain(`\`${done}?code=…&state=…\``);
    expect(section(api, `GET ${done}`)).toContain('](/docs/install/#behind-a-reverse-proxy)');
  });

  it('turns the nginx access log off for that path and proxies it like every other', () => {
    const nginx = [...proxy.matchAll(/```nginx\n([\s\S]*?)```/g)].map((m) => m[1]!).join('\n');
    const block = (match: string) =>
      (new RegExp(`^location ${match} \\{\\n([^}]*)\\}`, 'm').exec(nginx)?.[1] ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const rest = block('/');
    expect(rest).toContain('proxy_set_header Host $host;');
    expect(block(`= ${done}`)).toEqual(['access_log off;', ...rest]);
  });

  it('names what skips that path in Caddy and Traefik', () => {
    expect(proxy).toContain(`\`log_skip ${done}\``);
    expect(proxy).toContain('`observability.accessLogs: false`');
  });
});

describe('extension docs match how the server treats extensions', () => {
  it('needs no CORS step, because the extension asks for host access to any server', () => {
    const manifest = read('apps/extension/src/manifest.ts');
    expect(manifest).toContain("optional_host_permissions: ['http://*/*', 'https://*/*']");
    expect(read('apps/extension/src/lib/permissions.ts')).toContain('chrome.permissions.request({ origins: [pattern] })');
    const corsSteps = docPages().filter(({ body }) => /CORS_ORIGINS=\S*-extension:/.test(body));
    expect(corsSteps.map((p) => p.file)).toEqual([]);
  });

  it('names the variable and the official Firefox hash the server knows', () => {
    const unrecognised = section(extension, 'Unrecognised extension');
    expect(read('apps/server/src/config.ts')).toContain('process.env.BUKMARK_EXTENSION_IDS');
    expect(unrecognised).toContain('`BUKMARK_EXTENSION_IDS`');
    const addonId = /FIREFOX_ADDON_ID = '([^']+)'/.exec(read('apps/extension/src/manifest.ts'))?.[1];
    expect(addonId).toBeDefined();
    // Firefox's redirect host: lowercase hex SHA-1 of the add-on ID.
    const hash = createHash('sha1').update(addonId!, 'utf8').digest('hex');
    expect(unrecognised).toContain(`\`${hash}\``);
    expect(read('apps/server/src/auth/authorizePage.ts')).toContain(`FIREFOX_ADDON_ID = '${addonId}'`);
  });
});
