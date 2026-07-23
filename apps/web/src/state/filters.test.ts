import { beforeEach, describe, expect, it } from 'vitest';
import { useFilters } from './filters';

describe('filters store', () => {
  beforeEach(() => {
    useFilters.getState().reset();
  });

  it('defaults: empty q, unassigned off, status active', () => {
    const s = useFilters.getState();
    expect(s.q).toBe('');
    expect(s.unassigned).toBe(false);
    expect(s.status).toBe('active');
  });

  it('setters update state', () => {
    useFilters.getState().setQ('rust');
    useFilters.getState().setUnassigned(true);
    useFilters.getState().setStatus('archived');
    const s = useFilters.getState();
    expect(s.q).toBe('rust');
    expect(s.unassigned).toBe(true);
    expect(s.status).toBe('archived');
  });

  it('reset restores defaults', () => {
    useFilters.getState().setQ('x');
    useFilters.getState().reset();
    expect(useFilters.getState().q).toBe('');
  });

  it('view toggles and survives reset', () => {
    useFilters.getState().setView('grid');
    expect(useFilters.getState().view).toBe('grid');
    useFilters.getState().reset();
    expect(useFilters.getState().view).toBe('grid');
    useFilters.getState().setView('list');
  });
});
