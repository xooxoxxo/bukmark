import { act, fireEvent, render, screen } from '@testing-library/react';
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

  it('debounces input into the filters store', () => {
    render(<SearchBox />);
    const input = screen.getByPlaceholderText('Search links…');
    act(() => {
      fireEvent.change(input, { target: { value: 'rust' } });
    });
    expect(useFilters.getState().q).toBe('');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(useFilters.getState().q).toBe('rust');
  });
});
