import type { AzukWatch, WatchTrigger } from './client.js';

export type DeliveryStatus = 'queued' | 'running' | 'delivered' | 'failed' | 'needs_review' | 'stopped';
export type DeliveryStep = 'item' | 'watch';

export interface AzukApproval {
  connection: string;
  listId: string;
  listName: string;
  listingUrl: string;
  productName: string;
  target?: { price: string; currency: string };
}

export interface WatchReceipt {
  status: string;
  tier: string;
  notify: string;
  triggers: AzukWatch['triggers'];
  settingsMatch: boolean;
  checkedAt: string | null;
  targetStatus: string;
  observation: { price: string; currency: string | null; at: string } | null;
}

export function watchTrigger(target: AzukApproval['target']): WatchTrigger {
  return target ? { type: 'price_below', ...target } : { type: 'drop_pct', pct: 10 };
}

export function itemLabel(name: string, url: string): string {
  const listing = new URL(url);
  return `${name.trim().replace(/\s+/g, ' ')} [${listing.hostname.replace(/^www\./, '')} ${listing.pathname.split('/').filter(Boolean).at(-1)}]`;
}

export function watchReceipt(watch: AzukWatch, url: string, expected: WatchTrigger): WatchReceipt | null {
  const target = watch.source === 'url' && watch.targets.find((item) => item.url === url);
  if (!target) return null;
  const [trigger] = watch.triggers;
  const matches = expected.type === 'drop_pct'
    ? trigger?.type === 'drop_pct' && Number(trigger.pct) === expected.pct
    : trigger?.type === 'price_below' && Number(trigger.price) === Number(expected.price) && trigger.currency === expected.currency;
  return {
    status: watch.status, tier: watch.tier, notify: watch.notify_scope, triggers: watch.triggers,
    settingsMatch: watch.status === 'active' && watch.tier === 'passive' && watch.notify_scope === 'creator' && watch.targets.length === 1
      && watch.triggers.length === 1 && matches,
    checkedAt: watch.last_checked_at, targetStatus: target.status,
    observation: target.last_price != null && target.last_observed_at
      ? { price: String(target.last_price), currency: target.last_currency, at: target.last_observed_at }
      : null,
  };
}
