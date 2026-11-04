/**
 * Tool Benchmark Harness — quantifiable scoring for MCP tool handlers.
 *
 * Every benchmark case wraps ONE MCP tool: it invokes the real domain handler,
 * then validates the response against either
 *   - an external reference vector (RFC / spec / official test suite), or
 *   - a homemade assertion (self-designed fixtures with known ground truth).
 *
 * The runner aggregates per-suite results into a scorecard (JSON + markdown).
 * See CATALOG.md for the full 36-domain mapping of tools → benchmark source.
 */

export type BenchmarkOrigin = 'external-vector' | 'homemade' | 'adversarial';

export interface BenchCase {
  /** Stable case id, e.g. "binary_encode/rfc4648-vector-3". */
  readonly name: string;
  /** MCP tool name this case exercises. */
  readonly tool: string;
  /** Where the ground truth comes from. */
  readonly origin: BenchmarkOrigin;
  /** Human-readable one-liner naming the external source or the homemade fixture. */
  readonly reference: string;
  /** Invoke the tool (returns the raw handler response). */
  readonly run: () => Promise<unknown>;
  /** Validate the response; return true/false or a failure detail. */
  readonly validate: (body: unknown) => true | string;
  /** Cases that need an optional native dep (e.g. z3) may be skipped when absent. */
  readonly skip?: () => boolean;
  readonly skipReason?: string;
}

export interface BenchSuite {
  /** Suite id, e.g. "encoding". */
  readonly name: string;
  /** Registry domain this suite covers. */
  readonly domain: string;
  /** Short description of what the suite proves. */
  readonly description: string;
  readonly cases: readonly BenchCase[];
}

export interface BenchCaseResult {
  readonly name: string;
  readonly tool: string;
  readonly origin: BenchmarkOrigin;
  readonly reference: string;
  readonly status: 'pass' | 'fail' | 'error' | 'skipped';
  readonly ms: number;
  readonly detail?: string;
}

export interface BenchSuiteResult {
  readonly suite: string;
  readonly domain: string;
  readonly description: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly errored: number;
  readonly skipped: number;
  readonly score: number; // passed / (total - skipped), 0 when empty
  readonly durationMs: number;
  readonly cases: readonly BenchCaseResult[];
}

const STABLE = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? val.toString() : val), 0));

export async function runBenchSuite(suite: BenchSuite): Promise<BenchSuiteResult> {
  const cases: BenchCaseResult[] = [];
  const t0 = performance.now();
  for (const c of suite.cases) {
    if (c.skip?.()) {
      cases.push({
        name: c.name,
        tool: c.tool,
        origin: c.origin,
        reference: c.reference,
        status: 'skipped',
        ms: 0,
        detail: c.skipReason,
      });
      continue;
    }
    const start = performance.now();
    try {
      const raw = await c.run();
      const payload = STABLE(raw);
      const verdict = c.validate(payload);
      const ms = performance.now() - start;
      cases.push({
        name: c.name,
        tool: c.tool,
        origin: c.origin,
        reference: c.reference,
        status: verdict === true ? 'pass' : 'fail',
        ms,
        ...(verdict === true ? {} : { detail: verdict }),
      });
    } catch (err) {
      const ms = performance.now() - start;
      cases.push({
        name: c.name,
        tool: c.tool,
        origin: c.origin,
        reference: c.reference,
        status: 'error',
        ms,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const durationMs = performance.now() - t0;
  const evaluated = cases.filter((c) => c.status !== 'skipped');
  const passed = cases.filter((c) => c.status === 'pass').length;
  const failed = cases.filter((c) => c.status === 'fail').length;
  const errored = cases.filter((c) => c.status === 'error').length;
  const skipped = cases.filter((c) => c.status === 'skipped').length;
  return {
    suite: suite.name,
    domain: suite.domain,
    description: suite.description,
    total: cases.length,
    passed,
    failed,
    errored,
    skipped,
    score: evaluated.length === 0 ? 0 : (passed / evaluated.length) * 100,
    durationMs,
    cases,
  };
}

// ── Response helpers ──

/**
 * Domain handlers return either a plain payload object or an MCP content wrapper
 * `{ content: [{ type: 'text', text: JSON.stringify(payload) }] }`. Unwrap both.
 */
export function body(v: unknown): Record<string, unknown> {
  let cur: unknown = v;
  for (let depth = 0; depth < 3; depth++) {
    if (typeof cur === 'string') {
      try {
        cur = JSON.parse(cur);
      } catch {
        return { raw: cur };
      }
      continue;
    }
    if (cur && typeof cur === 'object') {
      const obj = cur as Record<string, unknown>;
      const text = (obj.content as Array<{ type?: string; text?: string }> | undefined)?.[0]?.text;
      if (typeof text === 'string') {
        try {
          cur = JSON.parse(text);
          continue;
        } catch {
          return { raw: obj };
        }
      }
      return obj;
    }
    return { raw: cur };
  }
  return { raw: cur };
}

/** Fail only on an explicit success:false — some handlers omit the field. */
export function expectSuccess(v: unknown): Record<string, unknown> {
  const b = body(v);
  if (b.success === false) {
    throw new Error(`tool responded success=false: ${JSON.stringify(b).slice(0, 300)}`);
  }
  return b;
}

// ── Scorecard rendering ──

export function renderScorecard(results: readonly BenchSuiteResult[]): string {
  const lines: string[] = [];
  const now = new Date().toISOString();
  lines.push('# Tool Benchmark Scorecard');
  lines.push('');
  lines.push(`Generated: ${now}`);
  lines.push('');
  const totals = results.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      passed: acc.passed + r.passed,
      skipped: acc.skipped + r.skipped,
    }),
    { total: 0, passed: 0, skipped: 0 },
  );
  const evaluated = totals.total - totals.skipped;
  lines.push(
    `**Overall**: ${totals.passed}/${evaluated} passed (${evaluated ? ((totals.passed / evaluated) * 100).toFixed(1) : '0.0'}%), ${totals.skipped} skipped, ${results.length} suites`,
  );
  lines.push('');
  lines.push(
    '| Suite | Domain | Score | Passed | Fail | Error | Skip | External vectors | Homemade | Adversarial | ms |',
  );
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of results) {
    const ext = r.cases.filter(
      (c) => c.origin === 'external-vector' && c.status !== 'skipped',
    ).length;
    const home = r.cases.filter((c) => c.origin === 'homemade' && c.status !== 'skipped').length;
    const adv = r.cases.filter((c) => c.origin === 'adversarial' && c.status !== 'skipped').length;
    lines.push(
      `| ${r.suite} | ${r.domain} | ${r.score.toFixed(1)}% | ${r.passed} | ${r.failed} | ${r.errored} | ${r.skipped} | ${ext} | ${home} | ${adv} | ${Math.round(r.durationMs)} |`,
    );
  }
  lines.push('');

  const problems = results.flatMap((r) =>
    r.cases
      .filter((c) => c.status === 'fail' || c.status === 'error')
      .map((c) => `- **${r.suite}/${c.name}** (${c.tool}) ${c.status}: ${c.detail ?? ''}`),
  );
  if (problems.length > 0) {
    lines.push('## Failures');
    lines.push('');
    lines.push(...problems);
    lines.push('');
  }
  return lines.join('\n');
}
