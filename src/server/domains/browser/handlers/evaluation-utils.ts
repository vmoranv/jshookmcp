import type { DetailedDataManager } from '@utils/DetailedDataManager';

export interface EvaluationPostFilterOptions {
  autoSummarize: boolean;
  maxSize: number;
  fieldFilter?: string[];
  stripBase64: boolean;
}

/** Recursively remove keys listed in `fields` from any nested object/array. */
function filterFields(value: unknown, fields: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => filterFields(item, fields));
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(obj)) {
      if (!fields.has(key)) {
        out[key] = filterFields(nested, fields);
      }
    }
    return out;
  }
  return value;
}

/**
 * Recursively replace base64 payloads with a short placeholder.
 * Catches: data:[mime];base64,<payload> and bare strings >500 chars of [A-Za-z0-9+/=]
 */
function stripBase64Values(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/^data:[a-z+-]+\/[a-z+-]+;base64,/i.test(value)) {
      return `[base64 ~${Math.round(value.length / 1024)}KB stripped]`;
    }
    if (value.length > 500 && /^[A-Za-z0-9+/=\r\n]+$/.test(value.replace(/\s/g, ''))) {
      return `[base64 ~${value.length}chars stripped]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripBase64Values(item));
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(obj)) {
      out[key] = stripBase64Values(nested);
    }
    return out;
  }
  return value;
}

export function applyEvaluationPostFilters(
  raw: unknown,
  detailedDataManager: DetailedDataManager,
  options: EvaluationPostFilterOptions,
): unknown {
  let result = options.autoSummarize ? detailedDataManager.smartHandle(raw, options.maxSize) : raw;
  if (options.fieldFilter && options.fieldFilter.length > 0) {
    result = filterFields(result, new Set(options.fieldFilter));
  }
  if (options.stripBase64) {
    result = stripBase64Values(result);
  }
  return result;
}
