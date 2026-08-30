import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const SERVER_ENTRY = join(process.cwd(), 'dist', 'index.mjs');
const HTTP_PORT = 31991;
const SERVER_URL = `http://127.0.0.1:${HTTP_PORT}/mcp`;

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return;
      }
      lastError = new Error(`Health returned ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError instanceof Error ? lastError : new Error('HTTP server did not become healthy');
}

function parseToolText(result: unknown): Record<string, unknown> {
  if (typeof result === 'object' && result !== null) {
    const content = (result as { content?: Array<{ text?: string }> }).content;
    const first = Array.isArray(content) ? content[0] : undefined;
    if (typeof first?.text === 'string') {
      return JSON.parse(first.text) as Record<string, unknown>;
    }
  }
  return result as Record<string, unknown>;
}

describe('HTTP session isolation E2E', { timeout: 120_000, sequential: true }, () => {
  let child: ChildProcess | null = null;
  let clientA: Client | null = null;
  let clientB: Client | null = null;
  let transportA: StreamableHTTPClientTransport | null = null;
  let transportB: StreamableHTTPClientTransport | null = null;

  beforeAll(async () => {
    if (!existsSync(SERVER_ENTRY)) {
      throw new Error(`Server entry not found at ${SERVER_ENTRY}. Run "pnpm build" first.`);
    }

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') env[key] = value;
    }
    env.MCP_TRANSPORT = 'http';
    env.MCP_PORT = String(HTTP_PORT);
    env.MCP_HOST = '127.0.0.1';
    env.MCP_TOOL_PROFILE = 'full';
    env.LOG_LEVEL = 'error';

    child = spawn('node', [SERVER_ENTRY], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await waitForHealth(`http://127.0.0.1:${HTTP_PORT}/health`, 20_000);

    clientA = new Client({ name: 'http-e2e-a', version: '1.0.0' }, { capabilities: {} });
    clientB = new Client({ name: 'http-e2e-b', version: '1.0.0' }, { capabilities: {} });
    transportA = new StreamableHTTPClientTransport(new URL(SERVER_URL));
    transportB = new StreamableHTTPClientTransport(new URL(SERVER_URL));

    await Promise.all([clientA.connect(transportA), clientB.connect(transportB)]);
  });

  afterAll(async () => {
    try {
      await transportA?.terminateSession();
    } catch {
      // best effort
    }
    try {
      await transportB?.terminateSession();
    } catch {
      // best effort
    }
    try {
      await transportA?.close();
    } catch {
      // best effort
    }
    try {
      await transportB?.close();
    } catch {
      // best effort
    }
    try {
      child?.kill('SIGTERM');
    } catch {
      // best effort
    }
  });

  test('two independent Streamable HTTP clients can initialize and call tools concurrently', async () => {
    expect(transportA?.sessionId).toBeTruthy();
    expect(transportB?.sessionId).toBeTruthy();
    expect(transportA?.sessionId).not.toBe(transportB?.sessionId);

    const [toolsA, toolsB] = await Promise.all([clientA!.listTools(), clientB!.listTools()]);
    expect((toolsA.tools ?? []).length).toBeGreaterThan(0);
    expect((toolsB.tools ?? []).length).toBeGreaterThan(0);

    const [coverageA, coverageB] = await Promise.all([
      clientA!.callTool({ name: 'coverage_report', arguments: {} }),
      clientB!.callTool({ name: 'coverage_report', arguments: {} }),
    ]);

    const bodyA = parseToolText(coverageA);
    const bodyB = parseToolText(coverageB);
    expect(bodyA.success).toBe(true);
    expect(bodyB.success).toBe(true);
    expect(typeof bodyA.totalKnownTools).toBe('number');
    expect(typeof bodyB.totalKnownTools).toBe('number');
  });
});
