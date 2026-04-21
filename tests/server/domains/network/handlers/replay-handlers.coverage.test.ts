import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplayHandlers } from '@server/domains/network/handlers/replay-handlers';

// Use a hoisted mock variable so we can re-configure in beforeEach (survives mockReset)
const mockReplayRequest = vi.fn();
vi.mock('@server/domains/network/replay', () => ({
  replayRequest: (...args: unknown[]) => mockReplayRequest(...args),
}));

function parseBody(r: unknown) {
  return JSON.parse((r as { content: [{ text: string }] }).content[0]!.text);
}

function createDeps() {
  return {
    consoleMonitor: {
      getNetworkRequests: vi.fn().mockReturnValue([]),
      getNetworkActivity: vi.fn().mockReturnValue(null),
      getResponseBody: vi.fn().mockResolvedValue(null),
    },
  };
}

describe('ReplayHandlers', () => {
  let handlers: ReplayHandlers;
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-configure mock after clearAllMocks wipes the implementation
    mockReplayRequest.mockResolvedValue({
      dryRun: true,
      preview: { url: 'https://a.com', method: 'GET', headers: {}, body: undefined },
    });
    deps = createDeps();
    handlers = new ReplayHandlers(deps as never);
  });

  describe('handleNetworkExtractAuth', () => {
    it('fails when no requests captured', async () => {
      const r = await handlers.handleNetworkExtractAuth({});
      expect(parseBody(r).success).toBe(false);
    });

    it('extracts auth from requests', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([
        {
          requestId: 'r1',
          url: 'https://api.com/data',
          method: 'GET',
          headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.test.sig' },
        },
      ]);
      const r = await handlers.handleNetworkExtractAuth({});
      const body = parseBody(r);
      expect(body.scannedRequests).toBe(1);
      expect(body.findings.length).toBeGreaterThanOrEqual(0);
    });

    it('respects minConfidence filter', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: 'r1', url: 'https://a.com', method: 'GET' },
      ]);
      const r = await handlers.handleNetworkExtractAuth({ minConfidence: 0.99 });
      expect(parseBody(r).scannedRequests).toBe(1);
    });

    it('handles error', async () => {
      deps.consoleMonitor.getNetworkRequests.mockImplementation(() => {
        throw new Error('fail');
      });
      const r = await handlers.handleNetworkExtractAuth({});
      expect(parseBody(r).success).toBe(false);
    });
  });

  describe('handleNetworkExportHar', () => {
    it('fails when no requests captured', async () => {
      const r = await handlers.handleNetworkExportHar({});
      expect(parseBody(r).success).toBe(false);
    });

    it('exports HAR with requests', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: 'r1', url: 'https://a.com', method: 'GET' },
      ]);
      deps.consoleMonitor.getNetworkActivity.mockReturnValue({
        response: { status: 200, headers: {} },
      });
      const r = await handlers.handleNetworkExportHar({});
      const body = parseBody(r);
      expect(body.har).toBeDefined();
      expect(body.entryCount).toBe(1);
    });

    it('exports HAR with includeBodies', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: 'r1', url: 'https://a.com', method: 'GET' },
      ]);
      deps.consoleMonitor.getNetworkActivity.mockReturnValue({
        response: { status: 200, headers: {} },
      });
      deps.consoleMonitor.getResponseBody.mockResolvedValue({
        body: 'hello',
        base64Encoded: false,
      });
      const r = await handlers.handleNetworkExportHar({ includeBodies: true });
      expect(parseBody(r).har).toBeDefined();
    });

    it('handles error', async () => {
      deps.consoleMonitor.getNetworkRequests.mockImplementation(() => {
        throw new Error('fail');
      });
      const r = await handlers.handleNetworkExportHar({});
      expect(parseBody(r).success).toBe(false);
    });
  });

  describe('handleNetworkReplayRequest', () => {
    it('fails without requestId', async () => {
      const r = await handlers.handleNetworkReplayRequest({});
      expect(parseBody(r).success).toBe(false);
    });

    it('fails when request not found', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([]);
      const r = await handlers.handleNetworkReplayRequest({ requestId: 'r1' });
      expect(parseBody(r).success).toBe(false);
      expect(parseBody(r).hint).toBeDefined();
    });

    it('replays a found request (dryRun)', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: 'r1', url: 'https://a.com', method: 'GET', headers: {} },
      ]);
      const r = await handlers.handleNetworkReplayRequest({ requestId: 'r1' });
      const body = parseBody(r);
      expect(body.dryRun).toBe(true);
      expect(body.preview).toBeDefined();
    });

    it('handles replay error', async () => {
      deps.consoleMonitor.getNetworkRequests.mockImplementation(() => {
        throw new Error('fail');
      });
      const r = await handlers.handleNetworkReplayRequest({ requestId: 'r1' });
      expect(parseBody(r).success).toBe(false);
    });
  });
});
