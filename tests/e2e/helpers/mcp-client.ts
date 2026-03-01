import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolResult } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms (${label})`)), ms);
    promise
      .then((v) => { clearTimeout(timer); resolve(v); })
      .catch((e) => { clearTimeout(timer); reject(e); });
  });
}

export function parseContent(result: unknown): unknown {
  if (!isRecord(result) || !Array.isArray(result.content) || result.content.length === 0) return result;
  const first = result.content[0];
  if (!isRecord(first) || typeof first.text !== 'string') return result;
  try { return JSON.parse(first.text); } catch { return first.text; }
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

  private record(name: string, resp: unknown, error: Error | null): unknown {
    const parsed = error ? null : parseContent(resp);
    const isError = isRecord(resp) && resp.isError === true;
    const ok = !error && !isError;

    let detail: string;
    if (error) {
      detail = error.message;
    } else if (isRecord(parsed)) {
      if (parsed.success === false) {
        detail = `GRACEFUL: ${String(parsed.message ?? parsed.error ?? 'success=false')}`;
      } else if (parsed.success === true) {
        detail = 'success=true';
      } else {
        detail = JSON.stringify(parsed).substring(0, 120);
      }
    } else {
      detail = String(parsed).substring(0, 120);
    }

    this.results.push({ name, ok, isError, detail: detail.substring(0, 200) });
    const icon = ok ? '\u2713' : isError ? '\u2717' : '\u26A0';
    console.error(`  ${icon} ${name.padEnd(42)} ${ok ? 'OK' : 'FAIL'} | ${detail.substring(0, 80)}`);
    return parsed;
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
      args: ['dist/index.js'],
      cwd: process.cwd(),
      env,
      stderr: 'pipe',
    });
    this.transport = transport;

    console.error('Connecting to MCP server...');
    await withTimeout(this.client.connect(transport), 30000, 'connect');
    console.error('Connected. Listing tools...');
    const listed = await withTimeout(this.client.listTools(), 15000, 'listTools');

    const tools = listed?.tools ?? [];
    this.toolMap = new Map(
      tools.map((tool) => [tool.name, { name: tool.name, inputSchema: tool.inputSchema as Record<string, unknown> | undefined }]),
    );

    console.error(`Server has ${this.toolMap.size} tools registered.\n`);
  }

  getToolMap() {
    return this.toolMap;
  }

  async call(name: string, args?: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> {
    try {
      const resp = await withTimeout(
        this.client.callTool({ name, arguments: args ?? {} }),
        timeoutMs,
        name,
      );
      return this.record(name, resp, null);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      this.record(name, null, error);
      return null;
    }
  }

  async cleanup(): Promise<void> {
    try { await this.call('browser_close', {}, 5000); } catch { /* ignore */ }
    try { await this.transport?.close(); } catch { /* ignore */ }
    try {
      const proc = this.transport as unknown as { _process?: { pid?: number } } | null;
      if (proc?._process?.pid) process.kill(proc._process.pid, 'SIGKILL');
    } catch { /* ignore */ }
  }
}
