import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import type { ImportDecision, ImportReviewItem } from '@bukmark/shared/review';
import { makeWrapper } from '../test/utils';
import { ImportReviewPage } from './ImportReviewPage';

afterEach(() => vi.unstubAllGlobals());

it('submits only selected clear suggestions and offers skipped questions again', async () => {
  const rows: ImportReviewItem[] = Array.from({ length: 30 }, (_, i) => ({
    id: String(i), version: 'v', revision: 0, title: 'Bookmark ' + i, host: 'example.test',
    address: 'https://example.test/' + i, protected: true, outcome: null, state: i < 15 ? 'clear' : 'question',
    suggestion: i < 15 ? { folder: 'References', reason: 'Guide' }
      : { folder: null, reason: 'Open task', question: 'What comes next?' },
  }));
  const batches: ImportDecision[][] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/imports/test') return Response.json({ name: 'Phone import', items: rows });
    if (url !== '/api/imports/test/decisions') throw new Error('Unexpected request');
    const items = JSON.parse(String(init?.body)).items as ImportDecision[];
    batches.push(items);
    for (const input of items) {
      const row = rows.find(r => r.id === input.id)!;
      row.state = input.choice === 'skip' ? 'skipped' : 'saved';
      row.outcome = input.answer ?? null;
      row.revision++;
    }
    return new Response(null, { status: 204 });
  }));
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={['/imports/test']}><Routes><Route path="/imports/:id" element={<ImportReviewPage />} /></Routes></MemoryRouter>,
    { wrapper: makeWrapper() });
  await user.click(await screen.findByText('Choose bookmarks (15 of 15)'));
  await user.click(screen.getByRole('checkbox', { name: /^Bookmark 0$/ }));
  await user.click(screen.getByRole('button', { name: 'Accept 14 suggestions' }));
  await waitFor(() => expect(batches[0]?.map(row => row.id)).toEqual(rows.slice(1, 15).map(row => row.id)));
  await screen.findByText('14 decisions saved.');
  await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
  await user.click(await screen.findByRole('button', { name: 'Bookmark 15' }));
  await user.type(screen.getByRole('textbox', { name: 'What comes next?' }), 'Return on Friday');
  await user.click(screen.getByRole('button', { name: 'Save answer' }));
  await waitFor(() => expect(batches[2]?.[0]).toMatchObject({ id: '15', revision: 1, choice: 'answer', answer: 'Return on Friday' }));
});
