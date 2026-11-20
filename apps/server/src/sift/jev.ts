import { load } from 'cheerio/slim';
import { readPublicPage } from '../og/publicPage.js';
import type { PageFetch } from '../og/fetchHead.js';
import { productListing } from '../review/model.js';
import { dispositions, handoffs, type Disposition, type Handoff } from './model.js';
import { privateConversationUrl } from './publicSource.js';

export const PILOT_LIMIT = 16;
export const JEV_MODEL = 'jev-1.14.0';
const USD_PER_MILLION_INPUT_TOKENS = 0.042;

export function jevCostUsd(inputTokens: number) {
  return inputTokens * USD_PER_MILLION_INPUT_TOKENS / 1_000_000;
}

interface PublicState {
  host: string;
  path: string;
  title: string;
}

const privatePath = /(?:^|\/)(?:account|auth|dashboard|inbox|login|mail|oauth|private|reset|settings|sign-?in|token)(?:\/|$)/i;
const email = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i;

function safePath(path: string) {
  try {
    const decoded = decodeURIComponent(path);
    return !/%2f|%5c|\\/i.test(path) && !privatePath.test(decoded) && !email.test(decoded);
  } catch {
    return false;
  }
}

function publicUrl(input: string) {
  const url = URL.parse(input);
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
    || url.pathname.length > 200 || !safePath(url.pathname) || privateConversationUrl(url.href)) return null;
  return url;
}

const host = (url: URL) => url.hostname.replace(/^www\./, '');
const path = (url: URL) => url.pathname.replace(/\/$/, '');

function samePage(saved: URL, candidate: URL) {
  const listing = productListing(saved.href);
  if (listing && listing === productListing(candidate.href) && path(candidate) === path(new URL(listing))) return true;
  return path(saved) === path(candidate) && [...saved.searchParams.keys()].every((key) => /^(?:utm_.+|fbclid|gclid|msclkid)$/i.test(key));
}

export async function publicBookmarkState(
  savedUrl: string,
  nominatedUrl: string,
  read: (url: string) => Promise<PageFetch> = readPublicPage,
): Promise<PublicState | null> {
  const saved = URL.parse(savedUrl);
  const candidate = publicUrl(nominatedUrl);
  if (!saved || saved.protocol !== 'https:' || saved.username || saved.password || saved.port || !candidate
    || host(saved) !== host(candidate) || !safePath(saved.pathname) || privateConversationUrl(saved.href) || !samePage(saved, candidate)) return null;
  const page = await read(candidate.href);
  const final = publicUrl(page.url);
  if (!page.html || page.status !== 200 || !final || host(final) !== host(candidate)) return null;
  const listing = productListing(candidate.href);
  if (listing && listing !== productListing(final.href)) return null;

  const $ = load(page.html);
  const title = ($('head meta[property="og:title"]').attr('content') ?? $('head title').first().text()).replace(/\s+/g, ' ').trim();
  if (!title || /access denied|captcha|sign in|log in|just a moment|robot check/i.test(title)
    || email.test(title)) return null;
  return { host: host(final), path: final.pathname, title: Array.from(title).slice(0, 160).join('') };
}

const questions = {
  disposition: {
    type: 'choice',
    instructions: 'Suggest the next use for this bookmark from the public page metadata. A saved page alone does not show that the owner is doing work or shopping. Use needs_review when intent is unclear.',
    criteria: {
      reference: 'A specific page worth returning to for facts, documentation, or downloads.',
      active_work: 'The evidence identifies a current project and a concrete next action.',
      shortcut: 'A service homepage worth considering as navigation.',
      archive_candidate: 'A generic navigation page with little value as a separate bookmark.',
      needs_review: 'The next use depends on missing owner intent or project context.',
    },
  },
  handoff: {
    type: 'choice',
    instructions: 'Which optional route could use this page? This is a suggestion only. Choose none if a handoff is unsupported or unclear.',
    criteria: {
      builder: 'A software repository, package, or issue that can attach to a repository.',
      recipe: 'A page for a specific cooking recipe.',
      knowledge: 'A source with a specific reusable idea worth drafting into a cited note.',
      azuk: 'A specific product listing that could be tracked.',
      none: 'No supported route or too little evidence.',
    },
  },
} as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function probability(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function choice<T extends string>(input: unknown, options: readonly T[]) {
  const answer = record(input);
  const value = options.find((option) => answer.choice === option);
  const confidence = probability(answer.confidence);
  const selectedProbability = value && probability(record(answer.probabilities)[value]);
  if (answer.type !== 'choice' || !value || confidence === null || selectedProbability === null || selectedProbability === undefined) return null;
  return { value, confidence, probability: selectedProbability };
}

export async function askJev(state: PublicState, token: string, fetcher = globalThis.fetch) {
  const response = await fetcher('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: JEV_MODEL, state, questions }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`TypeSafe returned HTTP ${response.status}.`);
  }
  const body = record(await response.json());
  const usage = record(body.usage);
  const inputTokens = usage.input_tokens;
  if (typeof inputTokens !== 'number' || !Number.isSafeInteger(inputTokens) || inputTokens < 0) {
    throw new Error('TypeSafe did not report billed input tokens.');
  }
  const answers = record(body.answers);
  const disposition = choice<Disposition>(answers.disposition, dispositions);
  const handoff = choice<Handoff>(answers.handoff, handoffs);
  return {
    model: typeof body.model === 'string' ? body.model : JEV_MODEL,
    inputTokens,
    costUsd: jevCostUsd(inputTokens),
    disposition,
    handoff,
    needsReview: !disposition || !handoff || disposition.value === 'needs_review'
      || disposition.probability < 0.8 || handoff.probability < 0.8,
  };
}
