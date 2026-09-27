import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../api/client';
import { useCreateToken, useDeleteToken, useListTokens } from '../api/queries';
import styles from './TokensPage.module.css';

interface NewToken {
  id: string;
  token: string;
  name: string;
}

export function TokensPage() {
  const tokens = useListTokens();
  const createToken = useCreateToken();
  const deleteToken = useDeleteToken();
  const [tokenName, setTokenName] = useState('');
  const [newToken, setNewToken] = useState<NewToken | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [returnFocus, setReturnFocus] = useState<string | null>(null);
  const [error, setError] = useState('');
  const tokenInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (newToken) tokenInputRef.current?.focus();
  }, [newToken]);

  async function handleCreateToken(e: FormEvent) {
    e.preventDefault();
    if (createToken.isPending) return;
    setError('');

    if (!tokenName.trim()) {
      setError('Token name is required');
      return;
    }

    try {
      const result = await createToken.mutateAsync(tokenName);
      setNewToken({ id: result.id, token: result.token, name: result.name });
      setCopied(null);
      setTokenName('');
    } catch (err) {
      setError(errorMessage(err));
      nameInputRef.current?.focus();
    }
  }

  async function handleDeleteToken(id: string) {
    setError('');
    try {
      await deleteToken.mutateAsync(id);
      setDeleteConfirm(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function askToRevoke(id: string) {
    setReturnFocus(null);
    setDeleteConfirm(id);
  }

  function cancelRevoke(id: string) {
    setReturnFocus(id);
    setDeleteConfirm(null);
  }

  // navigator.clipboard only exists in secure contexts; a plain-http LAN install has none.
  async function copyToken() {
    const input = tokenInputRef.current;
    if (!newToken || !input) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(newToken.token);
      } else {
        input.select();
        if (!document.execCommand('copy')) throw new Error('copy failed');
      }
      setCopied(true);
    } catch {
      input.focus();
      input.select();
      setCopied(false);
    }
  }

  function dismissNewToken() {
    setNewToken(null);
    setCopied(null);
    nameInputRef.current?.focus();
  }

  return (
    <div className={styles.container}>
      <p className={styles.description}>
        Tokens let the MCP server and scripts use this server. The browser extension creates its
        own token when you log in from it. You see each token once.
      </p>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {newToken && (
        <div className={styles.newTokenBox}>
          <p className={styles.newTokenLabel}>Token created: {newToken.name}</p>
          <p className={styles.newTokenWarning}>You won't see this token again. Copy it now.</p>
          <div className={styles.tokenDisplay}>
            <input
              ref={tokenInputRef}
              type="text"
              readOnly
              value={newToken.token}
              className={styles.tokenInput}
              aria-label="New access token"
              onClick={() => tokenInputRef.current?.select()}
            />
            <button type="button" className={styles.copyButton} onClick={() => void copyToken()}>
              Copy
            </button>
          </div>
          <p
            className={copied === false ? styles.copyFailed : styles.copyStatus}
            aria-live="polite"
          >
            {copied === true && 'Copied'}
            {copied === false && 'Copy failed. The token is selected; press Ctrl/Cmd+C.'}
          </p>
          <button type="button" className={styles.secondaryButton} onClick={dismissNewToken}>
            Done
          </button>
        </div>
      )}

      <div className={styles.section}>
        <h3>New token</h3>
        <form onSubmit={handleCreateToken} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="tokenName">Name</label>
            <input
              ref={nameInputRef}
              id="tokenName"
              type="text"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder="e.g., MCP server"
              readOnly={createToken.isPending}
              maxLength={100}
              autoComplete="off"
            />
          </div>
          <button
            type="submit"
            className={styles.createButton}
            disabled={createToken.isPending || !tokenName.trim()}
          >
            {createToken.isPending ? 'Creating…' : 'Create token'}
          </button>
        </form>
      </div>

      <div className={styles.section}>
        <h3>Active tokens</h3>
        {tokens.isError && (
          <div className={styles.loadError}>
            <p role="alert">Couldn't load tokens: {errorMessage(tokens.error)}</p>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void tokens.refetch()}
            >
              {tokens.isFetching ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        )}
        {tokens.isPending ? (
          <p className={styles.loading}>Loading tokens…</p>
        ) : !tokens.data ? null : tokens.data.items.length === 0 ? (
          <p className={styles.empty}>No tokens created yet.</p>
        ) : (
          <div className={styles.tokenList}>
            {tokens.data.items.map((token) => {
              const revokeLabel = `Revoke ${token.name} (${token.prefix})`;
              return (
                <div key={token.id} className={styles.tokenRow}>
                  <div className={styles.tokenInfo}>
                    <div className={styles.tokenName}>{token.name}</div>
                    <div className={styles.tokenMeta}>
                      {token.prefix} · Created {new Date(token.createdAt).toLocaleDateString()}
                      {token.lastUsedAt && (
                        <>
                          {' '}
                          · Last used {new Date(token.lastUsedAt).toLocaleDateString()}
                        </>
                      )}
                    </div>
                  </div>
                  <div className={styles.tokenActions}>
                    {deleteConfirm === token.id ? (
                      <div
                        className={styles.confirmDelete}
                        role="group"
                        aria-label={`Confirm: ${revokeLabel}?`}
                      >
                        <button
                          type="button"
                          className={styles.confirmButton}
                          aria-label={revokeLabel}
                          onClick={() => void handleDeleteToken(token.id)}
                          disabled={deleteToken.isPending}
                        >
                          Revoke
                        </button>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => cancelRevoke(token.id)}
                          disabled={deleteToken.isPending}
                          autoFocus
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        aria-label={revokeLabel}
                        onClick={() => askToRevoke(token.id)}
                        autoFocus={returnFocus === token.id}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
