/**
 * Session domain — progress-ledger semantics (offline, pure in-memory).
 *
 * Ground truth: the ledger contract documented on the handler itself —
 * idempotent re-record keeps the original recordedAt, each kind is capped at
 * SESSION_PROGRESS_MAX_ENTRIES_PER_KIND, coverage lists newest-first with a
 * deterministic kind/key tie-break, and clear is kind-scoped.
 */
import { SessionProgressHandlers } from '@server/domains/session/handlers.impl';
import { SESSION_PROGRESS_MAX_ENTRIES_PER_KIND } from '@src/constants';
import { body, expectSuccess, type BenchSuite } from '../harness';

const handlers = new SessionProgressHandlers();

export const sessionSuite: BenchSuite = {
  name: 'session-progress',
  domain: 'session',
  description:
    'session_progress ledger: idempotent re-record, per-kind cap, deterministic coverage ordering, kind-scoped clear',
  cases: [
    {
      name: 'session_progress_record/first-record-created',
      tool: 'session_progress_record',
      origin: 'homemade',
      reference: 'first record of a key must report created=true and bump the kind counter',
      run: () =>
        handlers.handleRecordProgressTool({
          sessionId: 'bench-rec',
          kind: 'process',
          key: 'proc:main',
          metadata: { pid: 4242 },
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.created !== true) return `expected created=true, got ${JSON.stringify(b)}`;
        const counts = b.kindCounts as Record<string, number> | undefined;
        if (counts?.process !== 1) return `kindCounts.process expected 1, got ${counts?.process}`;
        return b.totalEntries === 1 ? true : `totalEntries expected 1, got ${b.totalEntries}`;
      },
    },
    {
      name: 'session_progress_record/idempotent-rerecord',
      tool: 'session_progress_record',
      origin: 'homemade',
      reference:
        're-recording the same (session, kind, key) replaces metadata and reports created=false — total must not grow',
      run: async () => {
        const first = body(
          await handlers.handleRecordProgressTool({
            sessionId: 'bench-idem',
            kind: 'hook-point',
            key: 'hook:login',
            metadata: { note: 'v1' },
          }),
        );
        const second = body(
          await handlers.handleRecordProgressTool({
            sessionId: 'bench-idem',
            kind: 'hook-point',
            key: 'hook:login',
            metadata: { note: 'v2' },
          }),
        );
        const coverage = body(await handlers.handleGetCoverageTool({ sessionId: 'bench-idem' }));
        return { first, second, coverage };
      },
      validate: (v) => {
        const b = body(v);
        const second = b.second as Record<string, unknown>;
        const coverage = b.coverage as Record<string, unknown>;
        if (second.created !== false)
          return `re-record must report created=false, got ${second.created}`;
        const entries = (coverage.entries as Array<Record<string, unknown>>) ?? [];
        if (entries.length !== 1)
          return `expected exactly 1 entry after re-record, got ${entries.length}`;
        const meta = entries[0]?.metadata as Record<string, unknown> | undefined;
        if (meta?.note !== 'v2')
          return `metadata must be replaced (v2), got ${JSON.stringify(meta)}`;
        return true;
      },
    },
    {
      name: 'session_progress_record/per-kind-cap-rejects',
      tool: 'session_progress_record',
      origin: 'homemade',
      reference: `the ${SESSION_PROGRESS_MAX_ENTRIES_PER_KIND}-entry per-kind cap rejects with the constant named`,
      run: async () => {
        const cap = SESSION_PROGRESS_MAX_ENTRIES_PER_KIND;
        for (let i = 0; i < cap; i++) {
          await handlers.handleRecordProgressTool({
            sessionId: 'bench-cap',
            kind: 'protocol-field',
            key: `field:${i}`,
          });
        }
        return handlers.handleRecordProgressTool({
          sessionId: 'bench-cap',
          kind: 'protocol-field',
          key: 'field:overflow',
        });
      },
      validate: (v) => {
        const b = body(v);
        if (b.success !== false) {
          return `record past the cap must fail, got success=${b.success}`;
        }
        const raw = String(b.raw ?? JSON.stringify(b));
        return raw.includes('SESSION_PROGRESS_MAX_ENTRIES_PER_KIND')
          ? true
          : `rejection must name the constant, got: ${raw.slice(0, 200)}`;
      },
    },
    {
      name: 'session_progress_coverage/deterministic-ordering',
      tool: 'session_progress_coverage',
      origin: 'homemade',
      reference:
        'entries sort newest-first by recordedAt; the same-millisecond tie-break is kind then key ascending — both the tied case (aa,mm,zz) and the crossed-millisecond case (mm,aa,zz, strictly newest first) are correct deterministic outcomes',
      run: async () => {
        for (const key of ['zz', 'aa', 'mm']) {
          await handlers.handleRecordProgressTool({
            sessionId: 'bench-order',
            kind: 'process',
            key,
          });
        }
        return handlers.handleGetCoverageTool({ sessionId: 'bench-order' });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const entries = (b.entries as Array<Record<string, unknown>>) ?? [];
        if (entries.length !== 3) return `expected 3 entries, got ${entries.length}`;
        const keys = entries.map((e) => String(e.key));
        // Two deterministic outcomes are correct:
        //  - all three recordedAts tie on the same millisecond → key ascending (aa,mm,zz)
        //  - Date.now() crossed a millisecond between writes → strictly newest-first (mm,aa,zz)
        const tied = keys.join(',') === 'aa,mm,zz';
        const crossedMs = keys.join(',') === 'mm,aa,zz';
        if (!tied && !crossedMs) {
          return `non-deterministic ordering: ${keys.join(',')}`;
        }
        for (let i = 1; i < keys.length; i++) {
          const prev = entries[i - 1]!;
          const cur = entries[i]!;
          if (Number(prev.recordedAt) < Number(cur.recordedAt)) {
            return `ordering violates newest-first: ${keys.join(',')}`;
          }
        }
        // Crossed-ms case must carry strictly decreasing recordedAt values; tied case equal.
        if (crossedMs) {
          const t0 = Number(entries[1]!.recordedAt);
          const t1 = Number(entries[2]!.recordedAt);
          if (t0 <= t1) return `crossed-ms ordering timestamps wrong: ${keys.join(',')}`;
        }
        return true;
      },
    },
    {
      name: 'session_progress_coverage/kind-filter',
      tool: 'session_progress_coverage',
      origin: 'homemade',
      reference: 'a kind filter restricts entries without touching other kinds',
      run: async () => {
        await handlers.handleRecordProgressTool({
          sessionId: 'bench-filter',
          kind: 'process',
          key: 'p1',
        });
        await handlers.handleRecordProgressTool({
          sessionId: 'bench-filter',
          kind: 'hook-point',
          key: 'h1',
        });
        const filtered = body(
          await handlers.handleGetCoverageTool({ sessionId: 'bench-filter', kind: 'process' }),
        );
        const all = body(await handlers.handleGetCoverageTool({ sessionId: 'bench-filter' }));
        return { filtered, all };
      },
      validate: (v) => {
        const b = body(v);
        const filtered = b.filtered as Record<string, unknown>;
        const all = b.all as Record<string, unknown>;
        const filteredEntries = (filtered.entries as unknown[]) ?? [];
        const allEntries = (all.entries as unknown[]) ?? [];
        if (filteredEntries.length !== 1)
          return `filtered expected 1 entry, got ${filteredEntries.length}`;
        const first = filteredEntries[0] as Record<string, unknown>;
        if (first.kind !== 'process') return `filtered kind must be process, got ${first.kind}`;
        return allEntries.length === 2
          ? true
          : `unfiltered expected 2 entries, got ${allEntries.length}`;
      },
    },
    {
      name: 'session_progress_clear/kind-scoped',
      tool: 'session_progress_clear',
      origin: 'homemade',
      reference: 'clear(kind) removes only that kind; other kinds and their counts survive',
      run: async () => {
        await handlers.handleRecordProgressTool({
          sessionId: 'bench-clear',
          kind: 'process',
          key: 'p1',
        });
        await handlers.handleRecordProgressTool({
          sessionId: 'bench-clear',
          kind: 'hook-point',
          key: 'h1',
        });
        const cleared = body(
          await handlers.handleClearProgressTool({ sessionId: 'bench-clear', kind: 'process' }),
        );
        const coverage = body(await handlers.handleGetCoverageTool({ sessionId: 'bench-clear' }));
        return { cleared, coverage };
      },
      validate: (v) => {
        const b = body(v);
        const cleared = b.cleared as Record<string, unknown>;
        const coverage = b.coverage as Record<string, unknown>;
        if (cleared.cleared !== 1) return `expected cleared=1, got ${cleared.cleared}`;
        const counts = coverage.counts as Record<string, number>;
        if (counts.process !== 0)
          return `process count must be 0 after kind clear, got ${counts.process}`;
        return counts.hookPoint === 1
          ? true
          : `hookPoint must survive the scoped clear, got ${counts.hookPoint}`;
      },
    },
    {
      name: 'session_progress_clear/unknown-session-and-full-clear',
      tool: 'session_progress_clear',
      origin: 'homemade',
      reference: 'clearing an unknown session reports cleared=0; clearing all empties the bucket',
      run: async () => {
        const unknown = body(await handlers.handleClearProgressTool({ sessionId: 'bench-none' }));
        await handlers.handleRecordProgressTool({
          sessionId: 'bench-wipe',
          kind: 'process',
          key: 'p1',
        });
        const wipe = body(await handlers.handleClearProgressTool({ sessionId: 'bench-wipe' }));
        const after = body(await handlers.handleGetCoverageTool({ sessionId: 'bench-wipe' }));
        return { unknown, wipe, after };
      },
      validate: (v) => {
        const b = body(v);
        const unknown = b.unknown as Record<string, unknown>;
        const wipe = b.wipe as Record<string, unknown>;
        const after = b.after as Record<string, unknown>;
        if (unknown.cleared !== 0) return `unknown session must clear 0, got ${unknown.cleared}`;
        if (wipe.cleared !== 1) return `full clear expected cleared=1, got ${wipe.cleared}`;
        return Number(after.total) === 0
          ? true
          : `coverage after full clear must be total=0, got ${after.total}`;
      },
    },
  ],
};
