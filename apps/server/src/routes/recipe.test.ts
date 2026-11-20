import type { RecipeApproval, RecipeDraft, RecipeExport } from '@bukmark/shared';
import { normalizeUrl } from '@bukmark/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { runMigrations } from '../db/migrate.js';
import { importStore } from '../import/storeImport.js';
import { authCookie, authHeaders, SAME_ORIGIN } from '../test/auth.js';

const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_test';
const BASE = '/api/review/recipes';
const BOOKMARK = 'https://recipe.example.com/archived?utm_source=saved';
const PAGE = 'https://www.recipe.example.com/meal/';
const SOURCE_KEY = 'recipe:' + PAGE + '#card';
const date = '2026-10-01T00:00:00.000Z';

function fixture(overrides: object = {}) {
  const node = {
    '@type': 'Recipe', '@id': '#card', name: 'Whole grain breakfast',
    author: { name: 'Recipe Author' }, recipeYield: ['4'], prepTime: 'PT10M', cookTime: 'PT20M', totalTime: 'PT30M',
    recipeIngredient: ['1 cup grain, soaked overnight', '4 cups water', 'Pinch salt', 'Ingredients for 1 recipe above', '1 cup squash'],
    recipeInstructions: [
      { '@type': 'HowToStep', text: 'For the grain (base recipe): Drain the grain. Simmer for 30 minutes.' },
      { '@type': 'HowToStep', text: 'For the Squash &amp; Spice variation: Add squash while simmering.' },
    ],
    ...overrides,
  };
  return `<meta property="og:site_name" content="Example Kitchen">
    <script type="application/ld+json">${JSON.stringify({ '@graph': [node] })}</script>
    <div class="wprm-recipe-container" data-recipe-id="7"><div class="wprm-recipe-ingredients-container">
      <div class="wprm-recipe-ingredient-group">
        <h3 class="wprm-recipe-ingredient-group-name">Base</h3>
        <ul><li class="wprm-recipe-ingredient"><span class="wprm-checkbox-container">▢ </span>1 cup grain, soaked overnight</li>
        <li class="wprm-recipe-ingredient">4 cups water</li><li class="wprm-recipe-ingredient">Pinch salt</li></ul>
      </div><div class="wprm-recipe-ingredient-group">
        <h3 class="wprm-recipe-ingredient-group-name">Variation 1: Squash &amp; Spice</h3>
        <ul><li class="wprm-recipe-ingredient">Ingredients for 1 recipe above</li><li class="wprm-recipe-ingredient">1 cup squash</li></ul>
      </div>
    </div></div>`;
}

function approve(draft: RecipeDraft, fields = draft.fields): RecipeApproval {
  return { id: draft.id, revision: draft.revision, fields, selectedVariations: [], reviewedUnassigned: false };
}

describe('recipe review', () => {
  let app: FastifyInstance;
  let cookies: { bukmark_session: string };
  let token: Awaited<ReturnType<typeof authHeaders>>;
  let linkId: string;
  let html: string | null;

  beforeAll(async () => {
    await runMigrations(TEST_URL);
    app = await buildApp({
      databaseUrl: TEST_URL, checkUpdates: false, azuk: null, fetchOgImage: async () => null,
      recipePage: async () => ({ html, url: PAGE, status: html ? 200 : 503, error: null }),
    });
    return async () => { await app.close(); };
  });

  beforeEach(async () => {
    await app.db.execute(sql`TRUNCATE links, hubs, recipe_drafts, recipe_exports, owner, sessions, api_tokens CASCADE`);
    html = fixture();
    cookies = { bukmark_session: (await authCookie(app.db)).cookie };
    token = await authHeaders(app.db);
    const bookmark = normalizeUrl(BOOKMARK);
    if (!bookmark.ok) throw new Error('Fixture URL is invalid');
    await importStore(app.db, { version: 1, ingestedFiles: {}, links: {
      [bookmark.urlHash]: {
        title: 'Grain bookmark', url: bookmark.url, sources: ['onetab_import'], dupeCount: 2, groupHints: [],
        firstSeen: date, lastSeen: date,
        triage: { category: 'personal', keep: false, relevance: 1, explanation: 'Private note', triagedAt: date },
      },
    } });
    const response = await request('GET', BASE + '/candidates?q=Grain');
    expect(response.json().items[0].status).toBe('archived');
    linkId = response.json().items[0].id;
  });

  function request(method: 'GET' | 'POST', url: string, payload?: object, bearer = false) {
    return app.inject({ method, url, payload, ...(bearer ? { headers: token } : { cookies, headers: SAME_ORIGIN }) });
  }

  async function prepare() {
    const response = await request('POST', BASE + '/prepare', { linkId });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  async function download(id: string) {
    const file = await request('GET', BASE + '/exports/' + id);
    expect(file.headers['content-disposition']).toBe('attachment; filename="bukmark-recipe.json"');
    return file.json() as RecipeExport;
  }

  it('keeps the base separate, requires a timing decision, and reuses the approved export', async () => {
    const before = (await request('GET', '/api/links/' + linkId)).json();
    const { draft } = await prepare() as { draft: RecipeDraft };
    expect(draft).toMatchObject({
      key: SOURCE_KEY, timingConflict: { listedMinutes: 20, minimumMinutes: 30 },
      variations: [{ key: 'variation:squash & spice', title: 'Squash & Spice', ingredients: ['1 cup squash'],
        steps: ['Add squash while simmering.'] }],
    });
    expect((await request('POST', BASE + '/exports', approve(draft))).statusCode).toBe(400);
    const fields = { ...draft.fields, title: 'Reviewed breakfast', timing: {
      prepMinutes: 10, passive: [{ activity: 'Soak', durationText: 'overnight' }],
    } };
    const input = approve(draft, fields);
    expect((await request('POST', BASE + '/exports', input, true)).statusCode).toBe(403);
    const first = await request('POST', BASE + '/exports', input);
    expect(first.statusCode, first.body).toBe(200);
    const { id } = first.json();
    expect(await download(id)).toEqual({ schemaVersion: 1, recipes: [{
      key: SOURCE_KEY, title: 'Reviewed breakfast', source: { url: PAGE, authors: ['Recipe Author'], publisher: 'Example Kitchen' },
      ingredients: ['1 cup grain, soaked overnight', '4 cups water', 'Pinch salt'],
      steps: ['Drain the grain. Simmer for 30 minutes.'],
      yield: { servings: 4 }, timing: fields.timing,
    }] });
    expect((await request('POST', BASE + '/exports', input)).json()).toEqual({ id });
    const current = (await prepare()).draft as RecipeDraft;
    expect(current.fields).toEqual(fields);
    expect((await request('POST', BASE + '/exports', approve(current))).json()).toEqual({ id });
    expect((await request('GET', '/api/links/' + linkId)).json()).toEqual(before);
  });

  it('keeps owner edits and the prior file when source changes make a preview stale', async () => {
    const { draft } = await prepare() as { draft: RecipeDraft };
    const fields = { ...draft.fields, title: 'Owner title', timing: { prepMinutes: 10 } };
    const saved = await request('POST', BASE + '/exports', { ...approve(draft, fields), selectedVariations: ['variation:squash & spice'] });
    expect(saved.statusCode, saved.body).toBe(200);
    const old = await download(saved.json().id);
    expect(old.recipes[0]?.variations?.[0]?.title).toBe('Squash & Spice');

    const before = (await prepare()).draft as RecipeDraft;
    html = fixture({ recipeYield: '6 servings' });
    const next = (await prepare()).draft as RecipeDraft;
    expect(next.fields).toMatchObject({ title: 'Owner title', yield: { servings: 6 } });
    expect((await request('POST', BASE + '/exports', approve(before))).statusCode).toBe(409);
    expect(await download(saved.json().id)).toEqual(old);
  });

  it('reports bad source data without replacing an existing draft', async () => {
    const { draft } = await prepare();
    html = '<script type="application/ld+json">{"@type":</script>';
    expect(await prepare()).toEqual({ outcome: 'malformed' });
    html = null;
    expect(await prepare()).toEqual({ outcome: 'unavailable', error: null, status: 503 });
    expect((await request('GET', BASE + '/drafts?linkId=' + linkId)).json().items).toEqual([draft]);
  });

  it('asks which identified card to prepare and rejects cards without distinct identities', async () => {
    html = '<script type="application/ld+json">[{"@type":"Recipe","name":"Rice"},{"@type":"Recipe","name":"Beans"}]</script>';
    expect(await prepare()).toEqual({ outcome: 'ambiguous' });
    html = '<script type="application/ld+json">[{"@type":"Recipe","name":"Rice","@id":"#rice"},{"@type":"Recipe","name":"Beans","@id":"#beans"}]</script>';
    const { choices } = await prepare();
    expect(choices).toEqual([{ key: 'recipe:' + PAGE + '#rice', title: 'Rice' }, { key: 'recipe:' + PAGE + '#beans', title: 'Beans' }]);
    const selected = await request('POST', BASE + '/prepare', { linkId, key: choices[1].key });
    expect(selected.json()).toMatchObject({ outcome: 'prepared', draft: { key: choices[1].key, fields: { title: 'Beans' } } });
    expect((await request('GET', BASE + '/drafts')).json().items).toHaveLength(1);
  });
});
