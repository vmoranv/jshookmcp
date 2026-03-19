import { execFile, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { promisify } from 'node:util';

export type JsonObject = Record<string, unknown>;
export type TextToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
};

export type ProcessRunResult = {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
};

export type HttpJsonResult = {
  status: number;
  data: JsonObject;
  text: string;
};

const execFileAsync = promisify(execFile);

export function toTextResponse(payload: Record<string, unknown>): TextToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

export function toErrorResponse(
  tool: string,
  error: unknown,
  extra: Record<string, unknown> = {},
): TextToolResponse {
  return toTextResponse({
    success: false,
    tool,
    error: error instanceof Error ? error.message : String(error),
    ...extra,
  });
}

export function parseStringArg(
  args: Record<string, unknown>,
  key: string,
  required = false,
): string | undefined {
  const value = args[key];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  if (required) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return undefined;
}

export function toDisplayPath(absolutePath: string): string {
  const relPath = relative(process.cwd(), absolutePath).replace(/\\/g, '/');
  if (relPath.length === 0) return '.';
  return relPath.startsWith('..') ? absolutePath.replace(/\\/g, '/') : relPath;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function resolveOutputDirectory(
  toolName: string,
  target: string,
  requestedDir?: string,
): Promise<{ absolutePath: string; displayPath: string }> {
  if (requestedDir) {
    const absolutePath = resolve(requestedDir);
    await mkdir(absolutePath, { recursive: true });
    return { absolutePath, displayPath: toDisplayPath(absolutePath) };
  }

  const absolutePath = resolve(
    process.cwd(),
    'artifacts',
    toolName,
    `${sanitizePathSegment(target)}-${Date.now()}`,
  );
  await mkdir(absolutePath, { recursive: true });
  return { absolutePath, displayPath: toDisplayPath(absolutePath) };
}

export async function checkExternalCommand(
  command: string,
  versionArgs: string[],
  label: string,
  installHint?: string,
): Promise<TextToolResponse> {
  try {
    const { stdout, stderr } = await execFileAsync(command, versionArgs, {
      timeout: 10_000,
    });
    const version = (stdout || stderr).trim().split('\n')[0] ?? '';
    return toTextResponse({
      success: true,
      tool: label,
      available: true,
      version,
    });
  } catch (error) {
    return toTextResponse({
      success: true,
      tool: label,
      available: false,
      reason: error instanceof Error ? error.message : String(error),
      ...(installHint ? { installHint } : {}),
    });
  }
}

export async function runProcess(
  command: string,
  args: string[],
  options: {
    timeoutMs?: number;
    maxStdoutBytes?: number;
    maxStderrBytes?: number;
    cwd?: string;
  } = {},
): Promise<ProcessRunResult> {
  const timeoutMs = options.timeoutMs ?? 300_000;
  const maxStdout = options.maxStdoutBytes ?? 10 * 1024 * 1024;
  const maxStderr = options.maxStderrBytes ?? 1 * 1024 * 1024;

  return await new Promise<ProcessRunResult>((resolveResult) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let timedOut = false;

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolveResult({
        ok: exitCode === 0 && !timedOut,
        exitCode,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        truncated: stdoutTruncated || stderrTruncated,
      });
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000);
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length >= maxStdout) {
        stdoutTruncated = true;
        return;
      }
      const raw = chunk.toString('utf-8');
      const remaining = maxStdout - stdout.length;
      stdout += raw.slice(0, remaining);
      if (raw.length > remaining) stdoutTruncated = true;
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length >= maxStderr) {
        stderrTruncated = true;
        return;
      }
      const raw = chunk.toString('utf-8');
      const remaining = maxStderr - stderr.length;
      stderr += raw.slice(0, remaining);
      if (raw.length > remaining) stderrTruncated = true;
    });

    child.on('close', (code, signal) => {
      finish(code, signal as NodeJS.Signals | null);
    });

    child.on('error', (error) => {
      stderr += `${stderr ? '\n' : ''}Spawn error: ${error.message}`;
      finish(1, null);
    });
  });
}

export function assertLoopbackUrl(value: string, label = 'endpoint'): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${label} URL: ${value}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label}: only http/https protocols are allowed, got ${url.protocol}`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!isLoopback) {
    throw new Error(
      `${label}: only loopback hosts are allowed (127.0.0.1/localhost/::1), got ${host}`,
    );
  }

  return url.toString();
}

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

export function buildUrl(
  baseUrl: string,
  path: string,
  query: Record<string, unknown> = {},
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${baseUrl.replace(/\/$/, '')}${normalizedPath}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function requestJson(
  url: string,
  method = 'GET',
  bodyObj?: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<HttpJsonResult> {
  const body = bodyObj ? JSON.stringify(bodyObj) : undefined;

  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  let data: JsonObject = {};
  if (text.length > 0) {
    try {
      data = JSON.parse(text) as JsonObject;
    } catch {
      data = { text };
    }
  }

  return { status: response.status, data, text };
}
