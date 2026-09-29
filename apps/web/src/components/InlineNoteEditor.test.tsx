import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import type { LinkDto } from '../api/types';
import { makeWrapper } from '../test/utils';
import { InlineNoteEditor } from './InlineNoteEditor';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, patchLink: vi.fn() };
});

const link = { id: 'l1', url: 'https://example.com', title: 'Example', note: 'first thought' } as LinkDto;

function renderEditor(over: Partial<LinkDto> = {}) {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <InlineNoteEditor link={{ ...link, ...over }} />
    </Wrapper>,
  );
}

describe('InlineNoteEditor', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows the note, and a quiet prompt when there is none', () => {
    const { unmount } = renderEditor();
    expect(screen.getByRole('button', { name: 'Edit note: first thought' })).toHaveTextContent('first thought');
    unmount();
    renderEditor({ note: '' });
    expect(screen.getByRole('button', { name: 'Add a note to Example' })).toBeInTheDocument();
  });

  it('saves on Enter, trimmed, and closes', async () => {
    vi.mocked(client.patchLink).mockResolvedValue({ ...link, note: 'second' });
    renderEditor();
    await userEvent.click(screen.getByRole('button', { name: /Edit note/ }));
    const box = screen.getByRole('textbox', { name: 'Note for Example' });
    await userEvent.clear(box);
    await userEvent.type(box, '  second  {Enter}');
    await waitFor(() => expect(client.patchLink).toHaveBeenCalledWith('l1', { note: 'second' }));
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
  });

  it('keeps Shift+Enter as a new line', async () => {
    renderEditor({ note: '' });
    await userEvent.click(screen.getByRole('button', { name: /Add a note/ }));
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'a{Shift>}{Enter}{/Shift}b');
    expect(box).toHaveValue('a\nb');
    expect(client.patchLink).not.toHaveBeenCalled();
  });

  it('puts the note back on Escape without saving', async () => {
    renderEditor();
    await userEvent.click(screen.getByRole('button', { name: /Edit note/ }));
    await userEvent.type(screen.getByRole('textbox'), ' more{Escape}');
    expect(client.patchLink).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit note: first thought' })).toBeInTheDocument();
  });

  it('keeps the text and says why when saving fails', async () => {
    vi.mocked(client.patchLink).mockRejectedValue(new client.ApiError('server is down', 500));
    renderEditor();
    await userEvent.click(screen.getByRole('button', { name: /Edit note/ }));
    await userEvent.type(screen.getByRole('textbox'), '!{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('server is down');
    expect(screen.getByRole('textbox')).toHaveValue('first thought!');
  });
});
