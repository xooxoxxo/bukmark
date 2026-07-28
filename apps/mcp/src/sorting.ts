export interface UnsortedLink {
  id: string;
  url: string;
  title: string;
  note: string;
  groupHint: string | null;
  firstSeen: string;
}

export interface HubSummary {
  id: string;
  name: string;
  description: string;
  linkCount: number;
}

export interface AssignResult {
  assigned: number;
  hubsCreated: string[];
  unknownLinkIds: string[];
}

export function formatUnsorted(items: UnsortedLink[]): string {
  if (items.length === 0) return 'Nothing unsorted.';
  const lines = items.map((l) => {
    const parts = [`${l.id}  ${l.title || '(untitled)'}`, `  ${l.url}`];
    if (l.note) parts.push(`  note: ${l.note}`);
    // The old browser folder is the strongest sorting signal we have, but it is
    // a hint and not a decision — hence the wording.
    if (l.groupHint) parts.push(`  was in: ${l.groupHint}`);
    return parts.join('\n');
  });
  return `${items.length} unsorted:\n${lines.join('\n\n')}`;
}

export function formatHubs(items: HubSummary[]): string {
  if (items.length === 0) return 'No hubs yet.';
  const lines = items.map((h) =>
    h.description ? `${h.name} (${h.linkCount}) — ${h.description}` : `${h.name} (${h.linkCount})`,
  );
  return `${items.length} hubs:\n${lines.join('\n')}`;
}

export function summarizeAssign(res: AssignResult): string {
  const parts = [`${res.assigned} assigned`];
  if (res.hubsCreated.length > 0) parts.push(`new hubs: ${res.hubsCreated.join(', ')}`);
  if (res.unknownLinkIds.length > 0) {
    parts.push(`not found: ${res.unknownLinkIds.join(', ')}`);
  }
  return parts.join('; ');
}
