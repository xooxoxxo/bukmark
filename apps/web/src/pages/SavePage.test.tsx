import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import type { HubDto, LinkDto } from '../api/types';
import { AppRoutes } from '../App';
import { AuthGate } from '../components/AuthGate';

const PASSWORD = 'correct horse battery staple';
const SHARED = 'https://example.com/a';

interface SentRequest {
  method: string;
  url: string;
  contentType: string | null;
  body: unknown;
}

type Body = Record<string, string>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function savedLink(body: Body, dupeCount = 1): LinkDto {
  return {
    id: 'link-1',
    url: body.url!,
    title: body.title ?? '',
    note: body.note ?? '',
    status: 'active',
    relevance: null,
    dupeCount,
    hubIds: [],
    imageUrl: null,
    firstSeen: '2026-09-28T00:00:00.000Z',
  };
}

function hub(id: string, name: string): HubDto {
  return { id, name, description: '', status: 'active', linkCount: 0 };
}

/** Stands in for the bukmark server: every request the app makes lands here and is kept. */
function fakeServer() {
  const state = {
    authenticated: true,
    hubs: [] as HubDto[],
    hubsFail: false,
    save: (body: Body): Response => json(200, { outcome: 'created', link: savedLink(body) }),
  };
  const sent: SentRequest[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Body) : undefined;
      sent.push({ method, url: input, contentType: new Headers(init.headers).get('content-type'), body });
      const route = `${method} ${new URL(input, window.location.origin).pathname}`;

      if (route === 'GET /api/auth/status') {
        return json(200, { setupComplete: true, authenticated: state.authenticated });
      }
      if (route === 'POST /api/auth/login') {
        if (body?.password !== PASSWORD) return json(401, { error: 'Wrong password', code: 'bad_password' });
        state.authenticated = true;
        return json(200, { ok: true });
      }
      if (!state.authenticated) return json(401, { error: 'Sign in first', code: 'unauthenticated' });
      if (route === 'GET /api/hubs') {
        return state.hubsFail ? json(500, { error: 'database is down' }) : json(200, { items: state.hubs });
      }
      if (route === 'POST /api/links') return state.save(body!);
      if (route === 'GET /api/links') return json(200, { items: [], total: 0 });
      if (route === 'GET /api/stats') {
        return json(200, { links: 0, active: 0, archived: 0, hubs: 0, unassigned: 0 });
      }
      return json(404, { error: 'not found' });
    }),
  );

  return {
    state,
    sent,
    saves: () => sent.filter((r) => r.method === 'POST' && r.url === '/api/links'),
    asked: (method: string, url: string) => sent.some((r) => r.method === method && r.url === url),
  };
}

let server: ReturnType<typeof fakeServer>;

const query = (params: Record<string, string>) => new URLSearchParams(params).toString();

/** Opens /save the way the bookmarklet or the share sheet does: a fresh load of that URL. */
function openSave(search: string) {
  window.history.replaceState(null, '', `/save?${search}`);
  render(
    <QueryClientProvider client={createQueryClient()}>
      <BrowserRouter>
        <AuthGate>
          <AppRoutes />
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

/** Lets anything the page might still do on its own run first. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

async function signIn() {
  fireEvent.change(await screen.findByLabelText('Password'), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  server = fakeServer();
  vi.spyOn(window, 'close').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SavePage', () => {
  it('prefills the form from its query and sends nothing until Save is pressed', async () => {
    server.state.hubs = [hub('h1', 'Travel')];
    openSave(query({ url: SHARED, title: 'Example page' }));

    expect(await screen.findByLabelText('Title')).toHaveValue('Example page');
    expect(screen.getByLabelText('Link')).toHaveValue(SHARED);
    await waitFor(() => expect(server.asked('GET', '/api/hubs')).toBe(true));
    await settle();

    expect(server.sent.filter((r) => r.method !== 'GET')).toEqual([]);
    // A page of its own, for a popup or a phone: no sidebar and no link list behind it.
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    expect(server.asked('GET', '/api/stats')).toBe(false);
  });

  it('takes the link from text when a share leaves url empty', async () => {
    openSave(query({ title: 'Example page', text: `Example page ${SHARED}`, url: '' }));

    expect(await screen.findByLabelText('Link')).toHaveValue(SHARED);
    expect(screen.getByLabelText('Title')).toHaveValue('Example page');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('posts once when Save is pressed, however fast it is pressed again', async () => {
    server.state.hubs = [hub('h2', 'Travel'), hub('h1', 'Reading')];
    openSave(query({ url: SHARED, title: 'Example page' }));
    fireEvent.change(await screen.findByLabelText('Why keep it?'), {
      target: { value: 'for the trip' },
    });
    await userEvent.click(screen.getByRole('combobox', { name: 'Hub' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Travel' }));

    const save = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
    await settle();
    expect(server.saves()).toEqual([
      {
        method: 'POST',
        url: '/api/links',
        contentType: 'application/json',
        body: { url: SHARED, title: 'Example page', note: 'for the trip', hub: 'Travel' },
      },
    ]);
  });

  it('sends only what was filled in, so saving again keeps an existing title and note', async () => {
    openSave(query({ url: SHARED, title: '   ' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    await screen.findByRole('status');
    expect(server.saves().map((r) => r.body)).toEqual([{ url: SHARED }]);
  });

  it('asks for the password when signed out, then returns to /save with its link intact', async () => {
    server.state.authenticated = false;
    const search = query({ url: SHARED, title: 'Example page' });
    openSave(search);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Link')).not.toBeInTheDocument();
    await signIn();

    expect(await screen.findByLabelText('Link')).toHaveValue(SHARED);
    expect(screen.getByLabelText('Title')).toHaveValue('Example page');
    expect(`${window.location.pathname}${window.location.search}`).toBe(`/save?${search}`);
    await settle();
    expect(server.saves()).toEqual([]);
  });

  it('comes back through sign-in without re-sending when the session ends mid-save', async () => {
    server.state.save = () => {
      server.state.authenticated = false;
      return json(401, { error: 'Session expired', code: 'unauthenticated' });
    };
    openSave(query({ url: SHARED, title: 'Example page' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    await signIn();

    expect(await screen.findByLabelText('Link')).toHaveValue(SHARED);
    await settle();
    expect(server.saves()).toHaveLength(1);
  });

  it('explains a failed save and sends again only when Save is pressed again', async () => {
    let failures = 1;
    const created = server.state.save;
    server.state.save = (body) =>
      failures-- > 0 ? json(500, { error: 'database is down' }) : created(body);
    openSave(query({ url: SHARED }));

    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('database is down');
    await settle();
    expect(server.saves()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
    expect(server.saves()).toHaveLength(2);
  });

  it('refuses a link the server cannot save, and says why', async () => {
    openSave(query({ url: 'javascript:alert(1)', title: 'Example page' }));
    const link = await screen.findByLabelText('Link');

    expect(link).toHaveAccessibleDescription('Only http and https links can be saved.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Save a link' }));
    await settle();
    expect(server.saves()).toEqual([]);

    fireEvent.change(link, { target: { value: SHARED } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('asks for the link when a share carried none', async () => {
    openSave(query({ text: 'just some words' }));

    expect(await screen.findByLabelText('Link')).toHaveValue('');
    expect(screen.getByLabelText('Link')).toHaveAccessibleDescription('Paste the link to save.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('still saves when the hub list cannot load', async () => {
    server.state.hubsFail = true;
    openSave(query({ url: SHARED }));

    expect(
      await screen.findByText('Could not load hubs — saving still works.', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
    expect(server.saves().map((r) => r.body)).toEqual([{ url: SHARED }]);
  });

  it('says what happened, then closes a window that was opened just for saving', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    server.state.save = (body) => json(200, { outcome: 'updated', link: savedLink(body, 3) });
    openSave(query({ url: SHARED, title: 'Example page' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Updated — seen 3×');
    expect(window.close).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(window.close).toHaveBeenCalledTimes(1);
  });

  it('stays open, with a way into the app, in a tab that has its own history', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
    openSave(query({ url: SHARED, title: 'Example page' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(window.close).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('link', { name: 'Open bukmark' }));
    expect(await screen.findByRole('heading', { name: 'All links' })).toBeInTheDocument();
  });

  it('moves focus from the Save button it removes to what happened, so it is read out', async () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
    server.state.save = (body) => json(200, { outcome: 'resurrected', link: savedLink(body) });
    openSave(query({ url: SHARED }));

    const save = await screen.findByRole('button', { name: 'Save' });
    save.focus();
    fireEvent.click(save);

    const outcome = await screen.findByRole('status');
    expect(outcome).toHaveTextContent('Restored — you had deleted this before');
    await waitFor(() => expect(outcome).toHaveFocus());
  });
});
