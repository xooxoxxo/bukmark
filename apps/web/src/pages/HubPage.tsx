import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useDeleteHub, useHubs, usePatchHub } from '../api/queries';
import { LinksView } from '../components/LinksView';
import styles from './HubPage.module.css';

export function HubPage() {
  const { hubId } = useParams<{ hubId: string }>();
  const { data } = useHubs();
  const patchHub = usePatchHub();
  const deleteHub = useDeleteHub();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [confirming, setConfirming] = useState(false);

  const hub = data?.items.find((h) => h.id === hubId);
  if (!hubId) return null;
  if (!hub) {
    return (
      <div className={styles.state} role="status">
        <h2>Hub not found</h2>
        <p>This hub may have been renamed, archived, or removed.</p>
      </div>
    );
  }

  function saveRename(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    patchHub.mutate({ id: hubId!, body: { name: trimmed } }, { onSuccess: () => setEditing(false) });
  }

  const archived = hub.status === 'archived';

  return (
    <>
      <header className={styles.header}>
        {editing ? (
          <form onSubmit={saveRename} className={styles.renameForm}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Hub name"
            />
            <button type="submit">Save</button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <h2 className={styles.name}>{hub.name}</h2>
            {hub.description ? <p className={styles.desc}>{hub.description}</p> : null}
            <div className={styles.actions}>
              <button
                onClick={() => {
                  setName(hub.name);
                  setEditing(true);
                }}
              >
                Rename
              </button>
              <button
                onClick={() =>
                  patchHub.mutate({ id: hubId, body: { status: archived ? 'active' : 'archived' } })
                }
              >
                {archived ? 'Unarchive hub' : 'Archive hub'}
              </button>
              {confirming ? (
                <button
                  className={styles.danger}
                  onClick={() => deleteHub.mutate(hubId, { onSuccess: () => navigate('/') })}
                >
                  Really delete?
                </button>
              ) : (
                <button className={styles.danger} onClick={() => setConfirming(true)}>
                  Delete
                </button>
              )}
            </div>
          </>
        )}
        {(patchHub.isError || deleteHub.isError) ? (
          <p className={styles.error}>{errorMessage(patchHub.error ?? deleteHub.error)}</p>
        ) : null}
      </header>
      <LinksView hubId={hubId} />
    </>
  );
}
