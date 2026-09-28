import type { LinkLookup, SaveResult } from '../lib/api';

/**
 * Re-saving a page you already had is information, not a no-op — surface it
 * rather than showing the same "Saved" for every outcome.
 */
export function outcomeMessage(res: SaveResult): string {
  if (res.outcome === 'resurrected') return 'Restored — you had deleted this before';
  if (res.outcome === 'updated') return 'Updated — it was already saved';
  return 'Saved';
}

const inHubs = (hubs: string[]): string => (hubs.length > 0 ? `in ${hubs.join(', ')}` : 'unsorted');

/**
 * What bukmark already holds for this page, before it is saved: the page itself
 * and where it is filed, or else how its site is filed. Null when nothing.
 */
export function knownMessage({ saved, domain }: LinkLookup): string | null {
  if (saved) return `Already saved — ${inHubs(saved.hubs ?? [])}`;
  // Anything else from the server says nothing worth showing.
  if (!domain?.links) return null;
  const count = domain.links === 1 ? '1 link' : `${domain.links} links`;
  const top = domain.hubs[0];
  return `${count} from ${domain.host} saved — ${top ? `most in ${top.name}` : 'all unsorted'}`;
}
