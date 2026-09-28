import { normalizeUrl } from '../../../../packages/shared/src/normalize';
import type { FakeRequest } from './chrome';

export interface ServerLink {
  id: string;
  url: string;
  title: string;
  note: string;
  status: 'active' | 'archived';
  /** Hub ids. */
  hubs: string[];
  updatedAt: string;
  dupeCount: number;
}

export interface ServerHub {
  id: string;
  name: string;
  status: 'active' | 'dormant' | 'archived';
}

type Reply = { status?: number; body?: unknown } | Error;

/**
 * A bukmark server in memory, answering the calls sync makes the way the
 * contract has the real one answer them: the changes feed ordered by
 * (updatedAt, id), `since` inclusive, hubs by name with archived hubs left
 * out, and every change that moves a link's hubs touching the link.
 */
export class FakeServer {
  readonly links = new Map<string, ServerLink>();
  readonly hubs = new Map<string, ServerHub>();
  readonly deletions: Array<{ id: string; deletedAt: string }> = [];
  /** Set to make every request fail as if the network were down. */
  offline = false;
  /** Status to answer every request with instead, when set. */
  failWith: number | null = null;
  pageSize: number | null = null;
  private clock = Date.parse('2026-09-28T10:00:00.000Z');
  private nextId = 1;

  private now(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private id(prefix: string): string {
    return `00000000-0000-4000-8000-${prefix}${String(this.nextId++).padStart(11, '0')}`.slice(0, 36);
  }

  hubByName(name: string): ServerHub | undefined {
    return [...this.hubs.values()].find((h) => h.name === name);
  }

  /** Arranges a hub, made if missing. */
  hub(name: string): ServerHub {
    const found = this.hubByName(name);
    if (found) return found;
    const hub: ServerHub = { id: this.id('0'), name, status: 'active' };
    this.hubs.set(hub.id, hub);
    return hub;
  }

  /** Arranges a link, as a save from the web app would make it. */
  add(url: string, title: string, hubs: string[] = [], status: ServerLink['status'] = 'active'): ServerLink {
    const norm = normalizeUrl(url);
    if (!norm.ok) throw new Error(`bad url ${url}`);
    const link: ServerLink = {
      id: this.id('1'), url: norm.url, title, note: '', status, hubs: hubs.map((h) => this.hub(h).id), updatedAt: this.now(), dupeCount: 1,
    };
    this.links.set(link.id, link);
    return link;
  }

  byUrl(url: string): ServerLink | undefined {
    const norm = normalizeUrl(url);
    return norm.ok ? [...this.links.values()].find((l) => l.url === norm.url) : undefined;
  }

  /** A link as the tests read it: hub names, sorted. */
  view(link: ServerLink | undefined) {
    if (!link) return undefined;
    return { url: link.url, title: link.title, status: link.status, hubs: this.hubNames(link).sort() };
  }

  touch(link: ServerLink): void {
    link.updatedAt = this.now();
  }

  /** Edits made on the server side, as in the web app. */
  edit(link: ServerLink, patch: { title?: string; status?: ServerLink['status']; hubs?: string[] }): void {
    if (patch.title !== undefined) link.title = patch.title;
    if (patch.status !== undefined) link.status = patch.status;
    if (patch.hubs !== undefined) link.hubs = patch.hubs.map((h) => this.hub(h).id);
    this.touch(link);
  }

  renameHub(hub: ServerHub, name: string): void {
    hub.name = name;
    this.touchHub(hub.id);
  }

  setHubStatus(hub: ServerHub, status: ServerHub['status']): void {
    hub.status = status;
    this.touchHub(hub.id);
  }

  remove(link: ServerLink): void {
    this.links.delete(link.id);
    this.deletions.push({ id: link.id, deletedAt: this.now() });
  }

  private touchHub(hubId: string): void {
    for (const link of this.links.values()) if (link.hubs.includes(hubId)) this.touch(link);
  }

  private hubNames(link: ServerLink): string[] {
    return link.hubs.map((id) => this.hubs.get(id)!).filter((h) => h.status !== 'archived').map((h) => h.name);
  }

  private item(link: ServerLink) {
    return {
      id: link.id, url: link.url, title: link.title, note: link.note, status: link.status,
      hubs: this.hubNames(link), updatedAt: link.updatedAt,
    };
  }

  readonly route = (req: FakeRequest): Reply => {
    if (this.offline) return new TypeError('Failed to fetch');
    if (this.failWith !== null) return { status: this.failWith, body: { error: `HTTP ${this.failWith}` } };
    if (req.headers.get('authorization') !== 'Bearer bkm_sync') return { status: 401, body: { error: 'Not authenticated' } };
    const url = new URL(req.url);
    const path = url.pathname;
    const body = req.body as Record<string, unknown>;

    if (req.method === 'GET' && path === '/api/links/changes') {
      const since = url.searchParams.get('since');
      const limit = this.pageSize ?? Number(url.searchParams.get('limit') ?? 500);
      const rows = [...this.links.values()]
        .filter((l) => since === null || l.updatedAt >= since)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));
      const page = rows.slice(0, limit);
      const deleted = since === null ? [] : this.deletions.filter((d) => d.deletedAt >= since);
      return {
        body: {
          items: page.map((l) => this.item(l)),
          deleted,
          cursor: page.at(-1)?.updatedAt ?? since,
          more: rows.length > limit,
        },
      };
    }
    if (req.method === 'POST' && path === '/api/links') {
      const norm = normalizeUrl(String(body.url));
      if (!norm.ok) return { status: 400, body: { error: `${norm.reason} url` } };
      let link = [...this.links.values()].find((l) => l.url === norm.url);
      const outcome = link ? 'updated' : 'created';
      if (link) {
        link.status = 'active';
        link.dupeCount += 1;
        if (typeof body.title === 'string') link.title = body.title;
      } else {
        link = {
          id: this.id('1'), url: norm.url, title: typeof body.title === 'string' ? body.title : '', note: '',
          status: 'active', hubs: [], updatedAt: '', dupeCount: 1,
        };
        this.links.set(link.id, link);
      }
      if (typeof body.hub === 'string') {
        const hub = this.hub(body.hub);
        if (!link.hubs.includes(hub.id)) link.hubs.push(hub.id);
      }
      this.touch(link);
      return { body: { outcome, link: { ...this.item(link), dupeCount: link.dupeCount } } };
    }
    const linkMatch = /^\/api\/links\/([^/]+)$/.exec(path);
    if (req.method === 'PATCH' && linkMatch) {
      const link = this.links.get(decodeURIComponent(linkMatch[1]!));
      if (!link) return { status: 404, body: { error: 'link not found' } };
      this.edit(link, body as { title?: string; status?: ServerLink['status']; hubs?: string[] });
      return { body: this.item(link) };
    }
    if (req.method === 'GET' && path === '/api/hubs') {
      return { body: { items: [...this.hubs.values()].map((h) => ({ ...h, linkCount: 0 })) } };
    }
    if (req.method === 'POST' && path === '/api/hubs') {
      if (this.hubByName(String(body.name))) return { status: 409, body: { error: 'hub name exists' } };
      return { body: this.hub(String(body.name)) };
    }
    const hubMatch = /^\/api\/hubs\/([^/]+)$/.exec(path);
    if (req.method === 'PATCH' && hubMatch) {
      const hub = this.hubs.get(decodeURIComponent(hubMatch[1]!));
      if (!hub) return { status: 404, body: { error: 'hub not found' } };
      if (typeof body.name === 'string') {
        if (this.hubByName(body.name) && this.hubByName(body.name) !== hub) return { status: 500, body: { error: 'duplicate key' } };
        this.renameHub(hub, body.name);
      }
      if (typeof body.status === 'string') this.setHubStatus(hub, body.status as ServerHub['status']);
      return { body: hub };
    }
    if (req.method === 'POST' && path === '/api/links/bulk' && body.action === 'unassign') {
      let affected = 0;
      for (const id of body.ids as string[]) {
        const link = this.links.get(id);
        if (!link?.hubs.includes(String(body.hubId))) continue;
        link.hubs = link.hubs.filter((h) => h !== body.hubId);
        this.touch(link);
        affected++;
      }
      return { body: { affected } };
    }
    return { status: 404, body: { error: `no route ${req.method} ${path}` } };
  };
}
