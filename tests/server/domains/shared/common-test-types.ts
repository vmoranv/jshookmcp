/**
 * Shared test types for domain tool responses.
 */
export * from '@tests/shared/common-test-types';

export interface BaseResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  [key: string]: any;
}

export interface ErrorResponse {
  error: string;
  code?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  details?: any;
}

// Coordination Domain Responses
export interface CreateTaskHandoffResponse extends BaseResponse {
  taskId: string;
  status: 'pending';
  description: string;
  constraints?: string[];
  targetDomain?: string;
  pageUrl?: string;
  totalActiveHandoffs: number;
}

export interface CompleteTaskHandoffResponse extends BaseResponse {
  status: 'completed';
  summary: string;
  keyFindings?: string[];
  artifacts?: string[];
  durationMs: number;
}

export interface TaskHandoffRecord {
  taskId: string;
  description: string;
  status: 'pending' | 'completed';
  constraints?: string[];
  targetDomain?: string;
  pageUrl?: string;
  summary?: string;
  keyFindings?: string[];
  artifacts?: string[];
  createdAt: string;
  completedAt?: string;
}

export interface SessionInsight {
  insightId: string;
  category: string;
  content: string;
  confidence: number;
  timestamp: string;
}

export interface GetTaskContextResponse extends BaseResponse {
  handoff?: TaskHandoffRecord;
  active?: TaskHandoffRecord[];
  completed?: TaskHandoffRecord[];
  sessionInsights?: SessionInsight[];
  summary?: {
    totalActive: number;
    totalCompleted: number;
    totalInsights: number;
  };
}

export interface AppendSessionInsightResponse extends BaseResponse {
  insightId: string;
  category: string;
  totalInsights: number;
  totalByCategory: Record<string, number>;
}

// Process Domain Responses
export interface ProcessInfo {
  pid: number;
  name: string;
  path?: string;
  commandLine?: string;
}

export interface ProcessFindResponse extends BaseResponse {
  processes: ProcessInfo[];
  count: number;
  pattern: string;
}

export interface ProcessGetResponse extends BaseResponse {
  process: ProcessInfo & {
    parentPid?: number;
    threads?: number;
    workingSetSize?: number;
  };
}

export interface MemoryReadResponse extends BaseResponse {
  address: string;
  size: number;
  data: string; // hex or base64
  encoding: 'hex' | 'base64';
}

export interface MemoryScanResponse extends BaseResponse {
  matches: string[];
  count: number;
  scanDurationMs: number;
}

export interface MemoryAuditLog {
  timestamp: string;
  type: string;
  address: string;
  size?: number;
  success: boolean;
}

export interface MemoryAuditExportResponse extends BaseResponse {
  auditLog: MemoryAuditLog[];
  totalEntries: number;
  exportedAt: string;
}

// Hooks Domain Responses
export interface HookDefinition {
  id: string;
  name: string;
  description?: string;
  type: string;
}

export interface ListHooksResponse extends BaseResponse {
  hooks: HookDefinition[];
  count: number;
}

export interface AIHookResponse extends BaseResponse {
  suggestion: string;
  confidence: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  context?: any;
}
