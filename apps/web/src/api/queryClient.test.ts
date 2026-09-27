import { describe, expect, it } from 'vitest';
import { ApiError } from './client';
import { createQueryClient } from './queryClient';

function retryOf(queryClient = createQueryClient()) {
  const retry = queryClient.getDefaultOptions().queries?.retry;
  if (typeof retry !== 'function') throw new Error('expected a retry function');
  return (failureCount: number, error: unknown) => retry(failureCount, error as Error);
}

describe('createQueryClient', () => {
  it('does not retry a query the server refused', () => {
    const retry = retryOf();
    expect(retry(0, new ApiError('Session expired', 401, 'unauthenticated'))).toBe(false);
    expect(retry(0, new ApiError('Cross-site request refused', 403, 'bad_origin'))).toBe(false);
  });

  it('retries other failures once', () => {
    const retry = retryOf();
    expect(retry(0, new ApiError('database is down', 500))).toBe(true);
    expect(retry(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(retry(1, new ApiError('database is down', 500))).toBe(false);
  });

  it('marks the auth status stale when a query or a mutation gets a 401', async () => {
    const queryClient = createQueryClient();
    const status = () => queryClient.getQueryState(['auth-status'])?.isInvalidated;
    queryClient.setQueryData(['auth-status'], { setupComplete: true, authenticated: true });

    await queryClient
      .fetchQuery({
        queryKey: ['stats'],
        queryFn: () => Promise.reject(new ApiError('database is down', 500)),
        retry: false,
      })
      .catch(() => undefined);
    expect(status()).toBe(false);

    await queryClient
      .fetchQuery({
        queryKey: ['links'],
        queryFn: () => Promise.reject(new ApiError('Session expired', 401, 'unauthenticated')),
      })
      .catch(() => undefined);
    expect(status()).toBe(true);

    queryClient.setQueryData(['auth-status'], { setupComplete: true, authenticated: true });
    await queryClient
      .getMutationCache()
      .build(queryClient, {
        mutationFn: () => Promise.reject(new ApiError('Session expired', 401, 'unauthenticated')),
      })
      .execute(undefined)
      .catch(() => undefined);
    expect(status()).toBe(true);
  });
});
