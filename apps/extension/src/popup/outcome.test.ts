import { describe, expect, it } from 'vitest';
import { knownMessage, outcomeMessage } from './outcome';

const nothing = { host: 'example.com', links: 0, hubs: [] };

describe('outcomeMessage', () => {
  it('confirms a new save', () => {
    expect(outcomeMessage({ outcome: 'created', link: { dupeCount: 1 } })).toBe('Saved');
  });

  it('says a repeat was already saved, with no sighting count', () => {
    expect(outcomeMessage({ outcome: 'updated', link: { dupeCount: 3 } })).toBe('Updated — it was already saved');
  });

  it('flags that a previously deleted link came back', () => {
    expect(outcomeMessage({ outcome: 'resurrected', link: { dupeCount: 1 } })).toBe(
      'Restored — you had deleted this before',
    );
  });
});

describe('knownMessage', () => {
  it('says nothing about a page and site bukmark has never seen', () => {
    expect(knownMessage({ saved: null, domain: nothing })).toBeNull();
  });

  it('says nothing for an answer it does not recognise', () => {
    expect(knownMessage({ outcome: 'created' } as never)).toBeNull();
  });

  it('names the hubs a saved page is in', () => {
    expect(knownMessage({ saved: { hubs: ['rust', 'reading'] }, domain: nothing })).toBe('Already saved — in rust, reading');
  });

  it('says a saved page is unsorted when it is in no hub', () => {
    expect(knownMessage({ saved: { hubs: [] }, domain: nothing })).toBe('Already saved — unsorted');
  });

  it('names the hub most of the site is filed in', () => {
    const domain = { host: 'github.com', links: 12, hubs: [{ name: 'dev-tools', links: 9 }, { name: 'rust', links: 2 }] };
    expect(knownMessage({ saved: null, domain })).toBe('12 links from github.com saved — most in dev-tools');
  });

  it('says when the site is saved but none of it is filed', () => {
    expect(knownMessage({ saved: null, domain: { host: 'a.dev', links: 1, hubs: [] } })).toBe('1 link from a.dev saved — all unsorted');
  });
});
