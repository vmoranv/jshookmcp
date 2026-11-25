/**
 * TurboFanGraphParser + TurboFanTraceCollector unit tests.
 *
 * Tests the JSON parser in isolation (no V8 process spawn) and the
 * isolated collector's process spawning / temp dir / cleanup logic
 * with a real V8 child process.
 */

import { describe, expect, it } from 'vitest';
import {
  parseTurboFanJSON,
  parseTurboFanJSONFiles,
} from '@modules/v8-inspector/TurboFanGraphParser';
import {
  collectTurboFanIRIsolated,
  collectTurboFanIRFromDir,
} from '@modules/v8-inspector/TurboFanTraceCollector';

// ── Sample TurboFan JSON (real --trace-turbo format) ──────────────────────────

const sampleTurboJSON = JSON.stringify({
  function: {
    sourceId: 0,
    functionName: 'hotLoop',
    sourceName: 'test.js',
    sourceText: 'function hotLoop(n){let s=0;for(let i=0;i<n;i++){s+=i}return s}',
    startPosition: 0,
    endPosition: 64,
  },
  sources: {
    '0': {
      sourceId: 0,
      functionName: 'hotLoop',
      sourceName: 'test.js',
      sourceText: 'function hotLoop(n){let s=0;for(let i=0;i<n;i++){s+=i}return s}',
      startPosition: 0,
      endPosition: 64,
    },
  },
  inlinings: {
    '0': {
      inliningId: 0,
      sourceId: 0,
      inliningPosition: { scriptOffset: 10, inliningId: 0 },
    },
  },
  phases: [
    {
      name: 'begin inlining',
      type: 'graph',
      data: {
        nodes: [
          {
            id: 1,
            label: 'NumberConstant [0]',
            title: 'NumberConstant(0)',
            live: true,
            properties: '0',
            opcode: 'NumberConstant',
            control: false,
            opinfo: '0 v 0 eff 0 ctrl in',
            type: 'TaggedNumber',
          },
          {
            id: 2,
            label: 'NumberConstant [1]',
            title: 'NumberConstant(1)',
            live: true,
            properties: '1',
            opcode: 'NumberConstant',
            control: false,
            opinfo: '1 v 0 eff 0 ctrl in',
            type: 'TaggedNumber',
          },
          {
            id: 10,
            label: 'Loop',
            title: 'Loop',
            live: true,
            properties: '',
            opcode: 'Loop',
            control: true,
            opinfo: '0 v 0 eff 2 ctrl in',
            type: 'Internal',
          },
          {
            id: 25,
            label: 'JSAdd',
            title: 'JSAdd',
            live: true,
            properties: '',
            opcode: 'JSAdd',
            control: false,
            opinfo: '2 v 1 eff 1 ctrl in',
            type: 'TaggedNumber',
          },
        ],
        edges: [
          { source: 1, target: 25, index: 0, type: 'value' },
          { source: 2, target: 25, index: 1, type: 'value' },
          { source: 10, target: 25, index: 0, type: 'control' },
        ],
      },
    },
    {
      name: 'typed lowering',
      type: 'graph',
      data: {
        nodes: [
          {
            id: 30,
            label: 'NumberAdd',
            title: 'NumberAdd',
            live: true,
            properties: '',
            opcode: 'NumberAdd',
            control: false,
            opinfo: '2 v 0 eff 0 ctrl in',
            type: 'TaggedNumber',
          },
        ],
        edges: [{ source: 1, target: 30, index: 0, type: 'value' }],
      },
    },
    {
      name: 'schedule',
      type: 'schedule',
      data: '--- BLOCK B0 ---\n  0: NumberAdd\n--- BLOCK B1 ---\n  1: Return',
    },
  ],
});

// ── Parser tests ──────────────────────────────────────────────────────────────

describe('parseTurboFanJSON', () => {
  it('parses function metadata', () => {
    const graph = parseTurboFanJSON(sampleTurboJSON);
    expect(graph).not.toBeNull();
    expect(graph!.function.functionName).toBe('hotLoop');
    expect(graph!.function.sourceName).toBe('test.js');
    expect(graph!.function.startPosition).toBe(0);
  });

  it('parses graph phases with nodes and edges', () => {
    const graph = parseTurboFanJSON(sampleTurboJSON)!;
    const graphPhases = graph.phases.filter((p) => p.type === 'graph');
    expect(graphPhases.length).toBe(2);

    const firstPhase = graphPhases[0]!;
    expect(firstPhase.nodeCount).toBe(4);
    expect(firstPhase.edgeCount).toBe(3);
    expect(firstPhase.nodes!.length).toBe(4);
    expect(firstPhase.edges!.length).toBe(3);
  });

  it('parses schedule phase as raw text', () => {
    const graph = parseTurboFanJSON(sampleTurboJSON)!;
    const schedulePhase = graph.phases.find((p) => p.type === 'schedule');
    expect(schedulePhase).toBeTruthy();
    expect(typeof schedulePhase!.data).toBe('string');
    expect(schedulePhase!.data).toContain('BLOCK B0');
  });

  it('builds opcode histogram across all graph phases', () => {
    const graph = parseTurboFanJSON(sampleTurboJSON)!;
    expect(graph.opcodeHistogram['NumberConstant']).toBe(2);
    expect(graph.opcodeHistogram['Loop']).toBe(1);
    expect(graph.opcodeHistogram['JSAdd']).toBe(1);
    expect(graph.opcodeHistogram['NumberAdd']).toBe(1);
  });

  it('computes total node and edge counts', () => {
    const graph = parseTurboFanJSON(sampleTurboJSON)!;
    // Phase 1: 4 nodes, 3 edges; Phase 2: 1 node, 1 edge
    expect(graph.totalNodeCount).toBe(5);
    expect(graph.totalEdgeCount).toBe(4);
  });

  it('parses inlinings', () => {
    const graph = parseTurboFanJSON(sampleTurboJSON)!;
    expect(Object.keys(graph.inlinings).length).toBe(1);
    expect(graph.inlinings['0']!.sourceId).toBe(0);
  });

  it('generates a summary string', () => {
    const graph = parseTurboFanJSON(sampleTurboJSON)!;
    expect(graph.summary).toContain('hotLoop');
    expect(graph.summary).toContain('3 phases');
    expect(graph.summary).toContain('5 total nodes');
    expect(graph.summary).toContain('1 inlined calls');
  });

  it('parses node fields correctly including opcode and control flag', () => {
    const graph = parseTurboFanJSON(sampleTurboJSON)!;
    const loopNode = graph.phases[0]!.nodes!.find((n) => n.opcode === 'Loop');
    expect(loopNode).toBeTruthy();
    expect(loopNode!.control).toBe(true);

    const addNode = graph.phases[0]!.nodes!.find((n) => n.opcode === 'JSAdd');
    expect(addNode).toBeTruthy();
    expect(addNode!.control).toBe(false);
    expect(addNode!.type).toBe('TaggedNumber');
  });

  it('parses edge types correctly', () => {
    const graph = parseTurboFanJSON(sampleTurboJSON)!;
    const firstPhase = graph.phases[0]!;
    const valueEdge = firstPhase.edges!.find((e) => e.type === 'value');
    const controlEdge = firstPhase.edges!.find((e) => e.type === 'control');
    expect(valueEdge).toBeTruthy();
    expect(controlEdge).toBeTruthy();
  });

  it('returns null for invalid JSON', () => {
    expect(parseTurboFanJSON('not json')).toBeNull();
  });

  it('returns null for missing function metadata', () => {
    expect(parseTurboFanJSON(JSON.stringify({ phases: [] }))).toBeNull();
  });

  it('handles empty phases array', () => {
    const minimal = JSON.stringify({
      function: { functionName: 'empty', sourceName: '', sourceText: '', sourceId: 0 },
      phases: [],
    });
    const graph = parseTurboFanJSON(minimal)!;
    expect(graph.phaseCount).toBe(0);
    expect(graph.totalNodeCount).toBe(0);
    expect(graph.totalEdgeCount).toBe(0);
    expect(Object.keys(graph.opcodeHistogram).length).toBe(0);
  });

  it('classifies unknown edge types as unknown', () => {
    const json = JSON.stringify({
      function: { functionName: 'f', sourceName: '', sourceText: '', sourceId: 0 },
      phases: [
        {
          name: 'test',
          type: 'graph',
          data: {
            nodes: [
              {
                id: 1,
                label: 'n',
                title: 'n',
                live: true,
                properties: '',
                opcode: 'N',
                control: false,
                opinfo: '',
                type: '',
              },
            ],
            edges: [{ source: 1, target: 1, index: 0, type: 'weird' }],
          },
        },
      ],
    });
    const graph = parseTurboFanJSON(json)!;
    expect(graph.phases[0]!.edges![0]!.type).toBe('unknown');
  });

  it('returns null for non-object JSON roots', () => {
    expect(parseTurboFanJSON('null')).toBeNull();
    expect(parseTurboFanJSON('[]')).toBeNull();
    expect(parseTurboFanJSON('42')).toBeNull();
    expect(parseTurboFanJSON('"str"')).toBeNull();
  });
});

describe('parseTurboFanJSONFiles', () => {
  it('parses multiple files', () => {
    const result = parseTurboFanJSONFiles([
      { filename: 'turbo-hotLoop-0.json', content: sampleTurboJSON },
      {
        filename: 'turbo-other-1.json',
        content: JSON.stringify({
          function: { functionName: 'other', sourceName: 'b.js', sourceText: '', sourceId: 1 },
          phases: [],
        }),
      },
    ]);
    expect(result.available).toBe(true);
    expect(result.graphCount).toBe(2);
    expect(result.graphs[0]!.function.functionName).toBe('hotLoop');
    expect(result.graphs[1]!.function.functionName).toBe('other');
  });

  it('returns unavailable for empty list', () => {
    const result = parseTurboFanJSONFiles([]);
    expect(result.available).toBe(false);
    expect(result.graphCount).toBe(0);
  });

  it('skips invalid files', () => {
    const result = parseTurboFanJSONFiles([
      { filename: 'bad.json', content: 'invalid json' },
      { filename: 'turbo-good.json', content: sampleTurboJSON },
    ]);
    expect(result.available).toBe(true);
    expect(result.graphCount).toBe(1);
  });
});

// ── Collector tests ────────────────────────────────────────────────────────────

describe('collectTurboFanIRFromDir', () => {
  it('returns unavailable for nonexistent directory', () => {
    const result = collectTurboFanIRFromDir('/nonexistent/path/that/does/not/exist');
    expect(result.available).toBe(false);
    expect(result.graphCount).toBe(0);
    expect(result.reason).toContain('No valid');
  });
});

describe('collectTurboFanIRIsolated', () => {
  // These tests spawn a real Node.js child process with --trace-turbo.
  // They verify the end-to-end pipeline: spawn → compile → read JSON → parse.
  // Skipped in CI environments without a writable /tmp.

  it('collects TurboFan IR for a hot loop function', async () => {
    // A function with a loop that V8 will TurboFan-optimize.
    // We call it many times to trigger optimization.
    const source = `
      function hotSum(n) {
        let s = 0;
        for (let i = 0; i < n; i++) {
          s += i * 2;
        }
        return s;
      }
    `;
    const result = await collectTurboFanIRIsolated(
      { functionName: 'hotSum', sourceSlice: source },
      30_000,
      false,
    );

    // --trace-turbo may or may not produce output depending on V8 version/config.
    // If it produces output, we should have valid graphs.
    if (result.available) {
      expect(result.graphCount).toBeGreaterThanOrEqual(1);
      const graph = result.graphs[0]!;
      expect(graph.function.functionName).toBeTruthy();
      expect(graph.phaseCount).toBeGreaterThanOrEqual(1);
      // The temp dir should be cleaned up when keepTraceDir=false
      expect(result.traceDir).toBeNull();
    } else {
      // If unavailable, the reason should be informative
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    }
  }, 45_000);

  it('returns unavailable for malformed source', async () => {
    const result = await collectTurboFanIRIsolated(
      { functionName: 'broken', sourceSlice: 'this is not valid javascript {{{' },
      15_000,
      false,
    );
    // Should not crash; either the function fails to resolve or no turbo JSON is produced
    expect(result.available).toBe(false);
    expect(typeof result.reason).toBe('string');
  }, 20_000);

  it('keeps trace directory when keepTraceDir=true', async () => {
    const source = `
      function multiply(a, b) {
        let r = 0;
        for (let i = 0; i < a; i++) {
          r += b;
        }
        return r;
      }
    `;
    const result = await collectTurboFanIRIsolated(
      { functionName: 'multiply', sourceSlice: source },
      30_000,
      true, // keepTraceDir
    );

    if (result.available && result.traceDir) {
      // The directory should exist
      const { readdirSync } = await import('node:fs');
      const entries = readdirSync(result.traceDir);
      expect(entries.length).toBeGreaterThanOrEqual(0);
      // Clean up manually
      const { rmSync } = await import('node:fs');
      rmSync(result.traceDir, { recursive: true, force: true });
    }
  }, 45_000);

  it('routes the trace dir through artifacts/tmp and leaves no cfg in cwd', async () => {
    // Regression: TurboFanTraceCollector must (a) place the trace dir under the
    // project's unified artifacts/tmp tree (not the OS temp dir) and (b) set
    // the child's CWD to that dir so V8's turbo-<pid>-<srcId>.cfg files land
    // there too — not in process.cwd() (which is the repo root in dev / the
    // npm cache in npx). Previously the cfg files leaked into cwd.
    const { readdirSync, rmSync, existsSync } = await import('node:fs');
    const { getArtifactDir } = await import('@utils/artifacts');
    const expectedBase = getArtifactDir('tmp');

    const source = `
      function leakCheck(n) {
        let s = 0;
        for (let i = 0; i < n; i++) s += i;
        return s;
      }
    `;
    const result = await collectTurboFanIRIsolated(
      { functionName: 'leakCheck', sourceSlice: source },
      30_000,
      true, // keep so we can inspect where it landed
    );

    if (result.traceDir) {
      // (a) trace dir lives under artifacts/tmp/
      expect(result.traceDir.startsWith(expectedBase)).toBe(true);
      // (b) the cfg files are inside the trace dir, not leaked to cwd
      const traceEntries = readdirSync(result.traceDir);
      const cfgInTrace = traceEntries.filter((f) => f.endsWith('.cfg'));
      expect(cfgInTrace.length).toBeGreaterThan(0);
      rmSync(result.traceDir, { recursive: true, force: true });
    }

    // No cfg leaked into the process cwd regardless of optimization outcome.
    const cwdLeaks = readdirSync(process.cwd()).filter((f) => /^turbo-.*\.cfg$/u.test(f));
    expect(cwdLeaks).toEqual([]);
    // And the artifacts/tmp base dir itself still exists (was ensured).
    expect(existsSync(expectedBase)).toBe(true);
  }, 45_000);
});
