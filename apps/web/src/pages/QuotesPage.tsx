import { useEffect, useRef, useState } from 'react';
import { useQuotes } from '../api/queries';
import { QuoteCard } from '../components/QuoteCard';
// The links view's loading, error and empty panels: one look for every list.
import stateStyles from '../components/LinksView.module.css';
import { DOCS_URL } from '../docs';
import styles from './QuotesPage.module.css';

const SEARCH_DEBOUNCE_MS = 300;

export function QuotesPage() {
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQ(input.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const query = useQuotes(q ? { q } : {});
  const quotes = query.data?.pages.flatMap((page) => page.items) ?? [];
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  // Load the next page as the end of the list scrolls into view; the button
  // under it does the same by hand (and where IntersectionObserver is missing).
  // The root is the list when it scrolls by itself (desktop), so the margin
  // prefetches ahead of its edge; on a phone the page scrolls and the root is
  // the viewport.
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const end = endRef.current;
    if (!end || !hasNextPage || isFetchingNextPage || typeof IntersectionObserver === 'undefined') return;
    const list = scrollRef.current;
    const scrolls = list !== null && /^(auto|scroll)$/.test(getComputedStyle(list).overflowY);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage();
      },
      { root: scrolls ? list : null, rootMargin: '400px 0px' },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, quotes.length]);

  return (
    <div className={styles.page}>
      <section className={styles.bar} aria-label="Quote search">
        <input
          type="search"
          className={styles.search}
          placeholder="Search quotes…"
          aria-label="Search quotes"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
      </section>
      <div ref={scrollRef} className={styles.scroll}>
        {query.isPending ? (
          <div className={stateStyles.state} aria-live="polite">
            <h2>Loading quotes</h2>
            <p>Gathering what you marked.</p>
          </div>
        ) : query.isError ? (
          <div className={`${stateStyles.state} ${stateStyles.error}`} role="alert">
            <h2>Quotes could not load</h2>
            <p>{query.error.message}</p>
          </div>
        ) : quotes.length === 0 ? (
          q ? (
            <div className={stateStyles.state}>
              <h2>Nothing matches this search</h2>
              <p>Try other words; search reads each quote's text and note.</p>
            </div>
          ) : (
            <div className={stateStyles.state}>
              <h2>No quotes yet</h2>
              <p>
                Select text on a page, then right-click <strong>Save quote to bukmark</strong> or press{' '}
                <kbd>Alt+Shift+Q</kbd> (<kbd>Control+Shift+Q</kbd> on a Mac); on a phone, share the text to
                bukmark.{' '}
                <a className={styles.docs} href={`${DOCS_URL}quotes/`} target="_blank" rel="noreferrer">
                  How quotes work
                </a>
              </p>
            </div>
          )
        ) : (
          <>
            <div className={styles.list}>
              {quotes.map((quote) => (
                <QuoteCard key={quote.id} quote={quote} />
              ))}
            </div>
            {hasNextPage ? (
              <div ref={endRef} className={styles.more}>
                <button
                  type="button"
                  className={styles.moreButton}
                  disabled={isFetchingNextPage}
                  onClick={() => void fetchNextPage()}
                >
                  {isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
