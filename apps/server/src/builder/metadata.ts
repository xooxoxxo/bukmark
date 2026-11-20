import { builderSource, cleanTags, cleanText, githubName, type BuilderRecord, type BuilderSource } from './model.js';

const GITHUB = 'https://api.github.com';
const NPM = 'https://registry.npmjs.org';
const MAX_METADATA_BYTES = 256 * 1024;

export class BuilderMetadataError extends Error {}

async function readMetadata(fetcher: typeof fetch, origin: string, path: string): Promise<Record<string, unknown>> {
  const signal = AbortSignal.timeout(6000);
  let url = new URL(path, origin);
  for (let hops = 0; hops <= 2; hops++) {
    const response = await fetcher(url, {
      headers: { accept: 'application/json', 'user-agent': 'bukmark-builder' }, signal, redirect: 'manual',
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      const next = location ? URL.parse(location, url) : null;
      if (!next || next.origin !== origin || next.username || next.password) break;
      url = next;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new BuilderMetadataError(response.status === 404 ? 'The provider could not verify this public source.'
        : 'The metadata provider is unavailable. Try again later.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let body = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_METADATA_BYTES) throw new BuilderMetadataError('The provider response was too large.');
        body += decoder.decode(value, { stream: true });
      }
      const value: unknown = JSON.parse(body + decoder.decode());
      if (!value || typeof value !== 'object' || Array.isArray(value)) break;
      return value as Record<string, unknown>;
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  throw new BuilderMetadataError('The provider returned unverified metadata.');
}

async function repositoryRecord(fetcher: typeof fetch, repository: string): Promise<Extract<BuilderRecord, { kind: 'repository' }>> {
  const metadata = await readMetadata(fetcher, GITHUB, `/repos/${repository}`);
  const name = githubName(metadata.full_name);
  if (!name || metadata.private !== false || typeof metadata.id !== 'number' || !Number.isSafeInteger(metadata.id) || metadata.id <= 0) {
    throw new BuilderMetadataError('GitHub could not verify this public repository.');
  }
  const language = cleanText(metadata.language, 80);
  return {
    key: `github:${metadata.id}`, kind: 'repository', name, repository: name,
    canonicalUrl: `https://github.com/${name}`, synopsis: cleanText(metadata.description, 500),
    ...(language ? { language } : {}), tags: cleanTags(metadata.topics), context: [],
  };
}

function packageRepository(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('url' in value) || typeof value.url !== 'string') return undefined;
  const source = builderSource(value.url.replace(/^git\+/, ''));
  return source?.kind === 'repository' && !source.issue ? `https://github.com/${source.repository}` : undefined;
}

async function packageRecord(fetcher: typeof fetch, source: Extract<BuilderSource, { kind: 'package' }>): Promise<BuilderRecord> {
  const { name, version } = source;
  const path = `/${encodeURIComponent(name)}`;
  const [metadata, pinned] = await Promise.all([
    readMetadata(fetcher, NPM, `${path}/latest`),
    version ? readMetadata(fetcher, NPM, `${path}/${encodeURIComponent(version)}`) : undefined,
  ]);
  if (metadata.name !== name || (pinned && (pinned.name !== name || pinned.version !== version))) {
    throw new BuilderMetadataError('npm could not verify this package or saved version.');
  }
  const canonicalUrl = `https://www.npmjs.com/package/${name}`;
  const repositoryUrl = packageRepository(metadata.repository);
  const language = typeof metadata.source === 'string' && /\.tsx?$/.test(metadata.source) ? 'TypeScript' : undefined;
  return {
    key: `npm:${name}`, kind: 'package', ecosystem: 'npm', name, canonicalUrl,
    ...(repositoryUrl ? { repositoryUrl } : {}), ...(language ? { language } : {}),
    synopsis: cleanText(metadata.description, 500), tags: cleanTags(metadata.keywords),
    context: version ? [{ key: `npm:${name}:version:${version}`, kind: 'package-version', version, url: `${canonicalUrl}/v/${version}` }] : [],
  };
}

/** Deduplicate a repository lookup shared by its root and issues in one batch. */
export function builderResolver(fetcher = globalThis.fetch) {
  const repositories = new Map<string, ReturnType<typeof repositoryRecord>>();
  return async (source: Exclude<BuilderSource, { kind: 'github-context' }>): Promise<BuilderRecord> => {
    if (source.kind === 'package') return packageRecord(fetcher, source);
    let pending = repositories.get(source.repository);
    if (!pending) {
      pending = repositoryRecord(fetcher, source.repository);
      repositories.set(source.repository, pending);
    }
    const record = await pending;
    if (!source.issue) return record;
    const { issue } = source;
    const parent = `${GITHUB}/repos/${record.repository}`;
    const metadata = await readMetadata(fetcher, GITHUB, `/repos/${record.repository}/issues/${issue}`);
    if (typeof metadata.repository_url !== 'string' || metadata.repository_url.toLowerCase() !== parent.toLowerCase()
      || metadata.number !== issue || 'pull_request' in metadata || (metadata.state !== 'open' && metadata.state !== 'closed')) {
      throw new BuilderMetadataError('GitHub did not verify this issue under the repository.');
    }
    const stale = Array.isArray(metadata.labels) && metadata.labels.some((label: unknown) =>
      label && typeof label === 'object' && 'name' in label && cleanText(label.name, 20).toLowerCase() === 'stale');
    return {
      ...record, context: [{
        key: `${record.key}:issue:${issue}`, kind: 'issue', url: `${record.canonicalUrl}/issues/${issue}`,
        number: issue, title: cleanText(metadata.title, 300) || `Issue #${issue}`, state: metadata.state,
        ...(stale ? { note: 'GitHub labels this issue stale.' } : {}),
      }],
    };
  };
}
