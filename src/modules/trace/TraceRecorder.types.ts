/**
 * TraceRecorder type definitions for event capture lifecycle management.
 */

/** Options for starting a trace recording session. */
export interface TraceRecorderOptions {
  /** CDP domains to listen on. Default: ['Debugger', 'Runtime', 'Network', 'Page'] */
  cdpDomains?: string[];
  /** EventBus event categories to record. Default: all */
  eventCategories?: string[];
  /** Whether to record memory deltas. Default: true */
  recordMemoryDeltas?: boolean;
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
}
