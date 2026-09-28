import { buildApp } from './app.js';
import { config } from './config.js';

const app = await buildApp({ checkPages: config.checkPages });
await app.listen({ port: config.port, host: '0.0.0.0' });
