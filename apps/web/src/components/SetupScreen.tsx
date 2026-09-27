import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../api/client';
import { useSetupOwner } from '../api/queries';
import styles from './AuthScreen.module.css';

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 1024;

// Code points, matching the server: String .length counts an emoji as two.
const passwordLength = (value: string): number => [...value].length;

type Field = 'password' | 'confirm';

export function SetupScreen() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<{ message: string; field: Field } | null>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const setupOwner = useSetupOwner();

  useEffect(() => {
    passwordInputRef.current?.focus();
  }, []);

  function fail(message: string, field: Field) {
    setError({ message, field });
    const input = field === 'password' ? passwordInputRef.current : confirmInputRef.current;
    input?.focus();
    input?.select();
  }

  // Success needs no handler: useSetupOwner refetches the status and AuthGate moves on.
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (setupOwner.isPending) return;
    setError(null);

    if (passwordLength(password) < MIN_PASSWORD_LENGTH) {
      fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 'password');
      return;
    }

    if (passwordLength(password) > MAX_PASSWORD_LENGTH) {
      fail(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`, 'password');
      return;
    }

    if (password !== confirm) {
      fail('Passwords do not match', 'confirm');
      return;
    }

    try {
      await setupOwner.mutateAsync(password);
    } catch (err) {
      fail(errorMessage(err), 'password');
    }
  }

  function describedBy(field: Field, ...ids: string[]): string | undefined {
    if (error?.field === field) ids.push('auth-error');
    return ids.length ? ids.join(' ') : undefined;
  }

  return (
    <div className={styles.container}>
      <div className={styles.box}>
        <h1>Set up bukmark</h1>
        <p className={styles.instructions}>Create a password for this server.</p>

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label htmlFor="password">Password</label>
            <input
              ref={passwordInputRef}
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              readOnly={setupOwner.isPending}
              required
              autoComplete="new-password"
              aria-invalid={error?.field === 'password' ? true : undefined}
              aria-describedby={describedBy('password', 'password-rule')}
            />
            <p id="password-rule" className={styles.requirement}>
              {passwordLength(password) >= MIN_PASSWORD_LENGTH ? '✓' : ''} At least{' '}
              {MIN_PASSWORD_LENGTH} characters
            </p>
          </div>

          <div className={styles.field}>
            <label htmlFor="confirm">Confirm password</label>
            <input
              ref={confirmInputRef}
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              readOnly={setupOwner.isPending}
              required
              autoComplete="new-password"
              aria-invalid={error?.field === 'confirm' ? true : undefined}
              aria-describedby={describedBy('confirm')}
            />
          </div>

          {error && (
            <p id="auth-error" role="alert" className={styles.error}>
              {error.message}
            </p>
          )}

          <button type="submit" className={styles.button} disabled={setupOwner.isPending}>
            {setupOwner.isPending ? 'Creating…' : 'Create password'}
          </button>
        </form>
      </div>
    </div>
  );
}
