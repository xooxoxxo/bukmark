import * as Popover from '@radix-ui/react-popover';
import { useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import { useBulkLinks, useHubs } from '../api/queries';
import { useSelection } from '../state/selection';
import styles from './BulkBar.module.css';
import { Select } from './ui/Select';

export function BulkBar() {
  const selected = useSelection((s) => s.selected);
  const clear = useSelection((s) => s.clear);
  const { data: hubs } = useHubs();
  const bulk = useBulkLinks();
  const [hubId, setHubId] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [selected]);

  if (selected.size === 0) return null;
  const ids = [...selected];

  function run(action: 'archive' | 'assign' | 'delete') {
    bulk.mutate(
      action === 'assign' ? { ids, action, hubId } : { ids, action },
      { onSuccess: () => clear() },
    );
  }

  return (
    <div className={styles.summary}>
      <span className={styles.selectedCount}>{selected.size} selected</span>
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirmingDelete(false);
        }}
      >
        <Popover.Trigger asChild>
          <button type="button" className={styles.trigger}>
            Actions
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className={styles.content}
            align="end"
            sideOffset={6}
            collisionPadding={12}
            aria-label="Bulk actions"
          >
            <p className={styles.heading}>{selected.size} selected</p>
            <div className={styles.assignRow}>
              <Select
                value={hubId}
                onValueChange={setHubId}
                options={(hubs?.items ?? []).map((hub) => ({
                  value: hub.id,
                  label: hub.name,
                }))}
                placeholder="Choose hub…"
                ariaLabel="Assign to hub"
                className={styles.hubSelect}
              />
              <button
                type="button"
                onClick={() => run('assign')}
                disabled={!hubId || bulk.isPending}
              >
                Assign
              </button>
            </div>
            <div className={styles.actions}>
              <button type="button" onClick={() => run('archive')} disabled={bulk.isPending}>
                Archive
              </button>
              {confirmingDelete ? (
                <button
                  type="button"
                  className={styles.danger}
                  onClick={() => run('delete')}
                  disabled={bulk.isPending}
                >
                  Really delete {selected.size}?
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.danger}
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  clear();
                }}
                className={styles.ghost}
              >
                Clear
              </button>
            </div>
            {bulk.isError ? (
              <p className={styles.error} role="alert" aria-live="polite">
                {errorMessage(bulk.error)}
              </p>
            ) : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
