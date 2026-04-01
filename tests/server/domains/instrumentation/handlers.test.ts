import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstrumentationSessionManager } from '@server/instrumentation/InstrumentationSession';
import { InstrumentationType } from '@server/instrumentation/types';
import { InstrumentationHandlers } from '@server/domains/instrumentation/handlers';

function parseResponse(result: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe('InstrumentationHandlers', () => {
  let manager: InstrumentationSessionManager;
  let handlers: InstrumentationHandlers;

  beforeEach(() => {
    manager = new InstrumentationSessionManager();
    handlers = new InstrumentationHandlers(manager);
  });

  describe('handleSessionCreate', () => {
    it('creates session and returns sessionId', async () => {
      const result = await handlers.handleSessionCreate({});
      const data = parseResponse(result);
      expect(data.success).toBe(true);
      expect(data.session).toBeDefined();
      expect((data.session as Record<string, unknown>).id).toBeTruthy();
    });

    it('creates session with optional name', async () => {
      const result = await handlers.handleSessionCreate({ name: 'test-session' });
      const data = parseResponse(result);
      expect(data.success).toBe(true);
      expect((data.session as Record<string, unknown>).name).toBe('test-session');
    });
  });

  describe('handleSessionList', () => {
    it('returns empty array when no sessions', async () => {
      const result = await handlers.handleSessionList({});
      const data = parseResponse(result);
      expect(data.success).toBe(true);
      expect(data.totalSessions).toBe(0);
      expect(data.sessions).toEqual([]);
    });

    it('returns all active sessions', async () => {
      await handlers.handleSessionCreate({ name: 'a' });
      await handlers.handleSessionCreate({ name: 'b' });
      const result = await handlers.handleSessionList({});
      const data = parseResponse(result);
      expect(data.totalSessions).toBe(2);
    });
  });

  describe('handleSessionDestroy', () => {
    it('destroys existing session', async () => {
      const createResult = await handlers.handleSessionCreate({});
      const sessionId = (parseResponse(createResult).session as Record<string, unknown>)
        .id as string;
      const destroyResult = await handlers.handleSessionDestroy({ sessionId });
      const data = parseResponse(destroyResult);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Session destroyed');
    });

    it('returns error for non-existent session', async () => {
      const result = await handlers.handleSessionDestroy({ sessionId: 'nope' });
      const data = parseResponse(result);
      expect(data.success).toBe(false);
      expect(data.error).toBeTruthy();
    });

    it('returns error when sessionId is missing', async () => {
      const result = await handlers.handleSessionDestroy({});
      const data = parseResponse(result);
      expect(data.success).toBe(false);
    });
  });

  describe('handleSessionStatus', () => {
    it('returns session stats for existing session', async () => {
      const createResult = await handlers.handleSessionCreate({});
      const sessionId = (parseResponse(createResult).session as Record<string, unknown>)
        .id as string;
      const result = await handlers.handleSessionStatus({ sessionId });
      const data = parseResponse(result);
      expect(data.success).toBe(true);
      expect(data.stats).toBeDefined();
      expect((data.stats as Record<string, unknown>).operationCount).toBe(0);
    });

    it('returns error for non-existent session', async () => {
      const result = await handlers.handleSessionStatus({ sessionId: 'nope' });
      const data = parseResponse(result);
      expect(data.success).toBe(false);
    });
  });

  describe('handleOperationList', () => {
    it('returns operations for given session', async () => {
      const createResult = await handlers.handleSessionCreate({});
      const sessionId = (parseResponse(createResult).session as Record<string, unknown>)
        .id as string;
      await handlers.handleOperationRegister({
        sessionId,
        type: InstrumentationType.RUNTIME_HOOK,
        target: 'fn',
      });
      const result = await handlers.handleOperationList({ sessionId });
      const data = parseResponse(result);
      expect(data.success).toBe(true);
      expect(data.totalOperations).toBe(1);
    });
  });

  describe('handleOperationRegister', () => {
    it('registers an operation and returns operation data', async () => {
      const createResult = await handlers.handleSessionCreate({});
      const sessionId = (parseResponse(createResult).session as Record<string, unknown>)
        .id as string;
      const result = await handlers.handleOperationRegister({
        sessionId,
        type: InstrumentationType.RUNTIME_HOOK,
        target: 'signPayload',
        config: { captureArgs: true },
      });
      const data = parseResponse(result);
      expect(data.success).toBe(true);
      expect((data.operation as Record<string, unknown>).target).toBe('signPayload');
    });
  });

  describe('handleArtifactQuery', () => {
    it('returns artifacts for session', async () => {
      const createResult = await handlers.handleSessionCreate({});
      const sessionId = (parseResponse(createResult).session as Record<string, unknown>)
        .id as string;
      const opResult = await handlers.handleOperationRegister({
        sessionId,
        type: InstrumentationType.RUNTIME_HOOK,
        target: 'fn',
      });
      const op = parseResponse(opResult).operation as Record<string, unknown>;
      await handlers.handleArtifactRecord({ operationId: op.id, data: { args: [1, 2] } });
      const result = await handlers.handleArtifactQuery({ sessionId });
      const data = parseResponse(result);
      expect(data.success).toBe(true);
      expect(data.totalArtifacts).toBe(1);
    });

    it('respects limit parameter', async () => {
      const createResult = await handlers.handleSessionCreate({});
      const sessionId = (parseResponse(createResult).session as Record<string, unknown>)
        .id as string;
      const opResult = await handlers.handleOperationRegister({
        sessionId,
        type: InstrumentationType.RUNTIME_HOOK,
        target: 'fn',
      });
      const op = parseResponse(opResult).operation as Record<string, unknown>;
      await handlers.handleArtifactRecord({ operationId: op.id, data: { args: [1] } });
      await handlers.handleArtifactRecord({ operationId: op.id, data: { args: [2] } });
      await handlers.handleArtifactRecord({ operationId: op.id, data: { args: [3] } });
      const result = await handlers.handleArtifactQuery({ sessionId, limit: 2 });
      const data = parseResponse(result);
      expect(data.totalArtifacts).toBe(2);
    });
  });

  describe('handleArtifactRecord', () => {
    it('records artifacts and returns artifact metadata', async () => {
      const createResult = await handlers.handleSessionCreate({});
      const sessionId = (parseResponse(createResult).session as Record<string, unknown>)
        .id as string;
      const opResult = await handlers.handleOperationRegister({
        sessionId,
        type: InstrumentationType.RUNTIME_HOOK,
        target: 'fn',
      });
      const op = parseResponse(opResult).operation as Record<string, unknown>;
      const result = await handlers.handleArtifactRecord({
        operationId: op.id,
        data: { returnValue: 'signed' },
      });
      const data = parseResponse(result);
      expect(data.success).toBe(true);
      expect((data.artifact as Record<string, unknown>).operationId).toBe(op.id);
    });
  });

  describe('handleHookPreset', () => {
    it('returns error if sessionId is required', async () => {
      const result = await handlers.handleHookPreset({});
      const data = parseResponse(result);
      expect(data.success).toBe(false);
      expect(data.error).toBe('sessionId is required');
    });

    it('returns error if deps are not available', async () => {
      const createResult = await handlers.handleSessionCreate({});
      const sessionId = (parseResponse(createResult).session as Record<string, unknown>)
        .id as string;

      const result = await handlers.handleHookPreset({ sessionId });
      const data = parseResponse(result);
      expect(data.success).toBe(false);
      expect(data.error).toBe('hookPresetHandlers is not available');
    });

    it('delegates to sessionManager when deps are available', async () => {
      const mockDeps = {
        hookPresetHandlers: { handleHookPreset: vi.fn() },
      };
      const handlersWithDeps = new InstrumentationHandlers(manager, mockDeps);
      const createResult = await handlersWithDeps.handleSessionCreate({});
      const sessionId = (parseResponse(createResult).session as Record<string, unknown>)
        .id as string;

      vi.spyOn(manager, 'applyHookPreset').mockResolvedValue({
        payload: { success: true, result: 'ok' },
        operation: { status: 'completed' } as any,
        artifacts: [],
      });

      const result = await handlersWithDeps.handleHookPreset({ sessionId, extraArg: 123 });
      const data = parseResponse(result);
      expect(data.success).toBe(true);
      expect(manager.applyHookPreset).toHaveBeenCalledWith(sessionId, mockDeps.hookPresetHandlers, {
        extraArg: 123,
      });
    });
  });

  describe('handleNetworkReplay', () => {
    it('returns error if sessionId is missing', async () => {
      const result = await handlers.handleNetworkReplay({});
      const data = parseResponse(result);
      expect(data.success).toBe(false);
    });

    it('returns error if deps are not available', async () => {
      const createResult = await handlers.handleSessionCreate({});
      const sessionId = (parseResponse(createResult).session as Record<string, unknown>)
        .id as string;

      const result = await handlers.handleNetworkReplay({ sessionId });
      const data = parseResponse(result);
      expect(data.success).toBe(false);
      expect(data.error).toBe('advancedHandlers is not available');
    });

    it('delegates to sessionManager when deps are available', async () => {
      const mockDeps = {
        advancedHandlers: { handleNetworkReplayRequest: vi.fn() },
      };
      const handlersWithDeps = new InstrumentationHandlers(manager, mockDeps);
      const createResult = await handlersWithDeps.handleSessionCreate({});
      const sessionId = (parseResponse(createResult).session as Record<string, unknown>)
        .id as string;

      vi.spyOn(manager, 'replayNetworkRequest').mockResolvedValue({
        payload: { success: true },
        operation: { status: 'completed' } as any,
        artifacts: [],
      });

      const result = await handlersWithDeps.handleNetworkReplay({ sessionId, extraArg: 123 });
      const data = parseResponse(result);
      expect(data.success).toBe(true);
      expect(manager.replayNetworkRequest).toHaveBeenCalledWith(
        sessionId,
        mockDeps.advancedHandlers,
        { extraArg: 123 },
      );
    });
  });
});
