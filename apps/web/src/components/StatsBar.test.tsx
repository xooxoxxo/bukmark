import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import { makeWrapper } from '../test/utils';
import { StatsBar } from './StatsBar';

vi.mock('../api/client');

describe('StatsBar', () => {
  it('renders counts from /api/stats', async () => {
    vi.mocked(client.fetchStats).mockResolvedValue({
      links: 4163,
      active: 2868,
      archived: 1295,
      hubs: 18,
      unassigned: 42,
    });
    render(<StatsBar />, { wrapper: makeWrapper() });
    expect(await screen.findByText('4163 links')).toBeInTheDocument();
    expect(screen.getByText('2868 active')).toBeInTheDocument();
    expect(screen.getByText('1295 archived')).toBeInTheDocument();
    expect(screen.getByText('18 hubs')).toBeInTheDocument();
    expect(screen.getByText('42 unassigned')).toBeInTheDocument();
  });
});
