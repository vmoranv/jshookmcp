import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolPerformanceMetrics, ToolResult, ToolStatus } from '@tests/e2e/helpers/types';

const KNOWN_EXPECTED_LIMITATION_PATTERNS = [
  'GRACEFUL:',
  'timed out',
  'Timeout',
  'Protocol error',
  'Input validation error',
  'Configuration Error',
  'Node is either not clickable',
  'not an Element',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function classifyStatus(
  parsed: unknown,
  error: Error | null,
  isError: boolean,
  detail: string,
): { status: ToolStatus; code?: string } {
  const code = isRecord(parsed) && typeof parsed.code === 'string' ? parsed.code : undefined;
  const success =
    isRecord(parsed) && typeof parsed.success === 'boolean' ? parsed.success : undefined;
  const isKnownExpectedLimitation =
    success === false ||
    KNOWN_EXPECTED_LIMITATION_PATTERNS.some((pattern) => detail.includes(pattern));

  if (!error && !isError && success !== false) return { status: 'PASS', code };
  if (isKnownExpectedLimitation) return { status: 'EXPECTED_LIMITATION', code };
  return { status: 'FAIL', code };
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms (${label})`)), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

export function parseContent(result: unknown): unknown {
  if (!isRecord(result) || !Array.isArray(result.content) || result.content.length === 0)
    return result;
  const first = result.content[0];
  if (!isRecord(first) || typeof first.text !== 'string') return result;
  try {
    return JSON.parse(first.text);
  } catch {
    return first.text;
  }
}

function isPerformanceSamplingEnabled(): boolean {
  return process.env.E2E_COLLECT_PERFORMANCE === '1';
}

function isPerformanceMetrics(value: unknown): value is ToolPerformanceMetrics {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).elapsedMs === 'number' &&
    typeof (value as Record<string, unknown>).startedAt === 'string' &&
    typeof (value as Record<string, unknown>).finishedAt === 'string'
  );
}

export class MCPTestClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private toolMap = new Map<string, { name: string; inputSchema?: Record<string, unknown> }>();
  readonly results: ToolResult[] = [];

  constructor() {
    this.client = new Client(
      { name: 'full-e2e-tool-test', version: '1.0.0' },
      { capabilities: {} },
    );
  }

  private logResult(result: ToolResult): void {
    const icon =
      result.status === 'PASS'
        ? '\u2713'
        : result.status === 'SKIP'
          ? '\u21B7'
          : result.status === 'EXPECTED_LIMITATION'
            ? '\u26A0'
            : '\u2717';
    console.info(
      `  ${icon} ${result.name.padEnd(42)} ${result.status.padEnd(20)} | ${result.detail.substring(0, 80)}`,
    );
  }

  private buildPerformanceMetrics(timeoutMs: number): {
    startedAt: string;
    startTime: number;
    finalize: (serverMetrics?: ToolPerformanceMetrics) => ToolPerformanceMetrics;
  } {
    const startedAt = new Date().toISOString();
    const startTime = performance.now();

    return {
      startedAt,
      startTime,
      finalize: (serverMetrics?: ToolPerformanceMetrics) => {
        if (serverMetrics) {
          return serverMetrics;
        }

        return {
          source: 'client',
          startedAt,
          finishedAt: new Date().toISOString(),
          elapsedMs: Number((performance.now() - startTime).toFixed(2)),
          timeoutMs,
          serverPid: null,
          cpuUserMicros: null,
          cpuSystemMicros: null,
          memoryBefore: null,
          memoryAfter: null,
          memoryDelta: null,
        };
      },
    };
  }

  recordSynthetic(
    name: string,
    status: ToolStatus,
    detail: string,
    options?: {
      code?: string;
      isError?: boolean;
      performance?: ToolPerformanceMetrics;
    },
  ): ToolResult {
    const result: ToolResult = {
      name,
      status,
      code: options?.code,
      detail: detail.substring(0, 200),
      isError: options?.isError ?? status === 'FAIL',
      performance: options?.performance,
      ok: status === 'PASS',
    };
    this.results.push(result);
    this.logResult(result);
    return result;
  }

  private record(
    name: string,
    resp: unknown,
    error: Error | null,
    performance?: ToolPerformanceMetrics,
  ): { parsed: unknown; result: ToolResult } {
    const parsed = error ? null : parseContent(resp);
    let parsedForResult = parsed;
    let performanceMetrics = performance;

    if (!error && isRecord(parsed) && isPerformanceMetrics(parsed['_executionMetrics'])) {
      performanceMetrics = parsed['_executionMetrics'];
      const { _executionMetrics: _ignored, ...rest } = parsed;
      parsedForResult = rest;
    }
    const isError = isRecord(resp) && resp.isError === true;

    let detail: string;
    if (error) {
      detail = error.message;
    } else if (isRecord(parsedForResult)) {
      if (parsedForResult.success === false) {
        detail = `GRACEFUL: ${String(parsedForResult.message ?? parsedForResult.error ?? 'success=false')}`;
      } else if (parsedForResult.success === true) {
        detail = 'success=true';
      } else {
        detail = JSON.stringify(parsedForResult).substring(0, 120);
      }
    } else {
      detail = String(parsedForResult).substring(0, 120);
    }

    const normalizedDetail = detail.substring(0, 200);
    const { status, code } = classifyStatus(parsedForResult, error, isError, normalizedDetail);
    const result: ToolResult = {
      name,
      status,
      code,
      detail: normalizedDetail,
      isError,
      performance: performanceMetrics,
      ok: status === 'PASS',
    };
    this.results.push(result);
    this.logResult(result);
    return { parsed: parsedForResult, result };
  }

  async connect(): Promise<void> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') env[k] = v;
    }
    env.MCP_TRANSPORT = 'stdio';
    env.MCP_TOOL_PROFILE = 'full';
    env.LOG_LEVEL = 'error';
    env.PUPPETEER_HEADLESS = 'false';

    const transport = new StdioClientTransport({
      command: 'node',
      args: ['dist/index.mjs'],
      cwd: process.cwd(),
      env,
      stderr: 'pipe',
    });
    this.transport = transport;

    console.info('Connecting to MCP server...');
    await withTimeout(this.client.connect(transport), 30000, 'connect');
    console.info('Connected. Listing tools...');
    const listed = await withTimeout(this.client.listTools(), 15000, 'listTools');

    const tools = listed?.tools ?? [];
    this.toolMap = new Map(
      tools.map((tool) => [
        tool.name,
        { name: tool.name, inputSchema: tool.inputSchema as Record<string, unknown> | undefined },
      ]),
    );

    console.info(`Server has ${this.toolMap.size} tools registered.\n`);
  }

  getToolMap() {
    return this.toolMap;
  }

  async call(
    name: string,
    args?: Record<string, unknown>,
    timeoutMs = 30000,
  ): Promise<{ parsed: unknown; result: ToolResult }> {
    const collectPerformance = isPerformanceSamplingEnabled();
    const metrics = collectPerformance ? this.buildPerformanceMetrics(timeoutMs) : null;

    try {
      const resp = await withTimeout(
        this.client.callTool({ name, arguments: args ?? {} }),
        timeoutMs,
        name,
      );
      const parsedResponse = parseContent(resp);
      const serverMetrics =
        collectPerformance &&
        isRecord(parsedResponse) &&
        isPerformanceMetrics(parsedResponse['_executionMetrics'])
          ? (parsedResponse['_executionMetrics'] as ToolPerformanceMetrics)
          : undefined;
      return this.record(name, resp, null, metrics ? metrics.finalize(serverMetrics) : undefined);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      return this.record(name, null, error, metrics ? metrics.finalize() : undefined);
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.call('browser_close', {}, 5000);
    } catch {
      /* best-effort teardown */
    }
    try {
      await this.transport?.close();
    } catch {
      /* best-effort teardown */
    }
    try {
      const proc = this.transport as unknown as { _process?: { pid?: number } } | null;
      if (proc?._process?.pid) {
        process.kill(proc._process.pid, 'SIGTERM');
        // Give the server time to gracefully shut down (triggering Puppeteer browser.close)
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } catch {
      /* best-effort teardown */
    }
  }
}
