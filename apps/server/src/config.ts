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
};
