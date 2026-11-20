import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import type { BuilderDraft } from '../api/types';
import { makeWrapper } from '../test/utils';
import { ReviewPage } from './ReviewPage';
import { BuilderReview } from './BuilderReview';

afterEach(() => vi.unstubAllGlobals());

function batchDraft(index: number): BuilderDraft {
  const repository = `sample/tools-${index}`;
  return {
    id: `draft-${index}`, revision: 1, excluded: [],
    record: {
      key: `github:${1000 + index}`, kind: 'repository', repository, name: repository,
      canonicalUrl: `https://github.com/${repository}`, synopsis: `Repository ${index}.`,
      language: 'TypeScript', tags: ['reference'], context: [],
    },
  };
}

it('reviews three saved sources and approves two records with the issue under its repository', async () => {
  const repoUrl = 'https://github.com/sample/tools';
  const issueUrl = repoUrl + '/issues/120';
  const packageUrl = 'https://www.npmjs.com/package/@sample/validators';
  const issueKey = 'github:42:issue:120';
  const candidates = [
    { id: 'repo-source', title: 'Tools bookmark', url: repoUrl },
    { id: 'issue-source', title: 'Issue bookmark', url: issueUrl },
    { id: 'package-source', title: 'Package bookmark', url: packageUrl },
  ];
  const drafts: BuilderDraft[] = [
    {
      id: 'repo', revision: 2, excluded: [],
      record: {
        key: 'github:42', kind: 'repository', repository: 'sample/tools', name: 'sample/tools', canonicalUrl: repoUrl,
        language: 'TypeScript', synopsis: 'UI components.', tags: ['components'],
        context: [{ key: issueKey, kind: 'issue', number: 120, url: issueUrl, title: 'Missing prop', state: 'closed' }],
      },
    },
    {
      id: 'package', revision: 1, excluded: [],
      record: {
        key: 'npm:@sample/validators', kind: 'package', ecosystem: 'npm', name: '@sample/validators', canonicalUrl: packageUrl,
        synopsis: 'Schema adapters.', tags: ['forms'], context: [],
      },
    },
  ];
  const requests: unknown[] = [];
  let prepared = false;
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const { pathname } = new URL(input, 'http://localhost');
    if (pathname === '/api/hubs' || pathname === '/api/review') return Response.json({ items: [], more: false });
    if (pathname.endsWith('/candidates')) return Response.json({ items: candidates, more: false });
    if (pathname.endsWith('/drafts')) return Response.json({ items: prepared ? drafts : [], more: false });
    requests.push(JSON.parse(String(init?.body)));
    if (pathname.endsWith('/prepare')) {
      prepared = true;
      return Response.json({ items: candidates.map(({ id }) => ({ linkId: id, outcome: 'prepared' })) });
    }
    if (pathname.endsWith('/exports')) return Response.json({ id: 'receipt', recordCount: 2 });
    throw new Error('Unexpected request ' + pathname);
  });
  const Wrapper = makeWrapper();
  render(<Wrapper><MemoryRouter><ReviewPage /></MemoryRouter></Wrapper>);
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: 'Builder catalog' }));
  for (const candidate of candidates) {
    await user.click(await screen.findByRole('checkbox', { name: new RegExp(candidate.title) }));
  }
  await user.click(screen.getByRole('button', { name: 'Prepare selected links (3)' }));
  const repo = within(await screen.findByRole('article', { name: 'sample/tools' }));
  const pkg = within(screen.getByRole('article', { name: '@sample/validators' }));
  expect(repo.getByRole('checkbox', { name: 'Include issue #120' })).toBeChecked();
  expect(repo.getByRole('link', { name: 'Missing prop' })).toHaveAttribute('href', issueUrl);
  expect(pkg.queryByRole('checkbox', { name: 'Include issue #120' })).not.toBeInTheDocument();

  const synopsis = repo.getByRole('textbox', { name: 'Synopsis' });
  await user.clear(synopsis);
  await user.type(synopsis, 'Reviewed synopsis.');
  await user.click(repo.getByRole('checkbox', { name: 'Select sample/tools for JSON export' }));
  await user.click(pkg.getByRole('checkbox', { name: 'Select @sample/validators for JSON export' }));
  await user.click(screen.getByRole('button', { name: 'Approve JSON export (2)' }));

  expect(await screen.findByRole('link', { name: 'Download JSON (2 records)' }))
    .toHaveAttribute('href', '/api/review/builder/exports/receipt');
  expect(requests).toEqual([
    { linkIds: ['repo-source', 'issue-source', 'package-source'] },
    { items: [
      { id: 'repo', revision: 2, synopsis: 'Reviewed synopsis.', tags: ['components'], contextKeys: [issueKey] },
      { id: 'package', revision: 1, synopsis: 'Schema adapters.', tags: ['forms'], contextKeys: [] },
    ] },
  ]);
});

it('exports all 39 selections across pages with their edits and pinned context, then clears submitted edits', async () => {
  const drafts = Array.from({ length: 39 }, (_, index) => batchDraft(index));
  const commit = 'a'.repeat(40);
  const contextKey = `github:1000:code:file:${commit}:src/index.ts`;
  const pinnedUrl = `https://github.com/sample/tools-0/blob/${commit}/src/index.ts`;
  drafts[0]!.record.context = [{
    key: contextKey, kind: 'code', entryType: 'file', path: 'src/index.ts', ref: 'main', commit,
    url: pinnedUrl, sourceUrl: 'https://github.com/sample/tools-0/blob/main/src/index.ts',
  }];
  const requests: unknown[] = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname.endsWith('/candidates')) return Response.json({ items: [], more: false });
    if (url.pathname.endsWith('/drafts')) {
      const offset = Number(url.searchParams.get('offset'));
      return Response.json({ items: drafts.slice(offset, offset + 25), more: offset + 25 < drafts.length });
    }
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ id: 'existing-export', recordCount: 39 });
  });
  const Wrapper = makeWrapper();
  render(<Wrapper><BuilderReview linkId={null} /></Wrapper>);
  const user = userEvent.setup();
  const first = within(await screen.findByRole('article', { name: 'sample/tools-0' }));
  expect(first.getByRole('link', { name: 'Pinned commit aaaaaaaaaaaa' })).toHaveAttribute('href', pinnedUrl);
  await user.clear(first.getByRole('textbox', { name: 'Synopsis' }));
  await user.type(first.getByRole('textbox', { name: 'Synopsis' }), 'Reviewed across pages.');
  for (let index = 0; index < 25; index++) {
    await user.click(screen.getByRole('checkbox', { name: `Select sample/tools-${index} for JSON export` }));
  }
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  await screen.findByRole('article', { name: 'sample/tools-25' });
  for (let index = 25; index < 39; index++) {
    await user.click(screen.getByRole('checkbox', { name: `Select sample/tools-${index} for JSON export` }));
  }
  await user.click(screen.getByRole('button', { name: 'Approve JSON export (39)' }));
  expect(await screen.findByRole('link', { name: 'Download JSON (39 records)' }))
    .toHaveAttribute('href', '/api/review/builder/exports/existing-export');
  expect(requests).toEqual([{ items: drafts.map((item, index) => ({
    id: `draft-${index}`, revision: 1, synopsis: index === 0 ? 'Reviewed across pages.' : `Repository ${index}.`,
    tags: ['reference'], contextKeys: index === 0 ? [contextKey] : [],
  })) }]);
  await user.click(screen.getByRole('button', { name: 'Previous page' }));
  const reset = within(await screen.findByRole('article', { name: 'sample/tools-0' }));
  expect(reset.getByRole('textbox', { name: 'Synopsis' })).toHaveValue('Repository 0.');
  expect(reset.getByRole('checkbox', { name: 'Select sample/tools-0 for JSON export' })).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Approve JSON export' })).toBeDisabled();
}, 15000);

it('holds a changed selected revision until the current revision is selected again', async () => {
  const first = batchDraft(0);
  const second = batchDraft(1);
  let firstPageReads = 0;
  const requests: unknown[] = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname.endsWith('/candidates')) return Response.json({ items: [], more: false });
    if (url.pathname.endsWith('/drafts')) {
      if (Number(url.searchParams.get('offset'))) return Response.json({ items: [second], more: false });
      firstPageReads++;
      return Response.json({ items: [{ ...first, revision: firstPageReads === 1 ? 1 : 2 }], more: true });
    }
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ id: 'updated-export', recordCount: 2 });
  });
  const Wrapper = makeWrapper();
  render(<Wrapper><BuilderReview linkId={null} /></Wrapper>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('checkbox', { name: 'Select sample/tools-0 for JSON export' }));
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  await user.click(await screen.findByRole('checkbox', { name: 'Select sample/tools-1 for JSON export' }));
  await user.click(screen.getByRole('button', { name: 'Previous page' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Approve JSON export (2)' })).toBeDisabled());
  expect(screen.getByRole('alert')).toHaveTextContent('A selected draft changed');
  expect(requests).toEqual([]);
  await user.click(screen.getByRole('checkbox', { name: 'Select sample/tools-0 for JSON export' }));
  await user.click(screen.getByRole('button', { name: 'Approve JSON export (2)' }));
  expect(await screen.findByRole('link', { name: 'Download JSON (2 records)' })).toBeInTheDocument();
  expect(requests).toEqual([{ items: [
    { id: 'draft-0', revision: 2, synopsis: 'Repository 0.', tags: ['reference'], contextKeys: [] },
    { id: 'draft-1', revision: 1, synopsis: 'Repository 1.', tags: ['reference'], contextKeys: [] },
  ] }]);
});

it('holds the 100-draft selection boundary across pages and allows deselection', async () => {
  const drafts = Array.from({ length: 101 }, (_, index) => batchDraft(index));
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname.endsWith('/candidates')) return Response.json({ items: [], more: false });
    const offset = Number(url.searchParams.get('offset'));
    return Response.json({ items: drafts.slice(offset, offset + 25), more: offset + 25 < drafts.length });
  });
  const Wrapper = makeWrapper();
  render(<Wrapper><BuilderReview linkId={null} /></Wrapper>);
  const user = userEvent.setup();
  for (let offset = 0; offset < 100; offset += 25) {
    await screen.findByRole('article', { name: `sample/tools-${offset}` });
    for (let index = offset; index < offset + 25; index++) {
      await user.click(screen.getByRole('checkbox', { name: `Select sample/tools-${index} for JSON export` }));
    }
    await user.click(screen.getByRole('button', { name: 'Next page' }));
  }
  const extra = await screen.findByRole('checkbox', { name: 'Select sample/tools-100 for JSON export' });
  expect(extra).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Approve JSON export (100)' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Previous page' }));
  await user.click(await screen.findByRole('checkbox', { name: 'Select sample/tools-99 for JSON export' }));
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  expect(await screen.findByRole('checkbox', { name: 'Select sample/tools-100 for JSON export' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Clear selected drafts' }));
  expect(screen.getByRole('button', { name: 'Approve JSON export' })).toBeDisabled();
}, 15000);
