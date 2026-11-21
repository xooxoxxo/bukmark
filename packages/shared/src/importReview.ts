export interface ImportGroup { id: string; name: string; count: number; reviewed: number; skipped: number; lastImported: string }
export type ImportChoice = 'accept' | 'keep' | 'answer' | 'archive' | 'skip';
export interface ImportSuggestion { folder: string | null; reason: string; question?: string }
export interface ImportReviewItem {
  id: string; title: string; host: string; address: string; protected: boolean;
  suggestion: ImportSuggestion; state: 'clear' | 'question' | 'skipped' | 'saved';
  revision: number; version: string; outcome: string | null;
}
export interface ImportView { name: string; items: ImportReviewItem[] }
export interface ImportDecision {
  id: string; revision: number; version: string; choice: ImportChoice; answer?: string;
}
