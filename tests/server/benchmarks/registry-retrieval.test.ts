/**
 * Registry-corpus retrieval benchmark — the production-realistic retrieval
 * measurement layer.
 *
 * Difference from retrieval-metrics.test.ts: the corpus there is the
 * search-quality fixture's hand-written 163-tool proxy with short
 * descriptions; THIS benchmark indexes the REAL registry — all 736 tools with
 * their real (enriched) descriptions and the doc-expansion sceneKeywords the
 * production wiring feeds the engine (MCPServer.search.helpers). The ~573
 * not-yet-covered tools are the honest distractor pool: "ocean of tools"
 * methodology (LiveMCPBench) treats corpus size as part of the measurement.
 *
 * Coverage grows domain-by-domain (registry-coverage.fixture batches). Floors
 * are calibrated from measured pilot values, then only tightened.
 *
 * Output: artifacts/benchmarks/registry-retrieval.{md,json}
 *         artifacts/benchmarks/registry-retrieval-per-tool.json
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tool } from '@modelcontextprotocol/server';
import { GENERATED_TOOL_CATALOG } from '@server/registry/generated-tool-catalog';
import type { SearchConfig } from '@internal-types/config';
import { buildRegistryCoverageCases } from '@tests/server/search/fixtures/registry-coverage.fixture';
import {
  aggregateSearchMetrics,
  evaluateCase,
  summarizeFailedCases,
  type RankedResult,
} from '../../../scripts/search-tune/metrics';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

interface PerToolEvidence {
  readonly queries: number;
  readonly hitAt3: number;
  readonly hitAt10: number;
  readonly bestRank: number | null;
  readonly mrr: number;
}

type CoverageCases = ReturnType<typeof buildRegistryCoverageCases>;

function buildPerToolEvidence(
  rankedByCase: ReadonlyMap<string, readonly RankedResult[]>,
  cases: CoverageCases,
): Record<string, PerToolEvidence> {
  const acc = new Map<string, { queries: number; ranks: number[] }>();
  for (const testCase of cases) {
    const ranked = rankedByCase.get(testCase.id) ?? [];
    for (const exp of testCase.expectations) {
      if (exp.gain < 2) continue;
      const idx = ranked.findIndex((r) => r.name === exp.tool);
      const entry = acc.get(exp.tool) ?? { queries: 0, ranks: [] };
      entry.queries += 1;
      if (idx >= 0) entry.ranks.push(idx + 1);
      acc.set(exp.tool, entry);
    }
  }
  const out: Record<string, PerToolEvidence> = {};
  for (const [tool, { queries, ranks }] of acc) {
    out[tool] = {
      queries,
      hitAt3: ranks.filter((r) => r <= 3).length,
      hitAt10: ranks.filter((r) => r <= 10).length,
      bestRank: ranks.length > 0 ? Math.min(...ranks) : null,
      mrr: ranks.length > 0 ? ranks.reduce((s, r) => s + 1 / r, 0) / queries : 0,
    };
  }
  return out;
}

describe('registry-corpus retrieval benchmark', () => {
  it(
    'measures MRR/P@k/Success@k against the real 736-tool registry',
    { timeout: 180_000 },
    async () => {
      // Real registry corpus: real descriptions + doc-expansion sceneKeywords,
      // wired exactly like MCPSearchEngineFactory does in production.
      const tools: Tool[] = [];
      const domains = new Map<string, string>();
      const sceneKeywords = new Map<string, readonly string[]>();
      for (const entry of GENERATED_TOOL_CATALOG) {
        tools.push(entry.tool as Tool);
        domains.set(entry.tool.name, entry.domain);
        if (entry.sceneKeywords?.length) sceneKeywords.set(entry.tool.name, entry.sceneKeywords);
      }

      const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
      const engine = new ToolSearchEngine(
        tools,
        domains,
        undefined,
        undefined,
        { vectorEnabled: false } as SearchConfig, // lexical-layer measurement, no embedding worker
        sceneKeywords,
      );

      const cases = buildRegistryCoverageCases();
      const rankedByCase = new Map<string, RankedResult[]>();
      const caseMetrics = [];
      for (const testCase of cases) {
        const results = await engine.search(testCase.query, Math.max(testCase.topK, 10));
        const ranked: RankedResult[] = results.map((r) => ({
          name: r.name,
          score: Number(r.score ?? 0),
          domain: (r as { domain?: string | null }).domain ?? null,
        }));
        caseMetrics.push(evaluateCase(ranked, testCase));
        rankedByCase.set(testCase.id, ranked);
      }
      const agg = aggregateSearchMetrics(caseMetrics);
      const perTool = buildPerToolEvidence(rankedByCase, cases);
      const coveredTools = Object.keys(perTool).length;

      const report = {
        generatedAt: new Date().toISOString(),
        dataset: 'registry corpus (generated-tool-catalog, real descriptions + sceneKeywords)',
        corpusTools: tools.length,
        expansionTools: sceneKeywords.size,
        cases: cases.length,
        coveredTools,
        mrrAt10: agg.mrrAt10,
        ndcgAt10: agg.ndcgAt10,
        pAt1: agg.pAt1,
        pAt3: agg.pAt3,
        pAt5: agg.pAt5,
        successAt3: agg.successAt3,
        successAt5: agg.successAt5,
        objectiveScore: agg.objectiveScore,
        worstCases: summarizeFailedCases(rankedByCase, cases).slice(0, 8),
        perTool,
      };

      const outDir = resolve(ROOT, 'artifacts/benchmarks');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(
        resolve(outDir, 'registry-retrieval.json'),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      writeFileSync(
        resolve(outDir, 'registry-retrieval-per-tool.json'),
        `${JSON.stringify(perTool, null, 2)}\n`,
      );
      const md = [
        '# Registry-Corpus Retrieval Benchmark',
        '',
        `Dataset: ${report.dataset}`,
        '',
        '| Metric | Value |',
        '|---|---:|',
        `| Corpus | ${tools.length} tools (${sceneKeywords.size} expansion-annotated) |`,
        `| Covered tools (per-tool evidence) | ${coveredTools} / ${tools.length} |`,
        `| Queries | ${cases.length} |`,
        `| MRR@10 | ${(agg.mrrAt10 * 100).toFixed(1)}% |`,
        `| NDCG@10 | ${(agg.ndcgAt10 * 100).toFixed(1)}% |`,
        `| P@1 | ${(agg.pAt1 * 100).toFixed(1)}% |`,
        `| P@3 | ${(agg.pAt3 * 100).toFixed(1)}% |`,
        `| Success@3 | ${(agg.successAt3 * 100).toFixed(1)}% |`,
        '',
        `Objective (0.45·MRR + 0.25·NDCG + 0.15·P@1 + 0.15·S@3): ${(agg.objectiveScore * 100).toFixed(1)}%`,
      ].join('\n');
      writeFileSync(resolve(outDir, 'registry-retrieval.md'), `${md}\n`);

      // eslint-disable-next-line no-console
      console.log(
        `[registry-retrieval] corpus=${tools.length} covered=${coveredTools} MRR@10=${(agg.mrrAt10 * 100).toFixed(1)}% P@1=${(agg.pAt1 * 100).toFixed(1)}% S@3=${(agg.successAt3 * 100).toFixed(1)}%`,
      );

      // Floors: growth (cases only ever grow) + quality (calibrated on the
      // pilot's measured values minus a ~2-4pp buffer — same only-tighten
      // policy as the tool benchmark gate). Pilot measured: MRR 57.9 / P@1
      // 47.4 / S@3 63.2 (38 network cases over the full 736-tool corpus).
      expect(cases.length).toBeGreaterThanOrEqual(30);
      expect(coveredTools).toBeGreaterThanOrEqual(30);
      // Calibrated 2026-11-13 on the measured full-coverage baseline
      // (MRR 70.7 / P@1 60.7 / S@3 76.8, 569 cases over 736 tools, minus a
      // ~5pp buffer) — only-tighten policy.
      expect(agg.mrrAt10).toBeGreaterThanOrEqual(0.65);
      expect(agg.pAt1).toBeGreaterThanOrEqual(0.55);
      expect(agg.successAt3).toBeGreaterThanOrEqual(0.71);
    },
  );

  it(
    'measures held-out blind queries (generalization, no floors yet)',
    { timeout: 180_000 },
    async () => {
      const tools: Tool[] = [];
      const domains = new Map<string, string>();
      const sceneKeywords = new Map<string, readonly string[]>();
      for (const entry of GENERATED_TOOL_CATALOG) {
        tools.push(entry.tool as Tool);
        domains.set(entry.tool.name, entry.domain);
        if (entry.sceneKeywords?.length) sceneKeywords.set(entry.tool.name, entry.sceneKeywords);
      }
      const { ToolSearchEngine } = await import('@server/search/ToolSearchEngineImpl');
      const engine = new ToolSearchEngine(
        tools,
        domains,
        undefined,
        undefined,
        { vectorEnabled: false } as SearchConfig,
        sceneKeywords,
      );

      const { buildRegistryHoldoutCases } =
        await import('@tests/server/search/fixtures/registry-holdout.fixture');
      const cases = buildRegistryHoldoutCases();
      const rankedByCase = new Map<string, RankedResult[]>();
      const caseMetrics = [];
      for (const testCase of cases) {
        const results = await engine.search(testCase.query, Math.max(testCase.topK, 10));
        const ranked: RankedResult[] = results.map((r) => ({
          name: r.name,
          score: Number(r.score ?? 0),
          domain: (r as { domain?: string | null }).domain ?? null,
        }));
        caseMetrics.push(evaluateCase(ranked, testCase));
        rankedByCase.set(testCase.id, ranked);
      }
      const agg = aggregateSearchMetrics(caseMetrics);

      const report = {
        generatedAt: new Date().toISOString(),
        dataset: 'registry holdout (blind phrasings, authored without expansion keywords)',
        cases: cases.length,
        mrrAt10: agg.mrrAt10,
        ndcgAt10: agg.ndcgAt10,
        pAt1: agg.pAt1,
        pAt3: agg.pAt3,
        successAt3: agg.successAt3,
        worstCases: summarizeFailedCases(rankedByCase, cases).slice(0, 10),
      };
      const outDir = resolve(ROOT, 'artifacts/benchmarks');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(
        resolve(outDir, 'registry-holdout.json'),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      // eslint-disable-next-line no-console
      console.log(
        `[registry-holdout] MRR@10=${(agg.mrrAt10 * 100).toFixed(1)}% P@1=${(agg.pAt1 * 100).toFixed(1)}% S@3=${(agg.successAt3 * 100).toFixed(1)}%`,
      );

      // No floors yet. Baseline history (2026-11-13): the first holdout draft
      // used colloquial Chinese — a distribution that does not occur (agents
      // query in English) — and scored 7.9%, measuring the language gap, not
      // retrieval. The English-only paraphrase set below scored MRR 32.6 /
      // P@1 23.3 / S@3 36.7 vs 70.7/60.7/76.8 same-distribution: a ~38pp
      // SYNONYM-GENERALIZATION gap inside English — expansion phrases do not
      // cover the paraphrase space. Fix direction: per-tool synonym breadth in
      // sceneKeywords / SynonymExpander groups, then the vector layer.
      // Bound only guards against a fully-broken index.
      expect(cases.length).toBeGreaterThanOrEqual(25);
      expect(agg.mrrAt10).toBeGreaterThanOrEqual(0.05);
    },
  );
});
