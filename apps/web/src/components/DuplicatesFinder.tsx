import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { errorMessage } from '../api/client';
import styles from './DuplicatesFinder.module.css';

interface Link {
  id: string;
  url: string;
  title: string;
  hubIds: string[];
  status: string;
  createdAt: string;
  dupeCount: number;
}

interface Group {
  reason: string;
  links: Link[];
}

interface DuplicatesResponse {
  groups: Group[];
}

export function DuplicatesFinder() {
  const [selectedKeeps, setSelectedKeeps] = useState<Record<string, string>>({});
  const [mergeLoading, setMergeLoading] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState('');

  const { data, isLoading, error, refetch } = useQuery<DuplicatesResponse>({
    queryKey: ['links', 'duplicates'],
    queryFn: async () => {
      const res = await fetch('/api/links/duplicates');
      if (!res.ok) throw new Error(`Failed to fetch duplicates: ${res.statusText}`);
      return res.json();
    },
  });

  const merge = useMutation({
    mutationFn: async ({ groupIndex, keepId }: { groupIndex: number; keepId: string }) => {
      if (!data) throw new Error('No data');
      const group = data.groups[groupIndex];
      if (!group) throw new Error('Group not found');
      const mergeIds = group.links.filter((l) => l.id !== keepId).map((l) => l.id);
      if (mergeIds.length === 0) throw new Error('No links to merge');

      const res = await fetch('/api/links/merge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ keepId, mergeIds }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error || `Failed to merge: ${res.statusText}`);
      }
      return res.json();
    },
    onSuccess: () => {
      setSelectedKeeps({});
      void refetch();
    },
  });

  async function handleMerge(groupIndex: number) {
    setMergeError('');
    const keepId = selectedKeeps[groupIndex];
    if (!keepId) return;

    setMergeLoading(`${groupIndex}`);
    try {
      await merge.mutateAsync({ groupIndex, keepId });
    } catch (err) {
      setMergeError(errorMessage(err));
    } finally {
      setMergeLoading(null);
    }
  }

  if (isLoading) return <p className={styles.status}>Finding duplicates…</p>;
  if (error) {
    return (
      <div className={styles.error} role="alert">
        {errorMessage(error)}
      </div>
    );
  }

  const groups = data?.groups ?? [];

  if (groups.length === 0) {
    return <p className={styles.status}>No duplicates found</p>;
  }

  return (
    <div className={styles.container}>
      {groups.map((group, groupIndex) => {
        const keepId = selectedKeeps[groupIndex] || group.links[0]?.id;
        return (
          <div key={groupIndex} className={styles.group}>
            <div className={styles.groupHeader}>
              <h3 className={styles.groupTitle}>{group.reason}</h3>
              <span className={styles.groupCount}>{group.links.length} variants</span>
            </div>

            <div className={styles.links}>
              {group.links.map((link) => (
                <label key={link.id} className={styles.linkRow}>
                  <input
                    type="radio"
                    name={`group-${groupIndex}`}
                    value={link.id}
                    checked={keepId === link.id}
                    onChange={(e) => setSelectedKeeps({ ...selectedKeeps, [groupIndex]: e.target.value })}
                    className={styles.radio}
                  />
                  <div className={styles.linkInfo}>
                    <div className={styles.title}>{link.title || '(No title)'}</div>
                    <div className={styles.url} title={link.url}>{link.url}</div>
                    <div className={styles.meta}>
                      {link.hubIds.length > 0 && <span className={styles.hubCount}>{link.hubIds.length} hubs</span>}
                      <span className={styles.date}>{new Date(link.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.mergeButton}
                onClick={() => void handleMerge(groupIndex)}
                disabled={!keepId || mergeLoading === `${groupIndex}`}
              >
                {mergeLoading === `${groupIndex}` ? 'Merging…' : 'Merge'}
              </button>
            </div>
          </div>
        );
      })}

      {mergeError && (
        <div className={styles.error} role="alert">
          {mergeError}
        </div>
      )}
    </div>
  );
}
