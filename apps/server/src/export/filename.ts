/**
 * Filenames for exported files.
 *
 * The scope is often a hub name, which is user-supplied. Slugging is not
 * cosmetic: an unsanitised name goes into a Content-Disposition header, so a
 * name containing CR/LF would let a user inject arbitrary response headers.
 * Restricting the output to [a-z0-9-] removes that whole class of problem.
 */

const MAX_SCOPE_LENGTH = 40;

export function slugify(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SCOPE_LENGTH)
    .replace(/-+$/, '');
  return slug === '' ? 'export' : slug;
}

export function exportFilename(
  scope: string,
  format: 'html' | 'json' | 'csv',
  date: string,
): string {
  return `bukmark-${slugify(scope)}-${date}.${format}`;
}
