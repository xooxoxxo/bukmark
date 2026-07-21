import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFilters } from '../state/filters';
import { SearchBox } from './SearchBox';

describe('SearchBox', () => {
  beforeEach(() => {
    useFilters.getState().reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces input into the filters store', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchBox />);
    await user.type(screen.getByPlaceholderText('Search links…'), 'rust');
    expect(useFilters.getState().q).toBe('');
    vi.advanceTimersByTime(300);
    expect(useFilters.getState().q).toBe('rust');
  });
});
