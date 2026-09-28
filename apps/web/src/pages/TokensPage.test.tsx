import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import { ApiError, type ApiToken } from '../api/client';
import { bookmarklet } from '../save/bookmarklet';
import { TokensPage } from './TokensPage';
import { makeWrapper } from '../test/utils';

// Keep the real ApiError and errorMessage so error paths render real text.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, listTokens: vi.fn(), createToken: vi.fn(), deleteToken: vi.fn() };
});

const PLAINTEXT = 'bkm_xyz1234567890abcdefghijklmnopqrstuvwxyz0123';

function token(id: string, name: string, prefix: string): ApiToken {
  return { id, name, prefix, createdAt: new Date().toISOString(), lastUsedAt: null };
}

const MCP = token('token-1', 'MCP Server', 'bkm_abc12345');
const CAPTURE = token('token-2', 'bukmark capture', 'bkm_def67890');

function renderPage() {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <TokensPage />
    </Wrapper>,
  );
}

function setClipboard(clipboard: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

async function createScriptToken() {
  vi.mocked(client.createToken).mockResolvedValue({
    id: 'new-token',
    name: 'Script',
    prefix: PLAINTEXT.slice(0, 12),
    createdAt: new Date().toISOString(),
    token: PLAINTEXT,
  });
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Script' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
  return (await screen.findByRole('textbox', { name: 'New access token' })) as HTMLInputElement;
}

describe('TokensPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(client.listTokens).mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    setClipboard(undefined);
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('explains what tokens are for, leaving the title to the toolbar', async () => {
    renderPage();
    expect(await screen.findByText('No tokens created yet.')).toBeInTheDocument();
    expect(
      screen.getByText(/The browser extension creates its own token when you log in from it/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Access tokens' })).not.toBeInTheDocument();
  });

  it('loads and displays tokens list', async () => {
    vi.mocked(client.listTokens).mockResolvedValue({ items: [MCP] });
    renderPage();
    expect(await screen.findByText('MCP Server')).toBeInTheDocument();
    expect(screen.getByText(/bkm_abc12345/)).toBeInTheDocument();
  });

  it('reports a failed token list instead of claiming there are none, and retries', async () => {
    vi.mocked(client.listTokens)
      .mockRejectedValueOnce(new ApiError('database is down', 500))
      .mockResolvedValueOnce({ items: [MCP] });
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load tokens: database is down",
    );
    expect(screen.queryByText('No tokens created yet.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('MCP Server')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a new token once, focused and labelled, and forgets it after Done', async () => {
    renderPage();
    const input = await createScriptToken();

    expect(client.createToken).toHaveBeenCalledWith('Script');
    expect(input).toHaveValue(PLAINTEXT);
    expect(input).toHaveFocus();
    expect(screen.getByText(/You won't see this token again/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.queryByDisplayValue(PLAINTEXT)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(PLAINTEXT);
    expect(screen.getByLabelText('Name')).toHaveFocus();
  });

  it('copies the token and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    renderPage();
    await createScriptToken();

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await screen.findByText('Copied')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(PLAINTEXT);
  });

  it('selects the token and says so when there is no clipboard (plain http)', async () => {
    const execCommand = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    renderPage();
    const input = await createScriptToken();
    const copy = screen.getByRole('button', { name: 'Copy' });
    copy.focus();

    fireEvent.click(copy);

    expect(
      await screen.findByText('Copy failed. The token is selected; press Ctrl/Cmd+C.'),
    ).toBeInTheDocument();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(input).toHaveFocus();
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, PLAINTEXT.length]);
  });

  it('says so when the clipboard refuses the write', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) });
    renderPage();
    await createScriptToken();

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(
      await screen.findByText('Copy failed. The token is selected; press Ctrl/Cmd+C.'),
    ).toBeInTheDocument();
  });

  it('names each Revoke button after its token', async () => {
    vi.mocked(client.listTokens).mockResolvedValue({ items: [MCP, CAPTURE] });
    renderPage();

    expect(
      await screen.findByRole('button', { name: 'Revoke MCP Server (bkm_abc12345)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Revoke bukmark capture (bkm_def67890)' }),
    ).toBeInTheDocument();
  });

  it('revokes a token after confirmation, with focus starting on Cancel', async () => {
    vi.mocked(client.listTokens)
      .mockResolvedValueOnce({ items: [MCP] })
      .mockResolvedValueOnce({ items: [] });
    vi.mocked(client.deleteToken).mockResolvedValue({ ok: true });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke MCP Server (bkm_abc12345)' }));

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke MCP Server (bkm_abc12345)' }));

    await waitFor(() => expect(client.deleteToken).toHaveBeenCalledWith('token-1'));
    expect(await screen.findByText('No tokens created yet.')).toBeInTheDocument();
  });

  it('cancels token deletion and returns focus to that row', async () => {
    vi.mocked(client.listTokens).mockResolvedValue({ items: [MCP, CAPTURE] });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke MCP Server (bkm_abc12345)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Revoke MCP Server (bkm_abc12345)' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(client.deleteToken).not.toHaveBeenCalled();
  });

  it('sends iPhone and iPad owners to the iOS Shortcut guide', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'iPhone and iPad' })).toBeInTheDocument();
    const guide = screen.getByRole('link', { name: 'Set up the iOS Shortcut' });
    expect(guide).toHaveAttribute('href', 'https://bukmark.it/docs/phone/#ios-shortcut');
    expect(guide).toHaveAttribute('target', '_blank');
    expect(guide).toHaveAttribute('rel', 'noreferrer');
  });

  it("offers a bookmarklet for this server's save page that holds no token", async () => {
    renderPage();
    await createScriptToken();

    const link = screen.getByRole('link', { name: 'Save to bukmark' });
    const href = link.getAttribute('href') ?? '';
    expect(href).toBe(bookmarklet(window.location.origin));
    expect(href).toContain(`${window.location.origin}/save?url=`);
    expect(href).not.toContain(PLAINTEXT);
    // Clicked here rather than dragged, it would only save this page.
    expect(fireEvent.click(link)).toBe(false);
  });

  it('announces a failed revoke and refreshes the stale list', async () => {
    vi.mocked(client.listTokens)
      .mockResolvedValueOnce({ items: [MCP] })
      .mockResolvedValueOnce({ items: [] });
    vi.mocked(client.deleteToken).mockRejectedValue(new ApiError('Token not found', 404));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke MCP Server (bkm_abc12345)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke MCP Server (bkm_abc12345)' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Token not found');
    expect(await screen.findByText('No tokens created yet.')).toBeInTheDocument();
    expect(client.listTokens).toHaveBeenCalledTimes(2);
  });
});
