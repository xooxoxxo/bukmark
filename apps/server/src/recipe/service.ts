import { createHash } from 'node:crypto';
import type { RecipeApproval, RecipeDraft, RecipeDraftData, RecipeExport, RecipeFields } from '@bukmark/shared/review';
import { and, desc, eq, exists } from 'drizzle-orm';
import { canonicalJson } from '../canonicalJson.js';
import type { Db } from '../db/client.js';
import { links, recipeDrafts, recipeDraftSources, recipeExports } from '../db/schema.js';
import type { PageFetch } from '../og/fetchHead.js';
import { extractRecipes } from './extract.js';

const PAGE_SIZE = 25;
type Page = { linkId?: string; offset?: number };
export type RecipeEdits = Partial<{ [Key in keyof RecipeFields]: RecipeFields[Key] | null }>;
export type RecipeReader = (url: string) => Promise<PageFetch>;

function draftPreview(row: typeof recipeDrafts.$inferSelect): RecipeDraft {
  const { id, revision, data, edits, selectedVariations, reviewedUnassigned } = row;
  const fields = Object.fromEntries(Object.entries({ ...data.fields, ...edits }).filter(([, value]) => value != null)) as unknown as RecipeFields;
  return { ...data, id, revision, fields, reviewedUnassigned,
    selectedVariations: selectedVariations.filter((key) => data.variations.some((variant) => variant.key === key)) };
}

export async function listRecipeDrafts(db: Db, { linkId, offset = 0 }: Page) {
  const rows = await db.select().from(recipeDrafts)
    .where(linkId ? exists(db.select({ id: recipeDraftSources.linkId }).from(recipeDraftSources)
      .where(and(eq(recipeDraftSources.draftId, recipeDrafts.id), eq(recipeDraftSources.linkId, linkId)))) : undefined)
    .orderBy(desc(recipeDrafts.updatedAt), desc(recipeDrafts.id)).limit(PAGE_SIZE + 1).offset(offset);
  return { items: rows.slice(0, PAGE_SIZE).map(draftPreview), more: rows.length > PAGE_SIZE };
}

async function saveRecipe(db: Db, source: { id: string; url: string }, data: RecipeDraftData) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ url: links.url }).from(links).where(eq(links.id, source.id)).for('update');
    if (current?.url !== source.url) return { outcome: 'changed' as const };
    const [created] = await tx.insert(recipeDrafts).values({ key: data.key, data })
      .onConflictDoNothing({ target: recipeDrafts.key }).returning();
    let row = created ?? (await tx.select().from(recipeDrafts).where(eq(recipeDrafts.key, data.key)).for('update'))[0]!;
    if (!created && canonicalJson(row.data) !== canonicalJson(data)) {
      const reviewedUnassigned = row.reviewedUnassigned && canonicalJson(row.data.unassigned) === canonicalJson(data.unassigned);
      const [updated] = await tx.update(recipeDrafts).set({ data, reviewedUnassigned, revision: row.revision + 1, updatedAt: new Date() })
        .where(eq(recipeDrafts.id, row.id)).returning();
      row = updated!;
    }
    await tx.insert(recipeDraftSources).values({ draftId: row.id, linkId: source.id }).onConflictDoNothing();
    return { outcome: 'prepared' as const, draft: draftPreview(row) };
  });
}

export async function prepareRecipe(db: Db, linkId: string, key: string | undefined, readPage: RecipeReader) {
  const [link] = await db.select({ id: links.id, url: links.url }).from(links).where(eq(links.id, linkId));
  if (!link) return { outcome: 'missing' as const };
  const page = await readPage(link.url);
  if (!page.html) return { outcome: 'unavailable' as const, error: page.error, status: page.status };
  const result = extractRecipes(page.html, page.url);
  if (result.kind !== 'recipes') return { outcome: result.kind };
  const selected = key ? result.items.find((item) => item.key === key) : result.items.length === 1 ? result.items[0] : undefined;
  if (!selected) return { outcome: 'choose' as const, choices: result.items.map(({ key, fields }) => ({ key, title: fields.title })) };
  return saveRecipe(db, link, selected);
}

function fingerprint(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function diffFields(previous: RecipeFields, fields: RecipeFields, edits: RecipeEdits) {
  const keys = new Set([...Object.keys(previous), ...Object.keys(fields)] as (keyof RecipeFields)[]);
  const changes = [...keys].filter((key) => canonicalJson(previous[key]) !== canonicalJson(fields[key]));
  return { ...edits, ...Object.fromEntries(changes.map((key) => [key, fields[key] ?? null])) };
}

function complete(fields: RecipeFields) {
  return fields.title.trim() && fields.ingredients.length && fields.ingredients.every((line) => line.trim())
    && fields.steps.length && fields.steps.every((line) => line.trim());
}

export async function approveRecipeExport(db: Db, input: RecipeApproval) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(recipeDrafts).where(eq(recipeDrafts.id, input.id)).for('update');
    if (!row) return { outcome: 'changed' as const };
    const requestKey = fingerprint(input);
    const [retry] = await tx.select({ id: recipeExports.id }).from(recipeExports).where(eq(recipeExports.requestKey, requestKey));
    if (retry) return { outcome: 'saved' as const, id: retry.id };
    if (row.revision !== input.revision) return { outcome: 'changed' as const };

    const { fields } = input;
    const { timingConflict, unassigned, variations, url, key } = row.data;
    if (!complete(fields) || (unassigned && !input.reviewedUnassigned)) return { outcome: 'incomplete' as const };
    const selected = variations.filter((variant) => input.selectedVariations.includes(variant.key));
    if (selected.length !== input.selectedVariations.length) return { outcome: 'changed' as const };
    if (timingConflict) {
      const { prepMinutes = 0, cookMinutes, totalMinutes } = fields.timing ?? {};
      if ((cookMinutes !== undefined && cookMinutes < timingConflict.minimumMinutes)
        || (totalMinutes !== undefined && totalMinutes < prepMinutes + (cookMinutes ?? timingConflict.minimumMinutes))) {
        return { outcome: 'timing' as const };
      }
    }

    const selectedVariations = selected.map((item) => item.key);
    const edits = diffFields(draftPreview(row).fields, fields, row.edits);
    const reviewedUnassigned = Boolean(unassigned && input.reviewedUnassigned);
    let revision = row.revision;
    if (canonicalJson(edits) !== canonicalJson(row.edits)
      || canonicalJson(selectedVariations) !== canonicalJson(row.selectedVariations)
      || reviewedUnassigned !== row.reviewedUnassigned) {
      revision++;
      await tx.update(recipeDrafts).set({ edits, selectedVariations, reviewedUnassigned, revision, updatedAt: new Date() })
        .where(eq(recipeDrafts.id, row.id));
    }

    const [prior] = await tx.select({ id: recipeExports.id }).from(recipeExports)
      .where(and(eq(recipeExports.draftId, row.id), eq(recipeExports.revision, revision)));
    if (prior) return { outcome: 'saved' as const, id: prior.id };
    const { title, publisher, authors, credit, yield: recipeYield, timing, ingredients, steps, notes } = fields;
    const payload: RecipeExport = { schemaVersion: 1, recipes: [{
      key, title, source: { url, publisher, authors, credit }, yield: recipeYield,
      timing, ingredients, steps, notes, variations: selected.length ? selected : undefined,
    }] };
    const [created] = await tx.insert(recipeExports).values({ draftId: row.id, revision, requestKey, payload })
      .returning({ id: recipeExports.id });
    return { outcome: 'saved' as const, id: created!.id };
  });
}

export async function getRecipeExport(db: Db, id: string) {
  const [row] = await db.select({ payload: recipeExports.payload }).from(recipeExports).where(eq(recipeExports.id, id));
  return row?.payload;
}
