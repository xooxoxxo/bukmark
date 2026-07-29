const API = process.env.BOOKMARKT_API_URL ?? 'http://localhost:3000';

export function apiBase(): string {
  return API;
}

async function readError(res: Response): Promise<string> {
  const msg = await res
    .json()
    .then((b) => (b as { error?: string }).error)
    .catch(() => null);
  return msg ?? `HTTP ${res.status}`;
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}
