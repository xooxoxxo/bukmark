import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import type { ReleaseNote, UpdatesStatus } from '../api/types';
import { SidebarMenu } from '../components/SidebarMenu';
import { makeWrapper } from '../test/utils';
import { SettingsPage } from './SettingsPage';
import { UpdatesSection, relativeTime } from './UpdatesSection';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, fetchUpdates: vi.fn(), checkUpdates: vi.fn(), patchUpdates: vi.fn() };
});

function release(version: string, extra: Partial<ReleaseNote> = {}): ReleaseNote {
  return {
    tag: `v${version}`,
    version,
    name: `bukmark ${version}`,
    body: `Notes for ${version}.\n- first change\n- second change`,
    publishedAt: '2026-10-01T00:00:00Z',
    url: `https://github.com/xooxoxxo/bukmark/releases/tag/v${version}`,
    prerelease: false,
    requiresAttention: false,
    ...extra,
  };
}

const UP_TO_DATE: UpdatesStatus = {
  version: '0.3.0',
  development: false,
  install: 'installer',
  enabled: true,
  lockedByServer: false,
  lastCheckedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  error: null,
  latest: release('0.3.0'),
  newer: [],
  skippedVersion: null,
  updateAvailable: false,
};

const AVAILABLE: UpdatesStatus = {
  ...UP_TO_DATE,
  latest: release('0.4.0'),
  newer: [release('0.4.0'), release('0.3.1')],
  updateAvailable: true,
};

function status(over: Partial<UpdatesStatus>): UpdatesStatus {
  return { ...UP_TO_DATE, ...over };
}

function renderSection(data: UpdatesStatus | Error) {
  if (data instanceof Error) vi.mocked(client.fetchUpdates).mockRejectedValue(data);
  else vi.mocked(client.fetchUpdates).mockResolvedValue(data);
  const user = userEvent.setup();
  const Wrapper = makeWrapper();
  render(
    <Wrapper>
      <UpdatesSection />
    </Wrapper>,
  );
  return user;
}

describe('UpdatesSection', () => {
  beforeEach(() => {
    vi.mocked(client.fetchUpdates).mockReset();
    vi.mocked(client.checkUpdates).mockReset();
    vi.mocked(client.patchUpdates).mockReset();
  });

  it('says a newer version is out, with its notes, the command and how to undo', async () => {
    renderSection(AVAILABLE);
    expect(await screen.findByText('Running 0.3.0. 0.4.0 is out.')).toBeInTheDocument();
    expect(screen.getByText('5 minutes ago')).toBeInTheDocument();

    const newest = screen.getByText('What’s new in 0.4.0').closest('details')!;
    const older = screen.getByText('What’s new in 0.3.1').closest('details')!;
    expect(newest).toHaveAttribute('open');
    expect(older).not.toHaveAttribute('open');
    // Plain text, line breaks kept by CSS rather than parsed as markdown.
    expect(within(newest).getByText(/Notes for 0\.4\.0\./).textContent).toBe(
      'Notes for 0.4.0.\n- first change\n- second change',
    );
    expect(within(newest).getByRole('link', { name: 'Release on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/xooxoxxo/bukmark/releases/tag/v0.4.0',
    );

    expect(screen.getByText('bukmark update')).toBeInTheDocument();
    expect(screen.getByText(/Backs up the database first/)).toHaveTextContent(
      'Backs up the database first. To undo: bukmark rollback.',
    );
    expect(screen.queryByText(/git pull/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Skip this version' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop skipping' })).toBeNull();
  });

  it('warns above the command when a newer release needs attention', async () => {
    renderSection({ ...AVAILABLE, newer: [release('0.4.0', { requiresAttention: true }), release('0.3.1')] });
    expect(await screen.findByText(/0\.4\.0 needs a step from you/)).toBeInTheDocument();
  });

  it('shows the source command for a source install, and both, labelled, when unknown', async () => {
    renderSection({ ...AVAILABLE, install: 'source' });
    expect(await screen.findByText('git pull && docker compose up -d --build')).toBeInTheDocument();
    expect(screen.queryByText('bukmark update')).toBeNull();
  });

  it('labels both commands when the install method is unknown', async () => {
    renderSection({ ...AVAILABLE, install: 'unknown' });
    expect(await screen.findByText('Installed with the bukmark command')).toBeInTheDocument();
    expect(screen.getByText('Built from source')).toBeInTheDocument();
    expect(screen.getByText('bukmark update')).toBeInTheDocument();
    expect(screen.getByText('git pull && docker compose up -d --build')).toBeInTheDocument();
  });

  it('says up to date, with no notes or command', async () => {
    renderSection(UP_TO_DATE);
    expect(await screen.findByText('Running 0.3.0. Up to date.')).toBeInTheDocument();
    expect(screen.queryByText(/What’s new/)).toBeNull();
    expect(screen.queryByText('bukmark update')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Skip this version' })).toBeNull();
  });

  it('says development build and offers no update', async () => {
    renderSection(status({ version: 'dev', development: true, newer: [release('0.4.0')] }));
    expect(await screen.findByText('Development build.')).toBeInTheDocument();
    expect(screen.queryByText(/What’s new/)).toBeNull();
    expect(screen.queryByText('bukmark update')).toBeNull();
  });

  it('says checks are off, disables Check now and offers to turn them on', async () => {
    renderSection(status({ enabled: false }));
    expect(await screen.findByText('Running 0.3.0. Update checks are off.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Turn update checks on' })).toBeInTheDocument();
  });

  it('says the server sets the switch when locked, with no toggle', async () => {
    renderSection(status({ lockedByServer: true, enabled: false }));
    expect(await screen.findByText(/Set by the server/)).toHaveTextContent(
      'Set by the server (BUKMARK_UPDATE_FEED).',
    );
    expect(screen.queryByRole('button', { name: /Turn update checks/ })).toBeNull();
  });

  it('shows the last check’s error', async () => {
    renderSection(status({ error: 'GitHub answered 503' }));
    expect(await screen.findByText('The last check failed: GitHub answered 503')).toBeInTheDocument();
  });

  it('says so when the status cannot load', async () => {
    renderSection(new client.ApiError('database is down', 500));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load update status: database is down',
    );
  });

  it('checks now and shows the answer', async () => {
    let finish!: (value: UpdatesStatus) => void;
    vi.mocked(client.checkUpdates).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = renderSection(UP_TO_DATE);
    await user.click(await screen.findByRole('button', { name: 'Check now' }));
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    finish(AVAILABLE);
    expect(await screen.findByText('Running 0.3.0. 0.4.0 is out.')).toBeInTheDocument();
    expect(client.checkUpdates).toHaveBeenCalledTimes(1);
  });

  it('skips the newest version, then stops skipping', async () => {
    const skipped = { ...AVAILABLE, skippedVersion: '0.4.0', updateAvailable: false };
    vi.mocked(client.patchUpdates).mockResolvedValueOnce(skipped).mockResolvedValueOnce(AVAILABLE);
    const user = renderSection(AVAILABLE);

    await user.click(await screen.findByRole('button', { name: 'Skip this version' }));
    expect(client.patchUpdates).toHaveBeenLastCalledWith({ skippedVersion: '0.4.0' });
    expect(await screen.findByText('Running 0.3.0. You skipped 0.4.0.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip this version' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Stop skipping' }));
    expect(client.patchUpdates).toHaveBeenLastCalledWith({ skippedVersion: null });
    expect(await screen.findByText('Running 0.3.0. 0.4.0 is out.')).toBeInTheDocument();
  });

  it('turns update checks off and on', async () => {
    vi.mocked(client.patchUpdates)
      .mockResolvedValueOnce(status({ enabled: false }))
      .mockResolvedValueOnce(UP_TO_DATE);
    const user = renderSection(UP_TO_DATE);

    await user.click(await screen.findByRole('button', { name: 'Turn update checks off' }));
    expect(client.patchUpdates).toHaveBeenLastCalledWith({ enabled: false });
    await user.click(await screen.findByRole('button', { name: 'Turn update checks on' }));
    expect(client.patchUpdates).toHaveBeenLastCalledWith({ enabled: true });
    expect(await screen.findByRole('button', { name: 'Turn update checks off' })).toBeInTheDocument();
  });

  it('shows a refused change in the danger colour', async () => {
    vi.mocked(client.patchUpdates).mockRejectedValue(
      new client.ApiError('Set by the server (BUKMARK_UPDATE_FEED)', 409),
    );
    const user = renderSection(UP_TO_DATE);
    await user.click(await screen.findByRole('button', { name: 'Turn update checks off' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Set by the server');
  });

  it('copies the command, says Copied, then goes back', async () => {
    const user = renderSection(AVAILABLE);
    await user.click(await screen.findByRole('button', { name: 'Copy bukmark update' }));
    expect(await navigator.clipboard.readText()).toBe('bukmark update');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('says so when the clipboard refuses', async () => {
    const user = renderSection(AVAILABLE);
    await screen.findByRole('button', { name: 'Copy bukmark update' });
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Copy bukmark update' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not copy/i);
  });
});

describe('Settings page', () => {
  it('puts Updates first, above Appearance', async () => {
    vi.mocked(client.fetchUpdates).mockResolvedValue(UP_TO_DATE);
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </Wrapper>,
    );
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.slice(0, 2)).toEqual(['Updates', 'Appearance']);
  });
});

describe('Settings link in the sidebar', () => {
  function renderMenu(data: UpdatesStatus) {
    vi.mocked(client.fetchUpdates).mockResolvedValue(data);
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <MemoryRouter>
          <SidebarMenu />
        </MemoryRouter>
      </Wrapper>,
    );
  }

  it('carries a dot with hidden text when an update is available', async () => {
    renderMenu(AVAILABLE);
    expect(await screen.findByRole('link', { name: 'Settings update available' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('has no dot when the newest version is skipped', async () => {
    vi.mocked(client.fetchUpdates).mockResolvedValue({ ...AVAILABLE, skippedVersion: '0.4.0', updateAvailable: false });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <MemoryRouter>
          <SidebarMenu />
          <UpdatesSection />
        </MemoryRouter>
      </Wrapper>,
    );
    // The section shares the query, so once it shows the status the menu has it too.
    await screen.findByText('Running 0.3.0. You skipped 0.4.0.');
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByText('update available')).toBeNull();
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');
  it('rounds to minutes, hours or days', () => {
    expect(relativeTime('2026-10-11T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-10-11T11:55:00Z', now)).toBe('5 minutes ago');
    expect(relativeTime('2026-10-11T09:00:00Z', now)).toBe('3 hours ago');
    expect(relativeTime('2026-10-10T12:00:00Z', now)).toBe('yesterday');
  });
});
