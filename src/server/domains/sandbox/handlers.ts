/**
 * SandboxToolHandlers — Handles sandbox domain MCP tool calls.
 */

import { QuickJSSandbox } from '@server/sandbox/QuickJSSandbox';
import { MCPBridge } from '@server/sandbox/MCPBridge';
import { SessionScratchpad } from '@server/sandbox/SessionScratchpad';
import { executeWithRetry } from '@server/sandbox/AutoCorrectionLoop';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { SandboxOptions, SandboxResult } from '@server/sandbox/types';

export class SandboxToolHandlers {
  private readonly ctx: MCPServerContext;
  private readonly scratchpad = new SessionScratchpad();

  constructor(ctx: MCPServerContext) {
    this.ctx = ctx;
  }

  async handleExecuteSandboxScript(args: Record<string, unknown>): Promise<unknown> {
    const code = args.code as string;
    const sessionId = (args.sessionId as string | undefined) ?? undefined;
    const timeoutMs = (args.timeoutMs as number | undefined) ?? undefined;
    const autoCorrect = (args.autoCorrect as boolean | undefined) ?? false;

    if (!code || typeof code !== 'string') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: false, error: 'code parameter is required' }),
          },
        ],
      };
    }

    // Create a fresh sandbox for this execution
    const sandbox = new QuickJSSandbox();

    // Attach MCP bridge for tool invocation from sandbox
    const bridge = new MCPBridge(this.ctx);
    sandbox.setBridge(bridge);

    // Build sandbox options
    const options: SandboxOptions = {};
    if (timeoutMs !== undefined) {
      // SECURITY: Cap timeout to prevent DoS via infinite values
      const MAX_TIMEOUT = 30_000; // hard ceiling
      options.timeoutMs = Math.min(
        Math.max(1, Number.isFinite(timeoutMs) ? timeoutMs : 0),
        MAX_TIMEOUT,
      );
    }
    if (sessionId) {
      options.sessionId = sessionId;
      // Inject scratchpad state as globals
      const scratchpadState = this.scratchpad.getAll(sessionId);
      options.globals = {
        ...options.globals,
        __scratchpad: scratchpadState,
      };
    }

    let result: SandboxResult;

    if (autoCorrect) {
      result = await executeWithRetry(sandbox, code, options);
    } else {
      result = await sandbox.execute(code, options);
    }

    // Persist scratchpad updates if session is active
    if (sessionId && result.ok && result.output && typeof result.output === 'object') {
      const output = result.output as Record<string, unknown>;
      if (output.__scratchpad && typeof output.__scratchpad === 'object') {
        for (const [k, v] of Object.entries(output.__scratchpad as Record<string, unknown>)) {
          this.scratchpad.set(sessionId, k, v);
        }
      }
    }

    const summary = [
      `**Status:** ${result.ok ? '✓ Success' : '✗ Failed'}`,
      result.timedOut ? '**Timed out:** yes' : '',
      `**Duration:** ${result.durationMs}ms`,
      result.logs.length > 0
        ? `**Console output:**\n\`\`\`\n${result.logs.join('\n')}\n\`\`\``
        : '',
      result.output !== undefined ? `**Result:** ${JSON.stringify(result.output)}` : '',
      result.error ? `**Error:** ${result.error}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      content: [{ type: 'text', text: summary }],
    };
  }
}
