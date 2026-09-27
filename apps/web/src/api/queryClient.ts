import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

function isRefused(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

export function createQueryClient(): QueryClient {
  // Any 401 means the session is gone: refetching the status flips AuthGate to the login screen.
  function onError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      void queryClient.invalidateQueries({ queryKey: ['auth-status'] });
    }
  }

  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => failureCount < 1 && !isRefused(error),
      },
    },
  });
  return queryClient;
}
