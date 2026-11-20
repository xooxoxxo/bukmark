const REPOSITORY = /^[a-z\d-]+\/[a-z\d_.-]+$/i;
const PACKAGE = /^(?:@[a-z\d_][a-z\d_.-]*\/)?[a-z\d_][a-z\d_.-]*$/;
const PACKAGE_VERSION = /^\d+\.\d+\.\d+(?:-[a-z\d.-]+)?(?:\+[a-z\d.-]+)?$/i;
const GITHUB_PAGES = new Set([
  'about', 'account', 'apps', 'collections', 'features', 'login', 'marketplace', 'orgs',
  'search', 'settings', 'sponsors', 'topics', 'trending', 'users',
]);

export type GitHubContextSource = { kind: 'github-context'; repository: string; sourceUrl: string } & (
  { page: 'discussion'; number: number } | { page: 'blob' | 'tree'; refPath: string; lines?: string }
);

export interface BuilderPin { commit: string; ref: string }

export type BuilderSource = { kind: 'repository'; repository: string; issue?: number }
  | { kind: 'package'; name: string; version?: string }
  | GitHubContextSource;

export type BuilderContext = {
  key: string; kind: 'issue'; url: string; number: number; title: string; state: 'open' | 'closed'; note?: string;
} | {
  key: string; kind: 'package-version'; url: string; version: string;
} | {
  key: string; kind: 'discussion'; url: string; sourceUrl: string; number: number; title: string;
} | {
  key: string; kind: 'code'; url: string; sourceUrl: string; entryType: 'file' | 'directory';
  commit: string; ref: string; path: string;
};

interface CatalogFields {
  key: string;
  name: string;
  canonicalUrl: string;
  synopsis: string;
  language?: string;
  tags: string[];
  context: BuilderContext[];
}

export type BuilderRecord = CatalogFields & (
  { kind: 'repository'; repository: string }
  | { kind: 'package'; ecosystem: 'npm'; repositoryUrl?: string }
);

export interface BuilderEdits {
  synopsis?: string;
  tags?: string[];
  excluded?: string[];
}

function githubContextSource(url: URL): GitHubContextSource | null {
  const match = /^\/([a-z\d-]+)\/([a-z\d_.-]+)\/(discussions|blob|tree)\/(.+?)\/?$/i.exec(url.pathname);
  if (!match || GITHUB_PAGES.has(match[1]!.toLowerCase()) || url.pathname.length > 1400) return null;
  const repository = `${match[1]}/${match[2]}`.toLowerCase();
  const sourceUrl = `https://github.com${url.pathname.replace(/\/$/, '')}${url.hash}`;
  const common = { kind: 'github-context' as const, repository, sourceUrl };
  const [, , , page, tail] = match;
  if (page === 'discussions') {
    if (!/^[1-9]\d{0,8}$/.test(tail!) || url.hash) return null;
    return { ...common, page: 'discussion', number: Number(tail) };
  }
  if (page !== 'blob' && page !== 'tree') return null;
  let refPath: string;
  try { refPath = decodeURIComponent(tail!); } catch { return null; }
  const segments = refPath.split('/');
  if (segments.length < 2 || segments.some((part) => !part || part === '.' || part === '..' || /[\\\x00-\x1f\x7f]/.test(part))) return null;
  if (url.hash && (page !== 'blob' || !/^#L[1-9]\d{0,7}(?:-L[1-9]\d{0,7})?$/.test(url.hash))) return null;
  return { ...common, page, refPath, ...(url.hash ? { lines: url.hash } : {}) };
}

export function builderSource(input: string): BuilderSource | null {
  const url = URL.parse(input);
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'github.com') {
    const match = /^\/([a-z\d-]+)\/([a-z\d_.-]+?)(?:\.git)?(?:\/issues\/([1-9]\d{0,8}))?\/?$/i.exec(url.pathname);
    if (!match) return githubContextSource(url);
    if (GITHUB_PAGES.has(match[1]!.toLowerCase())) return null;
    const repository = `${match[1]}/${match[2]}`.toLowerCase();
    return { kind: 'repository', repository, ...(match[3] ? { issue: Number(match[3]) } : {}) };
  }
  if (host === 'npmjs.com') {
    let path: string;
    try { path = decodeURIComponent(url.pathname); } catch { return null; }
    const parts = /^\/package\/((?:@[^/]+\/)?[^/]+)(?:\/v\/([^/]+))?\/?$/.exec(path);
    if (!parts || !PACKAGE.test(parts[1]!) || (parts[2] && !PACKAGE_VERSION.test(parts[2]))) return null;
    return { kind: 'package', name: parts[1]!, ...(parts[2] ? { version: parts[2] } : {}) };
  }
  return null;
}

export function githubName(value: unknown): string | null {
  return typeof value === 'string' && REPOSITORY.test(value) ? value : null;
}

export function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replaceAll('\0', '').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

export function cleanTags(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map((tag) => cleanText(tag, 50)).filter(Boolean))].slice(0, 12) : [];
}

export function previewRecord(record: BuilderRecord, edits: BuilderEdits): BuilderRecord {
  return {
    ...record,
    synopsis: edits.synopsis ?? record.synopsis,
    tags: edits.tags ?? record.tags,
    context: record.context.filter((item) => !edits.excluded?.includes(item.key)),
  };
}
