import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { summarize, toRequestBody, type BookmarkItem, type ItemResult } from './addBookmarks.js';
import { getJson, postJson } from './api.js';
import {
  formatHubs, formatUnsorted, summarizeAssign,
  type AssignResult, type HubSummary, type UnsortedLink,
} from './sorting.js';

const API = process.env.BOOKMARKT_API_URL ?? 'http://localhost:3000';

const itemShape = {
  url: z.string(),
  title: z.string().optional(),
  note: z.string().optional(),
  hub: z.string().optional(),
  relevance: z.number().int().min(1).max(5).optional(),
};

async function postItem(item: BookmarkItem): Promise<ItemResult> {
  try {
    const res = await fetch(`${API}/api/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toRequestBody(item)),
    });
    if (!res.ok) {
      const msg = await res.json().then((b: { error?: string }) => b.error).catch(() => null);
      return { url: item.url, error: msg ?? `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { outcome: ItemResult['outcome'] };
    return { url: item.url, outcome: body.outcome };
  } catch (err) {
    return { url: item.url, error: err instanceof Error ? err.message : 'request failed' };
  }
}

const server = new McpServer({ name: 'bookmarkt', version: '1.0.0' });

server.registerTool(
  'add_bookmarks',
  {
    title: 'Add bookmarks',
    description:
      'Add one or more bookmarks to bookmarkt. Each item needs a url; optionally title, note (why worth keeping), hub (category name, auto-created), and relevance (1-5). Existing urls are updated; previously deleted urls are resurrected.',
    inputSchema: { items: z.array(z.object(itemShape)).min(1) },
  },
  async ({ items }) => {
    const results: ItemResult[] = [];
    for (const item of items) results.push(await postItem(item));
    return { content: [{ type: 'text', text: summarize(results) }] };
  },
);

server.registerTool(
  'list_unsorted',
  {
    title: 'List unsorted bookmarks',
    description:
      'List bookmarks that have no hub assigned yet. Each entry includes the note (why it was kept) and, for imported bookmarks, "was in" — the folder path it had in the browser, which is a hint about where it belongs, not a decision. Use with list_hubs before calling assign_hubs.',
    inputSchema: { limit: z.number().int().min(1).max(200).optional() },
  },
  async ({ limit }) => {
    const n = limit ?? 50;
    const body = await getJson<{ items: UnsortedLink[]; total: number }>(
      `/api/links?unassigned=true&limit=${n}`,
    );
    return { content: [{ type: 'text', text: formatUnsorted(body.items) }] };
  },
);

server.registerTool(
  'list_hubs',
  {
    title: 'List hubs',
    description:
      'List existing hubs (categories) with how many links each holds. Always call this before assign_hubs so you reuse an existing hub name instead of creating a near-duplicate.',
    inputSchema: {},
  },
  async () => {
    const body = await getJson<{ items: HubSummary[] }>('/api/hubs');
    return { content: [{ type: 'text', text: formatHubs(body.items) }] };
  },
);

server.registerTool(
  'assign_hubs',
  {
    title: 'Assign bookmarks to hubs',
    description:
      'Assign unsorted bookmarks to hubs in one batch. Each assignment needs linkId (from list_unsorted) and hub (a name; created automatically if new). Optional relevance 1-5. Re-assigning an existing pair updates its relevance.',
    inputSchema: {
      assignments: z
        .array(
          z.object({
            linkId: z.string(),
            hub: z.string().min(1),
            relevance: z.number().int().min(1).max(5).optional(),
          }),
        )
        .min(1)
        .max(100),
    },
  },
  async ({ assignments }) => {
    const res = await postJson<AssignResult>('/api/links/assign', { assignments });
    return { content: [{ type: 'text', text: summarizeAssign(res) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`bookmarkt MCP server ready (API ${API})`);
