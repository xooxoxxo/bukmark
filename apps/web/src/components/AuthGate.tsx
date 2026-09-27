import { useEffect, useState, type ReactNode } from 'react';
import { errorMessage } from '../api/client';
import { useAuthStatus } from '../api/queries';
import styles from './AuthScreen.module.css';
import { LoginScreen } from './LoginScreen';
import { SetupScreen } from './SetupScreen';

/** A status check faster than this paints nothing, so a normal load does not flash. */
const QUIET_MS = 200;

function useElapsed(active: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return active && elapsed;
}

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const { data, isError, error, isFetching, refetch } = useAuthStatus();
  const slow = useElapsed(!data && !isError, QUIET_MS);

  // A failed background refetch keeps the last known status rather than tearing down the app.
  if (!data) {
    if (isError) {
      return (
        <div className={styles.container}>
          <div className={styles.box}>
            <h1>bukmark could not load</h1>
            <p className={styles.error} role="alert">
              {errorMessage(error)}
            </p>
            <button type="button" className={styles.button} onClick={() => void refetch()}>
              {isFetching ? 'Trying again…' : 'Try again'}
            </button>
          </div>
        </div>
      );
    }
    return slow ? (
      <div className={styles.container}>
        <p className={styles.connecting} role="status">
          Connecting…
        </p>
      </div>
    ) : null;
  }

  if (!data.setupComplete) return <SetupScreen />;
  if (!data.authenticated) return <LoginScreen />;
  return <>{children}</>;
}
