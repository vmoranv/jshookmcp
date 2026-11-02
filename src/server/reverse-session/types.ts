export interface ReverseSessionTarget {
  platform: 'android' | 'native' | 'web' | 'unknown';
  packageName?: string;
  apkPath?: string;
  pid?: number;
}

export interface ReverseSessionStep {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  status: 'planned' | 'ready' | 'blocked' | 'running' | 'completed' | 'failed';
  reason?: string;
  attempts?: number;
  lastRunAt?: string;
  completedAt?: string;
  resultRef?: string;
  error?: string;
}

export interface ReverseSessionExecutedStep {
  stepId: string;
  tool: string;
  success: boolean;
  durationMs: number;
  evidenceRef?: string;
  error?: string;
  result?: unknown;
}

export interface ReverseSessionRunRecord {
  runId: string;
  startedAt: string;
  finishedAt: string;
  status: 'completed' | 'partial' | 'blocked' | 'failed';
  executedSteps: ReverseSessionExecutedStep[];
  blockedSteps: ReverseSessionStep[];
  evidenceRefs: string[];
  reason?: string;
}

export interface ReverseSessionRecord {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  status: 'planned' | 'active' | 'completed' | 'failed';
  artifactRoot: string;
  target: ReverseSessionTarget;
  steps: ReverseSessionStep[];
  evidenceRefs: string[];
  runs: ReverseSessionRunRecord[];
  nextSteps: string[];
}
