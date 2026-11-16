/**
 * Phase 2.1: eval:trace (capture-trace-audit.mjs) is the missing THIRD HOP.
 * Locks: valid --json -> written trace-audit.json with combined + provenance;
 * sourceKind fixture detection; invalid/no-trace -> no half product, non-zero.
 *
 * Tests the PURE `buildTraceArtifact` helper so no child process / real .ccg
 * directory is needed in the unit test; the CLI spawn is exercised end-to-end
 * separately (see trace-capture.e2e check in verify).
 */
import { describe, expect, it } from 'vitest';
import { buildTraceArtifact, classifySource } from '../../../scripts/capture-trace-audit.mjs';

const auditJson = {
  file: 'D:/proj/.ccg/traces',
  files: ['default.jsonl'],
  thresholds: {},
  sessions: [
    {
      sessionId: 'default',
      calls: 36,
      toolNames: ['tool_alpha', 'tool_beta'],
      domains: ['browser'],
    },
  ],
  combined: { calls: 36, repeatedToolCallRate: 0, toolDiversity: 0.0556 },
  findings: [],
};

describe('classifySource (provenance, never hides evidence)', () => {
  it('marks tool_alpha/tool_beta selftest data as fixture', () => {
    expect(classifySource(auditJson)).toBe('fixture');
  });

  it('marks a realistic multi-domain live session as live', () => {
    const live = {
      ...auditJson,
      sessions: [
        {
          sessionId: 'agent-7f3',
          calls: 12,
          toolNames: ['page_navigate', 'network_enable'],
          domains: ['browser', 'network'],
        },
      ],
    };
    expect(classifySource(live)).toBe('live');
  });

  it('returns unknown when there are no sessions', () => {
    expect(classifySource({ ...auditJson, sessions: [] })).toBe('unknown');
  });
});

describe('buildTraceArtifact (eval:trace output)', () => {
  it('wraps the audit JSON with generatedAt/sourceDir/sourceKind, keeps combined', () => {
    const art = buildTraceArtifact(auditJson, 'D:/proj/.ccg/traces');
    expect(art.sourceDir).toBe('D:/proj/.ccg/traces');
    expect(art.sourceKind).toBe('fixture'); // explicit, never 'live'
    expect(art.combined).toEqual(auditJson.combined);
    expect(art.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // cross-view reads `parsed.combined ?? parsed` — must be top-level.
    expect(art.combined.calls).toBe(36);
  });

  it('throws on an audit JSON without a combined object (no half product)', () => {
    expect(() => buildTraceArtifact({ sessions: [] }, 'x')).toThrow(/combined/);
  });

  it('throws on non-object input', () => {
    expect(() => buildTraceArtifact(null, 'x')).toThrow();
    expect(() => buildTraceArtifact('nope', 'x')).toThrow();
  });
});
