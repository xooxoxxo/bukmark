import type { KnowledgeDraft, KnowledgeEvidenceAction, KnowledgeExport, KnowledgeFields } from '@bukmark/shared/review';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { runMigrations } from '../db/migrate.js';
import { authCookie, authHeaders, SAME_ORIGIN } from '../test/auth.js';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';
const BASE = '/api/review/notes';
const WIKI = 'https://en.wikipedia.org';
const PAGE = WIKI + '/wiki/Fixture_grid';
const PIN = WIKI + '/wiki/Special:PermanentLink/123456';
const OTHER_PIN = WIKI + '/wiki/Special:PermanentLink/654321';
const EXCERPT = 'The local network can operate independently.';
const fields: KnowledgeFields = {
  title: 'Local grids can run independently', bodyMarkdown: 'A **local grid** can operate on its own.\n',
  whyItMatters: 'Compare the loads a backup system can support.', tags: ['energy'], includeExcerpt: true,
};

function article(revision: number, url: string, text: string) {
  return `<html><head><link rel="canonical" href="${url}"><script>RLCONF={"wgRevisionId":${revision}};</script>
    <link rel="license" href="https://creativecommons.org/licenses/by-sa/4.0/deed.en"></head>
    <body><h1>Fixture grid</h1><main><div id="mw-content-text"><div class="mw-parser-output"><p>${text}</p></div></div></main></body></html>`;
}

describe('knowledge notes', () => {
  let app: FastifyInstance;
  let cookies: { bukmark_session: string };
  let token: Awaited<ReturnType<typeof authHeaders>>;
  let linkId: string;
  let live: string | null;

  beforeAll(async () => {
    await runMigrations(DB);
    app = await buildApp({
      databaseUrl: DB, azuk: null, checkUpdates: false, fetchOgImage: async () => null,
      knowledgePage: async (url) => {
        if (url === PIN) return { status: 200, error: null, url: WIKI + '/w/index.php?title=Fixture_grid&oldid=123456', html: article(123456, PAGE, EXCERPT) };
        if (url === OTHER_PIN) return { status: 200, error: null, url, html: article(654321, WIKI + '/wiki/Other_grid', EXCERPT) };
        return { status: live ? 200 : 503, error: null, url, html: live };
      },
    });
    return async () => { await app.close(); };
  });

  beforeEach(async () => {
    await app.db.execute(sql`TRUNCATE links, hubs, knowledge_notes, knowledge_exports, owner, sessions, api_tokens CASCADE`);
    live = article(123456, PAGE, EXCERPT);
    cookies = { bukmark_session: (await authCookie(app.db)).cookie };
    token = await authHeaders(app.db);
    const response = await request('POST', '/api/links', { url: PAGE, title: 'Grid bookmark', hub: 'Energy', note: 'Private annotation' });
    expect(response.statusCode, response.body).toBe(200);
    linkId = response.json().link.id;
  });

  function request(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, bearer = false) {
    return app.inject({ method, url, payload, ...(bearer ? { headers: token } : { headers: SAME_ORIGIN, cookies }) });
  }

  async function draft() {
    const result = await request('POST', BASE + '/drafts', { linkId });
    expect(result.statusCode, result.body).toBe(200);
    return result.json().draft as KnowledgeDraft;
  }

  async function act(row: KnowledgeDraft, action: KnowledgeEvidenceAction) {
    return request('POST', BASE + '/evidence', { id: row.id, revision: row.revision, ...action });
  }

  async function attach(row: KnowledgeDraft) {
    const result = await act(row, { mode: 'page', excerpt: EXCERPT, locator: 'Lead', versionUrl: PIN });
    expect(result.statusCode, result.body).toBe(200);
    return result.json().draft as KnowledgeDraft;
  }

  async function save(row: KnowledgeDraft, value = fields) {
    const result = await request('PATCH', BASE + '/drafts/' + row.id, { revision: row.revision, fields: value });
    expect(result.statusCode, result.body).toBe(200);
    return result.json().draft as KnowledgeDraft;
  }

  function approve(row: KnowledgeDraft, bearer = false) {
    return request('POST', BASE + '/exports', { id: row.id, revision: row.revision }, bearer);
  }

  async function download(id: string) {
    const result = await request('GET', BASE + '/exports/' + id);
    expect(result.headers['content-disposition']).toBe('attachment; filename="bukmark-note.json"');
    return result.json() as KnowledgeExport;
  }

  it('exports the exact verified citation and reuses one snapshot across simultaneous approvals', async () => {
    const before = (await request('GET', '/api/links/' + linkId)).json();
    const started = await draft();
    expect((await draft()).id).toBe(started.id);
    const wrong = await act(started, { mode: 'page', excerpt: EXCERPT, versionUrl: OTHER_PIN });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().outcome).toBe('version');

    const row = await save(await attach(started));
    expect((await approve(row, true)).statusCode).toBe(403);
    const replies = await Promise.all([approve(row), approve(row)]);
    expect(replies.map(({ statusCode }) => statusCode)).toEqual([200, 200]);
    const { id } = replies[0]!.json();
    expect(replies[1]!.json()).toEqual({ outcome: 'saved', id });
    expect(await download(id)).toEqual({ schemaVersion: 1, notes: [{
      key: 'note:' + row.id, revision: 1, title: fields.title, bodyMarkdown: fields.bodyMarkdown,
      whyItMatters: fields.whyItMatters, tags: ['energy'], sources: [{
        title: 'Fixture grid', url: PAGE, publisher: 'Wikipedia', attribution: 'Wikipedia contributors',
        versionUrl: PIN, locator: 'Lead', observedOn: new Date().toISOString().slice(0, 10),
        excerpt: EXCERPT, licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      }],
    }] });
    expect((await request('GET', '/api/links/' + linkId)).json()).toEqual(before);
  });

  it('requires a decision when the live page loses the cited passage', async () => {
    const row = await save(await attach(await draft()));
    live = article(123457, PAGE, 'A later edition removed the definition.');
    const reread = await act(row, { mode: 'read' });
    const changed = reread.json().draft as KnowledgeDraft;
    expect(changed.sourceChanged).toBe(true);
    expect((await approve(row)).json().outcome).toBe('changed');
    expect((await approve(changed)).json().outcome).toBe('evidence-changed');
    const retained = (await act(changed, { mode: 'keep' })).json().draft as KnowledgeDraft;
    expect(retained.sourceChanged).toBe(false);
    expect((await act(retained, { mode: 'read' })).json().draft.revision).toBe(retained.revision);
    const result = await approve(retained);
    expect(result.statusCode, result.body).toBe(200);
    expect((await download(result.json().id)).notes[0]?.sources[0]?.versionUrl).toBe(PIN);
  });

  it('keeps the approved note and older export after an edit and bookmark deletion', async () => {
    const first = await save(await attach(await draft()));
    const original = (await approve(first)).json().id;
    const oldFile = await download(original);
    const next = await save(first, { ...fields, title: 'Updated note', includeExcerpt: false });
    const updated = (await approve(next)).json().id;
    expect(updated).not.toBe(original);
    expect((await request('POST', '/api/links/bulk', { ids: [linkId], action: 'delete' })).json().affected).toBe(1);
    expect((await request('GET', BASE + '/drafts')).json().items[0]).toMatchObject({ id: first.id, linkId: null, latestExportId: updated });
    expect((await approve(first)).json().id).toBe(original);
    expect(await download(original)).toEqual(oldFile);
    const latest = (await download(updated)).notes[0]!;
    expect(latest).toMatchObject({ key: oldFile.notes[0]?.key, revision: 2, title: 'Updated note' });
    expect(latest.sources[0]).not.toHaveProperty('excerpt');
  });

  it('uses a saved quote when the page is unavailable and excludes the quote annotation', async () => {
    live = null;
    const note = await draft();
    expect((await act(note, { mode: 'read' })).json().outcome).toBe('unavailable');
    expect((await approve(note)).json().outcome).toBe('incomplete');
    const result = await request('POST', '/api/quotes', { url: PAGE, text: EXCERPT, title: 'Saved source', note: 'Quote annotation' });
    const quote = result.json().quote;
    const cited = (await act(note, { mode: 'quote', quoteId: quote.id, excerpt: EXCERPT })).json().draft as KnowledgeDraft;
    expect(cited.evidence?.kind).toBe('quote');
    const row = await save(cited);
    const exported = await approve(row);
    expect(exported.statusCode, exported.body).toBe(200);
    expect((await download(exported.json().id)).notes[0]?.sources).toEqual([{
      url: PAGE, title: 'Saved source', observedOn: quote.createdAt.slice(0, 10), excerpt: EXCERPT,
    }]);
  });
});
