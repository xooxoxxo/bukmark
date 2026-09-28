import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { config } from './config.js';
import { getDb, type Db } from './db/client.js';
import { linkRoutes } from './routes/links.js';
import { hubRoutes } from './routes/hubs.js';
import { exportRoutes } from './routes/export.js';
import { fetchOgImage as defaultFetchOgImage } from './og/fetchOgImage.js';
import { checkPage as defaultCheckPage, startPageChecks, type CheckPage } from './og/checkLinks.js';
import { RateLimiter } from './auth/rateLimit.js';
import { requireAuth } from './auth/plugin.js';
import { publicAuthRoutes } from './auth/routes.js';
import { protectedAuthRoutes } from './auth/protectedRoutes.js';
import { authorizeDonePage, authorizePage } from './auth/authorizePage.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    fetchOgImage: (url: string) => Promise<string | null>;
    rateLimiter: RateLimiter;
    registeredRoutes: { method: string; url: string }[];
  }
}

// Default serializers already leave headers out; this guards any future log
// line that includes them.
export const LOG_REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'res.headers["set-cookie"]',
];

export async function buildApp(
  opts: {
    databaseUrl?: string;
    fetchOgImage?: (url: string) => Promise<string | null>;
    corsOrigins?: string[];
    trustProxy?: boolean | number | string;
    logStream?: NodeJS.WritableStream;
    /** null means unset, whatever BUKMARK_EXTENSION_IDS says. */
    extensionIds?: string[] | null;
    webDist?: string;
    /** Fetches a page for a link check; tests pass a stub. */
    checkPage?: CheckPage;
    /** Check links in the background. Off unless asked for, so tests never go online. */
    checkPages?: boolean;
  } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { redact: LOG_REDACT, ...(opts.logStream ? { stream: opts.logStream } : {}) },
    trustProxy: opts.trustProxy ?? config.trustProxy,
  }).withTypeProvider<TypeBoxTypeProvider>();

  const registeredRoutes: { method: string; url: string }[] = [];
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) registeredRoutes.push({ method, url: route.url });
  });
  app.decorate('registeredRoutes', registeredRoutes);

  const { db, sql } = getDb(opts.databaseUrl);
  app.decorate('db', db);
  app.decorate('fetchOgImage', opts.fetchOgImage ?? defaultFetchOgImage);
  app.addHook('onClose', async () => { await sql.end(); });

  const checkPage = opts.checkPage ?? defaultCheckPage;
  if (opts.checkPages) startPageChecks(app, checkPage);

  const rateLimiter = new RateLimiter();
  app.decorate('rateLimiter', rateLimiter);
  app.addHook('onClose', () => { rateLimiter.close(); });

  // Explicit allowlist, never a wildcard: it decides which other origins may
  // read API responses from a browser.
  const corsOrigins = opts.corsOrigins ?? config.corsOrigins;
  if (corsOrigins.length > 0) {
    await app.register(cors, {
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    });
  }

  app.get('/healthz', async () => ({ ok: true }));

  await app.register(cookie);
  await app.register(publicAuthRoutes, { prefix: '/api/auth' });
  await app.register(authorizePage, {
    extensionIds: opts.extensionIds === undefined ? config.extensionIds : opts.extensionIds,
  });
  await app.register(authorizeDonePage);

  await app.register(async (api) => {
    api.addHook('onRequest', requireAuth);
    await api.register(protectedAuthRoutes, { prefix: '/auth' });
    await api.register(linkRoutes, { checkPage });
    await api.register(hubRoutes);
    await api.register(exportRoutes);
  }, { prefix: '/api' });

  const webDist = opts.webDist ?? join(import.meta.dirname, '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      // A same-site page (another app on this host) gets the Lax session cookie
      // inside a frame, so any framable page, /save above all, could be laid
      // under a decoy and clickjacked. Also runs for reply.sendFile, so it
      // covers the SPA fallback below.
      setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
          res.setHeader('x-frame-options', 'DENY');
          res.setHeader('content-security-policy', "frame-ancestors 'none'");
        }
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not found' });
    });
  }
  return app;
}
