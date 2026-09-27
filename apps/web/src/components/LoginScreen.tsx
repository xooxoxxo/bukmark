import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../api/client';
import { useLogin } from '../api/queries';
import styles from './AuthScreen.module.css';

export function LoginScreen() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const login = useLogin();

  useEffect(() => {
    passwordInputRef.current?.focus();
  }, []);

  // Success needs no handler: useLogin refetches the status and AuthGate moves on.
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (login.isPending) return;
    setError('');
    try {
      await login.mutateAsync(password);
    } catch (err) {
      setError(errorMessage(err));
      passwordInputRef.current?.focus();
      passwordInputRef.current?.select();
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.box}>
        <h1>Sign in</h1>
        <p className={styles.instructions}>Enter the password for this server.</p>

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label htmlFor="password">Password</label>
            <input
              ref={passwordInputRef}
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              readOnly={login.isPending}
              required
              autoComplete="current-password"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'auth-error' : undefined}
            />
          </div>

          {error && (
            <p id="auth-error" role="alert" className={styles.error}>
              {error}
            </p>
          )}

          <button type="submit" className={styles.button} disabled={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
