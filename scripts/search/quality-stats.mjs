#!/usr/bin/env node
/**
 * Search quality traffic statistics.
 *
 * Reads the persisted SearchQualityTracker snapshot
 * (`~/.jshookmcp/state/search-quality.json`, written by the
 * RuntimeSnapshotScheduler) and prints latency, MRR, tool-usage rate, and the
 * BM25 top-score distribution. Search is lexical-only (ADR-0005), so there is
 * no vector eligibility or participation signal to report.
 *
 * BM25 top score is absent on quick-path (exact tool-name) records by design;
 * those records are excluded from the score histogram but still count toward
 * latency and usage metrics.
 *
 * Usage: node scripts/search/quality-stats.mjs [--json]
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const STATE_PATH = resolve(homedir(), '.jshookmcp', 'state', 'search-quality.json');

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

async function main() {
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(STATE_PATH, 'utf8'));
  } catch (error) {
    console.error(
      `Cannot read snapshot at ${STATE_PATH}: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error('Run the server against real traffic first; snapshots persist on shutdown.');
    process.exit(1);
  }

  const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
  if (records.length === 0) {
    console.log('Snapshot is empty — no searches recorded yet.');
    process.exit(0);
  }

  const fullPath = records.filter((r) => typeof r.bm25TopScore === 'number');
  const quickPath = records.length - fullPath.length;

  const histogram = [0, 2, 4, 8, 16, 32, 64];
  const buckets = histogram.map((lo, i) => {
    const hi = histogram[i + 1] ?? Infinity;
    const count = fullPath.filter((r) => r.bm25TopScore >= lo && r.bm25TopScore < hi).length;
    return { range: hi === Infinity ? `>=${lo}` : `${lo}-${hi}`, count };
  });

  const used = records.filter(
    (r) => typeof r.usedTool === 'string' && typeof r.usedToolRank === 'number',
  );

  const summary = {
    statePath: STATE_PATH,
    totalRecords: records.length,
    quickPathRecords: quickPath,
    fullPathRecords: fullPath.length,
    mrr: Number(
      (used.length > 0
        ? used.reduce((s, r) => s + 1 / r.usedToolRank, 0) / used.length
        : 0
      ).toFixed(4),
    ),
    toolUsedRate: Number((used.length / records.length).toFixed(4)),
    p50LatencyMs: percentile(
      records.map((r) => r.latencyMs).toSorted((a, b) => a - b),
      50,
    ),
    p99LatencyMs: percentile(
      records.map((r) => r.latencyMs).toSorted((a, b) => a - b),
      99,
    ),
    histogram: buckets.filter((b) => b.count > 0),
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  console.log('Search-quality traffic stats');
  console.log(
    `  records: ${records.length} (quick-path ${quickPath}, full-path ${fullPath.length})`,
  );
  console.log(
    `  MRR: ${summary.mrr}  |  toolUsedRate: ${summary.toolUsedRate}  |  p50 latency: ${summary.p50LatencyMs}ms  |  p99 latency: ${summary.p99LatencyMs}ms`,
  );
  if (buckets.some((b) => b.count > 0)) {
    console.log('  BM25 top-score histogram:');
    for (const b of buckets) {
      if (b.count > 0) console.log(`    [${b.range.padStart(6)}]: ${b.count}`);
    }
  }
  if (fullPath.length === 0) {
    console.log('  (no full-path samples yet — quick-path/exact-match traffic only)');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
