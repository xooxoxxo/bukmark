import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useMatch, useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { buildExportUrl, type ExportFormat } from '../api/exportUrl';
import { useDeleteHub, useHubs, usePatchHub } from '../api/queries';
import { useFilters } from '../state/filters';
import styles from './AppToolbar.module.css';

const FORMATS: [ExportFormat, string][] = [
  ['html', 'HTML'],
  ['json', 'JSON'],
  ['csv', 'CSV'],
];

export function AppToolbar() {
  const { hubId } = useParams<{ hubId: string }>();
  const onTokens = useMatch('/settings/tokens') !== null;
  const { data: hubs } = useHubs();
  const hub = hubs?.items.find((item) => item.id === hubId);
  const q = useFilters((state) => state.q);
  const unassigned = useFilters((state) => state.unassigned);
  const status = useFilters((state) => state.status);
  const patchHub = usePatchHub();
  const deleteHub = useDeleteHub();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setOpen(false);
    setEditing(false);
    setConfirmingDelete(false);
  }, [hubId]);

  const title = hub?.name ?? (hubId ? 'Hub' : unassigned ? 'Unassigned' : 'All links');
  const archived = hub?.status === 'archived';
  const mutationError = patchHub.error ?? deleteHub.error;

  const currentExport = (format: ExportFormat): string =>
    buildExportUrl({ format, q, hub: hubId, unassigned, status });

  function saveRename(event: FormEvent) {
    event.preventDefault();
    if (!hubId) return;
    const trimmed = name.trim();
    if (!trimmed || patchHub.isPending) return;
    patchHub.mutate(
      { id: hubId, body: { name: trimmed } },
      { onSuccess: () => setEditing(false) },
    );
  }

  function cancelRename() {
    setEditing(false);
    patchHub.reset();
  }

  function handleRenameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
    }
  }

  if (onTokens) {
    return (
      <header className={styles.bar} aria-label="Application toolbar">
        <div className={styles.identity}>
          <h2 className={styles.title}>Access tokens</h2>
        </div>
      </header>
    );
  }

  return (
    <header className={styles.bar} aria-label="Application toolbar">
      {editing && hub ? (
        <form className={styles.renameForm} onSubmit={saveRename}>
          <input
            aria-label="Hub name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={handleRenameKeyDown}
            autoFocus
          />
          <button type="submit" disabled={!name.trim() || patchHub.isPending}>
            Save
          </button>
          <button type="button" onClick={cancelRename}>
            Cancel
          </button>
          {patchHub.isError ? (
            <span className={styles.inlineError} role="alert">
              {errorMessage(patchHub.error)}
            </span>
          ) : null}
        </form>
      ) : (
        <div className={styles.identity}>
          <h2 className={styles.title}>{title}</h2>
          <DropdownMenu.Root
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) {
                setConfirmingDelete(false);
                patchHub.reset();
                deleteHub.reset();
              }
            }}
          >
            <DropdownMenu.Trigger asChild>
              <button type="button" className={styles.more} aria-label={`Actions for ${title}`}>
                <span aria-hidden="true">•••</span>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className={styles.menu}
                align="start"
                sideOffset={6}
                collisionPadding={8}
              >
                {hub && hubId ? (
                  <>
                    <DropdownMenu.Item
                      className={styles.menuItem}
                      onSelect={() => {
                        setName(hub.name);
                        setEditing(true);
                      }}
                    >
                      Rename hub
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className={styles.menuItem}
                      disabled={patchHub.isPending}
                      onSelect={(event) => {
                        event.preventDefault();
                        patchHub.mutate(
                          { id: hubId, body: { status: archived ? 'active' : 'archived' } },
                          { onSuccess: () => setOpen(false) },
                        );
                      }}
                    >
                      {archived ? 'Unarchive hub' : 'Archive hub'}
                    </DropdownMenu.Item>
                    {confirmingDelete ? (
                      <DropdownMenu.Item
                        className={`${styles.menuItem} ${styles.danger}`}
                        disabled={deleteHub.isPending}
                        onSelect={(event) => {
                          event.preventDefault();
                          deleteHub.mutate(hubId, {
                            onSuccess: () => {
                              setOpen(false);
                              navigate('/');
                            },
                          });
                        }}
                      >
                        Really delete hub?
                      </DropdownMenu.Item>
                    ) : (
                      <DropdownMenu.Item
                        className={`${styles.menuItem} ${styles.danger}`}
                        onSelect={(event) => {
                          event.preventDefault();
                          setConfirmingDelete(true);
                        }}
                      >
                        Delete hub
                      </DropdownMenu.Item>
                    )}
                    <DropdownMenu.Separator className={styles.separator} />
                  </>
                ) : null}
                {FORMATS.map(([format, label]) => (
                  <DropdownMenu.Item key={format} asChild>
                    <a
                      className={styles.menuItem}
                      href={currentExport(format)}
                      download
                      onClick={() => setOpen(false)}
                    >
                      Export {label}
                    </a>
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Separator className={styles.separator} />
                <DropdownMenu.Item asChild>
                  <a
                    className={styles.menuItem}
                    href={buildExportUrl({ format: 'json', status: 'all' })}
                    download
                    onClick={() => setOpen(false)}
                  >
                    Full backup (JSON)
                  </a>
                </DropdownMenu.Item>
                {mutationError ? (
                  <p className={styles.menuError} role="alert">
                    {errorMessage(mutationError)}
                  </p>
                ) : null}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          {hub?.description ? <p className={styles.description}>{hub.description}</p> : null}
        </div>
      )}
    </header>
  );
}
