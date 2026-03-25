/**
 * InstrumentationSessionManager — unified session lifecycle for all instrumentation types.
 *
 * Manages sessions, operations, and artifacts. Each session groups related
 * hook / inject / intercept / trace operations and their captured data into
 * a single queryable, exportable container.
 */
import type {
  InstrumentationArtifact,
  InstrumentationArtifactData,
  InstrumentationOperation,
  InstrumentationSessionSnapshot,
  SessionInfo,
} from './types';
import { InstrumentationType } from './types';
import type { EvidenceGraphBridge } from './EvidenceGraphBridge';
import type { ToolResponse } from '@server/types';

let _nextId = 0;
function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(++_nextId).toString(36)}`;
}

interface HookPresetInvoker {
  handleHookPreset(args: Record<string, unknown>): Promise<ToolResponse>;
}

interface NetworkReplayInvoker {
  handleNetworkReplayRequest(args: Record<string, unknown>): Promise<ToolResponse>;
}

interface TrackedToolExecutionResult<TPayload extends Record<string, unknown>> {
  operation: InstrumentationOperation;
  artifacts: InstrumentationArtifact[];
  payload: TPayload;
}

interface TrackedToolExecutionSpec<TPayload extends Record<string, unknown>> {
  sessionId: string;
  type: InstrumentationType;
  target: string;
  config: Record<string, unknown>;
  invoke: () => Promise<ToolResponse>;
  isSuccessful?: (payload: TPayload) => boolean;
  buildArtifacts?: (payload: TPayload) => InstrumentationArtifactData[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseToolPayload<TPayload extends Record<string, unknown>>(
  response: ToolResponse,
): TPayload {
  const firstText = response.content.find(
    (item): item is { type: 'text'; text: string } =>
      item.type === 'text' && typeof item.text === 'string',
  );
  if (!firstText) {
    throw new Error('Expected JSON text payload from wrapped tool response');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(firstText.text);
  } catch (error) {
    throw new Error(
      `Wrapped tool returned non-JSON text payload: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error('Wrapped tool returned JSON that is not an object');
  }

  return parsed as TPayload;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export class InstrumentationSessionManager {
  /** All sessions (including destroyed). */
  private readonly sessions = new Map<string, SessionInfo>();
  /** Session ID → operations. */
  private readonly operations = new Map<string, InstrumentationOperation[]>();
  /** Session ID → artifacts. */
  private readonly artifacts = new Map<string, InstrumentationArtifact[]>();
  /** Operation ID → owning session ID (reverse index). */
  private readonly operationIndex = new Map<string, string>();
  /** Optional evidence graph bridge for auto-population (EVID-04). */
  private evidenceBridge?: EvidenceGraphBridge;

  /** Set the evidence graph bridge for auto-populating evidence nodes. */
  setEvidenceBridge(bridge: EvidenceGraphBridge): void {
    this.evidenceBridge = bridge;
  }

  // ── Session lifecycle ──

  createSession(name?: string): SessionInfo {
    const id = uid('sess');
    const info: SessionInfo = {
      id,
      name,
      createdAt: Date.now(),
      operationCount: 0,
      artifactCount: 0,
      status: 'active',
    };
    this.sessions.set(id, info);
    this.operations.set(id, []);
    this.artifacts.set(id, []);
    return info;
  }

  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);
    session.status = 'destroyed';
    // Mark all operations as completed
    const ops = this.operations.get(sessionId) ?? [];
    for (const op of ops) {
      if (op.status === 'active') op.status = 'completed';
    }
  }

  listSessions(): SessionInfo[] {
    return [...this.sessions.values()].filter((s) => s.status === 'active');
  }

  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  // ── Operation management ──

  registerOperation(
    sessionId: string,
    type: InstrumentationType,
    target: string,
    config: Record<string, unknown>,
  ): InstrumentationOperation {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);
    if (session.status === 'destroyed') {
      throw new Error(`Session "${sessionId}" is destroyed — cannot register new operations`);
    }

    const id = uid('op');
    const op: InstrumentationOperation = {
      id,
      sessionId,
      type,
      target,
      config,
      createdAt: Date.now(),
      status: 'active',
    };

    const ops = this.operations.get(sessionId)!;
    ops.push(op);
    this.operationIndex.set(id, sessionId);
    session.operationCount = ops.length;

    // EVID-04: auto-populate evidence graph
    this.evidenceBridge?.onOperation(op);

    return op;
  }

  getSessionOperations(sessionId: string): InstrumentationOperation[] {
    return this.operations.get(sessionId) ?? [];
  }

  // ── Artifact recording ──

  recordArtifact(operationId: string, data: InstrumentationArtifactData): InstrumentationArtifact {
    const sessionId = this.operationIndex.get(operationId);
    if (!sessionId) throw new Error(`Operation "${operationId}" not found`);

    const ops = this.operations.get(sessionId) ?? [];
    const op = ops.find((o) => o.id === operationId);
    if (!op) throw new Error(`Operation "${operationId}" metadata missing`);

    const artifact: InstrumentationArtifact = {
      operationId,
      sessionId,
      type: op.type,
      timestamp: Date.now(),
      data,
    };

    const sessionArtifacts = this.artifacts.get(sessionId)!;
    sessionArtifacts.push(artifact);

    const session = this.sessions.get(sessionId)!;
    session.artifactCount = sessionArtifacts.length;

    // EVID-04: auto-populate evidence graph
    this.evidenceBridge?.onArtifact(artifact);

    return artifact;
  }

  getArtifacts(sessionId: string, type?: InstrumentationType): InstrumentationArtifact[] {
    const all = this.artifacts.get(sessionId) ?? [];
    if (!type) return all;
    return all.filter((a) => a.type === type);
  }

  getSessionSnapshot(sessionId: string): InstrumentationSessionSnapshot | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    return {
      session,
      stats: this.getSessionStats(sessionId),
      operations: [...this.getSessionOperations(sessionId)],
      artifacts: [...this.getArtifacts(sessionId)],
    };
  }

  listSessionSnapshots(): InstrumentationSessionSnapshot[] {
    return this.listSessions().map((session) => ({
      session,
      stats: this.getSessionStats(session.id),
      operations: [...this.getSessionOperations(session.id)],
      artifacts: [...this.getArtifacts(session.id)],
    }));
  }

  async applyHookPreset(
    sessionId: string,
    presetInvoker: HookPresetInvoker,
    args: Record<string, unknown>,
  ): Promise<
    TrackedToolExecutionResult<{
      success?: boolean;
      injected?: unknown;
      failed?: unknown;
      method?: unknown;
      [key: string]: unknown;
    }>
  > {
    const presetNames = getStringArray(args['presets']);
    const singlePreset = typeof args['preset'] === 'string' ? args['preset'] : undefined;
    const target =
      singlePreset ?? (presetNames.length > 0 ? presetNames.join(', ') : 'hook_preset');

    return this.executeTrackedTool({
      sessionId,
      type: InstrumentationType.RUNTIME_HOOK,
      target,
      config: { ...args },
      invoke: () => presetInvoker.handleHookPreset(args),
      isSuccessful: (payload) => {
        const injected = getStringArray(payload.injected);
        return injected.length > 0;
      },
      buildArtifacts: (payload) => {
        const injected = getStringArray(payload.injected);
        const failed = Array.isArray(payload.failed)
          ? payload.failed.filter(
              (item): item is { preset: string; error: string } =>
                isRecord(item) &&
                typeof item['preset'] === 'string' &&
                typeof item['error'] === 'string',
            )
          : [];
        const method = payload.method === 'evaluateOnNewDocument' ? 'before-load' : 'runtime';
        return [
          {
            presetIds: injected,
            failedPresets: failed,
            injectionPoint: method,
            scriptContent: injected.join(', '),
            body: payload,
          },
        ];
      },
    });
  }

  async replayNetworkRequest(
    sessionId: string,
    replayInvoker: NetworkReplayInvoker,
    args: Record<string, unknown>,
  ): Promise<
    TrackedToolExecutionResult<{
      success?: boolean;
      dryRun?: unknown;
      preview?: unknown;
      status?: unknown;
      statusText?: unknown;
      headers?: unknown;
      body?: unknown;
      bodyTruncated?: unknown;
      requestId?: unknown;
      [key: string]: unknown;
    }>
  > {
    const requestId = typeof args['requestId'] === 'string' ? args['requestId'] : 'network_replay';
    const urlOverride = typeof args['urlOverride'] === 'string' ? args['urlOverride'] : undefined;

    return this.executeTrackedTool({
      sessionId,
      type: InstrumentationType.NETWORK_INTERCEPT,
      target: requestId,
      config: { ...args },
      invoke: () => replayInvoker.handleNetworkReplayRequest(args),
      buildArtifacts: (payload) => {
        if (payload.dryRun === true && isRecord(payload.preview)) {
          return [
            {
              requestId,
              url:
                typeof payload.preview['url'] === 'string' ? payload.preview['url'] : urlOverride,
              method:
                typeof payload.preview['method'] === 'string'
                  ? payload.preview['method']
                  : undefined,
              headers: isRecord(payload.preview['headers'])
                ? (payload.preview['headers'] as Record<string, string>)
                : undefined,
              body: payload.preview['body'],
              replayMode: 'dry-run',
            },
          ];
        }

        return [
          {
            requestId: typeof payload.requestId === 'string' ? payload.requestId : requestId,
            url: urlOverride,
            method:
              typeof args['methodOverride'] === 'string'
                ? (args['methodOverride'] as string)
                : undefined,
            headers: isRecord(payload.headers)
              ? (payload.headers as Record<string, string>)
              : undefined,
            body: payload.body,
            statusCode: typeof payload.status === 'number' ? payload.status : undefined,
            statusText: typeof payload.statusText === 'string' ? payload.statusText : undefined,
            bodyTruncated:
              typeof payload.bodyTruncated === 'boolean' ? payload.bodyTruncated : undefined,
            replayMode: 'live',
          },
        ];
      },
    });
  }

  // ── Stats ──

  getSessionStats(sessionId: string): { operationCount: number; artifactCount: number } {
    const session = this.sessions.get(sessionId);
    if (!session) return { operationCount: 0, artifactCount: 0 };
    return {
      operationCount: session.operationCount,
      artifactCount: session.artifactCount,
    };
  }

  private findOperation(operationId: string): InstrumentationOperation | undefined {
    const sessionId = this.operationIndex.get(operationId);
    if (!sessionId) {
      return undefined;
    }
    return (this.operations.get(sessionId) ?? []).find((operation) => operation.id === operationId);
  }

  private setOperationStatus(
    operationId: string,
    status: InstrumentationOperation['status'],
  ): void {
    const operation = this.findOperation(operationId);
    if (operation) {
      operation.status = status;
    }
  }

  private async executeTrackedTool<TPayload extends Record<string, unknown>>(
    spec: TrackedToolExecutionSpec<TPayload>,
  ): Promise<TrackedToolExecutionResult<TPayload>> {
    const operation = this.registerOperation(spec.sessionId, spec.type, spec.target, spec.config);

    try {
      const payload = parseToolPayload<TPayload>(await spec.invoke());
      const isSuccessful = spec.isSuccessful
        ? spec.isSuccessful(payload)
        : payload['success'] !== false;

      if (!isSuccessful) {
        this.setOperationStatus(operation.id, 'failed');
        return { operation, artifacts: [], payload };
      }

      const artifacts = (spec.buildArtifacts?.(payload) ?? []).map((artifactData) =>
        this.recordArtifact(operation.id, artifactData),
      );
      this.setOperationStatus(operation.id, 'completed');
      return { operation, artifacts, payload };
    } catch (error) {
      this.setOperationStatus(operation.id, 'failed');
      throw error;
    }
  }
}
