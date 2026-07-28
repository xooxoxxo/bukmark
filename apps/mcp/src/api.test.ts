import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJson, postJson } from './api.js';

afterEach(() => { vi.unstubAllGlobals(); });

function stub(res: Partial<Response> & { json?: () => Promise<unknown> }): void {
  vi.stubGlobal('fetch', vi.fn(async () => res as unknown as Response));
}

describe('getJson', () => {
  it('returns the parsed body', async () => {
    stub({ ok: true, json: async () => ({ items: [1, 2] }) });
    await expect(getJson<{ items: number[] }>('/api/hubs')).resolves.toEqual({ items: [1, 2] });
  });

  it('throws with the server error message when the response is not ok', async () => {
    stub({ ok: false, status: 400, json: async () => ({ error: 'unparseable url' }) });
    await expect(getJson('/api/hubs')).rejects.toThrow('unparseable url');
  });

  it('falls back to the status code when the error body is unreadable', async () => {
    stub({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
    await expect(getJson('/api/hubs')).rejects.toThrow('HTTP 502');
  });
});

describe('postJson', () => {
  it('sends a json body and returns the parsed response', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ assigned: 2 }) } as unknown as Response));
    vi.stubGlobal('fetch', fetchMock);
    await expect(postJson('/api/links/assign', { assignments: [] })).resolves.toEqual({ assigned: 2 });
    const [, init] = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])!;
    expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' } });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ assignments: [] });
  });
});
