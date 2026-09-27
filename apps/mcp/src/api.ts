const API = process.env.BUKMARK_API_URL ?? 'http://localhost:3000';

export function apiBase(): string {
  return API;
}

function getAuthHeaders(): { authorization?: string } {
  const token = process.env.BUKMARK_API_TOKEN;
  if (!token) return {};
  return { authorization: `Bearer ${token}` };
}

async function readError(res: Response): Promise<string> {
  if (res.status === 401) {
    return 'bukmark rejected the request (401). Set BUKMARK_API_TOKEN to a token from the web app: Settings → Access tokens.';
  }
  const msg = await res
    .json()
    .then((b) => (b as { error?: string }).error)
    .catch(() => null);
  return msg ?? `HTTP ${res.status}`;
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}
