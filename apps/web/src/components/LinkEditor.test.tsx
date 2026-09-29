import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import type { LinkDetail } from '../api/types';
import { useEditing } from '../state/editing';
import { makeWrapper } from '../test/utils';
import { LinkEditor, checkLine } from './LinkEditor';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, fetchLink: vi.fn(), fetchHubs: vi.fn(), patchLink: vi.fn(), bulkLinks: vi.fn(), refreshLink: vi.fn() };
});

const LINK: LinkDetail = {
  id: 'l1', url: 'https://a.dev/post', title: 'A post', note: 'why', status: 'active', relevance: 3,
  dupeCount: 1, hubIds: ['h1'], imageUrl: null, firstSeen: '2026-09-01T00:00:00.000Z',
  lastSeen: '2026-09-01T00:00:00.000Z', contentText: 'The words of the page, kept.', httpStatus: 200,
  checkError: null, checkedAt: '2026-09-20T00:00:00.000Z', broken: false,
};

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
