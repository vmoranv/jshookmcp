import type {
  ProcessMemoryDelta,
  ProcessMemorySample,
  ToolPerformanceSummary,
  ToolPerformanceSummaryEntry,
  ToolResult,
} from '@tests/e2e/helpers/types';

function toBytesFromKiB(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(value) ? value * 1024 : null;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function diffNullableNumber(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : b - a;
}

export function parseLinuxProcStatus(status: string): ProcessMemorySample | null {
  const lines = status.split(/\r?\n/);
  const values = new Map<string, string>();
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_]+):\s+(.+)$/);
    if (match?.[1] && match[2]) values.set(match[1], match[2]);
  }

  const rssBytes = toBytesFromKiB(values.get('VmRSS'));
  const virtualBytes = toBytesFromKiB(values.get('VmSize'));
  const privateBytes = toBytesFromKiB(values.get('RssAnon') ?? values.get('VmData'));

  if (rssBytes === null && virtualBytes === null && privateBytes === null) return null;

  return {
    source: 'procfs',
    rssBytes,
    privateBytes,
    virtualBytes,
  };
}

export function parsePsMemory(stdout: string): ProcessMemorySample | null {
  const parts = stdout
    .trim()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const rssBytes = toBytesFromKiB(parts[0]);
  const virtualBytes = toBytesFromKiB(parts[1]);
  if (rssBytes === null && virtualBytes === null) return null;

  return {
    source: 'ps',
    rssBytes,
    privateBytes: null,
    virtualBytes,
  };
}

export function parseWindowsProcessJson(stdout: string): ProcessMemorySample | null {
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  const rssBytes = toNullableNumber(parsed['rssBytes'] ?? parsed['rss']);
  const privateBytes = toNullableNumber(parsed['privateBytes'] ?? parsed['private']);
  const virtualBytes = toNullableNumber(parsed['virtualBytes'] ?? parsed['virtual']);

  if (rssBytes === null && privateBytes === null && virtualBytes === null) return null;

  return {
    source: 'powershell',
    rssBytes,
    privateBytes,
    virtualBytes,
  };
}

export function diffProcessMemory(
  before: ProcessMemorySample | null,
  after: ProcessMemorySample | null,
): ProcessMemoryDelta | null {
  if (!before || !after) return null;

  return {
    rssBytes: diffNullableNumber(before.rssBytes, after.rssBytes),
    privateBytes: diffNullableNumber(before.privateBytes, after.privateBytes),
    virtualBytes: diffNullableNumber(before.virtualBytes, after.virtualBytes),
  };
}

function asSummaryEntry(result: ToolResult): ToolPerformanceSummaryEntry | null {
  const metrics = result.performance;
  if (!metrics) return null;
  return {
    name: result.name,
    status: result.status,
    elapsedMs: metrics.elapsedMs,
    rssDeltaBytes: metrics.memoryDelta?.rssBytes ?? null,
    privateDeltaBytes: metrics.memoryDelta?.privateBytes ?? null,
  };
}

export function buildPerformanceSummary(results: ToolResult[]): ToolPerformanceSummary {
  const entries = results
    .map(asSummaryEntry)
    .filter((entry): entry is ToolPerformanceSummaryEntry => entry !== null);

  const totalElapsedMs = entries.reduce((sum, entry) => sum + entry.elapsedMs, 0);
  const averageElapsedMs = entries.length > 0 ? totalElapsedMs / entries.length : 0;

  const slowestTools = entries.toSorted((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 20);

  const highestRssDeltaTools = entries
    .filter((entry) => entry.rssDeltaBytes !== null)
    .toSorted(
      (a, b) =>
        (b.rssDeltaBytes ?? Number.NEGATIVE_INFINITY) -
        (a.rssDeltaBytes ?? Number.NEGATIVE_INFINITY),
    )
    .slice(0, 20);

  return {
    measuredTools: entries.length,
    totalElapsedMs: Number(totalElapsedMs.toFixed(2)),
    averageElapsedMs: Number(averageElapsedMs.toFixed(2)),
    slowestTools,
    highestRssDeltaTools,
  };
}
