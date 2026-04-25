/**
 * electron_ipc_sniff — Intercept Electron IPC messages via CDP injection.
 *
 * Injects a preload-style hook into the renderer process via CDP to
 * instrument ipcRenderer.invoke / send / sendSync, capturing channel
 * names and arguments. Messages are buffered and can be dumped on demand.
 *
 * EADV-03: IPC sniffing probe.
 */

import {
  toTextResponse,
  toErrorResponse,
  parseStringArg,
} from '@server/domains/platform/handlers/platform-utils';

// ── IPC capture session tracking ──

interface IPCMessage {
  timestamp: number;
  method: string; // invoke | send | sendSync
  channel: string;
  args: unknown[];
}

interface IPCSniffSession {
  id: string;
  port: number;
  wsUrl: string;
  messages: IPCMessage[];
  startedAt: number;
  active: boolean;
}

const ipcSessions = new Map<string, IPCSniffSession>();

export function getElectronIPCSniffRuntimeCapability(): {
  available: boolean;
  reason?: string;
  fix?: string;
} {
  if (typeof globalThis.WebSocket === 'function') {
    return { available: true };
  }

  return {
    available: false,
    reason: 'Global WebSocket is not available in this Node runtime.',
    fix: 'Use Node.js 21+ or provide a WebSocket-compatible runtime.',
  };
}

/**
 * The JS payload injected into the renderer to hook ipcRenderer methods.
 * Uses CDP Runtime.evaluate to execute in the page context.
 */
const IPC_HOOK_PAYLOAD = `
(function() {
  if (window.__ipcSnifferInstalled) return 'already_installed';

  const captured = [];
  window.__ipcSnifferCaptured = captured;
  window.__ipcSnifferInstalled = true;

  // Try to access ipcRenderer from contextBridge-exposed API or require
  let ipcRenderer = null;

  // Method 1: Direct require (works if nodeIntegration is enabled)
  try {
    ipcRenderer = require('electron').ipcRenderer;
  } catch(e) {}

  // Method 2: window.electron (common contextBridge pattern)
  if (!ipcRenderer && window.electron && window.electron.ipcRenderer) {
    ipcRenderer = window.electron.ipcRenderer;
  }

  if (!ipcRenderer) {
    return 'ipcRenderer_not_accessible';
  }

  // Hook invoke
  const origInvoke = ipcRenderer.invoke.bind(ipcRenderer);
  ipcRenderer.invoke = function(channel, ...args) {
    captured.push({
      timestamp: Date.now(),
      method: 'invoke',
      channel: channel,
      args: args.map(a => {
        try { return JSON.parse(JSON.stringify(a)); }
        catch { return String(a); }
      })
    });
    return origInvoke(channel, ...args);
  };

  // Hook send
  const origSend = ipcRenderer.send.bind(ipcRenderer);
  ipcRenderer.send = function(channel, ...args) {
    captured.push({
      timestamp: Date.now(),
      method: 'send',
      channel: channel,
      args: args.map(a => {
        try { return JSON.parse(JSON.stringify(a)); }
        catch { return String(a); }
      })
    });
    return origSend(channel, ...args);
  };

  // Hook sendSync
  if (ipcRenderer.sendSync) {
    const origSendSync = ipcRenderer.sendSync.bind(ipcRenderer);
    ipcRenderer.sendSync = function(channel, ...args) {
      captured.push({
        timestamp: Date.now(),
        method: 'sendSync',
        channel: channel,
        args: args.map(a => {
          try { return JSON.parse(JSON.stringify(a)); }
          catch { return String(a); }
        })
      });
      return origSendSync(channel, ...args);
    };
  }

  return 'hooks_installed';
})();
`;

/**
 * JS payload to dump captured messages from the renderer.
 */
const IPC_DUMP_PAYLOAD = `
(function() {
  const captured = window.__ipcSnifferCaptured || [];
  const result = JSON.stringify(captured);
  return result;
})();
`;

/**
 * JS payload to clear captured messages.
 */
const IPC_CLEAR_PAYLOAD = `
(function() {
  if (window.__ipcSnifferCaptured) {
    const count = window.__ipcSnifferCaptured.length;
    window.__ipcSnifferCaptured.length = 0;
    return String(count);
  }
  return '0';
})();
`;

/**
 * Execute a CDP command via HTTP.
 */
async function cdpEvaluate(
  wsDebuggerUrl: string,
  expression: string,
): Promise<{ ok: boolean; result?: string; error?: string }> {
  // Extract host:port from ws URL
  const match = wsDebuggerUrl.match(/ws:\/\/([\d.]+:\d+)\//);
  if (!match?.[1]) {
    return { ok: false, error: `Invalid wsDebuggerUrl: ${wsDebuggerUrl}` };
  }
  const hostPort = match[1];

  // Get page targets
  try {
    const listRes = await fetch(`http://${hostPort}/json`, {
      signal: AbortSignal.timeout(5000),
    });
    const targets = (await listRes.json()) as Array<{
      id: string;
      type: string;
      webSocketDebuggerUrl?: string;
    }>;

    const page = targets.find((t) => t.type === 'page');
    if (!page) {
      return { ok: false, error: 'No page target found' };
    }

    // Use WebSocket-based CDP for evaluation
    const pageWsUrl = page.webSocketDebuggerUrl;
    if (!pageWsUrl) {
      return { ok: false, error: 'Page target has no WebSocket debugger URL' };
    }

    // Minimal WebSocket CDP call
    return await cdpEvalViaWs(pageWsUrl, expression);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Minimal WebSocket CDP Runtime.evaluate call.
 */
function cdpEvalViaWs(
  wsUrl: string,
  expression: string,
): Promise<{ ok: boolean; result?: string; error?: string }> {
  // Dynamic import WebSocket to avoid hard dependency
  return new Promise((resolve) => {
    try {
      const runtimeCapability = getElectronIPCSniffRuntimeCapability();
      if (!runtimeCapability.available) {
        resolve({
          ok: false,
          error: `${runtimeCapability.reason} ${runtimeCapability.fix ?? ''}`.trim(),
        });
        return;
      }
      const WS = globalThis.WebSocket!;

      const ws = new WS(wsUrl);
      const timeout = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        resolve({ ok: false, error: 'CDP WebSocket timeout (10s)' });
      }, 10_000);

      ws.addEventListener('open', () => {
        ws.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {
              expression,
              returnByValue: true,
              awaitPromise: false,
            },
          }),
        );
      });

      ws.addEventListener('message', (event: MessageEvent) => {
        clearTimeout(timeout);
        try {
          const data = JSON.parse(String(event.data)) as {
            id: number;
            result?: { result?: { value?: unknown }; exceptionDetails?: { text: string } };
          };
          if (data.result?.exceptionDetails) {
            resolve({ ok: false, error: data.result.exceptionDetails.text });
          } else {
            resolve({ ok: true, result: String(data.result?.result?.value ?? '') });
          }
        } catch (e) {
          resolve({ ok: false, error: `Parse error: ${e}` });
        }
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      });

      ws.addEventListener('error', (err: Event) => {
        clearTimeout(timeout);
        resolve({ ok: false, error: `WebSocket error: ${err}` });
      });
    } catch (error) {
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export async function handleElectronIPCSniff(
  args: Record<string, unknown>,
): Promise<ReturnType<typeof toTextResponse>> {
  try {
    const action = parseStringArg(args, 'action') ?? 'guide';

    if (action === 'start') {
      const port = (args.port as number | undefined) ?? 9222;
      const sessionId = `ipc-sniff-${port}-${Date.now()}`;

      // Discover renderer CDP endpoint
      let wsUrl: string;
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
          signal: AbortSignal.timeout(5000),
        });
        const info = (await res.json()) as { webSocketDebuggerUrl?: string };
        wsUrl = info.webSocketDebuggerUrl ?? `ws://127.0.0.1:${port}/devtools/browser`;
      } catch {
        return toTextResponse({
          success: false,
          tool: 'electron_ipc_sniff',
          error: `Cannot connect to CDP at port ${port}. Ensure Electron is launched with --remote-debugging-port=${port}.`,
          hint: 'Use electron_launch_debug to start the app with CDP enabled.',
        });
      }

      // Inject IPC hooks
      const injectResult = await cdpEvaluate(wsUrl, IPC_HOOK_PAYLOAD);

      if (!injectResult.ok) {
        return toTextResponse({
          success: false,
          tool: 'electron_ipc_sniff',
          error: `Failed to inject IPC hooks: ${injectResult.error}`,
          hint: 'The renderer may have contextIsolation enabled. Try injecting via main process CDP instead.',
        });
      }

      const session: IPCSniffSession = {
        id: sessionId,
        port,
        wsUrl,
        messages: [],
        startedAt: Date.now(),
        active: true,
      };

      ipcSessions.set(sessionId, session);

      return toTextResponse({
        success: true,
        tool: 'electron_ipc_sniff',
        action: 'start',
        sessionId,
        port,
        hookStatus: injectResult.result,
        usage: {
          dump: `electron_ipc_sniff(action="dump", sessionId="${sessionId}")`,
          stop: `electron_ipc_sniff(action="stop", sessionId="${sessionId}")`,
        },
        note:
          injectResult.result === 'ipcRenderer_not_accessible'
            ? 'ipcRenderer not accessible — contextIsolation may be enabled. IPC hooking requires nodeIntegration or a custom preload.'
            : 'IPC hooks installed. Interact with the app, then use dump to retrieve captured messages.',
      });
    }

    if (action === 'dump') {
      const sessionId = parseStringArg(args, 'sessionId');
      const port = args.port as number | undefined;
      const clear = (args.clear as boolean | undefined) !== false;

      // Find session
      let session: IPCSniffSession | undefined;
      if (sessionId) {
        session = ipcSessions.get(sessionId);
      } else if (port) {
        session = Array.from(ipcSessions.values()).find((s) => s.port === port);
      } else {
        // Use most recent session
        const sessions = Array.from(ipcSessions.values());
        session = sessions[sessions.length - 1];
      }

      if (!session) {
        return toTextResponse({
          success: false,
          tool: 'electron_ipc_sniff',
          error: 'No active IPC sniff session found.',
          activeSessions: Array.from(ipcSessions.keys()),
          hint: 'Start a session first: electron_ipc_sniff(action="start", port=9222)',
        });
      }

      // Dump from renderer
      const dumpResult = await cdpEvaluate(session.wsUrl, IPC_DUMP_PAYLOAD);

      if (!dumpResult.ok) {
        return toTextResponse({
          success: false,
          tool: 'electron_ipc_sniff',
          error: `Failed to dump IPC messages: ${dumpResult.error}`,
        });
      }

      let messages: IPCMessage[] = [];
      try {
        messages = JSON.parse(dumpResult.result ?? '[]') as IPCMessage[];
      } catch {
        messages = [];
      }

      // Clear after dump if requested
      if (clear && messages.length > 0) {
        await cdpEvaluate(session.wsUrl, IPC_CLEAR_PAYLOAD);
      }

      // Summarize by channel
      const channelSummary: Record<string, number> = {};
      for (const msg of messages) {
        channelSummary[msg.channel] = (channelSummary[msg.channel] ?? 0) + 1;
      }

      return toTextResponse({
        success: true,
        tool: 'electron_ipc_sniff',
        action: 'dump',
        sessionId: session.id,
        messageCount: messages.length,
        channelSummary,
        messages: messages.slice(0, 200), // Cap at 200 for context
        cleared: clear,
        note:
          messages.length > 200
            ? `Showing first 200 of ${messages.length} messages. Use dump repeatedly for ongoing capture.`
            : undefined,
      });
    }

    if (action === 'stop') {
      const sessionId = parseStringArg(args, 'sessionId');
      if (!sessionId) {
        return toTextResponse({
          success: false,
          tool: 'electron_ipc_sniff',
          error: 'sessionId is required for stop.',
          activeSessions: Array.from(ipcSessions.keys()),
        });
      }

      const session = ipcSessions.get(sessionId);
      if (!session) {
        return toTextResponse({
          success: false,
          tool: 'electron_ipc_sniff',
          error: `Session not found: ${sessionId}`,
        });
      }

      session.active = false;
      ipcSessions.delete(sessionId);

      return toTextResponse({
        success: true,
        tool: 'electron_ipc_sniff',
        action: 'stop',
        sessionId,
        message: 'IPC sniff session stopped.',
        uptime: Math.round((Date.now() - session.startedAt) / 1000),
      });
    }

    if (action === 'list') {
      const sessions = Array.from(ipcSessions.entries()).map(([id, s]) => ({
        sessionId: id,
        port: s.port,
        active: s.active,
        uptime: Math.round((Date.now() - s.startedAt) / 1000),
      }));

      return toTextResponse({
        success: true,
        tool: 'electron_ipc_sniff',
        action: 'list',
        sessions,
        count: sessions.length,
      });
    }

    // action === 'guide'
    return toTextResponse({
      success: true,
      guide: {
        what: 'Electron IPC sniffer — intercepts ipcRenderer.invoke/send/sendSync messages via CDP injection.',
        workflow: [
          '1. Launch Electron with: electron_launch_debug(exePath="...")',
          '2. Start sniffing: electron_ipc_sniff(action="start", port=9222)',
          '3. Interact with the app to trigger IPC messages',
          '4. Dump captured: electron_ipc_sniff(action="dump", sessionId="...")',
          '5. Stop when done: electron_ipc_sniff(action="stop", sessionId="...")',
        ],
        actions: ['start', 'dump', 'stop', 'list', 'guide'],
        limitations: [
          'Requires renderer CDP port (--remote-debugging-port)',
          'contextIsolation=true may block direct ipcRenderer access',
          'Main process IPC (ipcMain) is captured indirectly through renderer-side hooks',
        ],
      },
    });
  } catch (error) {
    return toErrorResponse('electron_ipc_sniff', error);
  }
}
