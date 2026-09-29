# Contributing

Bug reports, fixes and small improvements are welcome. For anything larger,
open an issue first to agree on the approach; it saves you rewriting a pull
request.

## Set up

Node.js 22 or later, pnpm 10, and Docker. The
[development guide](https://bukmark.it/docs/development/) runs the API and the
web app with hot reload; the [extension guide](https://bukmark.it/docs/extension/)
builds and loads the browser extension.

```bash
pnpm install
docker compose up -d db   # Postgres for the server and its tests
pnpm typecheck
pnpm test
```

The server's tests use `TEST_DATABASE_URL`, by default
`postgres://bukmark:bukmark@localhost:5432/bukmark_test`. Create that database
once: `docker compose exec db createdb -U bukmark bukmark_test`.

## Pull requests

- One change per pull request, with tests for what it fixes or adds.
- `pnpm typecheck` and `pnpm test` pass; CI runs both, and the builds.
- User-facing changes update the docs in `apps/site/src/content/docs/docs/`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`fix(extension): …`, `feat(server): …`, `docs: …`).

By contributing you agree your work is released under the [MIT license](LICENSE).
