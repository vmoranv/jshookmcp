import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CoordinationHandlers } from '@server/domains/coordination/index';
import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type {
  CreateTaskHandoffResponse,
  CompleteTaskHandoffResponse,
  GetTaskContextResponse,
  AppendSessionInsightResponse,
} from '@tests/server/domains/shared/common-test-types';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

describe('CoordinationHandlers', () => {
  const pageController = {
    getPage: vi.fn(),
  };

  let ctx: any;
  let handlers: CoordinationHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = { pageController };
    handlers = new CoordinationHandlers(ctx);
  });

  it('handleCreateTaskHandoff creates a new handoff', async () => {
    pageController.getPage.mockReturnValue({
      url: () => withPath(TEST_URLS.root, 'target'),
    });

    const body = (await handlers.handleCreateTaskHandoff({
      description: 'Test task',
      constraints: ['no-db'],
      targetDomain: 'browser',
    })) as unknown as CreateTaskHandoffResponse;

    expect(body.taskId).toBeDefined();
    expect(body.status).toBe('pending');
    expect(body.description).toBe('Test task');
    expect(body.constraints).toEqual(['no-db']);
    expect(body.targetDomain).toBe('browser');
    expect(body.pageUrl).toBe(withPath(TEST_URLS.root, 'target'));
    expect(body.totalActiveHandoffs).toBe(1);
  });

  it('handleCreateTaskHandoff works without active page', async () => {
    pageController.getPage.mockReturnValue(null);

    const body = (await handlers.handleCreateTaskHandoff({
      description: 'Test task no page',
    })) as unknown as CreateTaskHandoffResponse;

    expect(body.pageUrl).toBeUndefined();
  });

  it('handleCompleteTaskHandoff completes an existing handoff', async () => {
    // Create first
    const createRes = (await handlers.handleCreateTaskHandoff({
      description: 'To complete',
    })) as unknown as CreateTaskHandoffResponse;
    const taskId = createRes.taskId;

    // Complete
    const completeRes = (await handlers.handleCompleteTaskHandoff({
      taskId,
      summary: 'Task is done',
      keyFindings: ['found X'],
      artifacts: ['file.txt'],
    })) as unknown as CompleteTaskHandoffResponse;

    expect(completeRes.status).toBe('completed');
    expect(completeRes.summary).toBe('Task is done');
    expect(completeRes.keyFindings).toEqual(['found X']);
    expect(completeRes.artifacts).toEqual(['file.txt']);
    expect(completeRes.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('handleCompleteTaskHandoff throws error on invalid taskId', async () => {
    await expect(
      handlers.handleCompleteTaskHandoff({
        taskId: 'invalid',
        summary: 'done',
      }),
    ).rejects.toThrow(/Task handoff "invalid" not found/);
  });

  it('handleCompleteTaskHandoff throws error on already completed task', async () => {
    const createRes = (await handlers.handleCreateTaskHandoff({
      description: 'To complete twice',
    })) as unknown as CreateTaskHandoffResponse;
    const taskId = createRes.taskId;

    await handlers.handleCompleteTaskHandoff({ taskId, summary: 'done1' });

    await expect(
      handlers.handleCompleteTaskHandoff({
        taskId,
        summary: 'done2',
      }),
    ).rejects.toThrow(/is already completed/);
  });

  it('handleUpdateTaskHandoff updates status and metadata', async () => {
    const createRes = (await handlers.handleCreateTaskHandoff({
      description: 'Start me',
      constraints: ['initial'],
    })) as unknown as CreateTaskHandoffResponse;

    const updated = (await handlers.handleUpdateTaskHandoff({
      taskId: createRes.taskId,
      status: 'in_progress',
      description: 'Started',
      decision: 'Use browser state',
      risks: ['timeout'],
      nextSteps: ['inspect storage'],
    })) as any;

    expect(updated.previousStatus).toBe('pending');
    expect(updated.status).toBe('in_progress');
    expect(updated.description).toBe('Started');
    expect(updated.decision).toBe('Use browser state');
    expect(updated.risks).toEqual(['timeout']);
    expect(updated.nextSteps).toEqual(['inspect storage']);

    const context = (await handlers.handleGetTaskContext({})) as unknown as GetTaskContextResponse;
    expect(context.active?.[0]?.status).toBe('in_progress');
    expect(context.summary?.totalActive).toBe(1);
    expect(context.summary?.totalFailed).toBe(0);
  });

  it('handleUpdateTaskHandoff marks failed handoffs outside the active list', async () => {
    const createRes = (await handlers.handleCreateTaskHandoff({
      description: 'May fail',
    })) as unknown as CreateTaskHandoffResponse;

    const failed = (await handlers.handleUpdateTaskHandoff({
      taskId: createRes.taskId,
      status: 'failed',
      summary: 'Target page disappeared',
      keyFindings: ['page closed'],
      artifacts: ['artifacts/failure.json'],
    })) as any;

    expect(failed.status).toBe('failed');
    expect(failed.completedAt).toBeDefined();
    expect(failed.summary).toBe('Target page disappeared');

    const context = (await handlers.handleGetTaskContext({})) as unknown as GetTaskContextResponse;
    expect(context.active).toEqual([]);
    expect(context.failed?.[0]?.taskId).toBe(createRes.taskId);
    expect(context.failed?.[0]?.status).toBe('failed');
    expect(context.summary?.totalFailed).toBe(1);
  });

  it('handleUpdateTaskHandoff rejects completed handoff reopening', async () => {
    const createRes = (await handlers.handleCreateTaskHandoff({
      description: 'Done task',
    })) as unknown as CreateTaskHandoffResponse;

    await handlers.handleCompleteTaskHandoff({ taskId: createRes.taskId, summary: 'done' });

    await expect(
      handlers.handleUpdateTaskHandoff({
        taskId: createRes.taskId,
        status: 'in_progress',
      }),
    ).rejects.toThrow(/already completed and cannot be reopened/);
  });

  it('handleGetTaskContext returns specific handoff', async () => {
    const createRes = (await handlers.handleCreateTaskHandoff({
      description: 'ctx task',
    })) as unknown as CreateTaskHandoffResponse;

    const contextRes = (await handlers.handleGetTaskContext({
      taskId: createRes.taskId,
    })) as unknown as GetTaskContextResponse;
    expect(contextRes.handoff).toBeDefined();
    expect(contextRes.handoff?.description).toBe('ctx task');
  });

  it('handleGetTaskContext throws on nonexistent specific taskId', async () => {
    await expect(handlers.handleGetTaskContext({ taskId: 'missing' })).rejects.toThrow(
      /Task handoff "missing" not found/,
    );
  });

  it('handleAppendSessionInsight appends insight', async () => {
    const body = (await handlers.handleAppendSessionInsight({
      category: 'security',
      content: 'SQLi possible',
      confidence: 0.9,
    })) as unknown as AppendSessionInsightResponse;

    expect(body.insightId).toBeDefined();
    expect(body.category).toBe('security');
    expect(body.totalInsights).toBe(1);
    expect(body.totalByCategory['security']).toBe(1);
  });

  it('clamps and filters tagged session insights', async () => {
    await handlers.handleAppendSessionInsight({
      category: 'security',
      content: 'token in localStorage',
      confidence: 1.7,
      tags: ['auth', 'storage', 'auth'],
      severity: 'high',
      toolSource: 'browser',
    });
    await handlers.handleAppendSessionInsight({
      category: 'note',
      content: 'low signal observation',
      confidence: 0.3,
      tags: ['storage'],
      severity: 'low',
      toolSource: 'coordination',
    });

    const context = (await handlers.handleGetTaskContext({
      tag: 'auth',
      severity: 'high',
      minConfidence: 0.9,
    })) as unknown as GetTaskContextResponse;

    expect(context.sessionInsights).toHaveLength(1);
    expect(context.summary?.totalInsights).toBe(2);
    expect((context.summary as any)?.returnedInsights).toBe(1);
    expect(context.sessionInsights?.[0]).toEqual(
      expect.objectContaining({
        category: 'security',
        confidence: 1,
        tags: ['auth', 'storage'],
        severity: 'high',
        toolSource: 'browser',
      }),
    );
  });

  it('rejects invalid session insight severity values', async () => {
    await expect(
      handlers.handleAppendSessionInsight({
        category: 'security',
        content: 'invalid severity',
        severity: 'urgent',
      }),
    ).rejects.toThrow('Invalid severity');

    await handlers.handleAppendSessionInsight({
      category: 'security',
      content: 'valid severity',
      severity: 'high',
    });

    await expect(handlers.handleGetTaskContext({ severity: 'urgent' })).rejects.toThrow(
      'Invalid severity',
    );
  });

  it('handleGetTaskContext returns all handoffs and insights when taskId is omitted', async () => {
    await handlers.handleCreateTaskHandoff({ description: 'active task' });
    const completedTask = (await handlers.handleCreateTaskHandoff({
      description: 'finished task',
    })) as unknown as CreateTaskHandoffResponse;
    await handlers.handleCompleteTaskHandoff({ taskId: completedTask.taskId, summary: 'done' });

    await handlers.handleAppendSessionInsight({ category: 'test', content: 'test insight' });

    const contextRes = (await handlers.handleGetTaskContext(
      {},
    )) as unknown as GetTaskContextResponse;

    expect(contextRes.active?.length).toBe(1);
    expect(contextRes.completed?.length).toBe(1);
    expect(contextRes.sessionInsights?.length).toBe(1);
    expect(contextRes.summary?.totalActive).toBe(1);
    expect(contextRes.summary?.totalCompleted).toBe(1);
    expect(contextRes.summary?.totalInsights).toBe(1);
  });

  it('exports and restores handoff and insight snapshots', async () => {
    const notify = vi.fn();
    handlers.setPersistNotifier(notify);
    const created = (await handlers.handleCreateTaskHandoff({
      description: 'persist me',
      constraints: ['keep context'],
    })) as unknown as CreateTaskHandoffResponse;
    await handlers.handleAppendSessionInsight({
      category: 'finding',
      content: 'token lives in storage',
      confidence: 0.8,
      tags: ['auth', 'storage'],
      severity: 'medium',
      toolSource: 'browser',
    });

    expect(notify).toHaveBeenCalledTimes(2);
    expect(handlers.isPersistDirty()).toBe(true);
    const snapshot = handlers.exportSnapshot();
    expect(snapshot.handoffs).toHaveLength(1);
    expect(snapshot.insights).toHaveLength(1);

    handlers.markPersisted();
    expect(handlers.isPersistDirty()).toBe(false);

    const restored = new CoordinationHandlers(ctx);
    restored.restoreSnapshot(snapshot);
    expect(restored.isPersistDirty()).toBe(false);
    const restoredContext = (await restored.handleGetTaskContext(
      {},
    )) as unknown as GetTaskContextResponse;

    expect(restoredContext.active?.[0]?.taskId).toBe(created.taskId);
    expect(restoredContext.active?.[0]?.description).toBe('persist me');
    expect(restoredContext.sessionInsights?.[0]?.content).toBe('token lives in storage');
    expect(restoredContext.sessionInsights?.[0]).toEqual(
      expect.objectContaining({
        tags: ['auth', 'storage'],
        severity: 'medium',
        toolSource: 'browser',
      }),
    );
    expect((restoredContext.sessionInsights?.[0] as any)?.sourceTaskId).toBe(created.taskId);
  });

  it('ignores incompatible coordination snapshots', async () => {
    await handlers.handleCreateTaskHandoff({ description: 'keep existing' });

    handlers.restoreSnapshot({ schemaVersion: 99, handoffs: [], insights: [] });
    const context = (await handlers.handleGetTaskContext({})) as unknown as GetTaskContextResponse;

    expect(context.active?.length).toBe(1);
    expect(context.active?.[0]?.description).toBe('keep existing');
  });

  describe('ToolResponse wrappers', () => {
    it('wraps create_task_handoff without nesting an MCP content block', async () => {
      const body = parseJson<any>(
        await handlers.handleCreateTaskHandoffTool({
          description: 'wrapped handoff',
          targetDomain: 'browser',
        }),
      );

      expect(body.success).toBe(true);
      expect(body.taskId).toBeDefined();
      expect(body.description).toBe('wrapped handoff');
      expect(body.content).toBeUndefined();
    });

    it('converts thrown handoff errors into structured ToolResponse failures', async () => {
      const body = parseJson<any>(
        await handlers.handleCompleteTaskHandoffTool({
          taskId: 'missing',
          summary: 'not found',
        }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toContain('Task handoff "missing" not found');
      expect(body.message).toBe(body.error);
    });
  });
});
