/**
 * TraceRecorder type definitions for event capture lifecycle management.
 */

export interface CDPSessionLike {
  on(event: string, handler: (params: unknown) => void): void;
  off(event: string, handler: (params: unknown) => void): void;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export interface TraceNetworkCaptureOptions {
  /** Persist response bodies on Network.loadingFinished. Default: true */
  recordResponseBodies?: boolean;
  /** Attempt chunk-level response streaming with Network.streamResourceContent. Default: true */
  streamResponseChunks?: boolean;
  /** Maximum number of response body bytes to persist. Larger bodies are marked truncated. */
  maxBodyBytes?: number;
  /** Bodies at or below this size are stored inline in SQLite; larger ones go to artifacts. */
  inlineBodyBytes?: number;
}

/** Options for starting a trace recording session. */
export interface TraceRecorderOptions {
  /** CDP domains to listen on. Default: ['Debugger', 'Runtime', 'Network', 'Page'] */
  cdpDomains?: string[];
  /** EventBus event categories to record. Default: all */
  eventCategories?: string[];
  /** Whether to record memory deltas. Default: true */
  recordMemoryDeltas?: boolean;
  /** Network flow/body capture settings. */
  network?: TraceNetworkCaptureOptions;
}

/** Current state of the trace recorder. */
export type RecordingState = 'idle' | 'recording' | 'stopped';

/** Summary of a recording session. */
export interface RecordingSession {
  /** Unique session identifier */
  sessionId: string;
  /** Path to the SQLite database file */
  dbPath: string;
  /** Timestamp when recording started */
  startedAt: number;
  /** Timestamp when recording stopped (undefined while recording) */
  stoppedAt?: number;
  /** Number of events recorded */
  eventCount: number;
  /** Number of memory deltas recorded */
  memoryDeltaCount: number;
  /** Number of heap snapshots captured */
  heapSnapshotCount: number;
  /** Number of network requests observed during the session */
  networkRequestCount?: number;
  /** Number of network chunks recorded during the session */
  networkChunkCount?: number;
  /** Number of response bodies persisted during the session */
  networkBodyCount?: number;
  /** Cleanup errors encountered while stopping the recording */
  cleanupErrors?: string[];
}
