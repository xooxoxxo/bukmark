import { describe, expect, it } from 'vitest';
import { outcomeMessage } from './outcome';

describe('outcomeMessage', () => {
  it('confirms a new save', () => {
    expect(outcomeMessage({ outcome: 'created', link: { dupeCount: 1 } })).toBe('Saved');
  });

  it('says how many times a repeat has been seen, rather than pretending it is new', () => {
    expect(outcomeMessage({ outcome: 'updated', link: { dupeCount: 3 } })).toBe('Updated — seen 3×');
  });

  it('does not add a count for a second sighting', () => {
    expect(outcomeMessage({ outcome: 'updated', link: { dupeCount: 2 } })).toBe('Updated — seen 2×');
  });

  it('flags that a previously deleted link came back', () => {
    expect(outcomeMessage({ outcome: 'resurrected', link: { dupeCount: 1 } })).toBe(
      'Restored — you had deleted this before',
    );
  });
});
