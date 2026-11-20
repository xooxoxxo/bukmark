import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { BuilderRecord } from '../builder/model.js';
import { approveBuilderExport } from '../builder/service.js';
import { runMigrations } from '../db/migrate.js';
import { builderDrafts } from '../db/schema.js';
import { authCookie, authHeaders, SAME_ORIGIN } from '../test/auth.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';
const BASE = '/api/review/builder';
const REPO = 'https://github.com/sample/tools';
const ISSUE = REPO + '/issues/120';
const NPM = 'https://www.npmjs.com/package/@sample/validators';
const REPO_KEY = 'github:42';
const ISSUE_KEY = 'github:42:issue:120';
const NPM_KEY = 'npm:@sample/validators';
const DISCUSSION = REPO + '/discussions/51';
const FILE = REPO + '/blob/feature/example/examples/app.ts#L1-L2';
const COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);
const REPO_META = '<meta name="octolytics-dimension-repository_id" content="42">'
  + '<meta name="octolytics-dimension-repository_nwo" content="sample/tools">'
  + '<meta name="octolytics-dimension-repository_public" content="true">';

function codePage(ref: string, commit: string, path = 'examples/app.ts') {
  return new Response(REPO_META + '<script data-target="react-app.embeddedData">' + JSON.stringify({ payload: {
    codeViewLayoutRoute: { path, repo: { id: 42, public: true, private: false } },
    codeViewBlobLayoutRoute: { path, refInfo: { name: ref, currentOid: commit }, blob: { viewable: true } },
    'codeViewBlobLayoutRoute.StyledBlob': { rawLines: ['first', 'second'] },
  } }) + '</script>');
}

interface Draft {
  id: string;
  revision: number;
  record: BuilderRecord;
  excluded: string[];
}

function approval({ id, revision, record, excluded }: Draft) {
  return {
    id, revision, synopsis: record.synopsis, tags: record.tags,
    contextKeys: record.context.filter(({ key }) => !excluded.includes(key)).map(({ key }) => key),
  };
}

function batchRecord(index: number): BuilderRecord {
  const repository = `sample/tools-${index}`;
  return {
    key: `github:${1000 + index}`, kind: 'repository', name: repository, repository,
    canonicalUrl: `https://github.com/${repository}`, synopsis: `Repository ${index}.`,
    language: 'TypeScript', tags: ['reference'], context: [],
  };
}

describe('builder review', () => {
  let app: FastifyInstance;
  let cookies: { bukmark_session: string };
  let token: Awaited<ReturnType<typeof authHeaders>>;
  let issueParent: string;
  let reads: string[];
  let branchCommit: string;
  let pinnedPath: string;

  beforeAll(async () => {
    await runMigrations(TEST_URL);
    app = await buildApp({
      databaseUrl: TEST_URL, checkUpdates: false, azuk: null, fetchOgImage: async () => null,
      builderFetch: async (input) => {
        const url = String(input);
        reads.push(url);
        if (url === 'https://api.github.com/repos/sample/tools') {
          return Response.json({
            id: 42, full_name: 'sample/tools', private: false, language: 'TypeScript',
            description: 'Reusable UI components.', topics: ['components'],
          });
        }
        if (url === 'https://api.github.com/repos/sample/tools/issues/120') {
          return Response.json({
            number: 120, repository_url: issueParent, state: 'closed', title: 'Fix a missing prop', labels: [{ name: 'stale' }],
          });
        }
        if (url === 'https://registry.npmjs.org/%40sample%2Fvalidators/latest') {
          return Response.json({
            name: '@sample/validators', source: 'src/index.ts', description: 'Schema adapters.',
            keywords: ['forms'], repository: { url: 'git+https://github.com/sample/validators.git' },
          });
        }
        if (url === DISCUSSION) {
          return new Response(REPO_META + `<link rel="canonical" href="${DISCUSSION}">`
            + '<meta property="og:title" content="Using the example · sample/tools · Discussion #51"><div id="discussion_bucket"></div>');
        }
        if (url === FILE.split('#')[0] || url === FILE) return codePage('feature/example', branchCommit);
        if (url === `${REPO}/blob/${COMMIT}/examples/app.ts`) return codePage(COMMIT, COMMIT, pinnedPath);
        if (url === `${REPO}/blob/${OTHER_COMMIT}/examples/app.ts`) return codePage(OTHER_COMMIT, OTHER_COMMIT);
        return new Response(null, { status: 404 });
      },
    });
    return async () => { await app.close(); };
  });

  beforeEach(async () => {
    await app.db.execute(sql`TRUNCATE links, hubs, builder_drafts, builder_exports, owner, sessions, api_tokens CASCADE`);
    cookies = { bukmark_session: (await authCookie(app.db)).cookie };
    token = await authHeaders(app.db);
    issueParent = 'https://api.github.com/repos/sample/tools';
    branchCommit = COMMIT;
    pinnedPath = 'examples/app.ts';
    reads = [];
  });

  function request(method: 'GET' | 'POST', url: string, payload?: object, bearer = false) {
    return app.inject({ method, url, payload, ...(bearer ? { headers: token } : { cookies, headers: SAME_ORIGIN }) });
  }

  async function save(url: string) {
    const res = await request('POST', '/api/links', { url, title: 'Saved bookmark', note: 'Private note' });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().link.id as string;
  }

  async function prepare(...linkIds: string[]) {
    const response = await request('POST', BASE + '/prepare', { linkIds });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().items;
  }

  async function drafts(query = ''): Promise<Draft[]> {
    const response = await request('GET', BASE + '/drafts' + query);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().items;
  }

  async function exportDrafts(rows: Draft[]) {
    const response = await request('POST', BASE + '/exports', { items: rows.map(approval) });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as { id: string; recordCount: number };
  }

  it('exports two records from three bookmarks and preserves their local review', async () => {
    const repoId = await save(REPO);
    const issueId = await save(ISSUE);
    const packageId = await save(NPM);
    expect((await request('POST', '/api/review/prepare', {})).statusCode).toBe(200);
    const localReview = (await request('GET', '/api/review')).json();
    const library = (await request('GET', '/api/links?sort=title')).json();
    const candidates = (await request('GET', BASE + '/candidates?q=sample')).json().items;
    expect(candidates.map(({ id }: { id: string }) => id)).toEqual(expect.arrayContaining([repoId, issueId, packageId]));

    await prepare(issueId);
    expect((await drafts()).map(({ record }) => record.key)).toEqual([REPO_KEY]);
    reads = [];
    const prepared = await prepare(repoId, issueId, packageId);
    expect(prepared.map(({ key }: { key: string }) => key)).toEqual([REPO_KEY, REPO_KEY, NPM_KEY]);
    expect(reads.filter((url) => url === issueParent)).toHaveLength(1);
    const rows = await drafts();
    expect(rows).toHaveLength(2);
    expect(await drafts('?linkId=' + issueId)).toEqual(rows.filter(({ record }) => record.key === REPO_KEY));
    const input = { items: rows.map(approval) };
    expect((await request('POST', BASE + '/exports', input, true)).statusCode).toBe(403);
    const receipt = await exportDrafts(rows);
    const file = await request('GET', BASE + '/exports/' + receipt.id);
    expect(file.headers['content-disposition']).toBe('attachment; filename="bukmark-builder.json"');
    expect(file.json()).toEqual({
      schemaVersion: 1,
      records: [
        {
          key: REPO_KEY, name: 'sample/tools', kind: 'repository', repository: 'sample/tools', canonicalUrl: REPO,
          synopsis: 'Reusable UI components.', language: 'TypeScript', tags: ['components'],
          context: [{ key: ISSUE_KEY, kind: 'issue', number: 120, title: 'Fix a missing prop', state: 'closed',
            url: ISSUE, note: 'GitHub labels this issue stale.' }],
        },
        {
          key: NPM_KEY, name: '@sample/validators', kind: 'package', ecosystem: 'npm', canonicalUrl: NPM,
          synopsis: 'Schema adapters.', language: 'TypeScript', tags: ['forms'], context: [],
          repositoryUrl: 'https://github.com/sample/validators',
        },
      ],
    });
    expect((await request('GET', BASE + '/exports/' + receipt.id, undefined, true)).statusCode).toBe(403);
    expect((await prepare(repoId, issueId, packageId)).map(({ outcome }: { outcome: string }) => outcome))
      .toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(await exportDrafts(await drafts())).toEqual(receipt);
    expect((await request('GET', '/api/review')).json()).toEqual(localReview);
    expect((await request('GET', '/api/links?sort=title')).json()).toEqual(library);
  });

  it('accepts a repository URL variant and rejects unverified sources and a mismatched issue parent', async () => {
    const variant = await save('https://www.github.com/Sample/Tools.git/?tab=readme');
    const issue = await save(ISSUE);
    const missing = await save('https://github.com/sample/missing');
    issueParent = 'https://api.github.com/repos/sample/another-repo';

    expect(await prepare(variant, issue, missing)).toEqual([
      { linkId: variant, outcome: 'prepared', key: REPO_KEY },
      { linkId: issue, outcome: 'unverified', reason: 'GitHub did not verify this issue under the repository.' },
      { linkId: missing, outcome: 'unverified', reason: 'The provider could not verify this public source.' },
    ]);
    expect((await drafts()).map(({ record }) => ({ key: record.key, context: record.context })))
      .toEqual([{ key: REPO_KEY, context: [] }]);
  });

  it('groups repository context and reuses the verified pin when the branch moves', async () => {
    const file = await save(FILE);
    const discussion = await save(DISCUSSION);
    expect((await request('GET', BASE + '/candidates?q=sample')).json().items).toHaveLength(2);
    branchCommit = OTHER_COMMIT;
    const pin = { linkId: file, ref: 'feature/example', commit: COMMIT };
    const response = await request('POST', BASE + '/prepare', { linkIds: [file, discussion], pins: [pin] });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().items.map(({ outcome }: { outcome: string }) => outcome)).toEqual(['prepared', 'prepared']);
    const staged = await drafts();
    expect(staged).toHaveLength(1);
    expect(staged[0]!.record.context).toEqual([
      { kind: 'code', entryType: 'file', key: `github:42:code:file:${COMMIT}:examples/app.ts`,
        commit: COMMIT, ref: 'feature/example', path: 'examples/app.ts', sourceUrl: FILE,
        url: `${REPO}/blob/${COMMIT}/examples/app.ts#L1-L2` },
      { kind: 'discussion', key: 'github:42:discussion:51', number: 51, title: 'Using the example', url: DISCUSSION, sourceUrl: DISCUSSION },
    ]);
    expect(await drafts('?linkId=' + file)).toEqual(staged);
    expect(await drafts('?linkId=' + discussion)).toEqual(staged);
    expect((await prepare(file, discussion)).map(({ outcome }: { outcome: string }) => outcome)).toEqual(['unchanged', 'unchanged']);
    const changed = await request('POST', BASE + '/prepare', { linkIds: [file], pins: [{ ...pin, commit: OTHER_COMMIT }] });
    expect(changed.json().items[0].outcome).toBe('unverified');
    expect(await drafts()).toEqual(staged);
    expect(await app.db.execute(sql`select count(*)::int as count from builder_exports`)).toMatchObject([{ count: 0 }]);

    const approved = await exportDrafts(staged);
    const snapshot = await request('GET', BASE + '/exports/' + approved.id);
    expect(snapshot.json()).toEqual({ schemaVersion: 2, records: staged.map(({ record }) => record) });
  });

  it('holds code when the pinned page identifies a different path', async () => {
    const file = await save(FILE);
    pinnedPath = 'examples/other.ts';
    expect((await prepare(file))[0].outcome).toBe('unverified');
    expect(await drafts()).toEqual([]);
  });

  it('reuses an existing 39-record export through normal HTTP approval with pinned context', async () => {
    const records = Array.from({ length: 39 }, (_, index) => batchRecord(index));
    const pinnedUrl = `${records[0]!.canonicalUrl}/blob/${COMMIT}/src/index.ts`;
    records[0]!.tags = ['historical-reference'];
    records[0]!.context = [{
      key: `github:1000:code:file:${COMMIT}:src/index.ts`, kind: 'code', entryType: 'file',
      path: 'src/index.ts', ref: 'main', commit: COMMIT, url: pinnedUrl,
      sourceUrl: records[0]!.canonicalUrl + '/blob/main/src/index.ts',
    }];
    const stored = await app.db.insert(builderDrafts).values(records.map((record) => ({ key: record.key, record }))).returning();
    const rows = stored.map((row) => ({ ...row, excluded: [] }));
    const existing = await approveBuilderExport(app.db, rows.map(approval));

    const first = await exportDrafts(rows);
    expect(first.recordCount).toBe(39);
    expect(existing).toEqual({ outcome: 'saved', id: first.id, recordCount: 39 });
    expect(await exportDrafts(rows)).toEqual(first);
    const snapshot = await request('GET', BASE + '/exports/' + first.id);
    expect(snapshot.json().records).toHaveLength(39);
    expect(snapshot.json().records.find((record: BuilderRecord) => record.key === 'github:1000')).toMatchObject({
      tags: ['historical-reference'], context: [{ commit: COMMIT, url: pinnedUrl }],
    });
    expect(await app.db.execute(sql`select count(*)::int as count from builder_exports`)).toEqual([{ count: 1 }]);
  });

  it.each([
    { count: 100, status: 200, exports: 1 },
    { count: 101, status: 400, exports: 0 },
  ])('returns $status for a batch of $count drafts', async ({ count, status, exports }) => {
    const records = Array.from({ length: count }, (_, index) => batchRecord(index));
    const stored = await app.db.insert(builderDrafts).values(records.map((record) => ({ key: record.key, record }))).returning();
    const response = await request('POST', BASE + '/exports', {
      items: stored.map((row) => approval({ ...row, excluded: [] })),
    });
    expect(response.statusCode).toBe(status);
    expect(await app.db.execute(sql`select count(*)::int as count from builder_exports`)).toEqual([{ count: exports }]);
  });

  it('rejects stale approval and preserves approved edits across preparation and later exports', async () => {
    const repository = await save(REPO);
    const issue = await save(ISSUE);
    const pkg = await save(NPM);
    await prepare(repository, pkg);
    const before = await drafts();
    const oldRepo = before.find(({ record }) => record.key === REPO_KEY)!;
    const oldPackage = before.find(({ record }) => record.key === NPM_KEY)!;
    await prepare(issue);
    const rows = await drafts();
    const repo = rows.find(({ record }) => record.key === REPO_KEY)!;
    const stale = await request('POST', BASE + '/exports', {
      items: [{ ...approval(oldPackage), synopsis: 'Do not save this edit' }, approval(oldRepo)],
    });
    expect(stale.statusCode).toBe(409);
    expect(await drafts()).toEqual(rows);

    const selected = rows.map(approval);
    const approvedRepo = selected.find(({ id }) => id === repo.id)!;
    approvedRepo.synopsis = 'Owner synopsis';
    approvedRepo.tags = ['owner-tag'];
    approvedRepo.contextKeys = [];
    const response = await request('POST', BASE + '/exports', { items: selected });
    expect(response.statusCode, response.body).toBe(200);
    const firstPath = BASE + '/exports/' + response.json().id;
    const file = await request('GET', firstPath);
    expect(file.json().records[0]).toMatchObject({ synopsis: 'Owner synopsis', tags: ['owner-tag'], context: [] });
    await prepare(issue, pkg);
    const current = (await drafts()).find(({ id }) => id === repo.id)!;
    expect(current.record).toMatchObject({ synopsis: 'Owner synopsis', tags: ['owner-tag'] });
    expect(current.excluded).toEqual([ISSUE_KEY]);

    const updated = await exportDrafts([{ ...current, excluded: [] }]);
    const download = await request('GET', BASE + '/exports/' + updated.id);
    expect(download.json().records[0].context).toMatchObject([{ number: 120 }]);
    expect((await request('GET', firstPath)).body).toBe(file.body);
  });
});
