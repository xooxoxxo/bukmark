import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// IPv4 ranges that must never be reached by server-side og fetches: loopback,
// private, link-local (incl. cloud metadata 169.254.169.254), CGNAT/tailnet,
// benchmarking, multicast, reserved.
const V4_BLOCKS: ReadonlyArray<readonly [number, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [ipv4ToInt(base as string)!, bits as number] as const);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255 || (p.length > 1 && p.startsWith('0'))) return null;
    n = ((n << 8) | o) >>> 0;
  }
  return n;
}

export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    if (n === null) return true;
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) >>> 0 === (base & mask) >>> 0;
    });
  }
  if (kind === 6) {
    const norm = ip.toLowerCase();
    const mapped = norm.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]!);
    if (norm === '::1' || norm === '::') return true;
    // fe80::/10 link-local (fe80–febf)
    if (/^fe[89ab]/.test(norm)) return true;
    // fc00::/7 unique-local (fc/fd)
    if (norm.startsWith('fc') || norm.startsWith('fd')) return true;
    return false;
  }
  return true; // not a valid IP literal → block
}

// True only if the host is a public destination. Literal IPs are checked
// directly; hostnames are resolved and every returned address must be public.
export async function resolvesToPublic(hostname: string): Promise<boolean> {
  if (isIP(hostname)) return !isPrivateIp(hostname);
  try {
    const addrs = await lookup(hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}
