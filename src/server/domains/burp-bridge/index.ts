import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

/* ---------- Types ---------- */

interface HarEntry {
  request: {
    method: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
    postData?: { text?: string; mimeType?: string };
  };
  response: {
    status: number;
    headers: Array<{ name: string; value: string }>;
    content?: { text?: string; size?: number; mimeType?: string };
  };
  time?: number;
  startedDateTime?: string;
}

interface HarFile {
  log: {
    entries: HarEntry[];
  };
}

interface DiffResult {
  added: HarEntry[];
  removed: HarEntry[];
  modified: Array<{
    url: string;
    method: string;
    differences: Record<string, { base: unknown; target: unknown }>;
  }>;
  summary: {
    totalBase: number;
    totalTarget: number;
    addedCount: number;
    removedCount: number;
    modifiedCount: number;
    unchangedCount: number;
  };
}

/* ---------- Helpers ---------- */

function toTextResponse(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function toErrorResponse(tool: string, error: unknown, extra: Record<string, unknown> = {}) {
  return toTextResponse({
    success: false,
    tool,
    error: error instanceof Error ? error.message : String(error),
    ...extra,
  });
}

function hashBody(body: string | undefined): string {
  if (!body) return '<empty>';
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

function entryKey(entry: HarEntry): string {
  return `${entry.request.method}|${entry.request.url}`;
}

function headersToMap(headers: Array<{ name: string; value: string }>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    map[h.name.toLowerCase()] = h.value;
  }
  return map;
}

async function loadHar(path: string): Promise<HarFile> {
  const content = await readFile(resolve(path), 'utf-8');
  return JSON.parse(content) as HarFile;
}

async function fetchBurpAdapter(
  baseUrl: string,
  path: string,
  method = 'GET',
  body?: string,
  headers?: Record<string, string>,
): Promise<{ status: number; data: unknown }> {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/* ---------- Handler class ---------- */

export class BurpBridgeHandlers {
  private readonly endpoint: string;

  constructor(endpoint = 'http://127.0.0.1:18443') {
    // Validate endpoint is loopback only (SSRF protection)
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Burp adapter: only http/https protocols allowed, got ${parsed.protocol}`);
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    if (!isLoopback) {
      throw new Error(`Burp adapter: only loopback addresses allowed (127.0.0.1/localhost/::1), got ${host}`);
    }
    this.endpoint = endpoint;
  }

  /** Endpoint is fixed at construction; user args cannot override it. */
  private getEndpoint(_args: Record<string, unknown>): string {
    return this.endpoint;
  }

  async handleBurpProxyStatus(args: Record<string, unknown>) {
    const endpoint = this.getEndpoint(args);
    try {
      const { status, data } = await fetchBurpAdapter(endpoint, '/health');
      return toTextResponse({
        success: status === 200,
        endpoint,
        status,
        burp: data,
      });
    } catch (error) {
      return toTextResponse({
        success: false,
        endpoint,
        available: false,
        error: error instanceof Error ? error.message : String(error),
        hint: 'Ensure the Burp adapter is running. Install: https://github.com/nickvdyck/burp-rest-api or use Burp Suite Pro Extender REST API.',
      });
    }
  }

  async handleInterceptAndReplayToBurp(args: Record<string, unknown>) {
    const requestId = args.requestId as string;
    const target = (args.target as string) || 'proxy';
    const endpoint = this.getEndpoint(args);

    if (!requestId) {
      return toErrorResponse('intercept_and_replay_to_burp', new Error('requestId is required'));
    }

    try {
      const body = JSON.stringify({
        requestId,
        target,
        headerPatch: args.headerPatch ?? {},
        bodyPatch: args.bodyPatch ?? null,
      });

      const apiPath = target === 'repeater' ? '/repeater/send' : '/proxy/replay';
      const { status, data } = await fetchBurpAdapter(endpoint, apiPath, 'POST', body);

      return toTextResponse({
        success: status >= 200 && status < 300,
        target,
        burpResponse: data,
      });
    } catch (error) {
      return toErrorResponse('intercept_and_replay_to_burp', error, { endpoint });
    }
  }

  async handleImportHarFromBurp(args: Record<string, unknown>) {
    const harPath = args.harPath as string;
    if (!harPath) {
      return toErrorResponse('import_har_from_burp', new Error('harPath is required'));
    }

    try {
      const har = await loadHar(harPath);
      let entries = har.log.entries;

      // Apply filters
      if (typeof args.urlFilter === 'string') {
        const re = new RegExp(args.urlFilter, 'i');
        entries = entries.filter(e => re.test(e.request.url));
      }
      if (Array.isArray(args.methodFilter)) {
        const methods = new Set((args.methodFilter as string[]).map(m => m.toUpperCase()));
        entries = entries.filter(e => methods.has(e.request.method));
      }
      if (Array.isArray(args.statusFilter)) {
        const statuses = new Set(args.statusFilter as number[]);
        entries = entries.filter(e => statuses.has(e.response.status));
      }

      return toTextResponse({
        success: true,
        imported: entries.length,
        totalInHar: har.log.entries.length,
        filtered: har.log.entries.length - entries.length,
        samples: entries.slice(0, 5).map(e => ({
          method: e.request.method,
          url: e.request.url,
          status: e.response.status,
        })),
      });
    } catch (error) {
      return toErrorResponse('import_har_from_burp', error);
    }
  }

  async handleDiffHar(args: Record<string, unknown>) {
    const basePath = args.baseHarPath as string;
    const targetPath = args.targetHarPath as string;

    if (!basePath || !targetPath) {
      return toErrorResponse('diff_har', new Error('baseHarPath and targetHarPath are required'));
    }

    try {
      const [baseHar, targetHar] = await Promise.all([loadHar(basePath), loadHar(targetPath)]);

      const compareFields = Array.isArray(args.compareFields)
        ? (args.compareFields as string[])
        : ['url', 'method', 'status', 'headers', 'bodyHash'];
      const ignoreHeaders = new Set(
        Array.isArray(args.ignoreHeaders)
          ? (args.ignoreHeaders as string[]).map(h => h.toLowerCase())
          : [],
      );

      // URL filter
      let baseEntries = baseHar.log.entries;
      let targetEntries = targetHar.log.entries;
      if (typeof args.urlFilter === 'string') {
        const re = new RegExp(args.urlFilter, 'i');
        baseEntries = baseEntries.filter(e => re.test(e.request.url));
        targetEntries = targetEntries.filter(e => re.test(e.request.url));
      }

      // Index by method|url
      const baseMap = new Map<string, HarEntry>();
      for (const e of baseEntries) baseMap.set(entryKey(e), e);

      const targetMap = new Map<string, HarEntry>();
      for (const e of targetEntries) targetMap.set(entryKey(e), e);

      const result: DiffResult = {
        added: [],
        removed: [],
        modified: [],
        summary: {
          totalBase: baseEntries.length,
          totalTarget: targetEntries.length,
          addedCount: 0,
          removedCount: 0,
          modifiedCount: 0,
          unchangedCount: 0,
        },
      };

      // Find added (in target but not in base)
      for (const [key, entry] of targetMap) {
        if (!baseMap.has(key)) {
          result.added.push(entry);
        }
      }

      // Find removed (in base but not in target)
      for (const [key, entry] of baseMap) {
        if (!targetMap.has(key)) {
          result.removed.push(entry);
        }
      }

      // Find modified (in both, but different)
      for (const [key, baseEntry] of baseMap) {
        const targetEntry = targetMap.get(key);
        if (!targetEntry) continue;

        const diffs: Record<string, { base: unknown; target: unknown }> = {};

        if (compareFields.includes('status') && baseEntry.response.status !== targetEntry.response.status) {
          diffs.status = { base: baseEntry.response.status, target: targetEntry.response.status };
        }

        if (compareFields.includes('headers')) {
          const baseHeaders = headersToMap(baseEntry.request.headers);
          const targetHeaders = headersToMap(targetEntry.request.headers);
          const allKeys = new Set([...Object.keys(baseHeaders), ...Object.keys(targetHeaders)]);
          for (const hk of allKeys) {
            if (ignoreHeaders.has(hk)) continue;
            if (baseHeaders[hk] !== targetHeaders[hk]) {
              diffs[`header:${hk}`] = { base: baseHeaders[hk] ?? '<absent>', target: targetHeaders[hk] ?? '<absent>' };
            }
          }
        }

        if (compareFields.includes('bodyHash')) {
          const baseHash = hashBody(baseEntry.request.postData?.text);
          const targetHash = hashBody(targetEntry.request.postData?.text);
          if (baseHash !== targetHash) {
            diffs.bodyHash = { base: baseHash, target: targetHash };
          }
        }

        if (Object.keys(diffs).length > 0) {
          result.modified.push({
            url: baseEntry.request.url,
            method: baseEntry.request.method,
            differences: diffs,
          });
        }
      }

      result.summary.addedCount = result.added.length;
      result.summary.removedCount = result.removed.length;
      result.summary.modifiedCount = result.modified.length;
      result.summary.unchangedCount =
        Math.min(baseEntries.length, targetEntries.length) -
        result.modified.length;

      return toTextResponse({
        success: true,
        diff: {
          added: result.added.map(e => ({ method: e.request.method, url: e.request.url })),
          removed: result.removed.map(e => ({ method: e.request.method, url: e.request.url })),
          modified: result.modified.slice(0, 20),
          summary: result.summary,
        },
      });
    } catch (error) {
      return toErrorResponse('diff_har', error);
    }
  }

  async handleBurpSendToRepeater(args: Record<string, unknown>) {
    const url = args.url as string;
    if (!url) {
      return toErrorResponse('burp_send_to_repeater', new Error('url is required'));
    }

    const endpoint = this.getEndpoint(args);
    try {
      const body = JSON.stringify({
        url,
        method: (args.method as string) || 'GET',
        headers: args.headers ?? {},
        body: args.body ?? null,
      });

      const { status, data } = await fetchBurpAdapter(endpoint, '/repeater/send', 'POST', body);

      return toTextResponse({
        success: status >= 200 && status < 300,
        repeaterResponse: data,
      });
    } catch (error) {
      return toErrorResponse('burp_send_to_repeater', error, { endpoint });
    }
  }
}
