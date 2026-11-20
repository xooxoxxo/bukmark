import { load } from 'cheerio/slim';
import { fetchPage } from '../og/fetchHead.js';
import { cleanText, githubName, type BuilderContext, type BuilderPin, type BuilderRecord, type GitHubContextSource } from './model.js';

const GITHUB = 'https://github.com';
const COMMIT = /^[a-f0-9]{40}$/i;
const PAGE_BYTES = 12 * 1024 * 1024;

export class BuilderContextError extends Error {}

async function readPage(url: string, fetcher: typeof fetch) {
  const page = await fetchPage(url, PAGE_BYTES, (target, signal) => {
    if (target.origin !== GITHUB || target.username || target.password || target.search) return Promise.resolve('blocked');
    return fetcher(target, { signal, redirect: 'manual', headers: { accept: 'text/html', 'user-agent': 'bukmark-builder' } });
  }, AbortSignal.timeout(10_000));
  if (page.status !== 200 || !page.html) throw new BuilderContextError('GitHub could not verify this public context.');
  return { $: load(page.html), path: decodeURIComponent(new URL(page.url).pathname).replace(/\/$/, '') };
}

type GitHubPage = Awaited<ReturnType<typeof readPage>>;

function verifiedParent({ $, path }: GitHubPage, source: GitHubContextSource) {
  const meta = (key: string) => $(`meta[name="octolytics-dimension-repository_${key}"]`).attr('content');
  const name = githubName(meta('nwo'));
  const id = Number(meta('id'));
  if (!name || name.toLowerCase() !== source.repository || !path.toLowerCase().startsWith(`/${source.repository}/`)
    || meta('public') !== 'true' || !Number.isSafeInteger(id) || id <= 0) {
    throw new BuilderContextError('GitHub did not verify the expected public parent repository.');
  }
  return { id, name };
}

interface CodeView {
  path?: string;
  refInfo?: { name?: string; currentOid?: string };
  repo?: { id?: number; public?: boolean; private?: boolean };
  blob?: { viewable?: boolean };
  tree?: object;
  rawLines?: string[];
}

function codeView(page: GitHubPage, source: Extract<GitHubContextSource, { refPath: string }>) {
  const parent = verifiedParent(page, source);
  const payload = page.$('script[data-target="react-app.embeddedData"]').toArray().map((element) => {
    try { return JSON.parse(page.$(element).text()).payload as Record<string, CodeView> | undefined; } catch { return undefined; }
  }).find((entry) => entry?.codeViewLayoutRoute);
  const layout = payload?.codeViewLayoutRoute;
  const view = source.page === 'blob' ? payload?.codeViewBlobLayoutRoute : payload?.codeViewTreeRoute;
  const { name: ref, currentOid: commit } = view?.refInfo ?? {};
  const path = view?.path;
  if (!layout || layout.repo?.id !== parent.id || layout.repo.public !== true || layout.repo.private !== false
    || !view || !(source.page === 'blob' ? view.blob : view.tree) || !ref || !commit || !COMMIT.test(commit)
    || !path || path !== layout.path || path.split('/').some((part) => !part || part === '.' || part === '..')
    || !page.path.toLowerCase().startsWith(`/${source.repository}/${source.page}/`)) {
    throw new BuilderContextError('GitHub did not verify the code path and commit.');
  }
  return { ...parent, ref, commit: commit.toLowerCase(), path, lines: payload?.['codeViewBlobLayoutRoute.StyledBlob']?.rawLines?.length };
}

function repositoryRecord(parent: { id: number; name: string }, context: BuilderContext): BuilderRecord {
  return { key: `github:${parent.id}`, kind: 'repository', name: parent.name, repository: parent.name,
    canonicalUrl: `${GITHUB}/${parent.name}`, synopsis: '', tags: [], context: [context] };
}

export async function readRepositoryContext(source: GitHubContextSource, fetcher: typeof fetch, pin?: BuilderPin) {
  if (source.page === 'discussion') {
    const page = await readPage(source.sourceUrl, fetcher);
    const parent = verifiedParent(page, source);
    const url = `${GITHUB}/${parent.name}/discussions/${source.number}`;
    const rawTitle = page.$('meta[property="og:title"]').attr('content') ?? '';
    const suffix = ` · ${parent.name} · Discussion #${source.number}`;
    const title = cleanText(rawTitle.slice(0, -suffix.length), 300);
    if (pin || page.path.toLowerCase() !== new URL(url).pathname.toLowerCase() || page.$('link[rel="canonical"]').attr('href') !== url
      || !page.$('#discussion_bucket').length || !rawTitle.endsWith(suffix) || !title) {
      throw new BuilderContextError('GitHub did not verify this discussion under the repository.');
    }
    return repositoryRecord(parent, { kind: 'discussion', key: `github:${parent.id}:discussion:${source.number}`,
      number: source.number, title, url, sourceUrl: source.sourceUrl });
  }

  const original = pin ? undefined : codeView(await readPage(source.sourceUrl, fetcher), source);
  const ref = pin?.ref ?? original?.ref ?? '';
  const commit = (pin?.commit ?? original?.commit ?? '').toLowerCase();
  const path = source.refPath.slice(ref.length + 1);
  if (!ref || !source.refPath.startsWith(`${ref}/`) || !path || !COMMIT.test(commit)
    || (original && original.path !== path) || (COMMIT.test(ref) && ref.toLowerCase() !== commit)) {
    throw new BuilderContextError('The verified pin does not match the saved ref and path.');
  }
  const repository = original?.name ?? source.repository;
  const url = `${GITHUB}/${repository}/${source.page}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const pinnedPage = await readPage(url, fetcher);
  const pinned = codeView(pinnedPage, source);
  if (pinnedPage.path.split('/').slice(4).join('/') !== `${commit}/${path}`
    || pinned.commit !== commit || pinned.path !== path || (original && pinned.id !== original.id)) {
    throw new BuilderContextError('GitHub did not verify the same path at the pinned commit.');
  }
  if (source.lines) {
    const [start, end] = source.lines.match(/\d+/g)!.map(Number);
    const last = end ?? start!;
    if (!pinned.lines || start! > last || last > pinned.lines) throw new BuilderContextError('GitHub did not verify the saved line range.');
  }
  const entryType = source.page === 'blob' ? 'file' : 'directory';
  return repositoryRecord(pinned, { kind: 'code', entryType, key: `github:${pinned.id}:code:${entryType}:${commit}:${path}`,
    url: `${GITHUB}/${pinned.name}/${source.page}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}${source.lines ?? ''}`,
    sourceUrl: source.sourceUrl, ref, commit, path });
}
