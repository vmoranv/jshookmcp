import type { InstrumentationSessionManager } from '@server/instrumentation/InstrumentationSession';
import { InstrumentationType } from '@server/instrumentation/types';
import { argString } from '@server/domains/shared/parse-args';
import { asJsonResponse } from '@server/domains/shared/response';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';
import { resolveArtifactPath } from '@utils/artifacts';
import { writeTextFileAtomically } from '@utils/safeOutput';

interface HookPresetHandlerLike {
  handleHookPreset(args: Record<string, unknown>): Promise<ToolResponse>;
}

interface NetworkReplayHandlerLike {
  handleNetworkReplayRequest(args: Record<string, unknown>): Promise<ToolResponse>;
}

interface InstrumentationHandlerDeps {
  hookPresetHandlers?: HookPresetHandlerLike;
  advancedHandlers?: NetworkReplayHandlerLike;
}

export class InstrumentationHandlers {
  constructor(
    private readonly sessionManager: InstrumentationSessionManager,
    private readonly deps: InstrumentationHandlerDeps = {},
  ) {}

  async handleSessionDispatch(args: Record<string, unknown>) {
    const action = argString(args, 'action');
    switch (action) {
      case 'create':
        return this.handleSessionCreate(args);
      case 'list':
        return this.handleSessionList(args);
      case 'destroy':
        return this.handleSessionDestroy(args);
      case 'status':
        return this.handleSessionStatus(args);
      default:
        return asJsonResponse({
          success: false,
          error: `Unknown action: ${action}. Valid: create, list, destroy, status`,
        });
    }
  }
  async handleOperationDispatch(args: Record<string, unknown>) {
    const action = argString(args, 'action');
    switch (action) {
      case 'register':
        return this.handleOperationRegister(args);
      case 'list':
        return this.handleOperationList(args);
      case 'status':
        return this.handleOperationStatus(args);
      case 'stop':
        return this.handleOperationStop(args);
      default:
        return asJsonResponse({
          success: false,
          error: `Unknown action: ${action}. Valid: register, list, status, stop`,
        });
    }
  }
  async handleArtifactDispatch(args: Record<string, unknown>) {
    const action = argString(args, 'action');
    switch (action) {
      case 'record':
        return this.handleArtifactRecord(args);
      case 'query':
        return this.handleArtifactQuery(args);
      default:
        return asJsonResponse({
          success: false,
          error: `Unknown action: ${action}. Valid: record, query`,
        });
    }
  }
  async handleSessionCreate(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const name = argString(args, 'name');
      const session = this.sessionManager.createSession(name || undefined);
      return { session };
    });
  }

  async handleSessionList(_args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessions = this.sessionManager.listSessions();
      return { totalSessions: sessions.length, sessions };
    });
  }

  async handleSessionDestroy(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = argString(args, 'sessionId', '');
      if (!sessionId) throw new Error('sessionId is required');
      this.sessionManager.destroySession(sessionId);
      return { sessionId, message: 'Session destroyed' };
    });
  }

  async handleSessionStatus(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = argString(args, 'sessionId', '');
      if (!sessionId) throw new Error('sessionId is required');
      const session = this.sessionManager.getSession(sessionId);
      if (!session) throw new Error(`Session "${sessionId}" not found`);
      const stats = this.sessionManager.getSessionStats(sessionId);
      return { session, stats };
    });
  }

  async handleSessionExport(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = argString(args, 'sessionId', '');
      if (!sessionId) throw new Error('sessionId is required');

      const snapshot = this.sessionManager.getSessionSnapshot(sessionId);
      if (!snapshot) throw new Error(`Session "${sessionId}" not found`);

      const outputDir = argString(args, 'outputDir');
      const artifactPath = await resolveArtifactPath({
        category: 'sessions',
        toolName: 'instrumentation_session_export',
        target: sessionId,
        ext: 'json',
        customDir: outputDir,
      });
      const content = JSON.stringify(
        {
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          snapshot,
        },
        null,
        2,
      );
      await writeTextFileAtomically(artifactPath.absolutePath, content);

      return {
        sessionId,
        exportedPath: artifactPath.absolutePath,
        displayPath: artifactPath.displayPath,
        operationCount: snapshot.operations.length,
        artifactCount: snapshot.artifacts.length,
        bytesWritten: Buffer.byteLength(content, 'utf8'),
      };
    });
  }

  async handleOperationList(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = argString(args, 'sessionId', '');
      if (!sessionId) throw new Error('sessionId is required');
      let ops = this.sessionManager.getSessionOperations(sessionId);
      const typeFilter = argString(args, 'type');
      if (typeFilter) ops = ops.filter((o) => o.type === typeFilter);
      return { totalOperations: ops.length, operations: ops };
    });
  }

  async handleOperationStatus(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = argString(args, 'sessionId', '');
      const operationId = argString(args, 'operationId', '');
      if (!sessionId) throw new Error('sessionId is required');
      if (!operationId) throw new Error('operationId is required');

      const operation = this.sessionManager.getOperation(sessionId, operationId);
      if (!operation) throw new Error(`Operation "${operationId}" not found`);
      return { operation };
    });
  }

  async handleOperationStop(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = argString(args, 'sessionId', '');
      const operationId = argString(args, 'operationId', '');
      if (!sessionId) throw new Error('sessionId is required');
      if (!operationId) throw new Error('operationId is required');

      const operation = this.sessionManager.stopOperation(sessionId, operationId);
      return { operation, message: 'Operation stopped' };
    });
  }

  async handleOperationRegister(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = argString(args, 'sessionId', '');
      const type = argString(args, 'type', '');
      const target = argString(args, 'target', '');
      const config =
        args.config && typeof args.config === 'object' && !Array.isArray(args.config)
          ? (args.config as Record<string, unknown>)
          : {};
      if (!sessionId) throw new Error('sessionId is required');
      if (!type) throw new Error('type is required');
      if (!target) throw new Error('target is required');

      const operation = this.sessionManager.registerOperation(
        sessionId,
        type as InstrumentationType,
        target,
        config,
      );
      return { operation };
    });
  }

  async handleArtifactQuery(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = argString(args, 'sessionId', '');
      if (!sessionId) throw new Error('sessionId is required');
      const typeRaw = argString(args, 'type');
      const type = typeRaw ? (typeRaw as InstrumentationType) : undefined;
      const limit = typeof args.limit === 'number' ? args.limit : 50;
      let artifacts = this.sessionManager.getArtifacts(sessionId, type);
      if (limit > 0) artifacts = artifacts.slice(0, limit);
      return { totalArtifacts: artifacts.length, artifacts };
    });
  }

  async handleArtifactRecord(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const operationId = argString(args, 'operationId', '');
      const data =
        args.data && typeof args.data === 'object' && !Array.isArray(args.data)
          ? args.data
          : undefined;
      if (!operationId) throw new Error('operationId is required');
      if (!data) throw new Error('data is required');
      const artifact = this.sessionManager.recordArtifact(operationId, data);
      return { artifact };
    });
  }

  async handleHookPreset(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = argString(args, 'sessionId', '');
      if (!sessionId) throw new Error('sessionId is required');
      if (!this.deps.hookPresetHandlers) throw new Error('hookPresetHandlers is not available');

      const delegatedArgs = { ...args };
      delete delegatedArgs['sessionId'];

      const result = await this.sessionManager.applyHookPreset(
        sessionId,
        this.deps.hookPresetHandlers,
        delegatedArgs,
      );
      return {
        operation: result.operation,
        artifacts: result.artifacts,
        result: result.payload,
      };
    });
  }

  async handleNetworkReplay(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = argString(args, 'sessionId', '');
      if (!sessionId) throw new Error('sessionId is required');
      if (!this.deps.advancedHandlers) throw new Error('advancedHandlers is not available');

      const delegatedArgs = { ...args };
      delete delegatedArgs['sessionId'];

      const result = await this.sessionManager.replayNetworkRequest(
        sessionId,
        this.deps.advancedHandlers,
        delegatedArgs,
      );
      return {
        operation: result.operation,
        artifacts: result.artifacts,
        result: result.payload,
      };
    });
  }
}
