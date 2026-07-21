import { beforeEach, describe, expect, it } from 'vitest';
import { useSelection } from './selection';

describe('selection store', () => {
  beforeEach(() => {
    useSelection.getState().clear();
  });

  it('toggle adds then removes an id', () => {
    useSelection.getState().toggle('a');
    expect(useSelection.getState().selected.has('a')).toBe(true);
    useSelection.getState().toggle('a');
    expect(useSelection.getState().selected.has('a')).toBe(false);
  });

  it('setMany selects and deselects in bulk', () => {
    useSelection.getState().setMany(['a', 'b', 'c'], true);
    expect(useSelection.getState().selected.size).toBe(3);
    useSelection.getState().setMany(['a', 'b'], false);
    expect([...useSelection.getState().selected]).toEqual(['c']);
  });

  it('clear empties the set', () => {
    useSelection.getState().setMany(['a', 'b'], true);
    useSelection.getState().clear();
    expect(useSelection.getState().selected.size).toBe(0);
  });

  it('updates are immutable (new Set instance)', () => {
    const before = useSelection.getState().selected;
    useSelection.getState().toggle('a');
    expect(useSelection.getState().selected).not.toBe(before);
  });
});
