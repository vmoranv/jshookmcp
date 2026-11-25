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
  // `_meta` is client-controlled. Copy own entries explicitly and skip keys that
  // would mutate the prototype (`Object.assign` uses [[Set]], so an own
  // `__proto__` key would replace nextMeta's prototype and spoof sessionId).
  const mergeMeta = (source: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(source)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      nextMeta[key] = value;
    }
  };
  const existing = readToolRequestMeta(args);
  if (existing) {
    mergeMeta(existing);
  }
  if (isRecord(extra?.mcpReq?._meta)) {
    mergeMeta(extra.mcpReq._meta as Record<string, unknown>);
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
