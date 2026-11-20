import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { azukDeliveries, links } from '../db/schema.js';
import { productListing } from '../review/model.js';
import { AzukResponseError, type AzukClient, type AzukItem, type AzukWatch } from './client.js';
import { itemLabel, watchReceipt, type DeliveryStep } from './model.js';

type Delivery = typeof azukDeliveries.$inferSelect;
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
const CLAIM_DURATION = sql`now() + interval '60 seconds'`;
const LIST_LIMIT = 25;

class DeliveryIssue extends Error {
  constructor(message: string, readonly status: 'needs_review' | 'stopped') { super(message); }
}

class LostClaim extends Error {}

function validId(id: string) {
  return typeof id === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id);
}

function issueText(error: unknown) {
  return error instanceof AzukResponseError || error instanceof DeliveryIssue
    ? error.message : 'Could not confirm the result from Azuk.';
}

async function claimDelivery(db: Db, client: AzukClient) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(azukDeliveries).where(and(
      eq(azukDeliveries.connection, client.connection),
      or(eq(azukDeliveries.status, 'queued'), and(
        eq(azukDeliveries.status, 'running'), lt(azukDeliveries.claimUntil, sql`now()`),
      )),
    )).orderBy(asc(azukDeliveries.updatedAt), asc(azukDeliveries.id)).limit(1).for('update', { skipLocked: true });
    if (!row) return null;
    const [claimed] = await tx.update(azukDeliveries)
      .set({ status: 'running', claim: randomUUID(), claimUntil: CLAIM_DURATION, updatedAt: sql`now()` })
      .where(eq(azukDeliveries.id, row.id)).returning();
    return claimed!;
  });
}

export async function runAzukDelivery(db: Db, client: AzukClient): Promise<boolean> {
  let job = await claimDelivery(db, client);
  if (!job) return false;
  const claimedId = job.id;
  const claim = job.claim!;

  async function checkpoint(fields: Partial<Delivery>, connection: Db | Transaction = db) {
    const [row] = await connection.update(azukDeliveries)
      .set({ claimUntil: CLAIM_DURATION, ...fields, updatedAt: sql`now()` })
      .where(and(eq(azukDeliveries.id, claimedId), eq(azukDeliveries.claim, claim))).returning();
    if (!row) throw new LostClaim();
    job = row;
    return row;
  }

  async function checkSource(row: Delivery, transaction?: Transaction) {
    const query = (transaction ?? db).select({ url: links.url, status: links.status })
      .from(links).where(eq(links.id, row.linkId));
    const [link] = await (transaction ? query.for('share') : query);
    if (!link || link.status !== 'active' || productListing(link.url) !== row.listingUrl) {
      throw new DeliveryIssue('The source link was archived, removed, or changed.', 'stopped');
    }
  }

  async function write<T>(row: Delivery, step: DeliveryStep, perform: () => Promise<T>): Promise<T> {
    await db.transaction(async (tx) => {
      await checkSource(row, tx);
      await checkpoint({ pendingStep: step }, tx);
    });
    try {
      return await perform();
    } catch (error) {
      // These Azuk client errors reject the request before a write. A timeout,
      // malformed response or server error may have arrived after commit.
      if (error instanceof AzukResponseError && [400, 401, 403, 404, 422].includes(error.status)) {
        await checkpoint({ pendingStep: null });
      }
      throw error;
    }
  }

  try {
    await checkSource(job);
    const list = (await client.lists()).find((item) => item.id === job!.listId && item.name === job!.listName);
    if (!list) throw new DeliveryIssue('The approved Azuk list is no longer available under that name.', 'needs_review');
    const listingUrl = job.listingUrl;
    const text = itemLabel(job.productName, listingUrl);
    const items = await client.items(list);
    const matchingItems = job.itemId ? items.filter((item) => item.id === job!.itemId)
      : items.filter((item) => item.list_id === list.id && (item.note === listingUrl || item.text === text));
    if (matchingItems.length > 1 || (job.itemId && !matchingItems.length)) {
      throw new DeliveryIssue('Check the matching items in Azuk before continuing.', 'needs_review');
    }
    let item: AzukItem | undefined = matchingItems[0];
    if (!item) {
      if (job.pendingStep === 'item') throw new DeliveryIssue('Azuk has not confirmed the earlier item request. Check again before sending.', 'needs_review');
      item = await write(job, 'item', () => client.addItem(list, text, listingUrl));
    }
    if (!validId(item.id) || item.list_id !== list.id || item.note !== listingUrl) {
      throw new DeliveryIssue('Azuk did not confirm the item for this listing and list.', 'needs_review');
    }
    if (item.status === 'bought' || item.status === 'dropped') {
      await checkpoint({ itemId: item.id, pendingStep: null });
      throw new DeliveryIssue(`The Azuk item is already ${item.status}.`, 'stopped');
    }
    if (item.status !== 'open') throw new DeliveryIssue('The matching Azuk item is waiting for review there.', 'needs_review');
    const afterItem = await checkpoint({ itemId: item.id, pendingStep: job.pendingStep === 'watch' ? 'watch' : null });

    const matches = (await client.watches()).filter((watch) => watchReceipt(watch, listingUrl, afterItem.trigger));
    const active = matches.filter((watch) => watch.status !== 'deleted');
    if (active.length > 1 || (!active.length && matches.length)) {
      throw new DeliveryIssue('Check the matching watches in Azuk before continuing.', 'needs_review');
    }
    let watch: AzukWatch | undefined = active[0];
    if (!watch) {
      if (afterItem.pendingStep === 'watch') throw new DeliveryIssue('Azuk has not confirmed the earlier watch request. Check again before sending.', 'needs_review');
      watch = await write(afterItem, 'watch', () => client.addWatch(listingUrl, afterItem.productName, afterItem.trigger));
    }
    const receipt = watchReceipt(watch, listingUrl, afterItem.trigger);
    if (!validId(watch.id) || !receipt || watch.status === 'deleted') {
      throw new DeliveryIssue('Azuk did not confirm a watch for the exact listing.', 'needs_review');
    }
    await checkpoint({
      watchId: watch.id, watch: receipt, pendingStep: null, status: 'delivered',
      claim: null, claimUntil: null, error: null,
    });
  } catch (error) {
    if (!(error instanceof LostClaim)) {
      try {
        await checkpoint({
          status: error instanceof DeliveryIssue ? error.status : job!.pendingStep ? 'needs_review' : 'failed',
          error: issueText(error), claim: null, claimUntil: null,
        });
      } catch (checkpointError) {
        if (!(checkpointError instanceof LostClaim)) throw checkpointError;
      }
    }
  }
  return true;
}

export function startAzukDeliveries(app: FastifyInstance, client: AzukClient) {
  let running: Promise<boolean | void> | undefined;
  const timer = setInterval(() => {
    if (running) return;
    running = runAzukDelivery(app.db, client).catch((error: unknown) => {
      // Driver errors can contain query values. Keep the delivery itself in the queue for recovery.
      app.log.warn({ kind: error instanceof Error ? error.name : 'unknown' }, 'Azuk delivery worker failed');
    }).finally(() => { running = undefined; });
  }, 2000);
  timer.unref();
  app.addHook('preClose', async () => {
    clearInterval(timer);
    await running;
  });
}

export async function listAzukDeliveries(db: Db, client: AzukClient | undefined, linkId?: string, offset = 0) {
  const [link] = linkId ? await db.select({ url: links.url }).from(links).where(eq(links.id, linkId)) : [];
  const listing = link ? productListing(link.url) : null;
  const rows = await db.select().from(azukDeliveries).where(linkId ? or(
    eq(azukDeliveries.linkId, linkId), listing ? eq(azukDeliveries.listingUrl, listing) : undefined,
  ) : undefined)
    .orderBy(desc(azukDeliveries.updatedAt), desc(azukDeliveries.id)).limit(LIST_LIMIT + 1).offset(offset);
  return {
    items: rows.slice(0, LIST_LIMIT).map((row) => ({
      id: row.id, listName: row.listName, listingUrl: row.listingUrl, productName: row.productName,
      status: row.status, itemId: row.itemId, watchId: row.watchId, watch: row.watch, error: row.error,
      canRetry: client?.connection === row.connection && ['failed', 'needs_review'].includes(row.status),
      canRefresh: client?.connection === row.connection && row.status === 'delivered',
      connectionAvailable: client?.connection === row.connection,
    })),
    more: rows.length > LIST_LIMIT,
  };
}

export async function retryAzukDelivery(db: Db, client: AzukClient | undefined, id: string) {
  if (!client) return { outcome: 'unavailable' };
  const [queued] = await db.update(azukDeliveries).set({ status: 'queued', error: null, updatedAt: sql`now()` })
    .where(and(eq(azukDeliveries.id, id), eq(azukDeliveries.connection, client.connection),
      inArray(azukDeliveries.status, ['failed', 'needs_review']))).returning({ id: azukDeliveries.id });
  return { outcome: queued ? 'queued' : 'unchanged' };
}

export async function refreshAzukDelivery(db: Db, client: AzukClient | undefined, id: string) {
  if (!client) return { outcome: 'unavailable' };
  const [row] = await db.select().from(azukDeliveries).where(and(eq(azukDeliveries.id, id),
    eq(azukDeliveries.connection, client.connection), eq(azukDeliveries.status, 'delivered')));
  if (!row?.watchId) return { outcome: 'unchanged' };
  try {
    const current = await client.watch(row.watchId);
    const watch = current.id === row.watchId && watchReceipt(current, row.listingUrl, row.trigger);
    if (!watch) return { outcome: 'unavailable' };
    await db.update(azukDeliveries).set({ watch }).where(eq(azukDeliveries.id, id));
    return { outcome: 'refreshed' };
  } catch {
    return { outcome: 'unavailable' };
  }
}
