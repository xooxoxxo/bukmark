import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import type { LinkDetail, QuoteDto } from '../api/types';
import { useEditing } from '../state/editing';
import { makeWrapper } from '../test/utils';
import { LinkEditor, checkLine } from './LinkEditor';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, fetchLink: vi.fn(), fetchHubs: vi.fn(), patchLink: vi.fn(), bulkLinks: vi.fn(), refreshLink: vi.fn(), fetchQuotes: vi.fn() };
});

const LINK: LinkDetail = {
  id: 'l1', url: 'https://a.dev/post', title: 'A post', note: 'why', status: 'active', relevance: 3,
  dupeCount: 1, hubIds: ['h1'], imageUrl: null, firstSeen: '2026-09-01T00:00:00.000Z',
  lastSeen: '2026-09-01T00:00:00.000Z', contentText: 'The words of the page, kept.', httpStatus: 200,
  checkError: null, checkedAt: '2026-09-20T00:00:00.000Z', broken: false,
};

function quote(over: Partial<QuoteDto>): QuoteDto {
  return {
    id: 'q1', linkId: 'l1', text: 'A passage.', note: '', sourceUrl: 'https://a.dev/post',
    sourceTitle: 'A post', createdAt: '2026-09-28T10:00:00.000Z', updatedAt: '2026-09-28T10:00:00.000Z',
    ...over,
  };
}

function renderEditor(link: Partial<LinkDetail> = {}) {
  vi.mocked(client.fetchLink).mockResolvedValue({ ...LINK, ...link });
  vi.mocked(client.fetchHubs).mockResolvedValue({
    items: [
      { id: 'h1', name: 'rust', description: '', status: 'active', linkCount: 1 },
      { id: 'h2', name: 'reading', description: '', status: 'active', linkCount: 0 },
    ],
  });
  useEditing.getState().open('l1');
  const Wrapper = makeWrapper();
  return render(<Wrapper><LinkEditor /></Wrapper>);
}

describe('LinkEditor', () => {
  beforeEach(() => {
    vi.mocked(client.patchLink).mockResolvedValue(LINK);
    vi.mocked(client.bulkLinks).mockResolvedValue({ affected: 1 });
  });
  afterEach(() => {
    useEditing.getState().close();
    vi.clearAllMocks();
  });

  it('shows the link’s fields, hubs, last check and saved copy', async () => {
    renderEditor();
    const dialog = await screen.findByRole('dialog', { name: 'Edit link' });
    expect(await within(dialog).findByLabelText('Title')).toHaveValue('A post');
    expect(within(dialog).getByLabelText('Note')).toHaveValue('why');
    expect(within(dialog).getByRole('checkbox', { name: 'rust' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'reading' })).not.toBeChecked();
    expect(within(dialog).getByText(/The page was there on/)).toBeInTheDocument();
    expect(within(dialog).getByText('The words of the page, kept.')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'https://a.dev/post' })).toHaveAttribute('target', '_blank');
  });

  it('saves only what changed, then the hub changes, and closes', async () => {
    renderEditor();
    const title = await screen.findByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Better title');
    await userEvent.click(screen.getByRole('checkbox', { name: 'rust' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'reading' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Archived' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(useEditing.getState().id).toBeNull());
    expect(client.patchLink).toHaveBeenCalledWith('l1', { title: 'Better title', status: 'archived' });
    expect(client.bulkLinks).toHaveBeenCalledWith({ ids: ['l1'], action: 'assign', hubId: 'h2' });
    expect(client.bulkLinks).toHaveBeenCalledWith({ ids: ['l1'], action: 'unassign', hubId: 'h1' });
  });

  it('sends nothing but the hub change when only a hub changed', async () => {
    renderEditor();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'reading' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(useEditing.getState().id).toBeNull());
    expect(client.patchLink).not.toHaveBeenCalled();
    expect(client.bulkLinks).toHaveBeenCalledTimes(1);
  });

  it('deletes only after a second, explicit click', async () => {
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete…' }));
    expect(client.bulkLinks).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(client.bulkLinks).toHaveBeenCalledWith({ ids: ['l1'], action: 'delete' }));
    await waitFor(() => expect(useEditing.getState().id).toBeNull());
  });

  it('says so when there is no copy yet', async () => {
    renderEditor({ contentText: null, checkedAt: null, httpStatus: null });
    expect(await screen.findByText(/No copy yet/)).toBeInTheDocument();
    expect(screen.getByText(/Not checked yet/)).toBeInTheDocument();
  });

  it('keeps the dialog open and says why when saving fails', async () => {
    vi.mocked(client.patchLink).mockRejectedValue(new client.ApiError('link not found', 404));
    renderEditor();
    const title = await screen.findByLabelText('Title');
    await userEvent.type(title, '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('link not found');
    expect(useEditing.getState().id).toBe('l1');
  });
});

describe('LinkEditor quotes', () => {
  afterEach(() => {
    useEditing.getState().close();
    vi.clearAllMocks();
  });

  it('lists the link’s quotes, with their notes, and copies each in the quote format', async () => {
    const user = userEvent.setup();
    vi.mocked(client.fetchQuotes).mockResolvedValue({
      items: [
        quote({ id: 'q2', text: 'The second passage.', note: 'why this one' }),
        quote({ id: 'q1', text: 'The first passage.\nOn two lines.' }),
      ],
      nextCursor: null,
    });
    renderEditor({ quoteCount: 2 });

    const quotes = await screen.findByRole('region', { name: 'Quotes (2)' });
    expect(client.fetchQuotes).toHaveBeenCalledWith(expect.objectContaining({ linkId: 'l1' }));
    expect(await within(quotes).findByText('The second passage.')).toBeInTheDocument();
    expect(within(quotes).getByText('why this one')).toBeInTheDocument();
    expect(within(quotes).getByText(/The first passage\./)).toBeInTheDocument();
    // Read only here: the Quotes view edits them.
    expect(within(quotes).queryByRole('button', { name: /edit|delete/i })).not.toBeInTheDocument();

    const copies = within(quotes).getAllByRole('button', { name: 'Copy' });
    await user.click(copies[1]!);
    expect(await navigator.clipboard.readText()).toBe('"The first passage.\nOn two lines."\n— A post, a.dev/post');
    expect(within(quotes).getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(within(quotes).getAllByRole('button', { name: 'Copy' })).toHaveLength(1);
  });

  it('says so when the clipboard refuses', async () => {
    const user = userEvent.setup();
    vi.mocked(client.fetchQuotes).mockResolvedValue({ items: [quote({})], nextCursor: null });
    renderEditor({ quoteCount: 1 });
    const copy = await screen.findByRole('button', { name: 'Copy' });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.click(copy);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not copy/i);
  });

  it('asks for no quotes when the link has none', async () => {
    renderEditor({ quoteCount: 0 });
    await screen.findByLabelText('Title');
    expect(client.fetchQuotes).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: /Quotes/ })).not.toBeInTheDocument();
  });

  it('says why when the quotes cannot load, and keeps the rest of the dialog', async () => {
    vi.mocked(client.fetchQuotes).mockRejectedValue(new client.ApiError('database is down', 500));
    renderEditor({ quoteCount: 1 });
    expect(await screen.findByText(/Could not load the quotes: database is down/)).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('A post');
  });
});

describe('checkLine', () => {
  const at = '2026-09-20T00:00:00.000Z';
  it.each([
    [{ checkedAt: null, httpStatus: null, checkError: null, broken: false }, /^Not checked yet/],
    [{ checkedAt: at, httpStatus: 404, checkError: null, broken: true }, /^Broken — the page answered 404/],
    [{ checkedAt: at, httpStatus: null, checkError: 'dns', broken: true }, /^Broken — the domain no longer exists/],
    [{ checkedAt: at, httpStatus: null, checkError: 'timeout', broken: false }, /took too long.*tried again later/],
    [{ checkedAt: at, httpStatus: 403, checkError: null, broken: false }, /answered 403/],
    [{ checkedAt: at, httpStatus: null, checkError: 'blocked', broken: false }, /not public/],
  ])('%j', (link, expected) => {
    expect(checkLine(link)).toMatch(expected);
  });

  it('updates the preview on request, even for a link that has none, and says what it found', async () => {
    vi.mocked(client.refreshLink).mockResolvedValueOnce({ ...LINK, imageUrl: 'https://a.dev/og.png' });
    renderEditor({ imageUrl: null });
    await userEvent.click(await screen.findByRole('button', { name: 'Update preview' }));
    expect(client.refreshLink).toHaveBeenCalledWith('l1');
    expect(await screen.findByText('Preview updated.')).toBeInTheDocument();

    vi.mocked(client.refreshLink).mockResolvedValueOnce({ ...LINK, imageUrl: null });
    await userEvent.click(screen.getByRole('button', { name: 'Update preview' }));
    expect(await screen.findByText('The page has no preview image.')).toBeInTheDocument();
  });

});
