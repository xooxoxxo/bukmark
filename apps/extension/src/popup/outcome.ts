import type { SaveResult } from '../lib/api';

/**
 * Re-saving a page you already had is information, not a no-op — surface it
 * rather than showing the same "Saved" for every outcome.
 */
export function outcomeMessage(res: SaveResult): string {
  if (res.outcome === 'resurrected') return 'Restored — you had deleted this before';
  if (res.outcome === 'updated') return `Updated — seen ${res.link.dupeCount}×`;
  return 'Saved';
}
