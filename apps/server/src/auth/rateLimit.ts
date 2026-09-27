import { isIPv6 } from 'node:net';

const WINDOW_MS = 15 * 60 * 1000;

// Password sign-in shares one bucket across /api/auth/login and /authorize.
export const LIMITS = {
  login: { limit: 10, windowMs: WINDOW_MS },
  setup: { limit: 10, windowMs: WINDOW_MS },
  token: { limit: 30, windowMs: WINDOW_MS },
} as const;

export type Bucket = keyof typeof LIMITS;

// A client with a routed IPv6 prefix controls every address in its /64.
export function clientKey(ip: string): string {
  if (!isIPv6(ip)) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  let canonical: string;
  try {
    canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  } catch {
    return ip;
  }
  const [head = '', tail] = canonical.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  return `${groups.slice(0, 4).join(':')}::/64`;
}

export class RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  private cleanupInterval: NodeJS.Timeout;

  constructor(private maxEntries = 10_000) {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.buckets.entries()) {
        if (value.resetAt < now) {
          this.buckets.delete(key);
        }
      }
    }, 60 * 1000);

    this.cleanupInterval.unref();
  }

  check(ip: string, bucket: Bucket): { allowed: boolean; retryAfter: number } {
    const { limit, windowMs } = LIMITS[bucket];
    const key = `${clientKey(ip)}|${bucket}`;
    const now = Date.now();
    const entry = this.buckets.get(key);

    if (!entry || entry.resetAt < now) {
      // Re-insert so Map order stays oldest-window-first for eviction.
      this.buckets.delete(key);
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined && this.buckets.size >= this.maxEntries) this.buckets.delete(oldest);
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfter: 0 };
    }

    entry.count++;
    if (entry.count > limit) {
      return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfter: 0 };
  }

  reset(ip: string, bucket: Bucket): void {
    this.buckets.delete(`${clientKey(ip)}|${bucket}`);
  }

  get size(): number {
    return this.buckets.size;
  }

  close(): void {
    clearInterval(this.cleanupInterval);
  }
}
