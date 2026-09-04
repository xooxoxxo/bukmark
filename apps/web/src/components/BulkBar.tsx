import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import { useBulkLinks, useHubs } from '../api/queries';
import type { LinkDto } from '../api/types';
import { useSelection } from '../state/selection';
import styles from './BulkBar.module.css';

export function BulkBar({ selectedLinks }: { selectedLinks: LinkDto[] }) {
  const selected = useSelection((state) => state.selected);
  const clear = useSelection((state) => state.clear);
  const { data: hubs } = useHubs();
  const bulk = useBulkLinks();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [open, setOpen] = useState(false);
  const [pendingHubIds, setPendingHubIds] = useState<ReadonlySet<string>>(new Set());
  const [hubError, setHubError] = useState<string | null>(null);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [selected]);

  if (selected.size === 0) return null;

  const ids = [...selected];
  const commonHubIds = new Set(
    selectedLinks[0]?.hubIds.filter((hubId) =>
      selectedLinks.every((link) => link.hubIds.includes(hubId)),
    ) ?? [],
  );
  const orderedHubs = [...(hubs?.items ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );

  function run(action: 'archive' | 'delete') {
    bulk.mutate(
      { ids, action },
      {
        onSuccess: () => {
          setOpen(false);
          clear();
        },
      },
    );
  }

  async function toggleHub(hubId: string, checked: boolean) {
    setHubError(null);
    setPendingHubIds((current) => new Set(current).add(hubId));
    try {
      await bulk.mutateAsync({
        ids,
        action: checked ? 'unassign' : 'assign',
        hubId,
      });
    } catch (error) {
      setHubError(errorMessage(error));
    } finally {
      setPendingHubIds((current) => {
        const next = new Set(current);
        next.delete(hubId);
        return next;
      });
    }
  }

  return (
    <div className={styles.summary}>
      <span className={styles.selectedCount}>{selected.size} selected</span>
      <DropdownMenu.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setConfirmingDelete(false);
            setHubError(null);
          }
        }}
      >
        <DropdownMenu.Trigger asChild>
          <button type="button" className={styles.trigger}>
            Actions
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={styles.content}
            align="end"
            sideOffset={6}
            collisionPadding={12}
            aria-label="Bulk actions"
          >
            <DropdownMenu.Group className={styles.hubList}>
              {orderedHubs.map((hub) => {
                const checked = commonHubIds.has(hub.id);
                const pending = pendingHubIds.has(hub.id);
                return (
                  <DropdownMenu.CheckboxItem
                    key={hub.id}
                    className={styles.checkItem}
                    checked={checked}
                    disabled={pending}
                    aria-busy={pending}
                    onSelect={(event) => {
                      event.preventDefault();
                      void toggleHub(hub.id, checked);
                    }}
                  >
                    <span className={styles.box} aria-hidden="true">
                      <DropdownMenu.ItemIndicator className={styles.indicator}>
                        ✓
                      </DropdownMenu.ItemIndicator>
                    </span>
                    <span className={styles.hubName}>{hub.name}</span>
                  </DropdownMenu.CheckboxItem>
                );
              })}
              {orderedHubs.length === 0 ? (
                <DropdownMenu.Item className={styles.empty} disabled>
                  No hubs yet
                </DropdownMenu.Item>
              ) : null}
            </DropdownMenu.Group>
            <DropdownMenu.Separator className={styles.separator} />
            <DropdownMenu.Item
              className={styles.menuItem}
              disabled={bulk.isPending}
              onSelect={(event) => {
                event.preventDefault();
                run('archive');
              }}
            >
              Archive
            </DropdownMenu.Item>
            {confirmingDelete ? (
              <DropdownMenu.Item
                className={`${styles.menuItem} ${styles.danger}`}
                disabled={bulk.isPending}
                onSelect={(event) => {
                  event.preventDefault();
                  run('delete');
                }}
              >
                Really delete {selected.size}?
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item
                className={`${styles.menuItem} ${styles.danger}`}
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirmingDelete(true);
                }}
              >
                Delete
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item className={`${styles.menuItem} ${styles.clear}`} onSelect={clear}>
              Clear selection
            </DropdownMenu.Item>
            {hubError || bulk.isError ? (
              <p className={styles.error} role="alert" aria-live="polite">
                {hubError ?? errorMessage(bulk.error)}
              </p>
            ) : null}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
