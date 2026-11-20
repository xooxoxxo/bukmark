export type SiftDisposition = 'reference' | 'active_work' | 'shortcut' | 'archive_candidate' | 'needs_review' | 'archived';
export type SiftHandoff = 'builder' | 'recipe' | 'knowledge' | 'azuk' | 'none';

export type SiftBin = 'Technical reference' | 'Repo code and examples' | 'Discussions and answers'
  | 'Price-watch review' | 'Buying research' | 'Check source' | 'Needs review';
export interface SiftBinSuggestion {
  name: SiftBin;
  ruleId: string;
  ruleVersion: number;
  reason: string;
  fields: ('url' | 'title' | 'pageText')[];
}

export interface SiftComputed {
  disposition: SiftDisposition;
  handoff: SiftHandoff;
  reason: string;
  /** Absent on historical results computed before seven-bin rules. Never an owner decision. */
  bin?: SiftBinSuggestion;
}

export interface SiftBaselineInput {
  reference: string;
  approvedAt: string;
  bins: { id: string; name: string; count: number; createdAt: string }[];
  items: { linkId: string; hubId: string; membershipCreatedAt: string }[];
}

export type SiftScope = { kind: 'baseline'; id: string } | { kind: 'run'; id: string }
  | { kind: 'links'; linkIds: string[] } | { kind: 'next'; limit: number };

export interface SiftBaselineSummary {
  id: string;
  reference: string;
  approvedAt: string;
  count: number;
}

export interface SiftRunSummary {
  id: string;
  createdAt: string;
  scopeCount: number;
  visibleCount: number;
  localOnlyCount: number;
  unavailableCount: number;
  digest: string;
  rulesVersion: string;
  previousRunId: string | null;
}

export interface SiftPreviewItem {
  link: { id: string; url: string; title: string; status: 'active' | 'archived' };
  resultId: string;
  computed: SiftComputed;
  decision: { id: string; hubId: string; bin: string; revision: number; reference: string; approvedAt: string } | null;
  holds: string[];
  sourceChanged: boolean;
  review: { status: string; origin: string; revision: number } | null;
  exports: { id: string; route: 'builder' | 'recipe' | 'knowledge'; contextKey?: string; commit?: string }[];
}

export const BOOKMARK_REVIEW_LIMIT = 12;

export function canDownloadReviewedBookmark(item: SiftPreviewItem): boolean {
  return item.link.status === 'active' && item.holds.length === 0
    && !!item.computed.bin && item.computed.bin.name !== 'Check source';
}

export interface SiftPreview extends SiftRunSummary {
  items: SiftPreviewItem[];
  more: boolean;
  counts: {
    bins: Record<string, number>;
    suggestedBins?: Record<string, number>;
    dispositions: Record<string, number>;
    handoffs: Record<string, number>;
    ownerChoices: number;
    held: number;
    exportedSources: number;
    commitPins: number;
  };
  comparison: { added: number; removed: number; changedAnalysis: number; unchangedAnalysis: number; changedGuards: number } | null;
  usage: { pageReads: 0; modelRequests: 0; reportedInputTokens: 0; newProviderCostUsd: 0 };
  proposedChanges: 0;
  applicationPreviews?: { id: string; createdAt: string; selectedCount: number; applicationId: string | null }[];
}

export interface SiftRunReceipt {
  id: string;
  reusedRun: boolean;
  reusedResults: number;
  createdResults: number;
}

export type SiftSelection = { kind: 'run' } | { kind: 'links'; linkIds: string[] };
export interface SiftApplicationInput {
  digest: string;
  selection: SiftSelection;
  hubId: string | null;
}
export interface SiftApplicationItem {
  link: SiftPreviewItem['link'];
  resultId: string;
  expectedDecisionRevision: number | null;
  state: 'ready' | 'applied' | 'unchanged' | 'held';
  reasons: string[];
}
export interface SiftApplicationView {
  id: string;
  previewId: string;
  runId: string;
  digest: string;
  createdAt: string;
  kind: 'preview' | 'receipt';
  target: { id: string; name: string } | null;
  selectedCount: number;
  localOnlyCount: number;
  unavailableCount: number;
  counts: { ready: number; applied: number; unchanged: number; held: number };
  items: SiftApplicationItem[];
  more: boolean;
  applyEnabled: boolean;
  applicationId: string | null;
}
