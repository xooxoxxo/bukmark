import crypto from 'node:crypto';

const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

export function randomToken(bytes: number): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function pkceS256(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// The async form runs on the libuv threadpool; scryptSync would stall every
// other request for the ~70 ms each hash takes.
function scrypt(password: string, salt: Buffer, opts: crypto.ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, { ...opts, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, { N: 2 ** 15, r: 8, p: 1 });
  return `scrypt$15$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, logN, r, p, saltB64, hashB64, ...rest] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64 || rest.length > 0) return false;
  const hash = await scrypt(password, Buffer.from(saltB64, 'base64'), {
    N: 2 ** Number(logN),
    r: Number(r),
    p: Number(p),
  });
  return safeEqual(hash, Buffer.from(hashB64, 'base64'));
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function safeEqualString(a: string, b: string): boolean {
  return safeEqual(Buffer.from(a), Buffer.from(b));
}
