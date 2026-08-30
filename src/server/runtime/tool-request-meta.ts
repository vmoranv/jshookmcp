import {
  resolveToolRequestSessionId,
  type ToolRequestExtra,
} from '@server/runtime/ToolRequestContext';

export interface ToolRequestMeta {
  progressToken?: string | number;
  sessionId?: string;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readToolRequestMeta(args: Record<string, unknown>): ToolRequestMeta | null {
  const meta = args['_meta'];
  if (!isRecord(meta)) {
    return null;
  }
  return meta as ToolRequestMeta;
}

export function readToolSessionId(args: Record<string, unknown>): string | null {
  const meta = readToolRequestMeta(args);
  const sessionId = meta?.sessionId;
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    return null;
  }
  return sessionId;
}

export function attachToolRequestMeta(
  args: Record<string, unknown>,
  extra?: ToolRequestExtra,
): Record<string, unknown> {
  const merged = { ...args };
  const nextMeta: ToolRequestMeta = {};
  const existing = readToolRequestMeta(args);
  if (existing) {
    Object.assign(nextMeta, existing);
  }
  if (isRecord(extra?.mcpReq?._meta)) {
    Object.assign(nextMeta, extra?.mcpReq?._meta as Record<string, unknown>);
  }
  const sessionId = resolveToolRequestSessionId(extra);
  if (sessionId) {
    nextMeta.sessionId = sessionId;
  }
  if (Object.keys(nextMeta).length > 0) {
    merged['_meta'] = nextMeta;
  }
  return merged;
}
