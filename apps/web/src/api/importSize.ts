/**
 * A request body is closed before it reaches this many bytes. The server takes
 * 4 MiB; Fastify's own default is 1 MiB, so this leaves room under both.
 */
export const IMPORT_BODY_BUDGET = 800_000;

/** JSON size in UTF-8 bytes, which is what the server's body limit counts. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Consecutive chunks of at most `maxCount` entries and about IMPORT_BODY_BUDGET bytes; an entry is never split. */
export function chunkBySize<T>(list: T[], maxCount: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const entry of list) {
    const size = jsonBytes(entry) + 1;
    if (current.length > 0 && (current.length >= maxCount || bytes + size > IMPORT_BODY_BUDGET)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
