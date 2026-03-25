/**
 * InstrumentationHandlers — MCP tool handlers for the instrumentation domain.
 *
 * Delegates to InstrumentationSessionManager for all lifecycle operations.
 * Returns MCP-compliant { content: [{ type: 'text', text: JSON }] } responses.
 */
import type { InstrumentationSessionManager } from '@server/instrumentation/InstrumentationSession';
import { InstrumentationType } from '@server/instrumentation/types';
import { argString } from '@server/domains/shared/parse-args';
import type { ToolResponse } from '@server/types';

function jsonResponse(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

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

  async handleSessionCreate(args: Record<string, unknown>) {
    try {
      const name = argString(args, 'name');
      const session = this.sessionManager.createSession(name || undefined);
      return jsonResponse({ success: true, session });
    } catch (error) {
      return jsonResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleSessionList(_args: Record<string, unknown>) {
    try {
      const sessions = this.sessionManager.listSessions();
      return jsonResponse({ success: true, totalSessions: sessions.length, sessions });
    } catch (error) {
      return jsonResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleSessionDestroy(args: Record<string, unknown>) {
    try {
      const sessionId = argString(args, 'sessionId', '');
      if (!sessionId) return jsonResponse({ success: false, error: 'sessionId is required' });
      this.sessionManager.destroySession(sessionId);
      return jsonResponse({ success: true, sessionId, message: 'Session destroyed' });
    } catch (error) {
      return jsonResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleSessionStatus(args: Record<string, unknown>) {
    try {
      const sessionId = argString(args, 'sessionId', '');
      if (!sessionId) return jsonResponse({ success: false, error: 'sessionId is required' });
      const session = this.sessionManager.getSession(sessionId);
      if (!session)
        return jsonResponse({ success: false, error: `Session "${sessionId}" not found` });
      const stats = this.sessionManager.getSessionStats(sessionId);
      return jsonResponse({ success: true, session, stats });
    } catch (error) {
      return jsonResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleOperationList(args: Record<string, unknown>) {
    try {
      const sessionId = argString(args, 'sessionId', '');
      if (!sessionId) return jsonResponse({ success: false, error: 'sessionId is required' });
      let ops = this.sessionManager.getSessionOperations(sessionId);
      const typeFilter = argString(args, 'type');
      if (typeFilter) {
        ops = ops.filter((o) => o.type === typeFilter);
      }
      return jsonResponse({ success: true, totalOperations: ops.length, operations: ops });
    } catch (error) {
      return jsonResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleOperationRegister(args: Record<string, unknown>) {
    try {
      const sessionId = argString(args, 'sessionId', '');
      const type = argString(args, 'type', '');
      const target = argString(args, 'target', '');
      const config =
        args.config && typeof args.config === 'object' && !Array.isArray(args.config)
          ? (args.config as Record<string, unknown>)
          : {};
      if (!sessionId) return jsonResponse({ success: false, error: 'sessionId is required' });
      if (!type) return jsonResponse({ success: false, error: 'type is required' });
      if (!target) return jsonResponse({ success: false, error: 'target is required' });

      const operation = this.sessionManager.registerOperation(
        sessionId,
        type as InstrumentationType,
        target,
        config,
      );
      return jsonResponse({ success: true, operation });
    } catch (error) {
      return jsonResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleArtifactQuery(args: Record<string, unknown>) {
    try {
      const sessionId = argString(args, 'sessionId', '');
      if (!sessionId) return jsonResponse({ success: false, error: 'sessionId is required' });
      const typeRaw = argString(args, 'type');
      const type = typeRaw ? (typeRaw as InstrumentationType) : undefined;
      const limit = typeof args.limit === 'number' ? args.limit : 50;
      let artifacts = this.sessionManager.getArtifacts(sessionId, type);
      if (limit > 0) artifacts = artifacts.slice(0, limit);
      return jsonResponse({ success: true, totalArtifacts: artifacts.length, artifacts });
    } catch (error) {
      return jsonResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleArtifactRecord(args: Record<string, unknown>) {
    try {
      const operationId = argString(args, 'operationId', '');
      const data =
        args.data && typeof args.data === 'object' && !Array.isArray(args.data)
          ? args.data
          : undefined;
      if (!operationId) return jsonResponse({ success: false, error: 'operationId is required' });
      if (!data) return jsonResponse({ success: false, error: 'data is required' });
      const artifact = this.sessionManager.recordArtifact(operationId, data);
      return jsonResponse({ success: true, artifact });
    } catch (error) {
      return jsonResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleHookPreset(args: Record<string, unknown>) {
    try {
      const sessionId = argString(args, 'sessionId', '');
      if (!sessionId) return jsonResponse({ success: false, error: 'sessionId is required' });
      if (!this.deps.hookPresetHandlers) {
        return jsonResponse({ success: false, error: 'hookPresetHandlers is not available' });
      }

      const delegatedArgs = { ...args };
      delete delegatedArgs['sessionId'];

      const result = await this.sessionManager.applyHookPreset(
        sessionId,
        this.deps.hookPresetHandlers,
        delegatedArgs,
      );
      return jsonResponse({
        success: result.payload.success !== false && result.operation.status === 'completed',
        operation: result.operation,
        artifacts: result.artifacts,
        result: result.payload,
      });
    } catch (error) {
      return jsonResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleNetworkReplay(args: Record<string, unknown>) {
    try {
      const sessionId = argString(args, 'sessionId', '');
      if (!sessionId) return jsonResponse({ success: false, error: 'sessionId is required' });
      if (!this.deps.advancedHandlers) {
        return jsonResponse({ success: false, error: 'advancedHandlers is not available' });
      }

      const delegatedArgs = { ...args };
      delete delegatedArgs['sessionId'];

      const result = await this.sessionManager.replayNetworkRequest(
        sessionId,
        this.deps.advancedHandlers,
        delegatedArgs,
      );
      return jsonResponse({
        success: result.payload.success !== false && result.operation.status === 'completed',
        operation: result.operation,
        artifacts: result.artifacts,
        result: result.payload,
      });
    } catch (error) {
      return jsonResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
