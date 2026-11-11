import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { writeSessionArchive } from './archive.js';

interface SafariGroup {
  id: number;
  name: string;
  profileId: number;
  profileName: string | null;
  position: number;
  storedChildren: number;
}

interface SafariTab {
  id: number;
  title: string | null;
  url: string | null;
  position: number;
}

interface ChildCounts {
  children: number;
  excluded: number;
  internal: number;
}

const REQUIRED_COLUMNS = ['id', 'parent', 'type', 'subtype', 'title', 'url', 'order_index', 'num_children', 'hidden', 'deleted'];

function readGroups(db: DatabaseSync) {
  const columns = new Set(db.prepare("SELECT name FROM pragma_table_info('bookmarks')").all().map(row => row.name));
  if (!REQUIRED_COLUMNS.every(column => columns.has(column))) {
    throw new Error('Unsupported Safari tab database. Use a copy of SafariTabs.db.');
  }

  // A named group sits at the root or under a visible Safari profile. Hidden
  // groups include browser-managed tab lists that do not appear in the sidebar.
  const groups = db.prepare(`
    SELECT g.id, g.title AS name, g.parent AS profileId, p.title AS profileName,
           g.order_index AS position, g.num_children AS storedChildren
    FROM bookmarks g
    LEFT JOIN bookmarks p ON p.id = g.parent AND p.parent = 0 AND p.type = 1 AND p.subtype = 2
      AND coalesce(p.hidden, 0) = 0 AND coalesce(p.deleted, 0) = 0
    WHERE (g.parent = 0 OR p.id IS NOT NULL) AND g.type = 1 AND g.subtype = 0
      AND coalesce(g.hidden, 0) = 0 AND coalesce(g.deleted, 0) = 0 AND trim(g.title) <> ''
    ORDER BY g.parent, g.order_index, g.id
  `).all() as unknown as SafariGroup[];

  const readTabs = db.prepare(`
    SELECT id, title, CASE WHEN trim(url) <> '' THEN url END AS url, order_index AS position
    FROM bookmarks
    WHERE parent = ? AND type = 0 AND subtype = 0 AND coalesce(hidden, 0) = 0 AND coalesce(deleted, 0) = 0
    ORDER BY order_index, id
  `);
  const countChildren = db.prepare(`
    SELECT count(*) AS children,
           count(CASE WHEN coalesce(hidden, 0) <> 0 OR coalesce(deleted, 0) <> 0 THEN 1 END) AS excluded,
           count(CASE WHEN type = 1 AND subtype = 1 AND coalesce(hidden, 0) = 0 AND coalesce(deleted, 0) = 0 THEN 1 END) AS internal
    FROM bookmarks WHERE parent = ?
  `);

  return groups.map(group => {
    const tabs = readTabs.all(group.id) as unknown as SafariTab[];
    const childCounts = countChildren.get(group.id) as unknown as ChildCounts;
    const unknown = childCounts.children - childCounts.excluded - childCounts.internal - tabs.length;
    const missingUrls = tabs.filter(tab => tab.url === null).length;
    return { group, tabs, counts: { ...childCounts, unknown, missingUrls } };
  });
}

export function captureSafari(dbPath: string, outPath: string) {
  const db = new DatabaseSync(resolve(dbPath), { readOnly: true });
  let groups;
  try {
    // Use one read transaction so the group list and its children agree even if
    // this copy has committed data in an accompanying WAL.
    db.exec('PRAGMA trusted_schema = OFF; PRAGMA query_only = ON; BEGIN');
    groups = readGroups(db);
  } finally {
    db.close();
  }

  // Equivalent copies of the same captured data get the same archive and tab IDs.
  const sourceId = createHash('sha256').update(JSON.stringify(groups)).digest('hex');
  const records: object[] = [{ type: 'archive', format: 'bukmark-sessions', version: 1, source: 'safari-tab-groups', sourceId }];
  const report = { groups: groups.length, tabs: 0, missingUrls: 0, partialGroups: 0 };
  for (const { group, tabs, counts } of groups) {
    const snapshotId = `safari:${sourceId}:${group.id}`;
    const partial = counts.unknown > 0 || counts.children !== group.storedChildren;
    records.push({
      type: 'snapshot', id: snapshotId, name: group.name,
      profile: { id: group.profileId, name: group.profileName },
      position: group.position, tabCount: tabs.length,
      storedChildren: group.storedChildren, counts, partial,
    });
    for (const tab of tabs) {
      records.push({
        type: 'tab', snapshotId, id: `${snapshotId}:${tab.id}`, title: tab.title, url: tab.url, position: tab.position,
      });
    }
    report.tabs += tabs.length;
    report.missingUrls += counts.missingUrls;
    report.partialGroups += Number(partial);
  }

  writeSessionArchive(outPath, records);
  return report;
}
