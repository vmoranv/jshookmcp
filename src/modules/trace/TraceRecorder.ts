/**
 * TraceRecorder — Event capture engine for time-travel debugging.
 *
 * Subscribes to EventBus events and CDP session events, capturing them
 * into a TraceDB instance. Handles recording lifecycle (start/stop),
 * selective CDP domain filtering, and differential memory tracing.
 */

import { randomUUID } from 'node:crypto';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import type { MemoryDelta } from '@modules/trace/TraceDB.types';
import type { RecordingSession, RecordingState, TraceRecorderOptions } from '@modules/trace/TraceRecorder.types';
import { TraceDB } from '@modules/trace/TraceDB';
import { resolveArtifactPath } from '@utils/artifacts';

/** CDP event handler function type. */
type CDPEventHandler = (params: unknown) => void;

/**
 * Known CDP events to subscribe to per domain.
 * CDP sessions don't support wildcards, so we explicitly list relevant events.
 */
const CDP_EVENTS_BY_DOMAIN: Record<string, string[]> = {
  Debugger: ['Debugger.paused', 'Debugger.resumed', 'Debugger.scriptParsed'],
  Runtime: ['Runtime.consoleAPICalled', 'Runtime.exceptionThrown'],
  Network: [
    'Network.requestWillBeSent',
    'Network.responseReceived',
    'Network.loadingFinished',
  ],
  Page: ['Page.navigatedWithinDocument', 'Page.loadEventFired'],
};

const DEFAULT_CDP_DOMAINS = ['Debugger', 'Runtime', 'Network', 'Page'];

/**
 * CDPSession-like interface — minimal surface needed for recording.
 * Avoids importing Puppeteer types which may not be available.
 */
export interface CDPSessionLike {
  on(event: string, handler: CDPEventHandler): void;
  off(event: string, handler: CDPEventHandler): void;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export class TraceRecorder {
  private db: TraceDB | null = null;
  private state: RecordingState = 'idle';
  private session: RecordingSession | null = null;
  private eventBusUnsub: (() => void) | null = null;
  private cdpListeners = new Map<string, CDPEventHandler>();
  private cdpSession: CDPSessionLike | null = null;
  private eventCount = 0;
  private memoryDeltaCount = 0;
  private heapSnapshotCount = 0;

  /**
   * Start recording events into a new trace database.
   *
   * @param eventBus The server EventBus to subscribe to
   * @param cdpSession Optional CDP session for browser event recording
   * @param options Recording configuration
   * @returns The recording session details
   */
  async start(
    eventBus: EventBus<ServerEventMap>,
    cdpSession: CDPSessionLike | null,
    options?: TraceRecorderOptions
  ): Promise<RecordingSession> {
    if (this.state === 'recording') {
      throw new Error('Recording already in progress');
    }

    const sessionId = randomUUID();
    const { absolutePath } = await resolveArtifactPath({
      category: 'traces',
      toolName: 'trace_recorder',
      target: sessionId.slice(0, 8),
      ext: 'db',
    });

    // Initialize storage
    this.db = new TraceDB({ dbPath: absolutePath });
    this.eventCount = 0;
    this.memoryDeltaCount = 0;
    this.heapSnapshotCount = 0;

    // Set session metadata
    const startedAt = Date.now();
    this.db.setMetadata('sessionId', sessionId);
    this.db.setMetadata('platform', process.platform);
    this.db.setMetadata('startedAt', String(startedAt));
    this.db.setMetadata('nodeVersion', process.version);

    // Subscribe to EventBus (wildcard — captures all events)
    this.eventBusUnsub = eventBus.onAny((wrapped: { event: string; payload: unknown }) => {
      if (this.state !== 'recording' || !this.db) return;
      try {
        this.db.insertEvent({
          timestamp: Date.now(),
          category: this.mapEventCategory(String(wrapped.event)),
          eventType: String(wrapped.event),
          data: JSON.stringify(wrapped.payload ?? {}),
          scriptId: null,
          lineNumber: null,
        });
        this.eventCount++;
      } catch {
        // Swallow recording errors to avoid disrupting the host
      }
    });

    // Subscribe to CDP session events if available
    this.cdpSession = cdpSession;
    if (cdpSession) {
      const domains = options?.cdpDomains ?? DEFAULT_CDP_DOMAINS;
      for (const domain of domains) {
        const events = CDP_EVENTS_BY_DOMAIN[domain];
        if (!events) continue;

        for (const eventName of events) {
          const handler: CDPEventHandler = (params) => {
            if (this.state !== 'recording' || !this.db) return;
            try {
              // Extract scriptId and lineNumber from Debugger events when available
              let scriptId: string | null = null;
              let lineNumber: number | null = null;
              if (typeof params === 'object' && params !== null) {
                const p = params as Record<string, unknown>;
                if ('scriptId' in p) scriptId = String(p['scriptId']);
                if ('lineNumber' in p) lineNumber = Number(p['lineNumber']) || null;
                // For Debugger.paused, extract from callFrames[0]
                if (eventName === 'Debugger.paused' && Array.isArray(p['callFrames'])) {
                  const frame = (p['callFrames'] as Array<Record<string, unknown>>)[0];
                  if (frame) {
                    const loc = frame['location'] as Record<string, unknown> | undefined;
                    if (loc) {
                      scriptId = String(loc['scriptId'] ?? scriptId);
                      lineNumber = Number(loc['lineNumber'] ?? lineNumber) || null;
                    }
                  }
                }
              }

              this.db!.insertEvent({
                timestamp: Date.now(),
                category: domain.toLowerCase(),
                eventType: eventName,
                data: JSON.stringify(params ?? {}),
                scriptId,
                lineNumber,
              });
              this.eventCount++;
            } catch {
              // Swallow recording errors
            }
          };

          cdpSession.on(eventName, handler);
          this.cdpListeners.set(eventName, handler);
        }
      }
    }

    // Build session object
    this.session = {
      sessionId,
      dbPath: absolutePath,
      startedAt,
      eventCount: 0,
      memoryDeltaCount: 0,
      heapSnapshotCount: 0,
    };

    this.state = 'recording';
    return { ...this.session };
  }

  /**
   * Record a memory write delta.
   * Silently ignored if not currently recording.
   */
  recordMemoryDelta(delta: MemoryDelta): void {
    if (this.state !== 'recording' || !this.db) return;
    try {
      this.db.insertMemoryDelta(delta);
      this.memoryDeltaCount++;
    } catch {
      // Swallow recording errors
    }
  }

  /**
   * Capture a heap snapshot via CDP HeapProfiler.
   * Requires an active CDP session and recording in progress.
   */
  async captureHeapSnapshot(cdpSession: CDPSessionLike): Promise<void> {
    if (this.state !== 'recording' || !this.db) {
      throw new Error('Cannot capture heap snapshot: not recording');
    }

    const chunks: string[] = [];
    const chunkHandler = (params: unknown) => {
      if (typeof params === 'object' && params !== null) {
        const chunk = (params as Record<string, unknown>)['chunk'];
        if (typeof chunk === 'string') chunks.push(chunk);
      }
    };

    try {
      await cdpSession.send('HeapProfiler.enable');
      cdpSession.on('HeapProfiler.addHeapSnapshotChunk', chunkHandler);

      await cdpSession.send('HeapProfiler.takeHeapSnapshot', {
        reportProgress: false,
      });

      cdpSession.off('HeapProfiler.addHeapSnapshotChunk', chunkHandler);

      const snapshotStr = chunks.join('');
      const snapshotBuffer = Buffer.from(snapshotStr, 'utf-8');

      // Parse snapshot to extract summary
      const summary = this.extractHeapSummary(snapshotStr);

      this.db.insertHeapSnapshot({
        timestamp: Date.now(),
        snapshotData: snapshotBuffer,
        summary: JSON.stringify(summary),
      });
      this.heapSnapshotCount++;
    } finally {
      await cdpSession.send('HeapProfiler.disable').catch(() => {});
    }
  }

  /**
   * Stop recording and finalize the trace database.
   * @returns Final session summary with event counts
   */
  stop(): RecordingSession {
    if (this.state !== 'recording') {
      throw new Error('Cannot stop: not currently recording');
    }

    // Unsubscribe from EventBus
    if (this.eventBusUnsub) {
      this.eventBusUnsub();
      this.eventBusUnsub = null;
    }

    // Remove CDP listeners
    if (this.cdpSession) {
      for (const [event, handler] of this.cdpListeners) {
        this.cdpSession.off(event, handler);
      }
      this.cdpListeners.clear();
      this.cdpSession = null;
    }

    // Set end metadata and close DB
    if (this.db) {
      const stoppedAt = Date.now();
      this.db.setMetadata('stoppedAt', String(stoppedAt));
      this.db.setMetadata('eventCount', String(this.eventCount));
      this.db.setMetadata('memoryDeltaCount', String(this.memoryDeltaCount));
      this.db.setMetadata('heapSnapshotCount', String(this.heapSnapshotCount));
      this.db.close();

      // Update session
      if (this.session) {
        this.session.stoppedAt = stoppedAt;
        this.session.eventCount = this.eventCount;
        this.session.memoryDeltaCount = this.memoryDeltaCount;
        this.session.heapSnapshotCount = this.heapSnapshotCount;
      }
    }

    this.state = 'stopped';
    const finalSession = this.session ? { ...this.session } : this.createEmptySession();
    this.db = null;
    return finalSession;
  }

  /** Get the current recording state. */
  getState(): RecordingState {
    return this.state;
  }

  /** Get the current session details (null if not recording). */
  getSession(): RecordingSession | null {
    return this.session ? { ...this.session } : null;
  }

  /** Get the active TraceDB instance (null if not recording). */
  getDB(): TraceDB | null {
    return this.db;
  }

  // ── Private helpers ──

  /**
   * Map an EventBus event name to a trace category.
   * E.g., 'tool:called' → 'tool', 'debugger:breakpoint_hit' → 'debugger'
   */
  private mapEventCategory(event: string): string {
    const colonIdx = event.indexOf(':');
    return colonIdx > 0 ? event.substring(0, colonIdx) : 'other';
  }

  /**
   * Extract a lightweight summary from a V8 heap snapshot.
   * Only parses the minimal structure needed for diffing.
   */
  private extractHeapSummary(snapshotStr: string): Record<string, unknown> {
    try {
      const snapshot = JSON.parse(snapshotStr) as Record<string, unknown>;
      const snapshotInfo = snapshot['snapshot'] as Record<string, unknown> | undefined;

      if (!snapshotInfo) {
        return { totalSize: 0, nodeCount: 0, objectCounts: {} };
      }

      const meta = snapshotInfo['meta'] as Record<string, unknown> | undefined;
      const nodeCount = (snapshotInfo['node_count'] as number) ?? 0;

      // Extract node types and counts from the snapshot structure
      const nodeFields = meta?.['node_fields'] as string[] | undefined;
      const nodeTypes = meta?.['node_types'] as unknown[][] | undefined;
      const nodes = snapshot['nodes'] as number[] | undefined;

      const objectCounts: Record<string, number> = {};
      let totalSize = 0;

      if (nodeFields && nodes && nodeTypes) {
        const fieldCount = nodeFields.length;
        const typeIndex = nodeFields.indexOf('type');
        const nameIndex = nodeFields.indexOf('name');
        const selfSizeIndex = nodeFields.indexOf('self_size');
        const strings = (snapshot['strings'] as string[]) ?? [];

        for (let i = 0; i < nodes.length; i += fieldCount) {
          const selfSize = selfSizeIndex >= 0 ? (nodes[i + selfSizeIndex] ?? 0) : 0;
          totalSize += selfSize;

          if (nameIndex >= 0) {
            const nameIdx = nodes[i + nameIndex] ?? 0;
            const name = strings[nameIdx] ?? `type_${nodes[i + (typeIndex >= 0 ? typeIndex : 0)]}`;
            if (name) {
              objectCounts[name] = (objectCounts[name] ?? 0) + 1;
            }
          }
        }
      }

      return { totalSize, nodeCount, objectCounts };
    } catch {
      return { totalSize: 0, nodeCount: 0, objectCounts: {} };
    }
  }

  private createEmptySession(): RecordingSession {
    return {
      sessionId: '',
      dbPath: '',
      startedAt: 0,
      eventCount: 0,
      memoryDeltaCount: 0,
      heapSnapshotCount: 0,
    };
  }
}
