export interface CrossViewL2 {
  generatedAt?: string;
  stats?: Record<string, number>;
  tools?: Array<{
    tool: string;
    domain: string;
    semantic?: string;
    contract?: string;
    holdoutMrr?: string;
  }>;
}
export interface CrossViewL0 {
  repeatedToolCallRate?: number;
  orphanFailureCount?: number;
  p99CallDurationMs?: number;
  toolDiversity?: number;
}
export interface CrossViewMeta {
  sourceKind?: 'live' | 'fixture' | 'unknown';
  sourceDir?: string;
}
export interface CrossViewResult {
  md: string;
  json: {
    generatedAt: string;
    traceAvailable: boolean;
    sourceKind: string | null;
    sourceDir: string | null;
    l0: Record<string, unknown> | null;
    l2Stats: Record<string, number>;
    signals: string[];
    debtDelta: number;
  };
}
export function renderCrossView(
  l2: CrossViewL2,
  l0Combined: CrossViewL0 | null,
  meta?: CrossViewMeta,
): CrossViewResult;
