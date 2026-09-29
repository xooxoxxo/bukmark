import { and, eq } from 'drizzle-orm';
import { matchKey, normalizeUrl } from '@bukmark/shared';
import { pgCode, type Db } from '../db/client.js';
import { links, quotes } from '../db/schema.js';
import { addLink } from '../links/addLink.js';

export const QUOTE_MAX_CHARS = 10000;

export interface QuoteDTO {
  id: string;
  linkId: string | null;
  text: string;
  note: string;
  sourceUrl: string;
  sourceTitle: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateQuoteInput {
  url: string;
  text: string;
  title?: string;
  note?: string;
}

export interface CreateQuoteResult {
  quote: QuoteDTO;
  /** True when this call stored a new quote; false when the same text was already saved (Q4). */
  created: boolean;
  link: { id: string; created: boolean };
}

/** Bad input to the quote service; routes map it to 400. */
export class QuoteValidationError extends Error {
  constructor(public readonly reason: 'invalid-url' | 'empty-text' | 'text-too-long', message: string) {
    super(message);
    this.name = 'QuoteValidationError';
  }
}

/** text: trimmed, inner newlines kept. textKey: the Q4 identity (lower-case, whitespace runs collapsed). */
export function normalizeText(raw: string): { text: string; textKey: string } {
  const text = raw.trim();
  if (text.length === 0) throw new QuoteValidationError('empty-text', 'quote text is empty');
  if (text.length > QUOTE_MAX_CHARS) {
    throw new QuoteValidationError('text-too-long', `quote text is over ${QUOTE_MAX_CHARS} characters`);
  }
  return { text, textKey: text.toLowerCase().replace(/\s+/g, ' ') };
}

export function toQuoteDTO(row: typeof quotes.$inferSelect): QuoteDTO {
  return {
    id: row.id,
    linkId: row.linkId,
    text: row.text,
    note: row.note,
    sourceUrl: row.sourceUrl,
    sourceTitle: row.sourceTitle,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createQuote(
  db: Db,
  fetchOgImage: (url: string) => Promise<string | null>,
  input: CreateQuoteInput,
): Promise<CreateQuoteResult> {
  const norm = normalizeUrl(input.url);
  if (!norm.ok) throw new QuoteValidationError('invalid-url', `${norm.reason} url`);
  const { text, textKey } = normalizeText(input.text);

  // An existing link is left alone: a quote is not a re-save (no dupe bump,
  // no updated_at change, no capture).
  const byHash = await db.select({ id: links.id, title: links.title }).from(links)
    .where(eq(links.urlHash, norm.urlHash)).limit(1);
  const found = byHash[0] ?? (await db.select({ id: links.id, title: links.title }).from(links)
    .where(eq(links.matchKey, matchKey(norm.url))).limit(1))[0];

  let linkId: string;
  let linkTitle: string;
  let linkCreated = false;
  if (found) {
    linkId = found.id;
    linkTitle = found.title;
  } else {
    // Same path as any save: match key, unsorted, og image, tombstone resurrection.
    const saved = await addLink(
      db,
      { url: norm.url, urlHash: norm.urlHash, title: input.title, source: 'quote', onlyIfAbsent: true },
      fetchOgImage,
    );
    linkId = saved.link.id;
    linkTitle = saved.link.title;
    linkCreated = saved.outcome !== 'existing';
  }

  const existing = () => db.select().from(quotes)
    .where(and(eq(quotes.linkId, linkId), eq(quotes.textKey, textKey))).limit(1);
  const done = (row: typeof quotes.$inferSelect, created: boolean): CreateQuoteResult => ({
    quote: toQuoteDTO(row), created, link: { id: linkId, created: linkCreated },
  });

  const dupe = (await existing())[0];
  if (dupe) return done(dupe, false);

  try {
    const [row] = await db.insert(quotes).values({
      linkId, text, textKey, note: input.note ?? '',
      sourceUrl: norm.url, sourceTitle: input.title || linkTitle,
    }).returning();
    return done(row!, true);
  } catch (err) {
    if (pgCode(err) !== '23505') throw err;
    const raced = (await existing())[0];
    if (!raced) throw err;
    return done(raced, false);
  }
}
