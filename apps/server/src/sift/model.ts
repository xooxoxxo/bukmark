import { builderSource } from '../builder/model.js';
import { productListing, suggestAction } from '../review/model.js';

export const dispositions = ['reference', 'active_work', 'shortcut', 'archive_candidate', 'needs_review'] as const;
export const handoffs = ['builder', 'recipe', 'knowledge', 'azuk', 'none'] as const;

export type Disposition = typeof dispositions[number];
export type Handoff = typeof handoffs[number];

export interface SiftBookmark {
  url: string;
  title: string;
  status: 'active' | 'archived';
  appearances?: number;
  /** Bounded local page evidence; never supplied to Jev. */
  pageText?: string;
}

export interface Suggestion {
  disposition: Disposition | 'archived';
  handoff: Handoff;
  reason: string;
}

export function siftBookmark(bookmark: SiftBookmark): Suggestion {
  const url = URL.parse(bookmark.url);
  const builder = builderSource(bookmark.url);
  const product = productListing(bookmark.url);
  const host = url?.hostname.replace(/^www\./, '');
  const recipe = url?.protocol === 'https:' && /\brecipe\b/i.test(bookmark.title)
    && (host === 'loveandlemons.com' || /^\/recipes?\/.+/.test(url.pathname));
  const handoff = builder ? 'builder' : product ? 'azuk' : recipe ? 'recipe' : 'none';

  if (bookmark.status === 'archived') return { disposition: 'archived', handoff, reason: 'Existing archive.' };
  if (suggestAction(bookmark.url).draft.action === 'archive') {
    return { disposition: 'archive_candidate', handoff, reason: 'Known navigation shortcut.' };
  }
  if (product) return { disposition: 'needs_review', handoff, reason: 'Exact listing. Shopping intent and destination need review.' };
  if (builder) return { disposition: 'reference', handoff, reason: 'Supported repository, issue, or package URL.' };
  if (recipe) return { disposition: 'reference', handoff, reason: 'Recipe title and source pattern. Extraction still needs verification.' };
  if (url?.protocol === 'https:' && !url.username && !url.password && !url.port) {
    if ((host === 'developer.mozilla.org' && /\/docs\/.+/.test(url.pathname))
      || (host?.endsWith('.wikipedia.org') && /^\/wiki\/[\w%]/.test(url.pathname))
      || /^\/downloads?\/?$/.test(url.pathname)) {
      return { disposition: 'reference', handoff, reason: 'Documentation, encyclopedia, or upstream download page.' };
    }
    if (url.pathname === '/' && !url.search && !url.hash) {
      return { disposition: 'shortcut', handoff, reason: 'Site homepage. Confirm whether it earns a shortcut.' };
    }
  }
  return { disposition: 'needs_review', handoff, reason: 'Metadata gives no clear next use.' };
}
