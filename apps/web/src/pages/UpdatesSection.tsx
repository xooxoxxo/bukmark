import { errorMessage } from '../api/client';
import { useCheckUpdates, useSetUpdates, useUpdates } from '../api/queries';
import type { InstallMethod, ReleaseNote, UpdatesStatus } from '../api/types';
import { useCopy } from '../components/useCopy';
import styles from './SettingsPage.module.css';

const INSTALLER_COMMAND = 'bukmark update';
const SOURCE_COMMAND = 'git pull && docker compose up -d --build';

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "5 minutes ago", "yesterday"; "just now" under a minute. */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return format.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

function Command({ command, label }: { command: string; label?: string }) {
  const { copied, failed, copy } = useCopy(() => command);
  return (
    <div className={styles.field}>
      {label ? <p className={styles.label}>{label}</p> : null}
      <div className={styles.command}>
        <code>{command}</code>
        <button
          type="button"
          className={styles.button}
          onClick={() => void copy()}
          aria-label={copied ? 'Copied' : `Copy ${command}`}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {failed ? (
        <p className={styles.error} role="alert">
          Could not copy: the browser did not allow the clipboard.
        </p>
      ) : null}
    </div>
  );
}

function HowToUpdate({ install }: { install: InstallMethod }) {
  const installer = (
    <>
      <Command command={INSTALLER_COMMAND} label={install === 'unknown' ? 'Installed with the bukmark command' : undefined} />
      <p className={styles.hint}>
        Backs up the database first. To undo: <code>bukmark rollback</code>.
      </p>
    </>
  );
  const source = (
    <Command command={SOURCE_COMMAND} label={install === 'unknown' ? 'Built from source' : undefined} />
  );
  if (install === 'installer') return installer;
  if (install === 'source') return source;
  return (
    <>
      {installer}
      {source}
    </>
  );
}

function Release({ release, open }: { release: ReleaseNote; open: boolean }) {
  return (
    <details className={styles.release} open={open}>
      <summary>What’s new in {release.version}</summary>
      {release.body?.trim() ? (
        <p className={styles.notes}>{release.body.trim()}</p>
      ) : (
        <p className={styles.hint}>No notes.</p>
      )}
      {release.url ? (
        <a className={styles.linkButton} href={release.url} target="_blank" rel="noreferrer">
          Release on GitHub
        </a>
      ) : null}
    </details>
  );
}

function statusLine(data: UpdatesStatus): string {
  if (data.development) return 'Development build.';
  const running = `Running ${data.version}.`;
  if (!data.enabled) return `${running} Update checks are off.`;
  const target = data.newer[0];
  if (data.updateAvailable && target) return `${running} ${target.version} is out.`;
  if (target && data.skippedVersion) return `${running} You skipped ${data.skippedVersion}.`;
  if (!data.lastCheckedAt) return `${running} Not checked yet.`;
  return `${running} Up to date.`;
}

export function UpdatesSection() {
  const { data, isPending, isError, error } = useUpdates();
  const check = useCheckUpdates();
  const set = useSetUpdates();

  let body;
  if (isPending) {
    body = <p className={styles.hint}>Loading…</p>;
  } else if (isError) {
    body = (
      <p className={styles.error} role="alert">
        Could not load update status: {errorMessage(error)}
      </p>
    );
  } else {
    const target = data.newer[0];
    const attention = data.newer.filter((r) => r.requiresAttention);
    const showUpdate = !data.development && data.newer.length > 0;
    const mutationError = check.error ?? set.error;
    body = (
      <>
        <div className={styles.field}>
          <p className={styles.current}>{statusLine(data)}</p>
          {data.lastCheckedAt && data.enabled ? (
            <p className={styles.hint}>
              Last checked{' '}
              <time dateTime={data.lastCheckedAt} title={new Date(data.lastCheckedAt).toLocaleString()}>
                {relativeTime(data.lastCheckedAt)}
              </time>
              .
            </p>
          ) : null}
          {data.error && data.enabled ? (
            <p className={styles.error}>The last check failed: {data.error}</p>
          ) : null}
          <div className={styles.row}>
            <button
              type="button"
              className={styles.button}
              disabled={check.isPending || !data.enabled}
              onClick={() => check.mutate()}
            >
              {check.isPending ? 'Checking…' : 'Check now'}
            </button>
            {data.updateAvailable && target ? (
              <button
                type="button"
                className={styles.linkButton}
                disabled={set.isPending}
                onClick={() => set.mutate({ skippedVersion: target.version })}
              >
                Skip this version
              </button>
            ) : null}
            {data.skippedVersion ? (
              <button
                type="button"
                className={styles.linkButton}
                disabled={set.isPending}
                onClick={() => set.mutate({ skippedVersion: null })}
              >
                Stop skipping
              </button>
            ) : null}
          </div>
          {mutationError ? (
            <p className={styles.error} role="alert">
              {errorMessage(mutationError)}
            </p>
          ) : null}
        </div>

        {showUpdate ? (
          <div className={styles.field}>
            {data.newer.map((release, i) => (
              <Release key={release.tag} release={release} open={i === 0} />
            ))}
          </div>
        ) : null}

        {showUpdate ? (
          <div className={styles.field}>
            <p className={styles.label}>How to update</p>
            {attention.length > 0 ? (
              <p className={styles.warning}>
                {attention.map((r) => r.version).join(', ')} {attention.length === 1 ? 'needs' : 'need'} a
                step from you. Read the notes before you update.
              </p>
            ) : null}
            <HowToUpdate install={data.install} />
          </div>
        ) : null}

        <div className={styles.field}>
          {data.lockedByServer ? (
            <p className={styles.hint}>
              Set by the server (<code>BUKMARK_UPDATE_FEED</code>).
            </p>
          ) : (
            <button
              type="button"
              className={styles.linkButton}
              disabled={set.isPending}
              onClick={() => set.mutate({ enabled: !data.enabled })}
            >
              {data.enabled ? 'Turn update checks off' : 'Turn update checks on'}
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <section className={styles.section} aria-labelledby="updates">
      <h2 id="updates" className={styles.heading}>Updates</h2>
      {body}
    </section>
  );
}
