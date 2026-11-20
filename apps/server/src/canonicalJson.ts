/** JSONB does not retain object key order. Compare values in a consistent order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, node: unknown) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return node;
    return Object.fromEntries(Object.entries(node).sort(([a], [b]) => a.localeCompare(b)));
  });
}
