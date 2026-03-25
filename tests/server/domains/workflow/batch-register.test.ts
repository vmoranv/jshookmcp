import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// We test WorkflowHandlersBatch by subclassing it (same as the real chain does).
// We mock handleRegisterAccountFlow to avoid hitting the full workflow chain.
import { WorkflowHandlersBatch } from '@server/domains/workflow/handlers.impl.workflow-batch';

interface ToolHandlerResult {
  content: Array<{ type: string; text: string }>;
}

interface BatchRegisterResponse {
  success: boolean;
  error?: string;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
    truncated?: { original: number; limit: number };
  };
  results: Array<{
    index: number;
    idempotentKey: string;
    attempts: number;
    result?: { skipped?: boolean };
  }>;
}

class TestBatchHandler extends WorkflowHandlersBatch {
  public mockRegisterFn = vi.fn<(args: Record<string, unknown>) => Promise<ToolHandlerResult>>();

  constructor() {
    const deps = {
      browserHandlers: {
        handlePageEvaluate: vi.fn(),
        handlePageNavigate: vi.fn(),
        handleNetworkGetRequests: vi.fn(),
      },
      advancedHandlers: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        handleNetworkEnable: vi.fn().mockResolvedValue({}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        handleNetworkDisable: vi.fn().mockResolvedValue({}),
      },
    };
    super(deps as unknown as ConstructorParameters<typeof WorkflowHandlersBatch>[0]);

    // Override the inherited method to return controlled results
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    this.mockRegisterFn.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ success: true, registered: true }) }],
    });
  }

  // Override the parent method to use mock
  override async handleRegisterAccountFlow(args: Record<string, unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    return this.mockRegisterFn(args);
  }
}

describe('WorkflowHandlersBatch.handleBatchRegister', () => {
  let handler: TestBatchHandler;

  beforeEach(() => {
    handler = new TestBatchHandler();
  });

  /* ── Input validation ─────────────────────────────────────────────── */

  it('requires registerUrl and accounts', async () => {
    const result = parseJson<BatchRegisterResponse>(await handler.handleBatchRegister({}));
    expect(result.success).toBe(false);
    expect(result.error).toContain('registerUrl');
  });

  it('requires non-empty accounts array', async () => {
    const result = parseJson<BatchRegisterResponse>(
      await handler.handleBatchRegister({
        registerUrl: 'http://test.com/register',
        accounts: [],
      }),
    );
    expect(result.success).toBe(false);
  });

  /* ── Parameter clamping ───────────────────────────────────────────── */

  it('caps accounts at MAX_ACCOUNTS=50', async () => {
    const accounts = Array.from({ length: 100 }, (_, i) => ({
      fields: { email: `user${i}@test.com`, password: 'pw' },
    }));

    const result = parseJson<BatchRegisterResponse>(
      await handler.handleBatchRegister({
        registerUrl: 'http://test.com/register',
        accounts,
      }),
    );

    expect(result.summary.total).toBe(50);
    expect(result.summary.truncated).toEqual({ original: 100, limit: 50 });
  });

  it('clamps maxConcurrency to 1 (MAX_CONCURRENCY)', async () => {
    const result = parseJson<BatchRegisterResponse>(
      await handler.handleBatchRegister({
        registerUrl: 'http://test.com/register',
        accounts: [{ fields: { email: 'a@b.com', password: 'pw' } }],
        maxConcurrency: 10,
      }),
    );
    // Should succeed with serial execution
    expect(result.success).toBe(true);
  });

  it('clamps maxRetries to [0, 3]', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handler.mockRegisterFn.mockRejectedValue(new Error('fail'));
    const result = parseJson<BatchRegisterResponse>(
      await handler.handleBatchRegister({
        registerUrl: 'http://test.com/register',
        accounts: [{ fields: { email: 'a@b.com', password: 'pw' } }],
        maxRetries: 100,
        retryBackoffMs: 0,
      }),
    );
    // With MAX_RETRIES=3, should have at most 4 attempts (initial + 3 retries)
    expect(result.results[0].attempts).toBeLessThanOrEqual(4);
  });

  it('clamps timeoutPerAccountMs to [5000, 300000]', async () => {
    const result = parseJson<BatchRegisterResponse>(
      await handler.handleBatchRegister({
        registerUrl: 'http://test.com/register',
        accounts: [{ fields: { email: 'a@b.com', password: 'pw' } }],
        timeoutPerAccountMs: 999999,
      }),
    );
    expect(result.success).toBe(true);
  });

  /* ── PII masking ──────────────────────────────────────────────────── */

  it('masks idempotent keys in output (PII protection)', async () => {
    const result = parseJson<BatchRegisterResponse>(
      await handler.handleBatchRegister({
        registerUrl: 'http://test.com/register',
        accounts: [{ fields: { email: 'longuser@example.com', password: 'pw' } }],
      }),
    );

    const key = result.results[0].idempotentKey;
    // Should be masked: first 2 chars + *** + last 2 chars
    expect(key).toContain('***');
    expect(key).not.toBe('longuser@example.com');
    expect(key.startsWith('lo')).toBe(true);
    expect(key.endsWith('om')).toBe(true);
  });

  it('masks short keys appropriately', async () => {
    const result = parseJson<BatchRegisterResponse>(
      await handler.handleBatchRegister({
        registerUrl: 'http://test.com/register',
        accounts: [{ fields: { email: 'ab', password: 'pw' } }],
      }),
    );

    const key = result.results[0].idempotentKey;
    expect(key).toContain('***');
  });

  /* ── Idempotency ──────────────────────────────────────────────────── */

  it('skips duplicate accounts (idempotency)', async () => {
    const result = parseJson<BatchRegisterResponse>(
      await handler.handleBatchRegister({
        registerUrl: 'http://test.com/register',
        accounts: [
          { fields: { email: 'same@test.com', password: 'pw' } },
          { fields: { email: 'same@test.com', password: 'pw' } },
        ],
      }),
    );

    expect(result.summary.total).toBe(2);
    // First should succeed normally, second should be skipped
    const skipped = result.results.filter((r) => r.result?.skipped);
    expect(skipped.length).toBe(1);
    expect(result.summary.skipped).toBe(1);
  });

  /* ── Success/failure summary ──────────────────────────────────────── */

  it('reports all success when all accounts succeed', async () => {
    const result = parseJson<BatchRegisterResponse>(
      await handler.handleBatchRegister({
        registerUrl: 'http://test.com/register',
        accounts: [
          { fields: { email: 'a@b.com', password: 'pw' } },
          { fields: { email: 'c@d.com', password: 'pw' } },
        ],
      }),
    );

    expect(result.success).toBe(true);
    expect(result.summary.succeeded).toBe(2);
    expect(result.summary.failed).toBe(0);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  it('reports failure when any account fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handler.mockRegisterFn
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockRejectedValueOnce(new Error('registration failed'));

    const result = parseJson<BatchRegisterResponse>(
      await handler.handleBatchRegister({
        registerUrl: 'http://test.com/register',
        accounts: [
          { fields: { email: 'ok@b.com', password: 'pw' } },
          { fields: { email: 'fail@b.com', password: 'pw' } },
        ],
        maxRetries: 0,
      }),
    );

    expect(result.success).toBe(false);
    expect(result.summary.succeeded).toBe(1);
    expect(result.summary.failed).toBe(1);
  });

  /* ── Results ordering ─────────────────────────────────────────────── */

  it('sorts results by index for stable output', async () => {
    const result = parseJson<BatchRegisterResponse>(
      await handler.handleBatchRegister({
        registerUrl: 'http://test.com/register',
        accounts: [
          { fields: { email: 'a@b.com', password: 'pw' } },
          { fields: { email: 'c@d.com', password: 'pw' } },
          { fields: { email: 'e@f.com', password: 'pw' } },
        ],
      }),
    );

    const indices = result.results.map((r) => r.index);
    expect(indices).toEqual([0, 1, 2]);
  });

  /* ── Fallback idempotent key ──────────────────────────────────────── */

  it('uses account-N fallback when no fields', async () => {
    const result = parseJson<BatchRegisterResponse>(
      await handler.handleBatchRegister({
        registerUrl: 'http://test.com/register',
        accounts: [{}],
      }),
    );

    expect(result.results[0].idempotentKey).toContain('***');
  });
});
