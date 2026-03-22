import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CoordinationHandlers } from '@server/domains/coordination/index';
import type {
  CreateTaskHandoffResponse,
  CompleteTaskHandoffResponse,
  GetTaskContextResponse,
  AppendSessionInsightResponse,
} from '@tests/server/domains/shared/common-test-types';

describe('CoordinationHandlers', () => {
  const pageController = {
    getPage: vi.fn(),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  let ctx: any;
  let handlers: CoordinationHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = { pageController };
    handlers = new CoordinationHandlers(ctx);
  });

  it('handleCreateTaskHandoff creates a new handoff', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    pageController.getPage.mockReturnValue({
      url: () => 'https://example.com/target',
    });

    const body = await handlers.handleCreateTaskHandoff({
      description: 'Test task',
      constraints: ['no-db'],
      targetDomain: 'browser',
    }) as unknown as CreateTaskHandoffResponse;

    expect(body.taskId).toBeDefined();
    expect(body.status).toBe('pending');
    expect(body.description).toBe('Test task');
    expect(body.constraints).toEqual(['no-db']);
    expect(body.targetDomain).toBe('browser');
    expect(body.pageUrl).toBe('https://example.com/target');
    expect(body.totalActiveHandoffs).toBe(1);
  });

  it('handleCreateTaskHandoff works without active page', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    pageController.getPage.mockReturnValue(null);

    const body = await handlers.handleCreateTaskHandoff({
      description: 'Test task no page',
    }) as unknown as CreateTaskHandoffResponse;

    expect(body.pageUrl).toBeUndefined();
  });

  it('handleCompleteTaskHandoff completes an existing handoff', async () => {
    // Create first
    const createRes = await handlers.handleCreateTaskHandoff({ description: 'To complete' }) as unknown as CreateTaskHandoffResponse;
    const taskId = createRes.taskId;

    // Complete
    const completeRes = await handlers.handleCompleteTaskHandoff({
      taskId,
      summary: 'Task is done',
      keyFindings: ['found X'],
      artifacts: ['file.txt'],
    }) as unknown as CompleteTaskHandoffResponse;

    expect(completeRes.status).toBe('completed');
    expect(completeRes.summary).toBe('Task is done');
    expect(completeRes.keyFindings).toEqual(['found X']);
    expect(completeRes.artifacts).toEqual(['file.txt']);
    expect(completeRes.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('handleCompleteTaskHandoff throws error on invalid taskId', async () => {
    await expect(handlers.handleCompleteTaskHandoff({
      taskId: 'invalid',
      summary: 'done',
    })).rejects.toThrow(/Task handoff "invalid" not found/);
  });

  it('handleCompleteTaskHandoff throws error on already completed task', async () => {
    const createRes = await handlers.handleCreateTaskHandoff({ description: 'To complete twice' }) as unknown as CreateTaskHandoffResponse;
    const taskId = createRes.taskId;

    await handlers.handleCompleteTaskHandoff({ taskId, summary: 'done1' });

    await expect(handlers.handleCompleteTaskHandoff({
      taskId,
      summary: 'done2',
    })).rejects.toThrow(/is already completed/);
  });

  it('handleGetTaskContext returns specific handoff', async () => {
    const createRes = await handlers.handleCreateTaskHandoff({ description: 'ctx task' }) as unknown as CreateTaskHandoffResponse;
    
    const contextRes = await handlers.handleGetTaskContext({ taskId: createRes.taskId }) as unknown as GetTaskContextResponse;
    expect(contextRes.handoff).toBeDefined();
    expect(contextRes.handoff?.description).toBe('ctx task');
  });

  it('handleGetTaskContext throws on nonexistent specific taskId', async () => {
    await expect(handlers.handleGetTaskContext({ taskId: 'missing' })).rejects.toThrow(/Task handoff "missing" not found/);
  });

  it('handleAppendSessionInsight appends insight', async () => {
    const body = await handlers.handleAppendSessionInsight({
      category: 'security',
      content: 'SQLi possible',
      confidence: 0.9,
    }) as unknown as AppendSessionInsightResponse;

    expect(body.insightId).toBeDefined();
    expect(body.category).toBe('security');
    expect(body.totalInsights).toBe(1);
    expect(body.totalByCategory['security']).toBe(1);
  });

  it('handleGetTaskContext returns all handoffs and insights when taskId is omitted', async () => {
    await handlers.handleCreateTaskHandoff({ description: 'active task' });
    const completedTask = await handlers.handleCreateTaskHandoff({ description: 'finished task' }) as unknown as CreateTaskHandoffResponse;
    await handlers.handleCompleteTaskHandoff({ taskId: completedTask.taskId, summary: 'done' });
    
    await handlers.handleAppendSessionInsight({ category: 'test', content: 'test insight' });

    const contextRes = await handlers.handleGetTaskContext({}) as unknown as GetTaskContextResponse;

    expect(contextRes.active?.length).toBe(1);
    expect(contextRes.completed?.length).toBe(1);
    expect(contextRes.sessionInsights?.length).toBe(1);
    expect(contextRes.summary?.totalActive).toBe(1);
    expect(contextRes.summary?.totalCompleted).toBe(1);
    expect(contextRes.summary?.totalInsights).toBe(1);
  });
});

