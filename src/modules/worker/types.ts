export enum TaskType {
  FfiCall = 'ffi-call',
  ParseSnapshot = 'parse-snapshot',
  Generic = 'generic',
}

export interface WorkerTask {
  id: string;
  type: TaskType | string;
  payload: unknown;
  priority?: number;
  timeoutMs?: number;
}

export type TaskMessage = WorkerTask;

export interface QueuedTask {
  message: TaskMessage;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  submittedAt: number;
}

export interface WorkerResultMessage {
  type: 'result';
  id: string;
  data: unknown;
}

export interface WorkerErrorMessage {
  type: 'error';
  id: string;
  error: string;
}

export interface LegacyWorkerSuccessMessage {
  id: string;
  success: true;
  data: unknown;
}

export interface LegacyWorkerFailureMessage {
  id: string;
  success: false;
  error: string;
}
