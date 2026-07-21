import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('app', () => {
  it('healthz responds', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
