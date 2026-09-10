import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import { makeWrapper } from '../test/utils';
import { SidebarMenu } from './SidebarMenu';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, importLinks: vi.fn() };
});

function renderMenu() {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <SidebarMenu />
    </Wrapper>,
  );
}

function bookmarksFile(html: string, name = 'bookmarks.html'): File {
  return new File([html], name, { type: 'text/html' });
}

const TWO_LINKS = `<DL><p>
  <DT><H3>reading</H3>
  <DL><p>
    <DT><A HREF="https://a.com/1">Alpha</A>
    <DT><A HREF="https://a.com/2">Beta</A>
  </DL><p>
</DL><p>`;

describe('SidebarMenu', () => {
  beforeEach(() => {
    vi.mocked(client.importLinks).mockResolvedValue({
      created: 2,
      updated: 0,
      skippedDeleted: 0,
      invalid: [],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('states that the instance has no account rather than offering a sign-out', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(await screen.findByText(/No account/)).toBeInTheDocument();
    expect(screen.queryByText(/log ?out|sign ?out/i)).not.toBeInTheDocument();
  });

  it('offers importing bookmarks', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(await screen.findByText('Import bookmarks…')).toBeInTheDocument();
  });

  it('imports the parsed links from a chosen bookmarks file', async () => {
    renderMenu();

    await userEvent.upload(screen.getByTestId('import-file'), bookmarksFile(TWO_LINKS));

    await waitFor(() => expect(client.importLinks).toHaveBeenCalledTimes(1));
    expect(vi.mocked(client.importLinks).mock.calls[0]?.[0]).toEqual([
      { url: 'https://a.com/1', title: 'Alpha', folderPath: 'reading' },
      { url: 'https://a.com/2', title: 'Beta', folderPath: 'reading' },
    ]);
    expect(await screen.findByRole('status')).toHaveTextContent('2 added');
  });

  it('sends more than one batch when the file exceeds the request cap', async () => {
    const many = Array.from(
      { length: client.IMPORT_BATCH_SIZE + 5 },
      (_, i) => `<DT><A HREF="https://a.com/${i}">L${i}</A>`,
    ).join('\n');
    renderMenu();

    await userEvent.upload(screen.getByTestId('import-file'), bookmarksFile(`<DL><p>${many}</DL><p>`));

    await waitFor(() => expect(client.importLinks).toHaveBeenCalledTimes(2));
    expect(vi.mocked(client.importLinks).mock.calls[1]?.[0]).toHaveLength(5);
  });

  it('reports a json file that is not a backup without calling the API', async () => {
    renderMenu();

    await userEvent.upload(
      screen.getByTestId('import-file'),
      new File(['{"settings":{}}'], 'prefs.json', { type: 'application/json' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/bukmark backup/);
    expect(client.importLinks).not.toHaveBeenCalled();
  });

  it('surfaces a failed import instead of reporting success', async () => {
    vi.mocked(client.importLinks).mockRejectedValue(new client.ApiError('database is down', 500));
    renderMenu();

    await userEvent.upload(screen.getByTestId('import-file'), bookmarksFile(TWO_LINKS));

    expect(await screen.findByRole('alert')).toHaveTextContent('database is down');
  });
});
