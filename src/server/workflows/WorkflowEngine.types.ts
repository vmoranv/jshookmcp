import type { WorkflowExecutionContext } from '@server/workflows/WorkflowContract';

type JsonRecord = Record<string, unknown>;

export interface WorkflowMetric {
  name: string;
  value: number;
  type: 'counter' | 'gauge' | 'histogram';
  attrs?: Record<string, unknown>;
  at: string;
}

export interface WorkflowSpan {
  name: string;
  attrs?: Record<string, unknown>;
  at: string;
}

export interface ExecuteWorkflowOptions {
  profile?: string;
  config?: JsonRecord;
  preflightMode?: 'warn' | 'strict' | 'skip';
  nodeInputOverrides?: Record<string, Record<string, unknown>>;
  timeoutMs?: number;
}

export interface PreflightWarning {
  nodeId: string;
  toolName: string;
  condition: string;
  fix: string;
}

export class PreflightError extends Error {
  constructor(readonly warnings: PreflightWarning[]) {
    super(`Workflow preflight failed with ${warnings.length} unsatisfied prerequisite(s)`);
    this.name = 'PreflightError';
  }
}

export interface ExecuteWorkflowResult {
  workflowId: string;
  displayName: string;
  runId: string;
  profile: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result: unknown;
  stepResults: Record<string, unknown>;
  metrics: WorkflowMetric[];
  spans: WorkflowSpan[];
}

export interface InternalExecutionContext<TDataBus = unknown> extends WorkflowExecutionContext {
  readonly stepResults: Map<string, unknown>;
  readonly dataBus: TDataBus;
}

export interface ParallelResult {
  [stepId: string]: unknown;
  __order: string[];
}

export type { JsonRecord };
