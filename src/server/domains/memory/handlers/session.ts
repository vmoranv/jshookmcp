/**
 * SessionHandlers — scan session lifecycle (list, delete, export).
 */
import type { MemoryScanSessionManager } from '@native/MemoryScanSession';

function toTextResponse(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function toErrorResponse(tool: string, error: unknown) {
  return toTextResponse({
    success: false,
    tool,
    error: error instanceof Error ? error.message : String(error),
  });
}

export class SessionHandlers {
  constructor(private readonly sessionManager: MemoryScanSessionManager) {}

  async handleScanList(_args: Record<string, unknown>) {
    try {
      const sessions = this.sessionManager.listSessions();
      return toTextResponse({ success: true, sessions, count: sessions.length });
    } catch (error) {
      return toErrorResponse('memory_scan_session', error);
    }
  }

  async handleScanDelete(args: Record<string, unknown>) {
    try {
      return toTextResponse({
        success: true,
        deleted: this.sessionManager.deleteSession(args.sessionId as string),
      });
    } catch (error) {
      return toErrorResponse('memory_scan_session', error);
    }
  }

  async handleScanExport(args: Record<string, unknown>) {
    try {
      return toTextResponse({
        success: true,
        exportedData: this.sessionManager.exportSession(args.sessionId as string),
      });
    } catch (error) {
      return toErrorResponse('memory_scan_session', error);
    }
  }
}
