export interface KnowledgeFields {
  title: string;
  bodyMarkdown: string;
  whyItMatters?: string;
  tags: string[];
  includeExcerpt: boolean;
}

export interface KnowledgeCitation {
  url: string;
  title: string;
  publisher?: string;
  attribution?: string;
  versionUrl?: string;
  locator?: string;
  observedOn: string;
  licenseUrl?: string;
}

export interface KnowledgeEvidence {
  kind: 'page' | 'quote';
  citation: KnowledgeCitation;
  excerpt: string;
}

export interface KnowledgeDraft {
  id: string;
  linkId: string | null;
  savedUrl: string;
  revision: number;
  fields: KnowledgeFields;
  evidence: KnowledgeEvidence | null;
  sourceChanged: boolean;
  latestExportId: string | null;
}

export type KnowledgeEvidenceAction =
  | { mode: 'read' }
  | { mode: 'keep' }
  | { mode: 'page'; excerpt: string; locator?: string; versionUrl?: string }
  | { mode: 'quote'; quoteId: string; excerpt: string; locator?: string };

export interface KnowledgeReading {
  url: string;
  title: string;
  text: string;
  versionUrl?: string;
}

export interface KnowledgeExport {
  schemaVersion: 1;
  notes: {
    key: string;
    revision: number;
    title: string;
    bodyMarkdown: string;
    whyItMatters?: string;
    tags: string[];
    sources: (KnowledgeCitation & { excerpt?: string })[];
  }[];
}
