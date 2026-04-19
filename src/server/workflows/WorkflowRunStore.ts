import type { ExecuteWorkflowResult } from '@server/workflows/WorkflowEngine';
import { logger } from '@utils/logger';

export interface WorkflowRunEntry {
  workflowId: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'success' | 'error';
  stepResultKeys: string[];
}

export class WorkflowRunStore {
  private readonly runs = new Map<string, WorkflowRunEntry>();
  private readonly lastSuccess = new Map<string, ExecuteWorkflowResult>();

  recordSuccess(result: ExecuteWorkflowResult): void {
    const entry: WorkflowRunEntry = {
      workflowId: result.workflowId,
      runId: result.runId,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      status: 'success',
      stepResultKeys: Object.keys(result.stepResults),
    };
    this.runs.set(result.runId, entry);
    this.lastSuccess.set(result.workflowId, result);
    logger.debug(`workflow run recorded: ${result.runId} (${result.workflowId})`);
  }

  recordError(workflowId: string, runId: string, startedAt: string, error: unknown): void {
    const entry: WorkflowRunEntry = {
      workflowId,
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - new Date(startedAt).getTime(),
      status: 'error',
      stepResultKeys: [],
    };
    this.runs.set(runId, entry);
    logger.debug(`workflow run error: ${runId} (${workflowId}): ${error}`);
  }

  getRun(runId: string): WorkflowRunEntry | undefined {
    return this.runs.get(runId);
  }

  getLastSuccess(workflowId: string): ExecuteWorkflowResult | undefined {
    return this.lastSuccess.get(workflowId);
  }

  listRuns(workflowId?: string): WorkflowRunEntry[] {
    const entries = [...this.runs.values()];
    if (workflowId) {
      return entries.filter((e) => e.workflowId === workflowId);
    }
    return entries;
  }

  clear(): void {
    this.runs.clear();
    this.lastSuccess.clear();
  }
}
