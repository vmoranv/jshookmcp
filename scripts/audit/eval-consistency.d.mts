export interface ConsistencyInput {
  scorecard?: { generatedAt?: string; results?: unknown[] } | null;
  perToolJson?: {
    generatedAt?: string;
    measured?: boolean;
    stats?: Record<string, number>;
    tools?: unknown[];
  } | null;
  perToolMd?: string | null;
  coverageMtimeMs?: number | null;
}
export interface CiOrderInput {
  coverageMtimeMs?: number | null;
  e2eGeneratedAt?: number | null;
  retrievalGeneratedAt?: number | null;
}
export interface GuardResult {
  ok: boolean;
  violations: string[];
}
export function checkConsistency(input: ConsistencyInput): GuardResult;
export function checkCiOrder(input: CiOrderInput): GuardResult;
