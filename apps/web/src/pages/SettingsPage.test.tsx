import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import { MemoryRouter } from 'react-router-dom';
import { SidebarMenu } from '../components/SidebarMenu';
import { makeWrapper } from '../test/utils';
import { ACCENT_KEY, BRAND_ACCENT, THEME_KEY } from '../theme';
import { SettingsPage } from './SettingsPage';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, importLinks: vi.fn(), logout: vi.fn() };
});

function renderSettings() {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
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

describe('SettingsPage', () => {
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
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.accent;
    document.documentElement.style.removeProperty('--bk-accent');
  });

  it('is one visible link in the sidebar', () => {
    render(
      <MemoryRouter>
        <SidebarMenu />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('switches between system, light and dark, and remembers the choice', async () => {
    renderSettings();
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();

    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');

    await userEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it('recolours the accent, and goes back to the bukmark orange', async () => {
    renderSettings();
    expect(screen.getByRole('radio', { name: 'Orange' })).toBeChecked();

    await userEvent.click(screen.getByRole('radio', { name: 'Blue' }));
    expect(document.documentElement.style.getPropertyValue('--bk-accent')).toBe('#3a6df0');
    expect(document.documentElement.dataset.accent).toBe('custom');
    expect(localStorage.getItem(ACCENT_KEY)).toBe('#3a6df0');

    await userEvent.click(screen.getByRole('button', { name: 'Back to bukmark orange' }));
    expect(document.documentElement.style.getPropertyValue('--bk-accent')).toBe('');
    expect(localStorage.getItem(ACCENT_KEY)).toBeNull();
    expect(screen.getByRole('radio', { name: 'Orange' })).toBeChecked();
    expect(BRAND_ACCENT).toBe('#fd441d');
  });

  it('takes a custom colour and warns when it is hard to read', () => {
    renderSettings();
    fireEvent.change(screen.getByLabelText('Custom colour'), { target: { value: '#ffee00' } });

    expect(document.documentElement.style.getPropertyValue('--bk-accent')).toBe('#ffee00');
    expect(screen.getByText(/hard to read on the light theme/)).toBeInTheDocument();
  });

  it('exports every active link in three formats, and a full backup', () => {
    renderSettings();
    expect(screen.getByRole('link', { name: 'Export HTML' })).toHaveAttribute('href', '/api/export?format=html');
    expect(screen.getByRole('link', { name: 'Export JSON' })).toHaveAttribute('href', '/api/export?format=json');
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', '/api/export?format=csv');
    expect(screen.getByRole('link', { name: 'Full backup' })).toHaveAttribute(
      'href',
      '/api/export?format=json&status=all',
    );
  });

  it('links to access tokens and logs out through the API', async () => {
    vi.mocked(client.logout).mockResolvedValue({ ok: true });
    renderSettings();
    expect(screen.getByRole('link', { name: 'Access tokens' })).toHaveAttribute('href', '/settings/tokens');

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(client.logout).toHaveBeenCalledTimes(1));
  });

  it('offers importing bookmarks', () => {
    renderSettings();
    expect(screen.getByRole('button', { name: 'Import bookmarks…' })).toBeInTheDocument();
  });

  it('imports the parsed links from a chosen bookmarks file', async () => {
    renderSettings();

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
    renderSettings();

    await userEvent.upload(screen.getByTestId('import-file'), bookmarksFile(`<DL><p>${many}</DL><p>`));

    await waitFor(() => expect(client.importLinks).toHaveBeenCalledTimes(2));
    expect(vi.mocked(client.importLinks).mock.calls[1]?.[0]).toHaveLength(5);
  });

  it('reports a json file that is not a backup without calling the API', async () => {
    renderSettings();

    await userEvent.upload(
      screen.getByTestId('import-file'),
      new File(['{"settings":{}}'], 'prefs.json', { type: 'application/json' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/bukmark backup/);
    expect(client.importLinks).not.toHaveBeenCalled();
  });

  it('surfaces a failed import instead of reporting success', async () => {
    vi.mocked(client.importLinks).mockRejectedValue(new client.ApiError('database is down', 500));
    renderSettings();

    await userEvent.upload(screen.getByTestId('import-file'), bookmarksFile(TWO_LINKS));

    expect(await screen.findByRole('alert')).toHaveTextContent('database is down');
  });
});
