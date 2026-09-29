import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import type { QuoteDto } from '../api/types';
import { makeWrapper } from '../test/utils';
import { QuotesPage } from './QuotesPage';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, fetchQuotes: vi.fn(), patchQuote: vi.fn(), deleteQuote: vi.fn() };
});

function quote(id: string, text: string): QuoteDto {
  return {
    id,
    linkId: 'l1',
    text,
    note: '',
    sourceUrl: `https://example.com/${id}`,
    sourceTitle: `Page ${id}`,
    createdAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-09-28T10:00:00.000Z',
  };
}

function renderPage() {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <QuotesPage />
    </Wrapper>,
  );
}

describe('QuotesPage', () => {
  beforeEach(() => {
    vi.mocked(client.fetchQuotes).mockReset();
  });

  it('lists quotes as cards in the order the server gives, newest first', async () => {
    vi.mocked(client.fetchQuotes).mockResolvedValue({
      items: [quote('b', 'Newer passage.'), quote('a', 'Older passage.')],
      nextCursor: null,
    });
    renderPage();
    const cards = await screen.findAllByRole('article');
    expect(cards.map((c) => c.querySelector('blockquote')?.textContent)).toEqual([
      'Newer passage.',
      'Older passage.',
    ]);
    expect(screen.getByRole('searchbox', { name: 'Search quotes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('searches text and notes on the server once typing pauses', async () => {
    vi.mocked(client.fetchQuotes).mockImplementation(async (query) =>
      query?.q === 'javascript'
        ? { items: [quote('a', 'JavaScript tips.')], nextCursor: null }
        : { items: [quote('a', 'JavaScript tips.'), quote('b', 'Python guide.')], nextCursor: null },
    );
    renderPage();
    expect(await screen.findByText('Python guide.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search quotes' }), 'javascript');
    await waitFor(() => expect(client.fetchQuotes).toHaveBeenLastCalledWith({ q: 'javascript', limit: 50 }));
    expect(await screen.findByText('JavaScript tips.')).toBeInTheDocument();
    expect(screen.queryByText('Python guide.')).not.toBeInTheDocument();
    // Debounced: no request per keystroke.
    expect(vi.mocked(client.fetchQuotes).mock.calls.map((c) => c[0]?.q)).not.toContain('j');
  });

  it('loads older quotes by cursor', async () => {
    vi.mocked(client.fetchQuotes)
      .mockResolvedValueOnce({ items: [quote('b', 'Page one.')], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [quote('a', 'Page two.')], nextCursor: null });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Page two.')).toBeInTheDocument();
    expect(client.fetchQuotes).toHaveBeenLastCalledWith({ limit: 50, cursor: 'c1' });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('loads the next page when the end of the list scrolls into view', async () => {
    const observed: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          observed.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.mocked(client.fetchQuotes)
      .mockResolvedValueOnce({ items: [quote('b', 'Page one.')], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [quote('a', 'Page two.')], nextCursor: null });
    renderPage();
    await screen.findByText('Page one.');
    await waitFor(() => expect(observed.length).toBeGreaterThan(0));
    act(() => {
      observed.at(-1)!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(await screen.findByText('Page two.')).toBeInTheDocument();
    expect(client.fetchQuotes).toHaveBeenLastCalledWith({ limit: 50, cursor: 'c1' });
    vi.unstubAllGlobals();
  });

  it('observes against the list when it scrolls by itself, else the viewport', async () => {
    const roots: (Element | Document | null | undefined)[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(_: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          roots.push(options?.root);
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.mocked(client.fetchQuotes).mockResolvedValue({ items: [quote('b', 'Page one.')], nextCursor: 'c1' });
    const { unmount } = renderPage();
    await screen.findByText('Page one.');
    await waitFor(() => expect(roots.length).toBeGreaterThan(0));
    expect(roots.at(-1)).toBeNull();
    unmount();

    const real = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) =>
      ({ ...real(el), overflowY: 'auto' }) as CSSStyleDeclaration,
    );
    roots.length = 0;
    renderPage();
    await screen.findByText('Page one.');
    await waitFor(() => expect(roots.length).toBeGreaterThan(0));
    const root = roots.at(-1) as HTMLElement;
    expect(root).toBeInstanceOf(HTMLElement);
    expect(root).toContainElement(screen.getByText('Page one.'));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('says how to save a quote when there are none, linking to the docs', async () => {
    vi.mocked(client.fetchQuotes).mockResolvedValue({ items: [], nextCursor: null });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'No quotes yet' })).toBeInTheDocument();
    const help = screen.getByText(/right-click/i);
    expect(help).toHaveTextContent('Save quote to bukmark');
    expect(help).toHaveTextContent('Alt+Shift+Q');
    expect(help).toHaveTextContent('Control+Shift+Q on a Mac');
    expect(help).toHaveTextContent(/phone/i);
    expect(screen.getByRole('link', { name: /how quotes work/i })).toHaveAttribute(
      'href',
      'https://bukmark.it/docs/quotes/',
    );
  });

  it('says nothing matches when a search finds nothing', async () => {
    vi.mocked(client.fetchQuotes).mockImplementation(async (query) =>
      query?.q ? { items: [], nextCursor: null } : { items: [quote('a', 'Some.')], nextCursor: null },
    );
    renderPage();
    await screen.findByText('Some.');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search quotes' }), 'zzz');
    expect(await screen.findByRole('heading', { name: 'Nothing matches this search' })).toBeInTheDocument();
  });

  it('shows loading, then the error when quotes cannot load', async () => {
    let fail: (e: Error) => void = () => undefined;
    vi.mocked(client.fetchQuotes).mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    renderPage();
    expect(screen.getByRole('heading', { name: 'Loading quotes' })).toBeInTheDocument();
    fail(new client.ApiError('server is down', 500));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Quotes could not load');
    expect(alert).toHaveTextContent('server is down');
  });
});
