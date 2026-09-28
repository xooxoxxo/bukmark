import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { errorMessage, type SaveLinkResult } from '../api/client';
import { useHubs, useSaveLink } from '../api/queries';
import { Select } from '../components/ui/Select';
import { captureFromParams, isWebUrl } from '../save/capture';
import styles from './SavePage.module.css';

/** Hub ids are UUIDs, so this option value cannot collide with one. */
const UNASSIGNED = 'unassigned';

const CLOSE_AFTER_MS = 1000;

function outcomeMessage({ outcome, link }: SaveLinkResult): string {
  if (outcome === 'resurrected') return 'Restored — you had deleted this before';
  if (outcome === 'updated') return `Updated — seen ${link.dupeCount}×`;
  return 'Saved';
}

/**
 * Where the bookmarklet and the share sheet land. Nothing is saved until Save
 * is pressed: the session cookie is SameSite=Lax, so it rides along when any
 * site links here, and saving on load would let that site add links.
 */
export function SavePage() {
  const [params] = useSearchParams();
  const [initial] = useState(() => captureFromParams(params));
  const [url, setUrl] = useState(initial.url);
  const [title, setTitle] = useState(initial.title);
  const [note, setNote] = useState('');
  const [hubId, setHubId] = useState(UNASSIGNED);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<SaveLinkResult | null>(null);
  // Script may close a window that holds only this page: the bookmarklet's
  // popup, or the app window a share opened.
  const [closable] = useState(() => Boolean(window.opener) || window.history.length <= 1);
  // Set before the request goes out: saving the same link twice is not a no-op,
  // it bumps the link's seen count.
  const sending = useRef(false);
  const outcomeRef = useRef<HTMLParagraphElement>(null);
  const hubs = useHubs();
  const saveLink = useSaveLink();

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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (sending.current || !urlOk) return;
    sending.current = true;
    setError('');
    try {
      const result = await saveLink.mutateAsync({
        url: url.trim(),
        title: title.trim(),
        note: note.trim(),
        hub: hubs.data?.items.find((hub) => hub.id === hubId)?.name,
      });
      setSaved(result);
    } catch (err) {
      sending.current = false;
      setError(errorMessage(err));
    }
  }

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
              {outcomeMessage(saved)}
            </p>
            <p className={styles.savedLink}>{saved.link.title || saved.link.url}</p>
            <Link to="/" className={styles.secondary}>
              Open bukmark
            </Link>
          </div>
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
              <label htmlFor="save-note">Why keep it?</label>
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

            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}

            <button type="submit" className={styles.button} disabled={!urlOk || saveLink.isPending}>
              {saveLink.isPending ? 'Saving…' : 'Save'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
