import type { MemoryScanSessionManager } from '@native/MemoryScanSession';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { requireStringArg } from './validation';

const TOOL_SCAN_SESSION = 'memory_scan_session';

export class SessionHandlers {
  constructor(private readonly sessionManager: MemoryScanSessionManager) {}

  async handleScanList(_args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessions = this.sessionManager.listSessions();
      return { sessions, count: sessions.length };
    });
  }

  async handleScanDelete(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = requireStringArg(args.sessionId, 'sessionId', TOOL_SCAN_SESSION);
      return { deleted: this.sessionManager.deleteSession(sessionId) };
    });
  }

  async handleScanExport(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = requireStringArg(args.sessionId, 'sessionId', TOOL_SCAN_SESSION);
      return { exportedData: this.sessionManager.exportSession(sessionId) };
    });
  }
}
