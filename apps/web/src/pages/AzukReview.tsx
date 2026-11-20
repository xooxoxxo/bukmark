import { useState } from 'react';
import { useAzukDeliveries, useUpdateAzukDelivery } from '../api/queries';
import type { AzukApproval, AzukDelivery, AzukLists, ReviewProposal } from '../api/types';
import styles from './ReviewPage.module.css';

export interface AzukForm {
  listId: string;
  productName: string;
  price: string;
  currency: string;
}

export function azukForm(item: ReviewProposal): AzukForm {
  return { listId: '', productName: item.link.title.trim().slice(0, 150), price: '', currency: '' };
}

export function approvedAzuk(item: ReviewProposal, options: AzukLists | undefined, form: AzukForm): AzukApproval | undefined {
  if (!item.listingUrl || options?.status !== 'ready' || !form.productName.trim()) return undefined;
  const list = options.lists.find((entry) => entry.id === form.listId);
  const price = form.price.trim();
  if (!list || (price && (!/^\d{1,8}(?:\.\d{1,2})?$/.test(price) || Number(price) <= 0 || !/^[A-Z]{3}$/.test(form.currency)))) {
    return undefined;
  }
  return {
    connection: options.connection, listId: list.id, listName: list.name, listingUrl: item.listingUrl,
    productName: form.productName,
    ...(price ? { target: { price, currency: form.currency } } : {}),
  };
}

export function AzukReviewFields({ options, loading, busy, form, onChange, reload }: {
  options: AzukLists | undefined;
  loading: boolean;
  busy: boolean;
  form: AzukForm;
  onChange: (form: AzukForm) => void;
  reload: () => void;
}) {
  if (loading) return <p className={styles.meta}>Loading Azuk lists…</p>;
  if (options?.status === 'disabled') return <p className={styles.meta}>Connect Azuk on the server to send this listing.</p>;
  if (options?.status !== 'ready') {
    return (
      <div className={styles.actions}>
        <p className={styles.meta}>Azuk is unavailable. You can still defer this draft.</p>
        <button type="button" onClick={reload}>Reload Azuk lists</button>
      </div>
    );
  }
  return (
    <fieldset className={styles.azukFields} disabled={busy}>
      <legend>Azuk handoff</legend>
      <label className={styles.field}>
        <span>Azuk list</span>
        <select value={form.listId} onChange={(event) => onChange({ ...form, listId: event.target.value })}>
          <option value="">Choose a list</option>
          {options.lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
        </select>
      </label>
      <label className={styles.field}>
        <span>Product name</span>
        <input value={form.productName} maxLength={160} onChange={(event) => onChange({ ...form, productName: event.target.value })} />
      </label>
      <label className={styles.field}>
        <span>Target price (optional)</span>
        <input inputMode="decimal" value={form.price} maxLength={11}
          onChange={(event) => onChange({ ...form, price: event.target.value })} />
      </label>
      {form.price.trim() ? (
        <label className={styles.field}>
          <span>Currency</span>
          <input placeholder="EUR" value={form.currency} maxLength={3}
            onChange={(event) => onChange({ ...form, currency: event.target.value.toUpperCase() })} />
        </label>
      ) : null}
      <p className={styles.meta}>
        Azuk checks the exact listing daily and alerts the watch creator.
        {form.price.trim() ? ' It alerts below the target price.' : ' It alerts on a price drop of 10%.'}
      </p>
    </fieldset>
  );
}

const DELIVERY_STATUS: Record<AzukDelivery['status'], string> = {
  queued: 'Queued', running: 'Sending', delivered: 'Delivered', failed: 'Failed',
  needs_review: 'Needs review', stopped: 'Stopped',
};

function triggerText(trigger: NonNullable<AzukDelivery['watch']>['triggers'][number]) {
  if (trigger.type === 'drop_pct') return `${trigger.pct}% price drop`;
  if (trigger.type === 'price_below') return `Below ${trigger.price} ${trigger.currency}`;
  if (trigger.type === 'variant_in_stock') return `${trigger.variant ?? 'Variant'} in stock`;
  return trigger.type === 'in_stock' ? 'In stock' : trigger.type;
}

export function AzukActivity({ linkId }: { linkId: string | null }) {
  const [offset, setOffset] = useState(0);
  const [message, setMessage] = useState('');
  const queue = useAzukDeliveries(linkId, offset);
  const update = useUpdateAzukDelivery();
  return (
    <>
      {queue.isPending ? <p role="status" className={styles.message}>Loading Azuk deliveries…</p> : null}
      {queue.error || update.error ? <p role="alert" className={styles.error}>{(queue.error ?? update.error)?.message}</p> : null}
      {message ? <p role="status" className={styles.message}>{message}</p> : null}
      {queue.isSuccess && !queue.data.items.length ? <p className={styles.message}>No Azuk deliveries here.</p> : null}
      {queue.data?.items.map((item) => (
        <article className={styles.row} key={item.id} aria-label={item.productName}>
          <div className={styles.source}>
            <h3><a href={item.listingUrl} target="_blank" rel="noreferrer">{item.productName}</a></h3>
            <p className={styles.url}>{item.listingUrl}</p>
            <p className={styles.meta}>Azuk list · {item.listName}</p>
            <p>{DELIVERY_STATUS[item.status]}{item.itemId && !item.watchId ? ' · Item sent' : ''}</p>
            {item.error ? <p className={styles.error}>{item.error}</p> : null}
            {!item.connectionAvailable ? <p className={styles.meta}>This delivery belongs to a different or unavailable Azuk connection.</p> : null}
          </div>
          <div className={styles.review}>
            <details className={styles.evidence}><summary>Delivery identifiers</summary>
            <p className={styles.url}>Item · {item.itemId ?? 'Awaiting confirmation'}</p>
            <p className={styles.url}>Watch · {item.watchId ?? 'Awaiting confirmation'}</p>
            </details>
            {item.watch ? (
              <>
                {item.watch.observation ? (
                  <p>Last observed · {item.watch.observation.price} {item.watch.observation.currency} · {new Date(item.watch.observation.at).toLocaleString()}</p>
                ) : (
                  <p>{item.watch.targetStatus === 'blocked' || item.watch.targetStatus === 'failing'
                    ? `Azuk reports the listing as ${item.watch.targetStatus}.`
                    : item.watch.checkedAt ? 'Azuk checked the listing and has no readable price.' : 'Awaiting a price observation.'}</p>
                )}
                {!item.watch.settingsMatch ? <p className={styles.meta}>The existing watch has different settings.</p> : null}
                <p className={styles.meta}>
                  {item.watch.status} · {item.watch.tier === 'passive' ? 'daily' : item.watch.tier === 'active' ? 'hourly' : item.watch.tier}
                  {' · '}{item.watch.notify}{item.watch.triggers.length ? ` · ${item.watch.triggers.map(triggerText).join(', ')}` : ''}
                </p>
              </>
            ) : null}
            {item.canRetry || item.canRefresh ? (
              <button type="button" disabled={update.isPending} onClick={() => {
                setMessage('');
                update.mutate({ id: item.id, action: item.canRetry ? 'retry' : 'refresh' }, {
                  onSuccess: ({ outcome }) => setMessage(outcome === 'queued' ? 'Delivery queued for another check.'
                    : outcome === 'refreshed' ? 'Watch status updated.' : 'Azuk has no new status for this delivery.'),
                });
              }}>{item.canRetry ? 'Retry delivery' : 'Check price status'}</button>
            ) : null}
          </div>
        </article>
      ))}
      {offset > 0 || queue.data?.more ? (
        <div className={styles.pages}>
          <button type="button" disabled={offset === 0} onClick={() => setOffset(offset - 25)}>Previous page</button>
          <button type="button" disabled={!queue.data?.more} onClick={() => setOffset(offset + 25)}>Next page</button>
        </div>
      ) : null}
    </>
  );
}
