import { describe, expect, it } from 'vitest';
import { docPages, read, section, sections, sourceFiles } from './source';

const api = read('apps/site/src/content/docs/docs/api.md');
const serverFiles = sourceFiles('apps/server/src', ['.ts']);

/** Where app.ts mounts each route file, and whether it sits outside the auth hook. */
const ROUTE_FILES = [
  { file: 'apps/server/src/app.ts', prefix: '', isPublic: true },
  { file: 'apps/server/src/auth/routes.ts', prefix: '/api/auth', isPublic: true },
  { file: 'apps/server/src/auth/authorizePage.ts', prefix: '', isPublic: true },
  { file: 'apps/server/src/auth/protectedRoutes.ts', prefix: '/api/auth', isPublic: false },
  { file: 'apps/server/src/routes/links.ts', prefix: '/api', isPublic: false },
  { file: 'apps/server/src/routes/hubs.ts', prefix: '/api', isPublic: false },
  { file: 'apps/server/src/routes/export.ts', prefix: '/api', isPublic: false },
];

interface Route {
  key: string;
  isPublic: boolean;
  handler: string;
}

function routesIn({ file, prefix, isPublic }: (typeof ROUTE_FILES)[number]): Route[] {
  const src = read(file);
  const calls = [...src.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)];
  return calls.map((m, i) => ({
    key: `${m[1]!.toUpperCase()} ${prefix}${m[2]}`,
    isPublic,
    handler: src.slice(m.index, calls[i + 1]?.index ?? src.length),
  }));
}

const routes = ROUTE_FILES.flatMap(routesIn);

/** `### GET /x` and `### GET /x, POST /x` headings, one entry per endpoint. */
const endpointSections = new Map(
  sections(api)
    .filter((s) => s.level === 3)
    .flatMap((s) => s.title.split(', ').map((endpoint) => [endpoint, s.body] as const)),
);

const quickReference = section(api, 'Quick Reference')
  .split('\n')
  .map((line) => /^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`([^`]+)`/.exec(line))
  .filter((m) => m !== null)
  .map((m) => `${m[1]} ${m[2]}`);

describe('API reference covers the routes the server registers', () => {
  it('knows where every file that registers routes is mounted', () => {
    const known = new Set(ROUTE_FILES.map((f) => f.file));
    const registering = serverFiles.filter((f) => /\b(app|api)\.(get|post|put|patch|delete|route)\(/.test(read(f)));
    expect(registering.filter((f) => !known.has(f))).toEqual([]);
    for (const f of ROUTE_FILES) expect(routesIn(f).length, f.file).toBeGreaterThan(0);
  });

  it('lists every route in the Quick Reference, and nothing else', () => {
    expect([...quickReference].sort()).toEqual(routes.map((r) => r.key).sort());
  });

  it('gives every route a section', () => {
    expect(routes.map((r) => r.key).filter((k) => !endpointSections.has(k))).toEqual([]);
  });

  it('lists exactly the routes outside the auth hook as public', () => {
    const listed = new Set(
      [...section(api, 'Public endpoints').matchAll(/`((?:GET|POST|PUT|PATCH|DELETE) \/[^`]*)`/g)].map((m) => m[1]!),
    );
    expect([...listed].sort()).toEqual(routes.filter((r) => r.isPublic).map((r) => r.key).sort());
  });

  it('warns about the Origin check and the rate limit wherever a handler applies them', () => {
    const gaps: string[] = [];
    for (const r of routes) {
      const doc = endpointSections.get(r.key) ?? '';
      if (r.handler.includes('checkOrigin(') && !doc.includes('Origin')) gaps.push(`${r.key}: Origin`);
      if (/rate_?limit/i.test(r.handler) && !doc.includes('429')) gaps.push(`${r.key}: 429`);
    }
    expect(gaps).toEqual([]);
  });
});

describe('API reference shows the bodies the server sends', () => {
  /** Whether some string literal in the server source reads `text`; template holes match anything. */
  function serverCanSay(text: string): boolean {
    for (const file of serverFiles) {
      const code = read(file).split('\n').filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n');
      for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
        const literal = m[2]!;
        if (literal === text) return true;
        if (m[1] === '`' && literal.includes('${')) {
          const pattern = literal.split(/\$\{[^}]*\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
          if (new RegExp(`^${pattern.join('.+')}$`).test(text)) return true;
        }
      }
    }
    return false;
  }

  // Fastify's own reason phrase for a body that fails schema validation.
  const FRAMEWORK_ERRORS = ['Bad Request'];

  it('shows only error messages the server can produce', () => {
    const documented = [...api.matchAll(/"error":\s*"([^"]+)"/g)].map((m) => m[1]!);
    expect(documented.filter((e) => !FRAMEWORK_ERRORS.includes(e) && !serverCanSay(e))).toEqual([]);
  });

  it('documents every error code the server sends, and no other', () => {
    const sent = new Set(serverFiles.flatMap((f) => [...read(f).matchAll(/\bcode:\s*'([a-z_]+)'/g)].map((m) => m[1]!)));
    const documented = new Set([...api.matchAll(/"code":\s*"([a-z_]+)"/g)].map((m) => m[1]!));
    expect([...sent].filter((c) => !documented.has(c))).toEqual([]);
    expect([...documented].filter((c) => !sent.has(c))).toEqual([]);
  });

  it('calls the Secure cookie attribute conditional when the server sets it conditionally', () => {
    const secure = serverFiles.flatMap((f) => [...read(f).matchAll(/\bsecure:\s*([^,\n}]+)/g)].map((m) => m[1]!.trim()));
    expect(secure.length).toBeGreaterThan(0);
    const bullet = section(api, 'Session cookies').split(/\n- /).find((b) => b.startsWith('`Secure`'));
    expect(bullet).toBeDefined();
    if (secure.some((v) => v !== 'true')) expect(bullet).toMatch(/only when/);
  });
});

describe('curl examples work against a server that requires auth', () => {
  const publicPaths = new Set(routes.filter((r) => r.isPublic).map((r) => r.key.split(' ')[1]));
  const commands = [...docPages(), { file: 'README.md', body: read('README.md') }].flatMap(({ file, body }) =>
    [...body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
      .flatMap((m) => m[1]!.replace(/\\\n\s*/g, ' ').split('\n'))
      .filter((line) => /\bcurl\b/.test(line))
      .map((cmd) => ({ file, cmd: cmd.trim() })),
  );

  it('sends a token to every protected endpoint', () => {
    const tokenless = commands.filter(({ cmd }) => {
      const path = /\/api\/[\w/:.-]*/.exec(cmd)?.[0];
      return path !== undefined && !publicPaths.has(path) && !cmd.includes('Authorization: Bearer ');
    });
    expect(tokenless).toEqual([]);
  });

  it('fails on an error status instead of saving the error body as the file', () => {
    const writesFile = (cmd: string) => /(^|\s)(-[a-zA-Z]*[oO][a-zA-Z]*|--output|--remote-name)(\s|$)/.test(cmd);
    const failsOnError = (cmd: string) => /(^|\s)(-[a-zA-Z]*f[a-zA-Z]*|--fail)(\s|$)/.test(cmd);
    expect(commands.filter(({ cmd }) => writesFile(cmd) && !failsOnError(cmd))).toEqual([]);
  });
});
