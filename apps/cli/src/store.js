import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export function emptyStore() {
    return { version: 1, links: {}, ingestedFiles: {} };
}
function writeJsonAtomic(file, value) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
    renameSync(tmp, file);
}
export function loadStore(file) {
    if (!existsSync(file))
        return emptyStore();
    return JSON.parse(readFileSync(file, 'utf8'));
}
export function saveStore(file, store) {
    writeJsonAtomic(file, store);
}
export function loadCanon(file) {
    if (!existsSync(file))
        return { categories: [] };
    return JSON.parse(readFileSync(file, 'utf8'));
}
export function saveCanon(file, canon) {
    writeJsonAtomic(file, canon);
}
export function mergeCapture(store, cap, source, now) {
    const existing = store.links[cap.urlHash];
    if (!existing) {
        const rec = {
            url: cap.url,
            title: cap.title,
            sources: [source],
            dupeCount: 1,
            groupHints: cap.groupHint ? [cap.groupHint] : [],
            firstSeen: now,
            lastSeen: now,
        };
        store.links[cap.urlHash] = rec;
        return { added: true };
    }
    existing.dupeCount += 1;
    existing.lastSeen = now;
    if (!existing.sources.includes(source))
        existing.sources.push(source);
    if (cap.groupHint && !existing.groupHints.includes(cap.groupHint)) {
        existing.groupHints.push(cap.groupHint);
    }
    if (existing.title === '' && cap.title !== '')
        existing.title = cap.title;
    return { added: false };
}
