/**
 * TRUST_PROXY=true trusts one hop: the reverse proxy in front of the app. The
 * client address is then the entry that proxy appended to X-Forwarded-For;
 * anything further left was written by the client and is ignored, so it cannot
 * dodge the per-IP rate limits. A hop count or a comma-separated list of proxy
 * addresses/CIDRs is passed through for longer chains.
 */
export function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (!value || value === 'false') return false;
  if (value === 'true') return 1;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/**
 * BUKMARK_EXTENSION_IDS: the Chrome extension IDs and Firefox redirect hashes
 * the consent page knows. null when unset, which keeps the built-in default.
 */
export function parseExtensionIds(value: string | undefined): string[] | null {
  const ids = (value ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return ids.length > 0 ? ids : null;
}

export const config = {
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark',
  port: Number(process.env.PORT ?? 3000),
  // Comma-separated allowlist, e.g. "chrome-extension://abc...,http://localhost:5173".
  // Empty (the default) means CORS is not registered at all — same-origin only.
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  extensionIds: parseExtensionIds(process.env.BUKMARK_EXTENSION_IDS),
  // Fetch saved pages in the background for their text and status. On unless
  // BUKMARK_CHECK_PAGES=false.
  checkPages: process.env.BUKMARK_CHECK_PAGES !== 'false',
};
