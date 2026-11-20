import { sha256Hex } from '@bukmark/shared';

export const reviewActions = ['reference', 'next_step', 'archive', 'undecided', 'product'] as const;
export const reviewStates = ['pending', 'deferred', 'dismissed', 'applied'] as const;
export type ReviewAction = typeof reviewActions[number];
export type ReviewState = typeof reviewStates[number];

export interface ReviewDraft {
  action: ReviewAction;
  hub?: string;
  nextStep?: string;
}

export interface ReviewSuggestion {
  draft: ReviewDraft;
  reason: string;
}

type Source = { url: string; title: string; note: string; status: string };

export function sourceVersion({ url, title, note, status }: Source): string {
  return sha256Hex(JSON.stringify([url, title, note, status]));
}

export function cleanDraft({ action, hub, nextStep }: ReviewDraft): ReviewDraft {
  const clean: ReviewDraft = { action };
  if ((action === 'reference' || action === 'next_step') && hub?.trim()) clean.hub = hub.trim();
  if (action === 'next_step' && nextStep?.trim()) clean.nextStep = nextStep.trim();
  return clean;
}

export function canApply(draft: ReviewDraft): boolean {
  return draft.action === 'reference' || draft.action === 'archive'
    || (draft.action === 'next_step' && Boolean(draft.hub && draft.nextStep));
}

const AMAZON_HOSTS = new Set(['amazon.de', 'amazon.nl', 'amazon.com', 'amazon.com.tr']);

export function productListing(url: string): string | null {
  const parsed = URL.parse(url);
  if (parsed?.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  const host = parsed.hostname.replace(/^www\./, '');
  if (host === 'thomann.de' && /^\/(?:[a-z]{2}|intl)\/[a-z0-9]+(?:_[a-z0-9]+)+\.htm$/.test(parsed.pathname)) {
    return `https://www.thomann.de${parsed.pathname}`;
  }
  if (!AMAZON_HOSTS.has(host)) return null;
  const match = /\/(?:dp|gp\/product)\/([a-z0-9]{10})(?:\/|$)/i.exec(parsed.pathname);
  return match ? `https://www.${host}/dp/${match[1]!.toUpperCase()}` : null;
}

export function suggestAction(url: string): ReviewSuggestion {
  const parsed = URL.parse(url);
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    return { draft: { action: 'undecided' }, reason: 'This address needs a manual review.' };
  }
  const host = parsed.hostname.replace(/^www\./, '');
  const home = parsed.pathname === '/' && !parsed.search;
  const inbox = host === 'mail.google.com' && /^\/mail(?:\/u\/\d+)?\/?$/.test(parsed.pathname)
    && !parsed.search && (!parsed.hash || parsed.hash === '#inbox');
  const cart = AMAZON_HOSTS.has(host) && /^\/(?:cart|gp\/cart\/view\.html)(?:\/|$)/.test(parsed.pathname);
  if ((host === 'github.com' && home) || inbox || cart) {
    return { draft: { action: 'archive' }, reason: 'This is a navigation link. Review whether you still use it as a shortcut.' };
  }
  if (productListing(url)) {
    return { draft: { action: 'product' }, reason: 'The URL identifies a product listing. Decide whether you still want to track it.' };
  }
  return {
    draft: { action: 'undecided' },
    reason: home ? 'This opens a homepage. Keep it as a shortcut if you use it.' : 'Choose how you want to use this link.',
  };
}
