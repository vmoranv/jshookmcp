/** Summary/path helpers for DetailedDataManager. */

export interface DataSummary {
  type: string;
  size: number;
  sizeKB: string;
  preview: string;
  structure?: {
    keys?: string[];
    methods?: string[];
    properties?: string[];
    length?: number;
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function readPathSegment(value: unknown, key: string): unknown {
  return (Object(value) as Record<string, unknown>)[key];
}

/** Resolve a dotted path inside cached JSON, throwing a path-specific error. */
export function getByPath(obj: unknown, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      throw new Error(`Path not found: ${path} (stopped at ${key})`);
    }
    current = readPathSegment(current, key);
  }

  return current;
}

/** Build the compact summary returned instead of an oversized payload. */
export function generateSummaryFromJson(data: unknown, jsonStr: string, size: number): DataSummary {
  const type = Array.isArray(data) ? 'array' : typeof data;

  const summary: DataSummary = {
    type,
    size,
    sizeKB: (size / 1024).toFixed(1) + 'KB',
    preview: jsonStr.substring(0, 200) + (size > 200 ? '...' : ''),
  };

  if (isRecord(data)) {
    const keys = Object.keys(data);
    summary.structure = {
      keys: keys.slice(0, 50),
    };

    if (!Array.isArray(data)) {
      const methods = keys.filter((k) => typeof data[k] === 'function');
      const properties = keys.filter((k) => typeof data[k] !== 'function');

      summary.structure.methods = methods.slice(0, 30);
      summary.structure.properties = properties.slice(0, 50);
    } else {
      summary.structure.length = data.length;
    }
  }

  return summary;
}
