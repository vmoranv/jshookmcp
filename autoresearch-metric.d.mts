/** Type declaration for the root-level ES module metric extractor. */
export interface DebtArtifacts {
  perTool: {
    stats: {
      total?: number;
      withVectors?: number;
      semanticCovered?: number;
      contractOnly?: number;
    };
    tools?: Array<{ correctness?: string; throughput?: string }>;
  };
  suites: { results?: Array<{ failed?: number; errored?: number }> };
  retrPerTool: Record<string, { mrr?: number } | undefined>;
  retrAgg: { pAt1?: number; mrrAt10?: number };
  rejection: { rejectionAccuracy?: number };
}

export interface DebtMetrics {
  debt: number;
  unmeasured: number;
  low_mrr: number;
  vector_fail: number;
  vectors_total: number;
  semantic_covered: number;
  contract_only: number;
  per_tool_shortfall: number;
  slowest_ms: number;
  p1_pct: number;
  mrr10_pct: number;
  rejection_pct: number;
}

export function computeDebt(art: DebtArtifacts): DebtMetrics;
