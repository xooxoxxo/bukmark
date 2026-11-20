import { readFile } from 'node:fs/promises';
import { sha256Hex } from '@bukmark/shared';
import type { SiftComputed } from '@bukmark/shared';
import { canonicalJson } from '../canonicalJson.js';
import { siftBookmark, type SiftBookmark } from './model.js';
import { BIN_RULES, BIN_RULES_VERSION, suggestBin } from './bins.js';
import type { BinRuleDefinition } from './bins.js';

export const SIFT_SCOPE_LIMIT = 1000;
export const SIFT_PAGE_SIZE = 25;
export const siftDigest = (value: unknown) => sha256Hex(canonicalJson(value));

export interface SiftRules {
  version: string;
  digest: string;
  artifacts: { path: string; source: string }[];
  binRules?: readonly BinRuleDefinition[];
}

let rules: Promise<SiftRules> | undefined;
export function localSiftRules(): Promise<SiftRules> {
  return rules ??= (async () => {
    const paths = ['./bins.ts', './evidence.ts', './discussion.ts', './technical.ts', './model.ts', '../builder/model.ts', '../review/model.ts'];
    const artifacts = await Promise.all(paths.map(async (path) => ({
      path, source: await readFile(new URL(path, import.meta.url), 'utf8'),
    })));
    return { version: BIN_RULES_VERSION, digest: siftDigest(artifacts), artifacts, binRules: BIN_RULES };
  })();
}

export function localSiftResult(input: SiftBookmark): SiftComputed {
  return { ...siftBookmark(input), bin: suggestBin(input) };
}

export interface SiftGuard {
  sourceVersion: string;
  analysisInputDigest?: string;
  protected: boolean;
  decisionId: string | null;
  decisionRevision: number | null;
  memberships: { hubId: string; createdAt: string }[];
  review: { id: string; status: string; origin: string; revision: number } | null;
  exports: { id: string; route: 'builder' | 'recipe' | 'knowledge'; contextKey?: string; commit?: string }[];
  deliveries: { id: string; status: string }[];
}

export class SiftConflict extends Error {
  constructor(readonly code: 'baseline_changed' | 'decision_conflict' | 'scope_changed' | 'missing' | 'preview_changed' | 'library_busy') {
    super(code);
  }
}
