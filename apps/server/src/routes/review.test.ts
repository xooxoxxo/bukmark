import { normalizeUrl, type LinkRecord, type Store } from '@bukmark/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { runMigrations } from '../db/migrate.js';
import { importStore } from '../import/storeImport.js';
import type { ReviewDecision } from '../review/service.js';
import type { ReviewDraft } from '../review/model.js';
import { authCookie, authHeaders, SAME_ORIGIN } from '../test/auth.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';
const BATCH = [
  ['Git host', 'https://github.com/', 1],
  ['Component kit', 'https://github.com/example-sample/ui', 1],
  ['Select issue', 'https://github.com/example-sample/ui/issues/120', 1],
  ['Form validators', 'https://npmjs.com/package/@example-sample/validators', 1],
  ['Language defaults', 'https://example.org/docs/destructuring', 4],
  ['Runtime 18 upgrade', 'https://example.org/guides/upgrade-18', 2],
  ['Microgrid overview', 'https://example.org/energy/microgrid', 2],
  ['Whole grain breakfast', 'https://example.org/recipes/porridge', 2],
  ['MIDI controller', 'https://amazon.de/Controller/dp/B000000001/ref=example?tag=example', 1],
  ['Sync software downloads', 'https://example.org/downloads/', 1],
  ['Learning homepage', 'https://example.edu/', 5],
  ['Mail inbox', 'https://mail.google.com/mail/u/0/', 11],
] as const;

function fixtureStore(): Store {
  const date = '2026-07-21T00:00:00.000Z';
  const records = BATCH.map(([title, input, dupeCount]): [string, LinkRecord] => {
    const normalized = normalizeUrl(input);
    if (!normalized.ok) throw new Error('Invalid fixture URL');
    return [normalized.urlHash, {
      title, url: normalized.url, sources: ['onetab_import'], dupeCount, groupHints: [],
      firstSeen: date, lastSeen: date,
      ...(title === 'Component kit' ? { triage: {
        category: 'UI', keep: true, relevance: 3, explanation: 'Original note', triagedAt: date,
      } } : {}),
    }];
  });
  return { version: 1, links: Object.fromEntries(records), ingestedFiles: {} };
}

interface Row {
  id: string;
  revision: number;
  sourceVersion: string;
  link: { id: string; title: string };
  draft: ReviewDraft;
}

describe('bookmark review', () => {
  let app: FastifyInstance;
  let token: Awaited<ReturnType<typeof authHeaders>>;
  let cookies: { bukmark_session: string };

  beforeAll(async () => {
    await runMigrations(TEST_URL);
    app = await buildApp({ databaseUrl: TEST_URL, fetchOgImage: async () => null });
    return async () => { await app.close(); };
  });

  beforeEach(async () => {
    await app.db.execute(sql`TRUNCATE links, hubs, owner, sessions, api_tokens CASCADE`);
    token = await authHeaders(app.db);
    cookies = { bukmark_session: (await authCookie(app.db)).cookie };
    await importStore(app.db, fixtureStore());
  });

  async function request(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, assistant = false) {
    return app.inject({ method, url, payload, ...(assistant ? { headers: token } : { cookies, headers: SAME_ORIGIN }) });
  }

  async function queue(state = 'pending'): Promise<Row[]> {
    const response = await request('GET', `/api/review?state=${state}`);
    expect(response.statusCode).toBe(200);
    return response.json().items;
  }

  function decision(row: Row, value: ReviewDecision['decision'], draft?: ReviewDraft): ReviewDecision {
    return { id: row.id, revision: row.revision, sourceVersion: row.sourceVersion, decision: value, draft };
  }

  async function prepare() {
    const response = await request('POST', '/api/review/prepare', {});
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(12);
    return queue();
  }

  async function propose(row: Row, draft: ReviewDraft, reason: string) {
    const res = await request('POST', '/api/review/proposals', { items: [{
      linkId: row.link.id, sourceVersion: row.sourceVersion, draft, reason,
    }] }, true);
    expect(res.statusCode).toBe(200);
    return res.json().items[0].outcome;
  }

  it('prepares all 12 links, including filed links, without changing the library', async () => {
    const before = (await request('GET', '/api/links?sort=title')).json();
    const rows = await prepare();
    expect(rows).toHaveLength(12);
    expect(rows).toContainEqual(expect.objectContaining({ link: expect.objectContaining({ title: 'Component kit', note: 'Original note' }) }));
    expect(rows).toContainEqual(expect.objectContaining({
      link: expect.objectContaining({ title: 'Mail inbox' }),
      draft: { action: 'archive' }, oneTab: true, dupeCount: 11,
    }));
    expect(rows).toContainEqual(expect.objectContaining({
      link: expect.objectContaining({ title: 'MIDI controller' }),
      draft: { action: 'product' }, listingUrl: 'https://www.amazon.de/dp/B000000001',
    }));
    expect(rows).toContainEqual(expect.objectContaining({
      link: expect.objectContaining({ title: 'Learning homepage' }),
      draft: { action: 'undecided' }, dupeCount: 5,
    }));
    const next = await request('POST', '/api/review/prepare', {});
    expect(next.json()).toEqual({ items: [] });
    expect((await request('GET', '/api/links?sort=title')).json()).toEqual(before);
  });

  it('accepts assistant drafts but reserves decisions for the owner session', async () => {
    const rows = await prepare();
    const component = rows.find((row) => row.link.title === 'Component kit')!;
    const evidence = await request('GET', `/api/review/candidates?linkId=${component.link.id}`, undefined, true);
    expect(evidence.json().items).toEqual([expect.objectContaining({
      id: component.link.id, sourceVersion: component.sourceVersion, note: 'Original note',
      quotes: [], pageExcerpt: null,
    })]);
    expect(await propose(component, { action: 'reference' }, 'Reference for UI components.')).toBe('prepared');
    const updated = (await queue()).find((row) => row.id === component.id)!;
    const response = await request('POST', '/api/review/decisions', { items: [decision(updated, 'approve')] }, true);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('owner_session_required');
    expect((await queue()).find((row) => row.id === component.id)).toEqual(updated);
  });

  it('preserves deferred and dismissed decisions across equivalent drafts and resumes a deferred draft', async () => {
    const rows = await prepare();
    const product = rows.find((row) => row.draft.action === 'product')!;
    const home = rows.find((row) => row.link.title === 'Git host')!;
    const saved = await request('POST', '/api/review/decisions', {
      items: [decision(product, 'defer'), decision(home, 'dismiss')],
    });
    expect(saved.json().items).toEqual([
      { id: product.id, outcome: 'saved' }, { id: home.id, outcome: 'saved' },
    ]);
    expect(await propose(product, product.draft, 'Rephrased product evidence.')).toBe('unchanged');
    expect(await propose(home, home.draft, 'Rephrased homepage evidence.')).toBe('unchanged');
    const [deferred] = await queue('deferred');
    expect(deferred).toMatchObject({ id: product.id, status: 'deferred', revision: product.revision + 1 });
    expect(await queue('decided')).toMatchObject([{ id: home.id, status: 'dismissed' }]);
    await request('POST', '/api/review/decisions', { items: [decision(deferred!, 'resume')] });
    expect(await queue('deferred')).toEqual([]);
    expect(await queue()).toContainEqual(expect.objectContaining({ id: product.id, status: 'pending' }));
  });

  it('applies only complete current decisions and keeps the original link note and hubs', async () => {
    const rows = await prepare();
    const component = rows.find((row) => row.link.title === 'Component kit')!;
    const inbox = rows.find((row) => row.link.title === 'Mail inbox')!;
    const upgrade = rows.find((row) => row.link.title === 'Runtime 18 upgrade')!;
    const downloads = rows.find((row) => row.link.title === 'Sync software downloads')!;
    expect(await propose(inbox, { action: 'reference' }, 'Keep it as an inbox shortcut.')).toBe('prepared');
    await request('PATCH', `/api/links/${downloads.link.id}`, { note: 'Changed after review' });
    const nextStep: ReviewDraft = { action: 'next_step', hub: 'App', nextStep: 'Check the current component.' };
    const result = await request('POST', '/api/review/decisions', { items: [
      decision(component, 'approve', nextStep),
      decision(inbox, 'approve'),
      decision(upgrade, 'approve', { action: 'next_step', nextStep: 'Check the current runtime.' }),
      decision(downloads, 'approve', { action: 'archive' }),
    ] });
    expect(result.json().items).toEqual([
      { id: component.id, outcome: 'saved' }, { id: inbox.id, outcome: 'changed' },
      { id: upgrade.id, outcome: 'incomplete' }, { id: downloads.id, outcome: 'changed' },
    ]);
    const link = (await request('GET', `/api/links/${component.link.id}`)).json();
    expect(link).toMatchObject({ status: 'active', note: 'Original note\n\nNext step for App\nCheck the current component.' });
    expect(link.hubIds).toHaveLength(2);
    expect(await queue('decided')).toMatchObject([{ id: component.id, draft: nextStep }]);
  });

  it('archives only the approved link and restores it through the existing link action', async () => {
    const [inbox] = (await prepare()).filter((row) => row.link.title === 'Mail inbox');
    await request('POST', '/api/review/decisions', { items: [decision(inbox!, 'approve')] });
    expect((await request('GET', '/api/links?status=archived')).json().items).toMatchObject([{ id: inbox!.link.id }]);
    await request('POST', '/api/links/bulk', { ids: [inbox!.link.id], action: 'activate' });
    expect((await request('GET', '/api/links')).json().total).toBe(12);
  });
});
