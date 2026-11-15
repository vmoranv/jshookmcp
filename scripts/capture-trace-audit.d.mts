export type SourceKind = 'live' | 'fixture' | 'unknown';
export interface AuditSession {
  sessionId?: string;
  calls?: number;
  toolNames?: string[];
  domains?: string[];
}
export interface AuditPayload {
  combined?: Record<string, unknown>;
  sessions?: AuditSession[];
  findings?: unknown[];
  thresholds?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface TraceArtifact extends AuditPayload {
  generatedAt: string;
  sourceDir: string;
  sourceKind: SourceKind;
  combined: Record<string, unknown>;
}
export function classifySource(audit: AuditPayload): SourceKind;
export function buildTraceArtifact(audit: unknown, sourceDir: string): TraceArtifact;
