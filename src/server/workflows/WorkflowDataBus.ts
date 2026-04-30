import type { ToolResponse } from '@server/types';
import type { ToolNodeInput } from '@server/workflows/WorkflowContract';
import type { JsonRecord } from '@server/workflows/WorkflowEngine.types';

/**
 * Cross-node data bus for dynamic parameter passing.
 *
 * Supports expression templates like "${get-requests.scriptId}" to reference
 * outputs from previous steps.
 */
export class WorkflowDataBus {
  private readonly store = new Map<string, unknown>();

  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  get<T>(key: string): T | undefined {
    return this.store.get(key) as T;
  }

  getValueAtPath(key: string, path: string): unknown {
    const value = this.store.get(key);
    if (!value || typeof value !== 'object') {
      return value;
    }

    const payload = parseToolPayload(value as ToolResponse);
    const obj = payload || (value as Record<string, unknown>);

    return path.split('.').reduce<unknown>((current, segment) => {
      if (current && typeof current === 'object') {
        const arrayMatch = segment.match(/^(\d+)$/);
        if (arrayMatch && Array.isArray(current)) {
          return current[Number(arrayMatch[1])];
        }

        return (current as Record<string, unknown>)[segment];
      }

      return undefined;
    }, obj);
  }

  resolve(template: string): unknown {
    const match = template.match(/^\$\{(.+)\}$/);
    if (!match || !match[1]) {
      return template;
    }

    const ref = match[1];
    const dotIndex = ref.indexOf('.');
    if (dotIndex === -1) {
      return this.store.get(ref);
    }

    return this.getValueAtPath(ref.slice(0, dotIndex), ref.slice(dotIndex + 1));
  }
}

export function parseToolPayload(response: unknown): JsonRecord | undefined {
  if (!response || typeof response !== 'object') {
    return undefined;
  }

  const toolResponse = response as ToolResponse & {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = toolResponse.content?.find((item) => item.type === 'text')?.text;
  if (typeof text !== 'string') {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as JsonRecord) : undefined;
  } catch {
    return undefined;
  }
}

export function responseIndicatesFailure(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') {
    return undefined;
  }

  const toolResponse = response as ToolResponse & { isError?: boolean };
  if (toolResponse.isError) {
    return 'Tool returned MCP error response';
  }

  const payload = parseToolPayload(response);
  if (payload?.success === false) {
    return typeof payload.error === 'string' ? payload.error : 'Tool reported success=false';
  }

  return undefined;
}

export function collectSuccessStats(value: unknown): { success: number; failure: number } {
  if (Array.isArray(value)) {
    return value.reduce(
      (acc, item) => {
        const next = collectSuccessStats(item);
        acc.success += next.success;
        acc.failure += next.failure;
        return acc;
      },
      { success: 0, failure: 0 },
    );
  }

  if (!value || typeof value !== 'object') {
    return { success: 0, failure: 0 };
  }

  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj['__order'])) {
    return (obj['__order'] as string[]).reduce(
      (acc, key) => {
        const next = collectSuccessStats(obj[key]);
        acc.success += next.success;
        acc.failure += next.failure;
        return acc;
      },
      { success: 0, failure: 0 },
    );
  }

  const payload = parseToolPayload(value);
  if (payload?.success === true) {
    return { success: 1, failure: 0 };
  }
  /* istanbul ignore next */
  if (payload?.success === false) {
    return { success: 0, failure: 1 };
  }
  if ('error' in obj) {
    return { success: 0, failure: 1 };
  }

  return { success: 0, failure: 0 };
}

export function resolveInputFrom(
  mapping: Record<string, string>,
  dataBus: WorkflowDataBus,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [targetKey, sourceRef] of Object.entries(mapping)) {
    const template = sourceRef.startsWith('${') ? sourceRef : `\${${sourceRef}}`;
    resolved[targetKey] = dataBus.resolve(template);
  }

  return resolved;
}

export function resolveInputValues(
  input: Record<string, ToolNodeInput> | undefined,
  dataBus: WorkflowDataBus,
): Record<string, unknown> {
  if (!input) {
    return {};
  }

  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    resolved[key] = resolveValue(value, dataBus);
  }

  return resolved;
}

function resolveValue(value: ToolNodeInput, dataBus: WorkflowDataBus): unknown {
  if (typeof value === 'string') {
    return dataBus.resolve(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item as ToolNodeInput, dataBus));
  }
  if (value && typeof value === 'object') {
    const resolved: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      resolved[key] = resolveValue(nestedValue as ToolNodeInput, dataBus);
    }
    return resolved;
  }

  return value;
}
