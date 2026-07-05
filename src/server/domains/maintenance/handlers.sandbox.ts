/**
 * SandboxToolHandlers — QuickJS sandbox execution (merged from the former sandbox domain).
 */

import { QuickJSSandbox } from '@server/sandbox/QuickJSSandbox';
import { MCPBridge } from '@server/sandbox/MCPBridge';
import { SessionScratchpad } from '@server/sandbox/SessionScratchpad';
import { executeWithRetry } from '@server/sandbox/AutoCorrectionLoop';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { SandboxOptions, SandboxResult } from '@server/sandbox/types';
import {
  SANDBOX_MAX_MEMORY_LIMIT_MB,
  SANDBOX_MAX_TIMEOUT_MS,
  SANDBOX_MIN_MEMORY_LIMIT_BYTES,
} from '@src/constants';
import { redactSensitiveData, redactSensitiveString } from '@modules/security/RedactionService';

const MAX_MEMORY_LIMIT_BYTES = SANDBOX_MAX_MEMORY_LIMIT_MB * 1024 * 1024;

function errorResponse(error: string): unknown {
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error }) }],
  };
}

function clampPositiveNumber(value: unknown, min: number, max: number): number | string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 'value must be a finite number';
  }
  return Math.min(Math.max(min, Math.floor(numeric)), max);
}

function parseAllowedTools(value: unknown): readonly string[] | undefined | string {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return 'allowedTools must be an array of tool names';

  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      return 'allowedTools must contain only non-empty strings';
    }
    normalized.push(item.trim());
  }
  return [...new Set(normalized)];
}

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
    const memoryLimitBytes = (args.memoryLimitBytes as number | undefined) ?? undefined;
    const autoCorrect = (args.autoCorrect as boolean | undefined) ?? false;
    const redactOutput = (args.redactOutput as boolean | undefined) ?? true;

    if (!code || typeof code !== 'string') {
      return errorResponse('code parameter is required');
    }

    const allowedTools = parseAllowedTools(args.allowedTools);
    if (typeof allowedTools === 'string') {
      return errorResponse(allowedTools);
    }

    // Create a fresh sandbox for this execution
    const sandbox = new QuickJSSandbox();

    // Attach MCP bridge for tool invocation from sandbox
    const bridge = new MCPBridge(this.ctx, { allowedTools });
    sandbox.setBridge(bridge);

    // Build sandbox options
    const options: SandboxOptions = {};
    if (timeoutMs !== undefined) {
      // SECURITY: Cap timeout to prevent DoS via infinite values
      const clampedTimeout = clampPositiveNumber(timeoutMs, 1, SANDBOX_MAX_TIMEOUT_MS);
      if (typeof clampedTimeout === 'string') return errorResponse(`timeoutMs ${clampedTimeout}`);
      options.timeoutMs = clampedTimeout;
    }
    if (memoryLimitBytes !== undefined) {
      const clampedMemory = clampPositiveNumber(
        memoryLimitBytes,
        SANDBOX_MIN_MEMORY_LIMIT_BYTES,
        MAX_MEMORY_LIMIT_BYTES,
      );
      if (typeof clampedMemory === 'string') {
        return errorResponse(`memoryLimitBytes ${clampedMemory}`);
      }
      options.memoryLimitBytes = clampedMemory;
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

    const logs = redactOutput ? result.logs.map(redactSensitiveString) : result.logs;
    const output = redactOutput ? redactSensitiveData(result.output) : result.output;
    const error = redactOutput && result.error ? redactSensitiveString(result.error) : result.error;

    const summary = [
      `**Status:** ${result.ok ? '✓ Success' : '✗ Failed'}`,
      result.timedOut ? '**Timed out:** yes' : '',
      `**Duration:** ${result.durationMs}ms`,
      logs.length > 0 ? `**Console output:**\n\`\`\`\n${logs.join('\n')}\n\`\`\`` : '',
      output !== undefined ? `**Result:** ${JSON.stringify(output)}` : '',
      error ? `**Error:** ${error}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      content: [{ type: 'text', text: summary }],
    };
  }
}
