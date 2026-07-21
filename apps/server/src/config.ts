export const config = {
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://bookmarkt:bookmarkt@localhost:5432/bookmarkt',
  port: Number(process.env.PORT ?? 3000),
};
