import { DetailedDataManager } from '@utils/DetailedDataManager';
import { sanitizeForCache } from '@utils/sanitizeForCache';
import { DETAILED_DATA_SMART_THRESHOLD_BYTES } from '@src/constants';

export interface SerializationContext {
  maxDepth?: number;
  maxArrayLength?: number;
  maxStringLength?: number;
  maxObjectKeys?: number;
  threshold?: number;
}

type DataType =
  | 'large-array'
  | 'deep-object'
  | 'code-string'
  | 'network-requests'
  | 'dom-structure'
  | 'function-tree'
  | 'primitive'
  | 'unknown';

type UnknownRecord = Record<string, unknown>;

/**
 * Total variant of JSON.stringify for the serializer's `Promise<string>`
 * contract. JSON.stringify returns `undefined` for undefined/functions/symbols
 * and throws for BigInt/cycles; both would break the caller. BigInts become
 * decimal strings; anything still unserializable becomes a small marker object.
 */
function stringifySafely(data: unknown): string {
  try {
    return (
      JSON.stringify(data, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ) ?? 'null'
    );
  } catch (error) {
    return JSON.stringify({
      type: 'unserializable',
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

interface NetworkRequestLike extends UnknownRecord {
  requestId?: unknown;
  url?: unknown;
  method?: unknown;
  type?: unknown;
  timestamp?: unknown;
}

export class AdaptiveDataSerializer {
  private readonly DEFAULT_CONTEXT: Required<SerializationContext> = {
    maxDepth: 3,
    maxArrayLength: 10,
    maxStringLength: 1000,
    maxObjectKeys: 20,
    threshold: DETAILED_DATA_SMART_THRESHOLD_BYTES,
  };

  async serialize(data: unknown, context: SerializationContext = {}): Promise<string> {
    const ctx = { ...this.DEFAULT_CONTEXT, ...context };

    const type = this.detectType(data);

    switch (type) {
      case 'large-array':
        if (Array.isArray(data)) {
          return await this.serializeLargeArray(data, ctx);
        }
        /* v8 ignore next */
        return await this.serializeDefault(data, ctx);
      case 'deep-object':
        return this.serializeDeepObject(data, ctx);
      case 'code-string':
        if (typeof data === 'string') {
          return await this.serializeCodeString(data, ctx);
        }
        /* v8 ignore next */
        return await this.serializeDefault(data, ctx);
      case 'network-requests':
        if (this.isNetworkRequestArray(data)) {
          return await this.serializeNetworkRequests(data, ctx);
        }
        /* v8 ignore next */
        return await this.serializeDefault(data, ctx);
      case 'dom-structure':
        return this.serializeDOMStructure(data, ctx);
      case 'function-tree':
        return this.serializeFunctionTree(data, ctx);
      case 'primitive':
        return stringifySafely(data);
      default:
        return await this.serializeDefault(data, ctx);
    }
  }

  private detectType(data: unknown): DataType {
    if (data === null || data === undefined) {
      return 'primitive';
    }

    const type = typeof data;

    if (type === 'string' || type === 'number' || type === 'boolean') {
      if (type === 'string' && this.isCodeString(data as string)) {
        return 'code-string';
      }
      return 'primitive';
    }

    if (Array.isArray(data)) {
      if (data.length > 0 && this.isNetworkRequest(data[0])) {
        return 'network-requests';
      }
      if (data.length > 100) {
        return 'large-array';
      }
    }

    if (type === 'object') {
      if (this.isDOMStructure(data)) {
        return 'dom-structure';
      }
      if (this.isFunctionTree(data)) {
        return 'function-tree';
      }
      if (this.getDepth(data) > 3) {
        return 'deep-object';
      }
    }

    return 'unknown';
  }

  private async serializeLargeArray(
    arr: unknown[],
    ctx: Required<SerializationContext>,
  ): Promise<string> {
    if (arr.length <= ctx.maxArrayLength) {
      // Inline-only path: no store() backup, so preserve oversized fields to disk.
      return JSON.stringify(await sanitizeForCache(arr));
    }

    const sample = [...arr.slice(0, 5), ...arr.slice(-5)];

    const detailId = await DetailedDataManager.getInstance().store(arr);

    return JSON.stringify({
      type: 'large-array',
      length: arr.length,
      // Preview only — the full array is in the cache (sanitized), so no disk write here.
      sample: await sanitizeForCache(sample, { writeFile: false }),
      detailId,
      hint: `Use get_detailed_data("${detailId}") to get full array`,
    });
  }

  private serializeDeepObject(obj: unknown, ctx: Required<SerializationContext>): string {
    const limited = this.limitDepth(obj, ctx.maxDepth);
    return JSON.stringify(limited);
  }

  private async serializeCodeString(
    code: unknown,
    _ctx: Required<SerializationContext>,
  ): Promise<string> {
    if (typeof code !== 'string') {
      return JSON.stringify(code);
    }

    const lines = code.split('\n');

    if (lines.length <= 100) {
      return JSON.stringify(code);
    }

    const preview = lines.slice(0, 50).join('\n');
    const detailId = await DetailedDataManager.getInstance().store(code);

    return JSON.stringify({
      type: 'code-string',
      totalLines: lines.length,
      preview,
      detailId,
      hint: `Use get_detailed_data("${detailId}") to get full code`,
    });
  }

  private async serializeNetworkRequests(
    requests: unknown,
    ctx: Required<SerializationContext>,
  ): Promise<string> {
    if (!Array.isArray(requests)) {
      return JSON.stringify(requests);
    }

    if (requests.length <= ctx.maxArrayLength) {
      // Inline-only path: no store() backup, so preserve oversized fields to disk.
      return JSON.stringify(await sanitizeForCache(requests));
    }

    const summary = requests.map((req) => {
      const request = this.isRecord(req) ? req : {};
      return {
        requestId: request['requestId'],
        url: request['url'],
        method: request['method'],
        type: request['type'],
        timestamp: request['timestamp'],
      };
    });

    const detailId = await DetailedDataManager.getInstance().store(requests);

    return JSON.stringify({
      type: 'network-requests',
      count: requests.length,
      // Preview only — full requests are in the cache (sanitized). A data: URI in a
      // url field would otherwise leak here verbatim (issue #62), so sanitize the
      // summary too; no disk write since the canonical copy is already stored.
      summary: await sanitizeForCache(summary.slice(0, ctx.maxArrayLength), { writeFile: false }),
      detailId,
      hint: `Use get_detailed_data("${detailId}") to get full requests`,
    });
  }

  private serializeDOMStructure(dom: unknown, ctx: Required<SerializationContext>): string {
    const limited = this.limitDomDepth(dom, ctx.maxDepth);
    return JSON.stringify(limited);
  }

  private serializeFunctionTree(tree: unknown, ctx: Required<SerializationContext>): string {
    const simplified = this.simplifyFunctionTree(tree, ctx.maxDepth);
    return JSON.stringify(simplified);
  }

  private async serializeDefault(
    data: unknown,
    ctx: Required<SerializationContext>,
  ): Promise<string> {
    // Sanitize before the size check and the preview: a `data:` URI (or any
    // oversized secret) in an unrecognized payload would otherwise be emitted
    // verbatim into model context. The canonical copy is stored below, so this
    // display-only pass must not write a second file.
    const sanitized = await sanitizeForCache(data, { writeFile: false });
    const jsonStr = stringifySafely(sanitized);

    if (jsonStr.length <= ctx.threshold) {
      return jsonStr;
    }

    const detailId = await DetailedDataManager.getInstance().store(data);

    return JSON.stringify({
      type: 'large-data',
      size: jsonStr.length,
      sizeKB: (jsonStr.length / 1024).toFixed(1),
      preview: jsonStr.substring(0, 500),
      detailId,
      hint: `Use get_detailed_data("${detailId}") to get full data`,
    });
  }

  private isCodeString(str: string): boolean {
    if (str.length < 100) return false;

    const codePatterns = [
      /function\s+\w+\s*\(/,
      /const\s+\w+\s*=/,
      /let\s+\w+\s*=/,
      /var\s+\w+\s*=/,
      /class\s+\w+/,
      /import\s+.*from/,
      /export\s+(default|const|function)/,
    ];

    return codePatterns.some((pattern) => pattern.test(str));
  }

  private isRecord(obj: unknown): obj is UnknownRecord {
    return obj !== null && typeof obj === 'object';
  }

  private isNetworkRequest(obj: unknown): obj is NetworkRequestLike {
    return (
      this.isRecord(obj) &&
      ('requestId' in obj || 'url' in obj) &&
      ('method' in obj || 'type' in obj)
    );
  }

  private isNetworkRequestArray(data: unknown): data is NetworkRequestLike[] {
    return Array.isArray(data) && data.length > 0 && this.isNetworkRequest(data[0]);
  }

  private isDOMStructure(obj: unknown): obj is UnknownRecord {
    return (
      this.isRecord(obj) &&
      ('tag' in obj || 'tagName' in obj) &&
      ('children' in obj || 'childNodes' in obj)
    );
  }

  private isFunctionTree(obj: unknown): obj is UnknownRecord {
    return (
      this.isRecord(obj) &&
      ('functionName' in obj || 'name' in obj) &&
      ('dependencies' in obj || 'calls' in obj || 'callGraph' in obj)
    );
  }

  private getDepth(obj: unknown, currentDepth = 0): number {
    if (!this.isRecord(obj)) {
      return currentDepth;
    }

    if (currentDepth > 10) return currentDepth;

    let maxDepth = currentDepth;

    for (const value of Object.values(obj)) {
      const depth = this.getDepth(value, currentDepth + 1);
      maxDepth = Math.max(maxDepth, depth);
    }

    return maxDepth;
  }

  private limitDepth(obj: unknown, maxDepth: number, currentDepth = 0): unknown {
    if (currentDepth >= maxDepth) {
      if (!this.isRecord(obj)) return obj;
      return '[Max depth reached]';
    }

    if (!this.isRecord(obj)) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.limitDepth(item, maxDepth, currentDepth + 1));
    }

    const result: UnknownRecord = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.limitDepth(value, maxDepth, currentDepth + 1);
    }

    return result;
  }

  private limitDomDepth(obj: unknown, maxDepth: number, currentDepth = 0): unknown {
    if (!this.isRecord(obj)) {
      return obj;
    }

    if (Array.isArray(obj)) {
      if (currentDepth > maxDepth) {
        return ['[Max depth reached]'];
      }

      return obj.map((item) => this.limitDomDepth(item, maxDepth, currentDepth + 1));
    }

    const result: UnknownRecord = {};
    for (const [key, value] of Object.entries(obj)) {
      if (this.isRecord(value)) {
        if (currentDepth >= maxDepth) {
          result[key] = Array.isArray(value) ? ['[Max depth reached]'] : '[Max depth reached]';
        } else {
          result[key] = this.limitDomDepth(value, maxDepth, currentDepth + 1);
        }
        continue;
      }

      result[key] = value;
    }

    return result;
  }

  private getFunctionTreeName(tree: UnknownRecord): string {
    const candidate = tree.functionName ?? tree.name;
    return typeof candidate === 'string' ? candidate : '[unknown]';
  }

  private simplifyFunctionTree(tree: unknown, maxDepth: number, currentDepth = 0): unknown {
    if (!this.isRecord(tree)) {
      return { name: '[invalid-node]', truncated: true };
    }

    if (currentDepth >= maxDepth) {
      return { name: this.getFunctionTreeName(tree), truncated: true };
    }

    // `isFunctionTree` accepts three graph-key spellings; read the same set so a
    // { name, calls } / { functionName, callGraph } tree is not silently reduced
    // to `dependencies: []`.
    const rawDependencies = tree.dependencies ?? tree.calls ?? tree.callGraph;
    const dependencies = Array.isArray(rawDependencies) ? rawDependencies : [];

    return {
      name: this.getFunctionTreeName(tree),
      dependencies: dependencies.map((dep) =>
        this.simplifyFunctionTree(dep, maxDepth, currentDepth + 1),
      ),
    };
  }
}
