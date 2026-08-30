import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestId } from '@modelcontextprotocol/server';

/**
 * Normalized view over the v2 handler context (ServerContext). Every field is
 * optional so the SDK's context is structurally assignable to it; handlers
 * read per-request state from here instead of touching the SDK type directly.
 * v2 nesting: requestId → mcpReq.id, metadata → mcpReq._meta, signal →
 * mcpReq.signal; sessionId stays top-level (transport-provided).
 */
export interface ToolRequestExtra {
  sessionId?: string;
  mcpReq?: {
    id?: RequestId;
    method?: string;
    _meta?: unknown;
    signal?: AbortSignal;
  };
  http?: {
    req?: {
      // Minimal structural view of the web-standard Request.headers — no
      // index signature, so the SDK's Headers instance stays assignable.
      headers?: {
        get?: (name: string) => string | null | undefined;
      };
    };
  };
}

export interface ToolRequestContextValue {
  sessionId: string | null;
  requestId: RequestId | null;
  signal?: AbortSignal;
}

const requestContext = new AsyncLocalStorage<ToolRequestContextValue>();

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value.find((entry) => entry.trim().length > 0)?.trim() ?? null;
  }
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function resolveToolRequestSessionId(extra?: ToolRequestExtra): string | null {
  if (typeof extra?.sessionId === 'string' && extra.sessionId.trim().length > 0) {
    return extra.sessionId.trim();
  }

  // v2 exposes the original HTTP request with Web-standard Headers.
  const headerSessionId =
    extra?.http?.req?.headers?.get?.('mcp-session-id') ??
    extra?.http?.req?.headers?.get?.('Mcp-Session-Id') ??
    null;
  if (typeof headerSessionId === 'string' && headerSessionId.trim().length > 0) {
    return headerSessionId.trim();
  }

  const meta = extra?.mcpReq?._meta;
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null;
  return firstHeaderValue((meta as Record<string, unknown>)['sessionId'] as string | undefined);
}

export function runWithToolRequestContext<T>(
  extra: ToolRequestExtra | undefined,
  callback: () => T,
): T {
  return requestContext.run(
    {
      sessionId: resolveToolRequestSessionId(extra),
      requestId: extra?.mcpReq?.id ?? null,
      ...(extra?.mcpReq?.signal ? { signal: extra.mcpReq.signal } : {}),
    },
    callback,
  );
}

export function getToolRequestContext(): ToolRequestContextValue | null {
  return requestContext.getStore() ?? null;
}
