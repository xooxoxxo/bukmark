import type { RecipeDraftData, RecipeFields, RecipeVariation } from '@bukmark/shared/review';
import { load, type CheerioAPI } from 'cheerio/slim';

const MAX_ROWS = 100;
const MAX_CARDS = 10;
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function plain(value: string, max = 2000) {
  return Array.from(value.replace(/[\u0000\uD800-\uDFFF]/gu, '').replace(/\s+/g, ' ').trim()).slice(0, max).join('');
}

function text(value: unknown, max = 2000) {
  if (typeof value !== 'string') return '';
  if (!/[<&]/.test(value)) return plain(value, max);
  const $ = load(value, {}, false);
  $('script,style,template').remove();
  return plain($.root().text(), max);
}

function typeIs(node: JsonObject, name: string) {
  return values(node['@type']).some((value) => value === name || value === `https://schema.org/${name}` || value === `http://schema.org/${name}`);
}

function recipeNodes(value: unknown, depth = 0): JsonObject[] {
  if (depth > 12) return [];
  return values(value).flatMap((item) => {
    const node = object(item);
    if (!node) return [];
    if (typeIs(node, 'Recipe')) return [node];
    return [...recipeNodes(node['@graph'], depth + 1), ...recipeNodes(node.mainEntity, depth + 1)];
  });
}

function documentUrl(input: URL) {
  const url = new URL(input);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_.+|fbclid|gclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
  }
  return url.href;
}

function cardKey(node: JsonObject, source: URL) {
  const id = typeof node['@id'] === 'string' ? URL.parse(node['@id'], source) : null;
  return id?.hash && documentUrl(id) === documentUrl(source) && id.hash.length < 150 ? id.hash : '';
}

function ingredients(value: unknown) {
  return values(value).slice(0, MAX_ROWS).map((item) => text(item)).filter(Boolean);
}

const namedVariation = /^variation\s+\d+\s*:\s*(.+)$/i;
const stepVariant = /^for the (.+?) variation:\s*/i;
const baseStep = /^for the .+?\(base recipe\):\s*/i;

function stepLines(value: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  return values(value).slice(0, MAX_ROWS).flatMap((item) => {
    if (typeof item === 'string') return item.split(/\r?\n/).slice(0, MAX_ROWS).map((line) => text(line)).filter(Boolean);
    const node = object(item);
    if (!node) return [];
    if (typeIs(node, 'HowToSection') || typeIs(node, 'ItemList')) {
      const steps = stepLines(node.itemListElement, depth + 1);
      const variation = namedVariation.exec(text(node.name, 200))?.[1];
      return variation ? steps.map((step) => `For the ${variation} variation: ${step}`) : steps;
    }
    const line = text(node.text ?? node.name);
    return line ? [line] : [];
  }).slice(0, MAX_ROWS);
}

function minutes(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/i.exec(value);
  if (!match || (!match[1] && !match[2])) return undefined;
  const result = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  return result <= 10080 ? result : undefined;
}

function recipeYield(value: unknown): RecipeFields['yield'] {
  const labels = values(value).map((item) => text(typeof item === 'number' ? String(item) : item, 160)).filter(Boolean);
  const label = labels.find((item) => !/^\d+$/.test(item)) ?? labels[0];
  if (!label) return undefined;
  const count = /^(\d+)(?: servings?)?$/i.exec(label);
  const servings = count ? Number(count[1]) : 0;
  return servings > 0 && servings <= 10000 ? { servings } : { text: label };
}

function timeConflict(steps: string[], listedMinutes: number | undefined) {
  if (listedMinutes === undefined) return undefined;
  let conflict: RecipeDraftData['timingConflict'];
  for (const step of steps) {
    for (const match of step.matchAll(/\b(?:cook|simmer|bake|roast|boil|fry|steam)\b[^.!?]{0,50}?\bfor\s+(?:about\s+)?(?:(\d+)\s*(?:to|–|-)\s*)?(\d+)\s*(minutes?|mins?|hours?)\b/gi)) {
      const minimumMinutes = Number(match[1] ?? match[2]) * (match[3]!.toLowerCase().startsWith('hour') ? 60 : 1);
      if (minimumMinutes > (conflict?.minimumMinutes ?? listedMinutes) && minimumMinutes <= 10080) {
        conflict = { listedMinutes, minimumMinutes, step };
      }
    }
  }
  return conflict;
}

function cardGroups($: CheerioAPI, node: JsonObject, source: URL, singleRecipe: boolean) {
  const cardIds = new Set(values(node.recipeInstructions).map((item) => {
    const url = object(item)?.url;
    const target = typeof url === 'string' ? URL.parse(url, source) : null;
    return target && documentUrl(target) === documentUrl(source) ? /^#wprm-recipe-(\d+)-step-/.exec(target.hash)?.[1] : undefined;
  }).filter(Boolean));
  const cards = $('.wprm-recipe-container').filter((_index, card) =>
    $(card).find('.wprm-recipe-ingredients-container').length > 0);
  const matching = cards.filter((_index, card) => cardIds.has($(card).attr('data-recipe-id')));
  const card = matching.length === 1 ? matching : singleRecipe && cards.length === 1 ? cards : cards.slice(0, 0);
  const groups = card.find('.wprm-recipe-ingredient-group').toArray().slice(0, 21).map((group) => ({
    title: plain($(group).find('.wprm-recipe-ingredient-group-name').text(), 200),
    ingredients: $(group).find('.wprm-recipe-ingredient').toArray().slice(0, MAX_ROWS)
      .map((line) => {
        const ingredient = $(line).clone();
        ingredient.find('.wprm-checkbox-container').remove();
        return plain(ingredient.text());
      }).filter(Boolean),
  }));
  const summary = plain(card.find('.wprm-recipe-summary').text());
  return {
    groups,
    note: plain(card.find('.wprm-recipe-notes-container .wprm-recipe-notes').text()),
    credit: /\b(?:adapted from|based on) [^.]+[.]?/i.exec(summary)?.[0],
  };
}

function splitRecipe(
  rows: string[], steps: string[], groups: ReturnType<typeof cardGroups>['groups'],
): Pick<RecipeFields, 'ingredients' | 'steps'> & Pick<RecipeDraftData, 'variations' | 'unassigned'> {
  const [base, ...rest] = groups;
  const variants = rest.map((group) => namedVariation.exec(group.title)?.[1]);
  const labels = steps.map((line) => stepVariant.exec(line)?.[1]?.toLowerCase());
  const hasVariants = groups.some(({ title }) => /\bvariations?\b/i.test(title)) || labels.some(Boolean)
    || rows.some((line) => /^ingredients for .*recipe/i.test(line));
  if (!hasVariants) return { ingredients: rows, steps, variations: [] };

  if (base?.ingredients.length && !namedVariation.test(base.title) && variants.length && variants.every(Boolean)
    && labels.filter(Boolean).length > 0 && labels.every((label) => !label || variants.some((name) => name?.toLowerCase() === label))) {
    const titles = variants as string[];
    const variations: RecipeVariation[] = titles.map((title, index) => ({
      key: `variation:${title.toLowerCase()}`,
      title,
      ingredients: rest[index]!.ingredients.filter((line) => !/^ingredients for .*recipe/i.test(line)),
      steps: steps.filter((_step, position) => labels[position] === title.toLowerCase())
        .map((line) => line.replace(stepVariant, '')),
    }));
    const baseSteps = steps.filter((_step, position) => !labels[position]).map((line) => line.replace(baseStep, ''));
    if (baseSteps.length && new Set(variations.map(({ key }) => key)).size === variations.length
      && variations.every((item) => item.steps.length)) {
      return { ingredients: base.ingredients, steps: baseSteps, variations };
    }
  }
  return { ingredients: [], steps: [], variations: [], unassigned: { ingredients: rows, steps } };
}

export function extractRecipes(html: string, url: string) {
  const $ = load(html);
  const source = new URL(url);
  const canonicalUrl = documentUrl(source);
  const nodes: JsonObject[] = [];
  let malformed = false;
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try { nodes.push(...recipeNodes(JSON.parse($(script).text()))); }
    catch { malformed = true; }
    if (nodes.length > MAX_CARDS) return { kind: 'ambiguous' as const };
  }
  if (!nodes.length) return { kind: malformed ? 'malformed' as const : 'no-recipe' as const };

  const distinct = new Map(nodes.map((node) => [JSON.stringify(node), node]));
  const cards = [...distinct.values()].map((node) => ({ node, key: `recipe:${canonicalUrl}${cardKey(node, source)}` }));
  if (cards.length > 1 && (cards.some(({ key }) => key === `recipe:${canonicalUrl}`) || new Set(cards.map(({ key }) => key)).size !== cards.length)) {
    return { kind: 'ambiguous' as const };
  }

  const publisher = text($('meta[property="og:site_name"]').attr('content'), 200) || undefined;
  const items: RecipeDraftData[] = cards.map(({ node, key }) => {
    const groups = cardGroups($, node, source, cards.length === 1);
    const { ingredients: baseIngredients, steps, variations, unassigned } = splitRecipe(
      ingredients(node.recipeIngredient), stepLines(node.recipeInstructions), groups.groups,
    );
    const prepMinutes = minutes(node.prepTime);
    const cookMinutes = minutes(node.cookTime);
    const totalMinutes = minutes(node.totalTime);
    const overnight = [...baseIngredients, ...steps].some((line) => /\bsoak(?:ed|ing)?\b[^.]{0,80}\bovernight\b/i.test(line));
    const authors = values(node.author).slice(0, 12).map((item) => text(object(item)?.name ?? item, 200)).filter(Boolean);
    const fields: RecipeFields = {
      title: text(node.name, 200),
      publisher,
      authors: authors.length ? authors : undefined,
      credit: text(groups.credit, 500) || undefined,
      yield: recipeYield(node.recipeYield),
      timing: prepMinutes !== undefined || cookMinutes !== undefined || totalMinutes !== undefined || overnight ? {
        prepMinutes, cookMinutes, totalMinutes,
        passive: overnight ? [{ activity: 'Soak', durationText: 'overnight' }] : undefined,
      } : undefined,
      ingredients: baseIngredients,
      steps,
      notes: groups.note ? [groups.note] : undefined,
    };
    return { key, url: canonicalUrl, fields, variations, unassigned, timingConflict: timeConflict(steps, cookMinutes) };
  });
  return { kind: 'recipes' as const, items };
}
