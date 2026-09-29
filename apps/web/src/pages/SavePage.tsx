import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { errorMessage, type CreateQuoteInput, type CreateQuoteResult, type SaveLinkResult } from '../api/client';
import { useCreateQuote, useHubs, useSaveLink } from '../api/queries';
import { Select } from '../components/ui/Select';
import { sourceAddress } from '../quotes/copyText';
import { captureFromParams, isWebUrl, quoteFromParams } from '../save/capture';
import styles from './SavePage.module.css';

/** Hub ids are UUIDs, so this option value cannot collide with one. */
const UNASSIGNED = 'unassigned';

const CLOSE_AFTER_MS = 1000;

function outcomeMessage({ outcome, link }: SaveLinkResult): string {
  if (outcome === 'resurrected') return 'Restored — you had deleted this before';
  if (outcome === 'updated') return `Updated — seen ${link.dupeCount}×`;
  return 'Saved';
}

/** What a save says it did, and the line naming what it saved. */
interface Outcome {
  message: string;
  saved: string;
}

function linkOutcome(result: SaveLinkResult): Outcome {
  return { message: outcomeMessage(result), saved: result.link.title || result.link.url };
}

function quoteOutcome({ quote, link }: CreateQuoteResult): Outcome {
  return {
    message: link.created ? 'Quote saved, and the page with it' : 'Quote saved',
    saved: quote.sourceTitle || quote.sourceUrl,
  };
}

/**
 * Where the bookmarklet and the share sheet land. Nothing is saved until Save
 * is pressed: the session cookie is SameSite=Lax, so it rides along when any
 * site links here, and saving on load would let that site add links.
 *
 * A share that carried a passage (Android's share sheet with text selected)
 * offers to save it as a quote, or the link alone.
 */
export function SavePage() {
  const [params] = useSearchParams();
  const [initial] = useState(() => captureFromParams(params));
  const [quote] = useState(() => quoteFromParams(params, initial));
  const [url, setUrl] = useState(initial.url);
  const [title, setTitle] = useState(initial.title);
  const [note, setNote] = useState('');
  const [hubId, setHubId] = useState(UNASSIGNED);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<Outcome | null>(null);
  // Script may close a window that holds only this page: the bookmarklet's
  // popup, or the app window a share opened.
  const [closable] = useState(() => Boolean(window.opener) || window.history.length <= 1);
  // Set before the request goes out: saving the same link twice is not a no-op,
  // it bumps the link's seen count.
  const sending = useRef(false);
  const outcomeRef = useRef<HTMLParagraphElement>(null);
  const hubs = useHubs();
  const saveLink = useSaveLink();
  const saveQuote = useCreateQuote();
  const pending = saveLink.isPending || saveQuote.isPending;

  // Saving swaps the form, focused Save button and all, for the outcome. Focus
  // would drop to the page, and a status inserted already holding its text is
  // not reliably read out, so focus goes to the outcome.
  useEffect(() => {
    if (saved) outcomeRef.current?.focus();
  }, [saved]);

  useEffect(() => {
    if (!saved || !closable) return;
    const timer = setTimeout(() => window.close(), CLOSE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [saved, closable]);

  const urlOk = isWebUrl(url);
  const hubOptions = [
    { value: UNASSIGNED, label: 'Unassigned' },
    ...[...(hubs.data?.items ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .map((hub) => ({ value: hub.id, label: hub.name })),
  ];

  /** Sends one save, once: a second press while it is out does nothing. */
  async function send(save: () => Promise<Outcome>) {
    if (sending.current || !urlOk) return;
    sending.current = true;
    setError('');
    try {
      setSaved(await save());
    } catch (err) {
      sending.current = false;
      setError(errorMessage(err));
    }
  }

  const sendLink = () =>
    send(async () =>
      linkOutcome(
        await saveLink.mutateAsync({
          url: url.trim(),
          title: title.trim(),
          note: note.trim(),
          hub: hubs.data?.items.find((hub) => hub.id === hubId)?.name,
        }),
      ),
    );

  // Only what was filled in, as the link save sends it.
  const sendQuote = () =>
    send(async () => {
      const body: CreateQuoteInput = { url: url.trim(), text: quote };
      if (title.trim()) body.title = title.trim();
      if (note.trim()) body.note = note.trim();
      return quoteOutcome(await saveQuote.mutateAsync(body));
    });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void (quote ? sendQuote() : sendLink());
  }

  const errorLine = error ? (
    <p role="alert" className={styles.error}>
      {error}
    </p>
  ) : null;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.brand}>
          <img src="/logo-mark.svg" alt="" className={styles.logo} />
          bukmark
        </h1>

        {saved ? (
          <div className={styles.body}>
            <p ref={outcomeRef} className={styles.outcome} role="status" tabIndex={-1}>
              {saved.message}
            </p>
            <p className={styles.savedLink}>{saved.saved}</p>
            <Link to="/" className={styles.secondary}>
              Open bukmark
            </Link>
          </div>
        ) : quote ? (
          <form className={styles.body} onSubmit={handleSubmit} noValidate aria-label="Save a quote">
            <figure className={styles.quote}>
              <blockquote className={styles.quoteText} cite={url}>
                {quote}
              </blockquote>
              <figcaption className={styles.source}>
                {title.trim() ? <span className={styles.sourceTitle}>{title.trim()}</span> : null}
                <span className={styles.host}>{sourceAddress(url).split('/')[0]}</span>
              </figcaption>
            </figure>

            <div className={styles.field}>
              <label htmlFor="save-note">Note</label>
              <textarea
                id="save-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                readOnly={pending}
                placeholder="optional"
                rows={3}
              />
            </div>

            {errorLine}

            <div className={styles.buttons}>
              <button type="submit" className={styles.button} disabled={pending}>
                {saveQuote.isPending ? 'Saving…' : 'Save quote'}
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={pending}
                onClick={() => void sendLink()}
              >
                {saveLink.isPending ? 'Saving…' : 'Save link only'}
              </button>
            </div>
          </form>
        ) : (
          <form className={styles.body} onSubmit={handleSubmit} noValidate aria-label="Save a link">
            <div className={styles.field}>
              <label htmlFor="save-title">Title</label>
              <input
                id="save-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                readOnly={saveLink.isPending}
                autoComplete="off"
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="save-url">Link</label>
              <input
                id="save-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                readOnly={saveLink.isPending}
                required
                spellCheck={false}
                autoComplete="off"
                aria-invalid={url.trim() && !urlOk ? true : undefined}
                aria-describedby={urlOk ? undefined : 'save-url-hint'}
              />
              {!urlOk && (
                <p id="save-url-hint" className={styles.hint}>
                  {url.trim() ? 'Only http and https links can be saved.' : 'Paste the link to save.'}
                </p>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor="save-note">Note</label>
              <textarea
                id="save-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                readOnly={saveLink.isPending}
                placeholder="optional — what your assistant sorts on later"
                rows={3}
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="save-hub">Hub</label>
              <Select
                id="save-hub"
                value={hubId}
                onValueChange={setHubId}
                options={hubOptions}
                ariaLabel="Hub"
                disabled={saveLink.isPending}
                className={styles.hubSelect}
              />
              {hubs.isError && (
                <p className={styles.hint}>Could not load hubs — saving still works.</p>
              )}
            </div>

            {errorLine}

            <button type="submit" className={styles.button} disabled={!urlOk || saveLink.isPending}>
              {saveLink.isPending ? 'Saving…' : 'Save'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
