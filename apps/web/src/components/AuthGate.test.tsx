import { QueryClientProvider, useQuery, type QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import { ApiError, type AuthStatus } from '../api/client';
import { createQueryClient } from '../api/queryClient';
import { AppRoutes } from '../App';
import { AuthGate } from './AuthGate';

// Keep the real ApiError and errorMessage so error paths render real text.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return {
    ...actual,
    fetchAuthStatus: vi.fn(),
    setupOwner: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    fetchLinks: vi.fn(),
    fetchHubs: vi.fn(),
    fetchStats: vi.fn(),
  };
});

/** What GET /api/auth/status answers; the mocked auth calls move it like the server would. */
let server: AuthStatus;
let queryClient: QueryClient;

function renderGate(children: ReactNode = <p>App content</p>) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthGate>{children}</AuthGate>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function signIn(password: string) {
  fireEvent.change(await screen.findByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

async function createPassword(password: string) {
  fireEvent.change(await screen.findByLabelText('Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Create password' }));
}

function cachedKeys() {
  return queryClient
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey);
}

beforeEach(() => {
  vi.resetAllMocks();
  queryClient = createQueryClient();
  server = { setupComplete: true, authenticated: true };
  vi.mocked(client.fetchAuthStatus).mockImplementation(async () => ({ ...server }));
});

describe('AuthGate', () => {
  it('paints nothing at first, then a quiet notice if the status check is slow', async () => {
    vi.mocked(client.fetchAuthStatus).mockReturnValue(new Promise(() => {}));
    const { container } = renderGate();
    expect(container).toBeEmptyDOMElement();

    expect(await screen.findByRole('status')).toHaveTextContent('Connecting…');
    expect(screen.queryByText('App content')).not.toBeInTheDocument();
  });

  it('shows SetupScreen when setup is not complete', async () => {
    server = { setupComplete: false, authenticated: false };
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Set up bukmark' })).toBeInTheDocument();
    expect(screen.queryByText('App content')).not.toBeInTheDocument();
  });

  it('shows LoginScreen when not authenticated', async () => {
    server = { setupComplete: true, authenticated: false };
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('App content')).not.toBeInTheDocument();
  });

  it('shows app content when authenticated', async () => {
    renderGate();
    expect(await screen.findByText('App content')).toBeInTheDocument();
  });

  it('explains a failed status check and retries it, instead of a blank page', async () => {
    vi.mocked(client.fetchAuthStatus).mockRejectedValueOnce(new ApiError('database is down', 500));
    renderGate();

    expect(await screen.findByRole('alert')).toHaveTextContent('database is down');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('App content')).toBeInTheDocument();
  });

  it('leaves the login screen once the password is accepted', async () => {
    server = { setupComplete: true, authenticated: false };
    vi.mocked(client.login).mockImplementation(async () => {
      server.authenticated = true;
      return { ok: true };
    });
    renderGate();

    await signIn('correct horse battery');

    expect(await screen.findByText('App content')).toBeInTheDocument();
    expect(client.login).toHaveBeenCalledWith('correct horse battery');
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('leaves the setup screen once the password is created', async () => {
    server = { setupComplete: false, authenticated: false };
    vi.mocked(client.setupOwner).mockImplementation(async () => {
      server = { setupComplete: true, authenticated: true };
      return { ok: true };
    });
    renderGate();

    await createPassword('correct horse battery');

    expect(await screen.findByText('App content')).toBeInTheDocument();
    expect(client.setupOwner).toHaveBeenCalledWith('correct horse battery');
  });

  it('announces a wrong password and stays on the login screen', async () => {
    server = { setupComplete: true, authenticated: false };
    vi.mocked(client.login).mockRejectedValue(new ApiError('Wrong password', 401, 'bad_password'));
    renderGate();

    await signIn('not it');

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong password');
    // The 401 also refetches the status; the error must survive that.
    await waitFor(() => expect(client.fetchAuthStatus).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong password');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('moves to setup when the owner was reset while the login screen was open', async () => {
    server = { setupComplete: true, authenticated: false };
    vi.mocked(client.login).mockImplementation(async () => {
      server = { setupComplete: false, authenticated: false };
      throw new ApiError('Setup required', 409, 'setup_required');
    });
    renderGate();

    await signIn('correct horse battery');

    expect(await screen.findByRole('heading', { name: 'Set up bukmark' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('moves to login when setup finished elsewhere, without carrying the error over', async () => {
    server = { setupComplete: false, authenticated: false };
    vi.mocked(client.setupOwner).mockImplementation(async () => {
      server = { setupComplete: true, authenticated: false };
      throw new ApiError('Setup already complete', 409, 'already_setup');
    });
    renderGate();

    await createPassword('correct horse battery');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('flips to the login screen when a data query gets a 401, without retrying it', async () => {
    function Links() {
      const links = useQuery({ queryKey: ['links'], queryFn: () => client.fetchLinks() });
      return <p>{links.isError ? 'links failed' : 'App content'}</p>;
    }
    vi.mocked(client.fetchLinks).mockImplementation(async () => {
      server.authenticated = false;
      throw new ApiError('Session expired', 401, 'unauthenticated');
    });
    renderGate(<Links />);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(client.fetchLinks).toHaveBeenCalledTimes(1);
  });

  describe('logging out from Settings', () => {
    beforeEach(() => {
      vi.mocked(client.fetchHubs).mockResolvedValue({ items: [] });
      vi.mocked(client.fetchStats).mockResolvedValue({
        links: 0,
        active: 0,
        archived: 0,
        hubs: 0,
        unassigned: 0, broken: 0, unchecked: 0,
      });
      vi.mocked(client.fetchLinks).mockResolvedValue({ items: [], total: 0 });
    });

    async function logOut() {
      renderGate(<AppRoutes />);
      expect(await screen.findByText('0 results')).toBeInTheDocument();
      expect(cachedKeys()).toContainEqual(['hubs']);
      await userEvent.click(screen.getByRole('link', { name: 'Settings' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    }

    it('returns to the login screen and keeps nothing the session loaded', async () => {
      vi.mocked(client.logout).mockImplementation(async () => {
        server.authenticated = false;
        return { ok: true };
      });
      await logOut();

      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
      expect(client.logout).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('heading', { name: 'All links' })).not.toBeInTheDocument();
      expect(cachedKeys()).toEqual([['auth-status']]);
    });

    it('treats a session that had already ended as logged out', async () => {
      vi.mocked(client.logout).mockImplementation(async () => {
        server.authenticated = false;
        throw new ApiError('Session expired', 401, 'unauthenticated');
      });
      await logOut();

      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
      expect(cachedKeys()).toEqual([['auth-status']]);
    });

    it('stays signed in and says so when the server cannot be reached', async () => {
      vi.mocked(client.logout).mockRejectedValue(new TypeError('Failed to fetch'));
      await logOut();

      expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch');
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    });
  });
});
