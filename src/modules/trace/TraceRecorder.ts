/**
 * TraceRecorder — Event capture engine for time-travel debugging.
 *
 * Subscribes to EventBus and CDP events and persists them into TraceDB.
 */

import { randomUUID } from 'node:crypto';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import type { MemoryDelta } from '@modules/trace/TraceDB.types';
import {
  CDP_EVENTS_BY_DOMAIN,
  DEFAULT_CDP_DOMAINS,
  extractEventTiming,
  extractRequestId,
  extractScriptLocation,
  sanitizeTracePayload,
  type CDPEventHandler,
} from '@modules/trace/TraceRecorder.internal';
import { TraceNetworkCapture } from '@modules/trace/TraceRecorder.network';
import type {
  CDPSessionLike,
  RecordingSession,
  RecordingState,
  TraceRecorderOptions,
} from '@modules/trace/TraceRecorder.types';
import { TraceDB } from '@modules/trace/TraceDB';
import { resolveArtifactPath } from '@utils/artifacts';

export type { CDPSessionLike } from '@modules/trace/TraceRecorder.types';

export class TraceRecorder {
  private db: TraceDB | null = null;
  private state: RecordingState = 'idle';
  private session: RecordingSession | null = null;
  private eventBusUnsub: (() => void) | null = null;
  private cdpListeners = new Map<string, CDPEventHandler>();
  private enabledCdpDomains = new Set<string>();
  private cdpSession: CDPSessionLike | null = null;
  private eventCount = 0;
  private memoryDeltaCount = 0;
  private heapSnapshotCount = 0;
  private eventSequence = 0;
  private pendingOperations = new Set<Promise<void>>();
  private readonly networkCapture = new TraceNetworkCapture({
    getDb: () => this.db,
    getCdpSession: () => this.cdpSession,
    trackOperation: (operation) => this.trackOperation(operation),
  });

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
    options?: TraceRecorderOptions,
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

    const selectedDomains = cdpSession
      ? (options?.cdpDomains ?? DEFAULT_CDP_DOMAINS).filter(
          (domain) => CDP_EVENTS_BY_DOMAIN[domain],
        )
      : [];
    this.db = new TraceDB({ dbPath: absolutePath });
    this.eventCount = 0;
    this.memoryDeltaCount = 0;
    this.heapSnapshotCount = 0;
    this.eventSequence = 0;
    this.pendingOperations.clear();
    this.cdpListeners.clear();
    this.enabledCdpDomains.clear();
    this.cdpSession = cdpSession;

    try {
      const networkOptions = this.networkCapture.configure(options?.network);

      if (cdpSession) {
        for (const domain of selectedDomains) {
          await cdpSession.send(`${domain}.enable`);
          this.enabledCdpDomains.add(domain);
        }
      }

      const startedAt = Date.now();
      this.db.setMetadata('sessionId', sessionId);
      this.db.setMetadata('platform', process.platform);
      this.db.setMetadata('startedAt', String(startedAt));
      this.db.setMetadata('nodeVersion', process.version);
      this.db.setMetadata(
        'network.recordResponseBodies',
        String(networkOptions.recordResponseBodies),
      );
      this.db.setMetadata(
        'network.streamResponseChunks',
        String(networkOptions.streamResponseChunks),
      );
      this.db.setMetadata('network.maxBodyBytes', String(networkOptions.maxBodyBytes));
      this.db.setMetadata('network.inlineBodyBytes', String(networkOptions.inlineBodyBytes));

      this.eventBusUnsub = eventBus.onAny((wrapped: { event: string; payload: unknown }) => {
        if (this.state !== 'recording') return;
        try {
          const now = Date.now();
          this.db?.insertEvent({
            timestamp: now,
            wallTime: now,
            monotonicTime: null,
            category: this.mapEventCategory(String(wrapped.event)),
            eventType: String(wrapped.event),
            data: JSON.stringify(wrapped.payload ?? {}),
            scriptId: null,
            lineNumber: null,
            requestId: null,
            sequence: this.nextSequence(),
          });
          this.eventCount++;
        } catch {
          // Swallow recording errors to avoid disrupting the host
        }
      });

      if (cdpSession) {
        for (const domain of selectedDomains) {
          const events = CDP_EVENTS_BY_DOMAIN[domain] ?? [];
          for (const eventName of events) {
            const handler: CDPEventHandler = (params) => {
              if (this.state !== 'recording' || !this.db) return;
              try {
                const timing = extractEventTiming(params);
                const requestId = extractRequestId(params);
                const { scriptId, lineNumber } = extractScriptLocation(eventName, params);
                const data = JSON.stringify(sanitizeTracePayload(eventName, params));

                this.db.insertEvent({
                  timestamp: timing.timestamp,
                  wallTime: timing.wallTime,
                  monotonicTime: timing.monotonicTime,
                  category: domain.toLowerCase(),
                  eventType: eventName,
                  data,
                  scriptId,
                  lineNumber,
                  requestId,
                  sequence: this.nextSequence(),
                });
                this.eventCount++;

                if (domain === 'Network') {
                  this.networkCapture.handleEvent(eventName, params, timing);
                }
              } catch {
                // Swallow recording errors
              }
            };

            cdpSession.on(eventName, handler);
            this.cdpListeners.set(eventName, handler);
          }
        }
      }

      this.session = {
        sessionId,
        dbPath: absolutePath,
        startedAt,
        eventCount: 0,
        memoryDeltaCount: 0,
        heapSnapshotCount: 0,
        ...this.networkCapture.getCounts(),
      };

      this.state = 'recording';
      return { ...this.session };
    } catch (error) {
      await this.cleanupFailedStart();
      throw error;
    }
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
  async captureActiveHeapSnapshot(): Promise<number> {
    if (!this.cdpSession) {
      throw new Error('Cannot capture heap snapshot: no active CDP session');
    }

    return await this.captureHeapSnapshot(this.cdpSession);
  }

  async captureHeapSnapshot(cdpSession: CDPSessionLike): Promise<number> {
    if (this.state !== 'recording' || !this.db) {
      throw new Error('Cannot capture heap snapshot: not recording');
    }

    const chunks: string[] = [];
    let chunkListenerAttached = false;
    const chunkHandler = (params: unknown) => {
      if (typeof params === 'object' && params !== null) {
        const chunk = (params as Record<string, unknown>)['chunk'];
        if (typeof chunk === 'string') chunks.push(chunk);
      }
    };

    try {
      await cdpSession.send('HeapProfiler.enable');
      cdpSession.on('HeapProfiler.addHeapSnapshotChunk', chunkHandler);
      chunkListenerAttached = true;

      await cdpSession.send('HeapProfiler.takeHeapSnapshot', {
        reportProgress: false,
      });

      const snapshotStr = chunks.join('');
      const snapshotBuffer = Buffer.from(snapshotStr, 'utf-8');
      const summary = this.extractHeapSummary(snapshotStr);

      this.db.insertHeapSnapshot({
        timestamp: Date.now(),
        snapshotData: snapshotBuffer,
        summary: JSON.stringify(summary),
      });
      this.heapSnapshotCount++;
      return snapshotBuffer.byteLength;
    } finally {
      if (chunkListenerAttached) {
        cdpSession.off('HeapProfiler.addHeapSnapshotChunk', chunkHandler);
      }
      await cdpSession.send('HeapProfiler.disable').catch(() => {});
    }
  }

  /**
   * Stop recording and finalize the trace database.
   * @returns Final session summary with event counts
   */
  async stop(): Promise<RecordingSession> {
    if (this.state !== 'recording') {
      throw new Error('GRACEFUL: Cannot stop: not currently recording');
    }

    if (this.eventBusUnsub) {
      this.eventBusUnsub();
      this.eventBusUnsub = null;
    }

    if (this.cdpSession) {
      for (const [event, handler] of this.cdpListeners) {
        this.cdpSession.off(event, handler);
      }
    }
    this.cdpListeners.clear();

    await this.waitForPendingOperations();

    let cleanupErrors: string[] | undefined;
    if (this.cdpSession) {
      if (this.enabledCdpDomains.size > 0) {
        const enabledDomains = Array.from(this.enabledCdpDomains);
        const cleanupResults = await Promise.allSettled(
          enabledDomains.map((domain) => this.cdpSession!.send(`${domain}.disable`)),
        );
        cleanupErrors = cleanupResults.flatMap((result, index) =>
          result.status === 'rejected'
            ? [
                `${enabledDomains[index]}.disable failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
              ]
            : [],
        );
      }
      this.enabledCdpDomains.clear();
      this.cdpSession = null;
    }

    if (this.db) {
      const stoppedAt = Date.now();
      const networkCounts = this.networkCapture.getCounts();
      this.db.setMetadata('stoppedAt', String(stoppedAt));
      this.db.setMetadata('eventCount', String(this.eventCount));
      this.db.setMetadata('memoryDeltaCount', String(this.memoryDeltaCount));
      this.db.setMetadata('heapSnapshotCount', String(this.heapSnapshotCount));
      this.db.setMetadata('networkRequestCount', String(networkCounts.networkRequestCount));
      this.db.setMetadata('networkChunkCount', String(networkCounts.networkChunkCount));
      this.db.setMetadata('networkBodyCount', String(networkCounts.networkBodyCount));
      this.db.close();

      if (this.session) {
        this.session.stoppedAt = stoppedAt;
        this.session.eventCount = this.eventCount;
        this.session.memoryDeltaCount = this.memoryDeltaCount;
        this.session.heapSnapshotCount = this.heapSnapshotCount;
        this.session.networkRequestCount = networkCounts.networkRequestCount;
        this.session.networkChunkCount = networkCounts.networkChunkCount;
        this.session.networkBodyCount = networkCounts.networkBodyCount;
        if (cleanupErrors && cleanupErrors.length > 0) {
          this.session.cleanupErrors = cleanupErrors;
        } else {
          delete this.session.cleanupErrors;
        }
      }
    }

    this.state = 'stopped';
    const finalSession = this.session ? { ...this.session } : this.createEmptySession();
    this.db = null;
    this.networkCapture.clear();
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

  private trackOperation(operation: Promise<void>): void {
    this.pendingOperations.add(operation);
    void operation.finally(() => {
      this.pendingOperations.delete(operation);
    });
  }

  private async waitForPendingOperations(): Promise<void> {
    while (this.pendingOperations.size > 0) {
      await Promise.allSettled(Array.from(this.pendingOperations));
    }
  }

  private async cleanupFailedStart(): Promise<void> {
    if (this.eventBusUnsub) {
      this.eventBusUnsub();
      this.eventBusUnsub = null;
    }

    if (this.cdpSession) {
      for (const [event, handler] of this.cdpListeners) {
        this.cdpSession.off(event, handler);
      }
    }
    this.cdpListeners.clear();

    if (this.cdpSession && this.enabledCdpDomains.size > 0) {
      await Promise.allSettled(
        Array.from(this.enabledCdpDomains).map((domain) =>
          this.cdpSession!.send(`${domain}.disable`),
        ),
      );
    }
    this.enabledCdpDomains.clear();
    this.cdpSession = null;

    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Best-effort cleanup after failed start
      }
      this.db = null;
    }

    this.session = null;
    this.state = 'idle';
    this.eventCount = 0;
    this.memoryDeltaCount = 0;
    this.heapSnapshotCount = 0;
    this.eventSequence = 0;
    this.pendingOperations.clear();
    this.networkCapture.clear();
  }

  private nextSequence(): number {
    this.eventSequence += 1;
    return this.eventSequence;
  }

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
      networkRequestCount: 0,
      networkChunkCount: 0,
      networkBodyCount: 0,
    };
  }
}
