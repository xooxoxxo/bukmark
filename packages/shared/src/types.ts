export type Source =
  | 'onetab_import'
  | 'chrome_import'
  | 'safari_import'
  | 'extension_capture'
  | 'manual';

export interface RawCapture {
  url: string;
  title: string;
  groupHint?: string;
  capturedAt?: string;
}

export interface Triage {
  category: string;
  keep: boolean;
  relevance: 1 | 2 | 3 | 4 | 5;
  explanation: string;
  reason?: string;
  triagedAt: string;
}

export interface LinkRecord {
  url: string;
  title: string;
  sources: Source[];
  dupeCount: number;
  groupHints: string[];
  firstSeen: string;
  lastSeen: string;
  junk?: { rule: string };
  triage?: Triage;
}

export interface IngestedFile {
  filename: string;
  ingestedAt: string;
  captureCount: number;
}

export interface Store {
  version: 1;
  links: Record<string, LinkRecord>;
  ingestedFiles: Record<string, IngestedFile>;
}

export interface Canon {
  categories: string[];
}

export interface Paths {
  dataDir: string;
  workDir: string;
  outputDir: string;
}

export const defaultPaths: Paths = {
  dataDir: 'data',
  workDir: 'work',
  outputDir: 'output',
};
