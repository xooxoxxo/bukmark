/**
 * Seeds a throwaway database with plausible demo data, for trying the UI or
 * capturing it. Never point this at a real database — the real instance holds
 * personal bookmarks. The landing page's interactive demo
 * (apps/site/src/components/DemoApp.astro) uses a subset of these links.
 *
 *   pnpm --filter @bukmark/server exec tsx scripts/seedDemo.ts
 */
import { normalizeUrl } from '@bukmark/shared';
import { getDb } from '../src/db/client.js';
import { addLink } from '../src/links/addLink.js';

const DEMO_URL =
  process.env.DEMO_DATABASE_URL ?? 'postgres://bukmark:bukmark@localhost:5432/bukmark_demo';

// Safety by construction, not by convention. This script exists to keep
// published demo data away from real bookmarks, so it refuses to run
// against anything but the throwaway demo database.
if (!/\/bukmark_demo(\?|$)/.test(DEMO_URL)) {
  console.error(
    `refusing to seed: DEMO_DATABASE_URL must point at a database named ` +
      `bukmark_demo, got ${DEMO_URL.replace(/\/\/[^@]*@/, '//***@')}`,
  );
  process.exit(1);
}

const HUBS = ['rust', 'homelab', 'reading', 'design', 'postgres'];

const LINKS: Array<{ url: string; title: string; note: string; hub?: string }> = [
  { url: 'https://doc.rust-lang.org/book/', title: 'The Rust Programming Language', note: 'The book. Start at ch. 4 for ownership.', hub: 'rust' },
  { url: 'https://rust-lang.github.io/api-guidelines/', title: 'Rust API Guidelines', note: 'Naming conventions I keep forgetting.', hub: 'rust' },
  { url: 'https://tokio.rs/tokio/tutorial', title: 'Tokio Tutorial', note: 'Async runtime, worth doing end to end.', hub: 'rust' },
  { url: 'https://without.boats/blog/', title: 'without.boats', note: 'Async Rust design history from the inside.', hub: 'rust' },
  { url: 'https://tailscale.com/kb/1017/install/', title: 'Tailscale install docs', note: 'Tailnet setup for the homelab.', hub: 'homelab' },
  { url: 'https://docs.docker.com/compose/compose-file/', title: 'Compose file reference', note: 'Healthcheck syntax, every single time.', hub: 'homelab' },
  { url: 'https://pve.proxmox.com/wiki/Main_Page', title: 'Proxmox VE Wiki', note: 'VM passthrough notes.', hub: 'homelab' },
  { url: 'https://wiki.archlinux.org/title/Systemd', title: 'systemd — ArchWiki', note: 'Unit files, the good reference.', hub: 'homelab' },
  { url: 'https://caddyserver.com/docs/caddyfile', title: 'Caddyfile docs', note: 'Reverse proxy config.', hub: 'homelab' },
  { url: 'https://www.postgresql.org/docs/current/indexes.html', title: 'PostgreSQL: Indexes', note: 'Partial indexes section is the useful bit.', hub: 'postgres' },
  { url: 'https://use-the-index-luke.com/', title: 'Use The Index, Luke!', note: 'Best SQL indexing explainer there is.', hub: 'postgres' },
  { url: 'https://www.postgresql.org/docs/current/textsearch.html', title: 'PostgreSQL: Full Text Search', note: 'tsvector and ranking.', hub: 'postgres' },
  { url: 'https://github.com/pgvector/pgvector', title: 'pgvector', note: 'Embeddings in Postgres, no extra service.', hub: 'postgres' },
  { url: 'https://practicaltypography.com/', title: 'Butterick\'s Practical Typography', note: 'Read the summary of key rules.', hub: 'design' },
  { url: 'https://www.refactoringui.com/', title: 'Refactoring UI', note: 'Spacing and hierarchy, mostly.', hub: 'design' },
  { url: 'https://inclusive-components.design/', title: 'Inclusive Components', note: 'Accessible patterns worth copying.', hub: 'design' },
  { url: 'https://www.nngroup.com/articles/ten-usability-heuristics/', title: 'Ten Usability Heuristics', note: 'The checklist that still holds up.', hub: 'design' },
  { url: 'https://danluu.com/', title: 'Dan Luu', note: 'Long posts, high signal.', hub: 'reading' },
  { url: 'https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/', title: 'Things You Should Never Do, Part I', note: 'On rewrites. Reread before proposing one.', hub: 'reading' },
  { url: 'https://www.hillelwayne.com/post/', title: 'Hillel Wayne', note: 'Formal methods, made approachable.', hub: 'reading' },
  { url: 'https://apenwarr.ca/log/', title: 'apenwarr', note: 'Networking and org design.', hub: 'reading' },
  // Unsorted on purpose — this is the pile the product is about.
  { url: 'https://astro.build/blog/', title: 'Astro Blog', note: 'Content layer changes in 5.x.' },
  { url: 'https://developer.chrome.com/docs/extensions/mv3/intro/', title: 'Chrome MV3 overview', note: 'Optional host permissions.' },
  { url: 'https://modelcontextprotocol.io/docs', title: 'Model Context Protocol', note: 'Tool schema reference.' },
  { url: 'https://orm.drizzle.team/docs/overview', title: 'Drizzle ORM', note: 'Migration workflow.' },
  { url: 'https://fastify.dev/docs/latest/', title: 'Fastify docs', note: 'Plugin encapsulation rules.' },
  { url: 'https://vitest.dev/guide/', title: 'Vitest guide', note: 'Workspace config.' },
  { url: 'https://developers.cloudflare.com/pages/', title: 'Cloudflare Pages', note: 'Direct upload with wrangler.' },
  { url: 'https://sqlite.org/whentouse.html', title: 'When To Use SQLite', note: 'Honest about its limits.' },
  { url: 'https://jvns.ca/', title: 'Julia Evans', note: 'Debugging zines.' },
];

async function main(): Promise<void> {
  const { db, sql } = getDb(DEMO_URL);
  for (const l of LINKS) {
    const result = normalizeUrl(l.url);
    if (!result.ok) {
      console.warn(`failed to normalize ${l.url}: ${result.reason}`);
      continue;
    }
    await addLink(
      db,
      {
        url: result.url,
        urlHash: result.urlHash,
        title: l.title,
        note: l.note,
        hub: l.hub,
      },
      async () => null, // never fetch og:image while seeding
    );
  }
  console.log(`seeded ${LINKS.length} links across ${HUBS.length} hubs`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
