import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AzukLists, ReviewDecision, ReviewProposal } from '../api/types';
import { makeWrapper } from '../test/utils';
import { ReviewPage } from './ReviewPage';

function proposal(id: string, title: string, draft: ReviewProposal['draft']): ReviewProposal {
  return {
    id, revision: 2, status: 'pending', draft, origin: 'rule', reason: 'From the saved URL.',
    link: { id: `link-${id}`, url: `https://example.org/${id}`, title, note: '', status: 'active' },
    sourceVersion: 'a'.repeat(64), sourceChanged: false, dupeCount: 11, oneTab: true,
    folder: null, listingUrl: null,
  };
}

function renderQueue(items: ReviewProposal[], path = '/review', azuk: AzukLists = { status: 'disabled' }) {
  const Wrapper = makeWrapper();
  const requests: Array<{ path: string; body: unknown }> = [];
  let prepared = !path.includes('linkId=');
  let rows = items;
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname === '/api/hubs') return Response.json({ items: [] });
    if (url.pathname === '/api/review/azuk/lists') return Response.json(azuk);
    if (url.pathname === '/api/review/azuk/deliveries') return Response.json({ items: [], more: false });
    if (url.pathname === '/api/review') {
      return Response.json({ items: prepared ? rows.filter((row) => row.status === url.searchParams.get('state')) : [], more: false });
    }
    const body = JSON.parse(String(init?.body));
    requests.push({ path: url.pathname, body });
    if (url.pathname === '/api/review/prepare') {
      prepared = true;
      return Response.json({ items: [{ linkId: 'link-a', outcome: 'prepared' }] });
    }
    const decisions = body.items as ReviewDecision[];
    for (const decision of decisions) {
      rows = rows.map((row) => row.id === decision.id ? {
        ...row, status: decision.decision === 'defer' ? 'deferred' : decision.decision === 'resume' ? 'pending' : 'applied',
        revision: row.revision + 1,
      } : row);
    }
    return Response.json({ items: decisions.map(({ id }) => ({ id, outcome: 'saved' })) });
  });
  render(<Wrapper><MemoryRouter initialEntries={[path]}><ReviewPage /></MemoryRouter></Wrapper>);
  return requests;
}

afterEach(() => vi.unstubAllGlobals());

describe('ReviewPage', () => {
  it('sends the visible revisions and edited next step for selected rows only', async () => {
    const migration = proposal('a', 'Runtime guide', { action: 'next_step', nextStep: 'Check the entry point.' });
    const shortcut = proposal('b', 'Inbox', { action: 'archive' });
    const requests = renderQueue([migration, shortcut]);
    const user = userEvent.setup();
    const row = within(await screen.findByRole('article', { name: 'Runtime guide' }));
    expect(row.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getAllByText(/11 OneTab appearances/)).toHaveLength(2);
    await user.type(row.getByRole('combobox', { name: 'Project hub' }), 'App');
    await user.click(row.getByRole('checkbox', { name: 'Select Runtime guide for approval' }));
    await user.click(screen.getByRole('button', { name: 'Approve selected (1)' }));

    expect(await screen.findByText('Saved 1 decision.')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Inbox' })).toBeInTheDocument();
    expect(requests).toEqual([{ path: '/api/review/decisions', body: { items: [{
      id: 'a', revision: 2, sourceVersion: migration.sourceVersion, decision: 'approve',
      draft: { action: 'next_step', hub: 'App', nextStep: 'Check the entry point.' },
    }] } }]);
  });

  it('prepares just the selected link on the single link route', async () => {
    const requests = renderQueue([proposal('a', 'A saved page', { action: 'undecided' })], '/review?linkId=link-a');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Prepare this link' }));
    expect(await screen.findByRole('article', { name: 'A saved page' })).toBeInTheDocument();
    expect(requests).toEqual([{ path: '/api/review/prepare', body: { linkId: 'link-a' } }]);
  });

  it('makes a deferred product available to resume without an approval action', async () => {
    const product = {
      ...proposal('a', 'A controller', { action: 'product' }),
      listingUrl: 'https://www.amazon.de/dp/B000000001',
    };
    const requests = renderQueue([product]);
    const user = userEvent.setup();
    const row = within(await screen.findByRole('article', { name: 'A controller' }));
    expect(row.getByRole('button', { name: 'Send to Azuk' })).toBeDisabled();
    await user.click(row.getByRole('button', { name: 'Defer' }));
    await screen.findByText('Saved 1 decision.');
    await user.click(screen.getByRole('button', { name: 'Deferred' }));
    await user.click(await screen.findByRole('button', { name: 'Resume review' }));
    expect(requests).toEqual([
      { path: '/api/review/decisions', body: { items: [{ id: 'a', revision: 2, sourceVersion: product.sourceVersion, decision: 'defer' }] } },
      { path: '/api/review/decisions', body: { items: [{ id: 'a', revision: 3, sourceVersion: product.sourceVersion, decision: 'resume' }] } },
    ]);
  });

  it('sends the selected Azuk list, exact listing and alert settings after approval', async () => {
    const product = {
      ...proposal('a', 'A controller', { action: 'product' }),
      listingUrl: 'https://www.amazon.de/dp/B000000001',
    };
    const connection = 'b'.repeat(64);
    const list = { id: 'test-list', name: 'Bookmarkt test', kind: 'shopping' };
    const requests = renderQueue([product], '/review', { status: 'ready', connection, lists: [list] });
    const user = userEvent.setup();
    const row = within(await screen.findByRole('article', { name: 'A controller' }));
    expect(row.getByRole('button', { name: 'Send to Azuk' })).toBeDisabled();
    await user.selectOptions(await row.findByRole('combobox', { name: 'Azuk list' }), list.id);
    await user.type(row.getByRole('textbox', { name: 'Target price (optional)' }), '90.50');
    expect(row.getByRole('button', { name: 'Send to Azuk' })).toBeDisabled();
    await user.type(row.getByRole('textbox', { name: 'Currency' }), 'eur');
    await user.click(row.getByRole('button', { name: 'Send to Azuk' }));
    expect(await screen.findByText('Azuk delivery queued.')).toBeInTheDocument();
    expect(requests).toEqual([{ path: '/api/review/decisions', body: { items: [{
      id: 'a', revision: 2, sourceVersion: product.sourceVersion, decision: 'approve',
      azuk: { connection, listId: list.id, listName: list.name, listingUrl: product.listingUrl,
        productName: product.link.title, target: { price: '90.50', currency: 'EUR' } },
    }] } }]);
  });
});
