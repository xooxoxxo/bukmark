import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { getDb, type Db } from './db/client.js';
import { linkRoutes } from './routes/links.js';

declare module 'fastify' {
  interface FastifyInstance { db: Db }
}

export async function buildApp(opts: { databaseUrl?: string } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: true }).withTypeProvider<TypeBoxTypeProvider>();
  const { db, sql } = getDb(opts.databaseUrl);
  app.decorate('db', db);
  app.addHook('onClose', async () => { await sql.end(); });

  app.get('/healthz', async () => ({ ok: true }));
  await app.register(linkRoutes, { prefix: '/api' });

  const webDist = join(import.meta.dirname, '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not found' });
    });
  }
  return app;
}
