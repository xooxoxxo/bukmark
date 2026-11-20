import type { SiftApplicationItem } from '@bukmark/shared';

/** IDs and guards stay on the instance; public views recheck current protection. */
export interface SiftApplicationEntry {
  linkId: string;
  resultId: string;
  expectedGuardDigest: string;
  expectedDecisionRevision: number | null;
  state: SiftApplicationItem['state'];
  reasons: string[];
}

export interface SiftTarget {
  id: string;
  name: string;
  version: string;
}
