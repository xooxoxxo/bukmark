import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import type { QuoteDto } from '../api/types';
import { makeWrapper } from '../test/utils';
import { QuoteCard } from './QuoteCard';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, patchQuote: vi.fn(), deleteQuote: vi.fn(), fetchQuotes: vi.fn() };
});

const base: QuoteDto = {
  id: 'q1',
  linkId: 'l1',
  text: 'The quoted passage.\nSecond line.',
  note: 'why it mattered',
  sourceUrl: 'https://www.example.com/article?ref=x',
  sourceTitle: 'Example Article',
  createdAt: '2026-09-28T10:00:00.000Z',
  updatedAt: '2026-09-28T10:00:00.000Z',
};

function renderCard(over: Partial<QuoteDto> = {}) {
  const user = userEvent.setup();
  const Wrapper = makeWrapper();
  render(
    <Wrapper>
      <QuoteCard quote={{ ...base, ...over }} />
    </Wrapper>,
  );
  return user;
}

describe('QuoteCard', () => {
  beforeEach(() => {
    vi.mocked(client.patchQuote).mockReset();
    vi.mocked(client.deleteQuote).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows the passage, its note, the source as an outside link and the date', () => {
    renderCard();
    expect(screen.getByText(/The quoted passage\./)).toHaveTextContent('The quoted passage. Second line.');
    expect(screen.getByRole('button', { name: 'Edit note: why it mattered' })).toBeInTheDocument();
    const source = screen.getByRole('link', { name: /Example Article/ });
    expect(source).toHaveAttribute('href', 'https://www.example.com/article?ref=x');
    expect(source).toHaveAttribute('target', '_blank');
    expect(source).toHaveAttribute('rel', 'noreferrer');
    expect(source).toHaveTextContent('example.com');
    expect(screen.getByText(/2026/).tagName).toBe('TIME');
  });

  it('names the source by its address when the page had no title', () => {
    renderCard({ sourceTitle: '' });
    expect(screen.getByRole('link', { name: 'example.com/article' })).toBeInTheDocument();
  });

  it('copies the passage and its source, says Copied, then goes back', async () => {
    const user = renderCard();
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe(
      '"The quoted passage.\nSecond line."\n— Example Article, example.com/article',
    );
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument(), {
      timeout: 2500,
    });
  });

  it('says so when the clipboard refuses', async () => {
    const user = renderCard();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not copy/i);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('edits the note in place', async () => {
    vi.mocked(client.patchQuote).mockResolvedValue({ ...base, note: 'better' });
    const user = renderCard();
    await user.click(screen.getByRole('button', { name: /Edit note/ }));
    const box = screen.getByRole('textbox', { name: /Note for/ });
    expect(box).toHaveAttribute('maxLength', '10000');
    await user.clear(box);
    await user.type(box, 'better{Enter}');
    await waitFor(() => expect(client.patchQuote).toHaveBeenCalledWith('q1', { note: 'better' }));
  });

  it('edits text and note in a dialog, sending only what changed', async () => {
    vi.mocked(client.patchQuote).mockResolvedValue({ ...base, text: 'Shorter.' });
    const user = renderCard();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit quote' });
    const text = within(dialog).getByLabelText('Text');
    expect(text).toHaveValue(base.text);
    await user.clear(text);
    await user.type(text, 'Shorter.');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(client.patchQuote).toHaveBeenCalledWith('q1', { text: 'Shorter.' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('will not save an empty text, and Cancel closes without saving', async () => {
    const user = renderCard();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit quote' });
    await user.clear(within(dialog).getByLabelText('Text'));
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(client.patchQuote).not.toHaveBeenCalled();
  });

  it('explains a same-page collision and keeps the dialog open', async () => {
    vi.mocked(client.patchQuote).mockRejectedValue(
      new client.ApiError('this page already has a quote with that text', 409),
    );
    const user = renderCard();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit quote' });
    await user.type(within(dialog).getByLabelText('Text'), ' More.');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Another quote from this page already has that text.',
    );
  });

  it('deletes only after a confirm, and Keep backs out', async () => {
    vi.mocked(client.deleteQuote).mockResolvedValue(undefined);
    const user = renderCard();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(client.deleteQuote).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.queryByText('Delete this quote?')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this quote?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete for good' }));
    await waitFor(() => expect(client.deleteQuote).toHaveBeenCalledWith('q1'));
  });

  it('shows why a delete failed', async () => {
    vi.mocked(client.deleteQuote).mockRejectedValue(new client.ApiError('not found', 404));
    const user = renderCard();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete for good' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not found');
  });
});
