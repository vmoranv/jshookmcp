import { beforeEach, describe, expect, it } from 'vitest';
import { InstrumentationSessionManager } from '@server/instrumentation/InstrumentationSession';
import { InstrumentationType } from '@server/instrumentation/types';
import type { ToolResponse } from '@server/types';

function jsonToolResponse(payload: unknown): ToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

describe('InstrumentationSession', () => {
  let manager: InstrumentationSessionManager;

  beforeEach(() => {
    manager = new InstrumentationSessionManager();
  });

  // ── Session Lifecycle ──

  describe('lifecycle', () => {
    it('creates session with unique id and empty operations list', () => {
      const session = manager.createSession();
      expect(session.id).toBeTruthy();
      expect(session.operationCount).toBe(0);
      expect(session.artifactCount).toBe(0);
      expect(session.status).toBe('active');
    });

    it('creates session with optional name', () => {
      const session = manager.createSession('my-session');
      expect(session.name).toBe('my-session');
    });

    it('creates sessions with unique ids', () => {
      const s1 = manager.createSession();
      const s2 = manager.createSession();
      expect(s1.id).not.toBe(s2.id);
    });

    it('lists all active sessions', () => {
      manager.createSession('a');
      manager.createSession('b');
      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.status === 'active')).toBe(true);
    });

    it('destroys session and marks it destroyed', () => {
      const session = manager.createSession();
      manager.destroySession(session.id);
      const info = manager.getSession(session.id);
      expect(info?.status).toBe('destroyed');
    });

    it('destroyed sessions are excluded from listSessions', () => {
      const s1 = manager.createSession();
      manager.createSession();
      manager.destroySession(s1.id);
      expect(manager.listSessions()).toHaveLength(1);
    });

    it('prevents operations on destroyed session', () => {
      const session = manager.createSession();
      manager.destroySession(session.id);
      expect(() =>
        manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'window.fetch', {}),
      ).toThrow(/destroyed/i);
    });
  });

  // ── Operation Registration ──

  describe('registerOperation', () => {
    it('registers before-load inject operation', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(
        session.id,
        InstrumentationType.BEFORE_LOAD_INJECT,
        'console.log override',
        { code: '...' },
      );
      expect(op.type).toBe(InstrumentationType.BEFORE_LOAD_INJECT);
      expect(op.sessionId).toBe(session.id);
      expect(op.target).toBe('console.log override');
      expect(op.status).toBe('active');
    });

    it('registers runtime function hook', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(
        session.id,
        InstrumentationType.RUNTIME_HOOK,
        'window.fetch',
        { captureArgs: true },
      );
      expect(op.type).toBe(InstrumentationType.RUNTIME_HOOK);
    });

    it('registers XHR/Fetch intercept', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(
        session.id,
        InstrumentationType.NETWORK_INTERCEPT,
        'https://api.example.com/*',
        {},
      );
      expect(op.type).toBe(InstrumentationType.NETWORK_INTERCEPT);
    });

    it('registers function trace', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(
        session.id,
        InstrumentationType.FUNCTION_TRACE,
        'CryptoJS.AES.encrypt',
        {},
      );
      expect(op.type).toBe(InstrumentationType.FUNCTION_TRACE);
    });

    it('associates operation with session and increments count', () => {
      const session = manager.createSession();
      manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'x', {});
      manager.registerOperation(session.id, InstrumentationType.FUNCTION_TRACE, 'y', {});
      const updated = manager.getSession(session.id)!;
      expect(updated.operationCount).toBe(2);
    });

    it('throws for non-existent session', () => {
      expect(() =>
        manager.registerOperation('no-such-id', InstrumentationType.RUNTIME_HOOK, 'x', {}),
      ).toThrow();
    });
  });

  // ── Artifact Production ──

  describe('artifacts', () => {
    it('records artifact with hook data', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'fn', {});
      const artifact = manager.recordArtifact(op.id, {
        args: [1, 'hello'],
        returnValue: 42,
        callStack: 'fn@main.js:10',
      });
      expect(artifact.operationId).toBe(op.id);
      expect(artifact.sessionId).toBe(session.id);
      expect(artifact.type).toBe(InstrumentationType.RUNTIME_HOOK);
      expect(artifact.data.args).toEqual([1, 'hello']);
      expect(artifact.data.returnValue).toBe(42);
    });

    it('records artifact with intercept data', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(
        session.id,
        InstrumentationType.NETWORK_INTERCEPT,
        'api',
        {},
      );
      const artifact = manager.recordArtifact(op.id, {
        url: 'https://api.example.com/login',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { user: 'test' },
      });
      expect(artifact.data.url).toBe('https://api.example.com/login');
      expect(artifact.data.method).toBe('POST');
    });

    it('records artifact with trace data', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(
        session.id,
        InstrumentationType.FUNCTION_TRACE,
        'enc',
        {},
      );
      const artifact = manager.recordArtifact(op.id, {
        functionName: 'encrypt',
        executionTimeMs: 12.5,
      });
      expect(artifact.data.functionName).toBe('encrypt');
      expect(artifact.data.executionTimeMs).toBe(12.5);
    });

    it('records artifact with inject data', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(
        session.id,
        InstrumentationType.BEFORE_LOAD_INJECT,
        'script',
        {},
      );
      const artifact = manager.recordArtifact(op.id, {
        scriptContent: 'window.x = 1;',
        injectionPoint: 'before-load',
      });
      expect(artifact.data.scriptContent).toBe('window.x = 1;');
      expect(artifact.data.injectionPoint).toBe('before-load');
    });

    it('getArtifacts returns all artifacts for a session', () => {
      const session = manager.createSession();
      const op1 = manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'a', {});
      const op2 = manager.registerOperation(
        session.id,
        InstrumentationType.FUNCTION_TRACE,
        'b',
        {},
      );
      manager.recordArtifact(op1.id, { args: [1] });
      manager.recordArtifact(op2.id, { functionName: 'x' });
      expect(manager.getArtifacts(session.id)).toHaveLength(2);
    });

    it('getArtifacts filters by operation type', () => {
      const session = manager.createSession();
      const op1 = manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'a', {});
      const op2 = manager.registerOperation(
        session.id,
        InstrumentationType.FUNCTION_TRACE,
        'b',
        {},
      );
      manager.recordArtifact(op1.id, { args: [1] });
      manager.recordArtifact(op2.id, { functionName: 'x' });
      const hooks = manager.getArtifacts(session.id, InstrumentationType.RUNTIME_HOOK);
      expect(hooks).toHaveLength(1);
      expect(hooks[0]!.type).toBe(InstrumentationType.RUNTIME_HOOK);
    });

    it('increments session artifact count', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'x', {});
      manager.recordArtifact(op.id, { args: [] });
      manager.recordArtifact(op.id, { args: [] });
      expect(manager.getSession(session.id)!.artifactCount).toBe(2);
    });
  });

  // ── Session Query ──

  describe('query', () => {
    it('getSession returns session by id', () => {
      const session = manager.createSession('test');
      const found = manager.getSession(session.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('test');
    });

    it('getSession returns undefined for non-existent id', () => {
      expect(manager.getSession('nope')).toBeUndefined();
    });

    it('getSessionOperations returns operations for session', () => {
      const session = manager.createSession();
      manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'a', {});
      manager.registerOperation(session.id, InstrumentationType.FUNCTION_TRACE, 'b', {});
      const ops = manager.getSessionOperations(session.id);
      expect(ops).toHaveLength(2);
      expect(ops[0]!.target).toBe('a');
    });

    it('getSessionStats returns operation count and artifact count', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'x', {});
      manager.recordArtifact(op.id, { args: [] });
      const stats = manager.getSessionStats(session.id);
      expect(stats).toEqual({ operationCount: 1, artifactCount: 1 });
    });
  });

  describe('integrations', () => {
    it('applies hook presets through the session and records a runtime hook artifact', async () => {
      const session = manager.createSession('preset-session');
      const hookPresetHandlers = {
        handleHookPreset: async () =>
          jsonToolResponse({
            success: true,
            injected: ['webassembly-full'],
            failed: [],
            method: 'evaluateOnNewDocument',
          }),
      };

      const result = await manager.applyHookPreset(session.id, hookPresetHandlers, {
        preset: 'webassembly-full',
        method: 'evaluateOnNewDocument',
      });

      expect(result.operation.type).toBe(InstrumentationType.RUNTIME_HOOK);
      expect(result.operation.status).toBe('completed');
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]!.data.presetIds).toEqual(['webassembly-full']);
      expect(result.artifacts[0]!.data.injectionPoint).toBe('before-load');
    });

    it('marks hook preset operations failed when nothing is injected', async () => {
      const session = manager.createSession('failed-preset-session');
      const hookPresetHandlers = {
        handleHookPreset: async () =>
          jsonToolResponse({
            success: false,
            injected: [],
            failed: [{ preset: 'missing', error: 'not found' }],
          }),
      };

      const result = await manager.applyHookPreset(session.id, hookPresetHandlers, {
        preset: 'missing',
      });

      expect(result.operation.status).toBe('failed');
      expect(result.artifacts).toHaveLength(0);
      expect(result.payload.failed).toEqual([{ preset: 'missing', error: 'not found' }]);
    });

    it('replays a captured network request through the session and records replay artifacts', async () => {
      const session = manager.createSession('replay-session');
      const advancedHandlers = {
        handleNetworkReplayRequest: async () =>
          jsonToolResponse({
            success: true,
            dryRun: false,
            requestId: 'req-1',
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            body: '{"ok":true}',
            bodyTruncated: false,
          }),
      };

      const result = await manager.replayNetworkRequest(session.id, advancedHandlers, {
        requestId: 'req-1',
        methodOverride: 'POST',
        urlOverride: 'https://example.com/api/login',
        dryRun: false,
      });

      expect(result.operation.type).toBe(InstrumentationType.NETWORK_INTERCEPT);
      expect(result.operation.status).toBe('completed');
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]!.data.requestId).toBe('req-1');
      expect(result.artifacts[0]!.data.statusCode).toBe(200);
      expect(result.artifacts[0]!.data.replayMode).toBe('live');
    });

    it('records dry-run replay previews as artifacts', async () => {
      const session = manager.createSession('replay-dry-run');
      const advancedHandlers = {
        handleNetworkReplayRequest: async () =>
          jsonToolResponse({
            success: true,
            dryRun: true,
            preview: {
              url: 'https://example.com/api/login',
              method: 'POST',
              headers: { authorization: 'Bearer abc' },
              body: '{"user":"alice"}',
            },
          }),
      };

      const result = await manager.replayNetworkRequest(session.id, advancedHandlers, {
        requestId: 'req-2',
        dryRun: true,
      });

      expect(result.operation.status).toBe('completed');
      expect(result.artifacts[0]!.data.replayMode).toBe('dry-run');
      expect(result.artifacts[0]!.data.url).toBe('https://example.com/api/login');
    });

    it('builds session snapshots for resources and exports', () => {
      const session = manager.createSession('snapshot');
      const op = manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'x', {});
      manager.recordArtifact(op.id, { args: [1] });

      const snapshot = manager.getSessionSnapshot(session.id);

      expect(snapshot).toBeDefined();
      expect(snapshot!.session.id).toBe(session.id);
      expect(snapshot!.operations).toHaveLength(1);
      expect(snapshot!.artifacts).toHaveLength(1);
      expect(manager.listSessionSnapshots()).toHaveLength(1);
    });
  });
});
