/** Known account-private conversation routes can return a generic anonymous public shell. */
export function privateConversationUrl(input: string): boolean {
  const url = URL.parse(input);
  if (!url) return false;
  const host = url.hostname.replace(/^www\./, '');
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return false; }
  if (host === 'claude.ai') return /^\/chat(?:\/|$)/i.test(path);
  if (host === 'chatgpt.com' || host === 'chat.openai.com') {
    return /^\/c(?:\/|$)|^\/g\/[^/]+\/c(?:\/|$)|^\/g\/g-p-[^/]+(?:\/|$)/i.test(path);
  }
  return false;
}
