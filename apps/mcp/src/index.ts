import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { summarize, toRequestBody, type BookmarkItem, type ItemResult } from './addBookmarks.js';

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

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`bookmarkt MCP server ready (API ${API})`);
