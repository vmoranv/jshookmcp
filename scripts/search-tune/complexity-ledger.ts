/**
 * Mechanical complexity ledger for the Search engine.
 *
 * Counts, never estimates: score mechanisms, tunable parameters, runtime
 * dependencies, and Search module LOC. The ledger is a veto input, so a human
 * saying "we removed two boosts" is not evidence; this module is.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { SEARCH_MECHANISMS } from './ablation';
import { SEARCH_TUNE_PARAM_KEYS } from './search-space';

export interface ComplexityCounts {
  readonly scoreStages: number;
  readonly tunableParams: number;
  readonly runtimeDeps: number;
  readonly searchLoc: number;
}

export interface LedgerSource {
  read(): Promise<ComplexityCounts>;
}

export interface LedgerComparison {
  readonly before: ComplexityCounts;
  readonly after: ComplexityCounts;
  readonly withinBudget: boolean;
  readonly violations: readonly string[];
  readonly locTolerance: number;
}

const SEARCH_DIR = 'src/server/search';

/** Default source reads the live repo; tests inject their own counts. */
export function createRepoLedgerSource(rootDir = process.cwd()): LedgerSource {
  return {
    async read(): Promise<ComplexityCounts> {
      const [runtimeDeps, searchLoc] = await Promise.all([
        countRuntimeDeps(rootDir),
        countSearchLoc(rootDir),
      ]);
      return {
        scoreStages: SEARCH_MECHANISMS.length,
        tunableParams: SEARCH_TUNE_PARAM_KEYS.length,
        runtimeDeps,
        searchLoc,
      };
    },
  };
}

export async function computeComplexityLedger(
  source: LedgerSource = createRepoLedgerSource(),
): Promise<ComplexityCounts> {
  return source.read();
}

/**
 * Net-complexity veto: the three counts must not grow; LOC may grow by the
 * tolerance to absorb moved code without rewarding padding.
 */
export function compareComplexity(
  before: ComplexityCounts,
  after: ComplexityCounts,
  locTolerance = 0.1,
): LedgerComparison {
  const violations: string[] = [];
  if (after.scoreStages > before.scoreStages) violations.push('scoreStages');
  if (after.tunableParams > before.tunableParams) violations.push('tunableParams');
  if (after.runtimeDeps > before.runtimeDeps) violations.push('runtimeDeps');
  const locBudget = Math.floor(before.searchLoc * (1 + locTolerance));
  if (after.searchLoc > locBudget) violations.push('searchLoc');
  return {
    before,
    after,
    withinBudget: violations.length === 0,
    violations,
    locTolerance,
  };
}

async function countRuntimeDeps(rootDir: string): Promise<number> {
  const raw = await readFile(join(rootDir, 'package.json'), 'utf8');
  const parsed = JSON.parse(raw) as { dependencies?: Record<string, string> };
  return Object.keys(parsed.dependencies ?? {}).length;
}

async function countSearchLoc(rootDir: string): Promise<number> {
  const dir = join(rootDir, SEARCH_DIR);
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(dir, entry.name));
  const counts = await Promise.all(files.map(countLines));
  return counts.reduce((sum, value) => sum + value, 0);
}

async function countLines(path: string): Promise<number> {
  const text = await readFile(path, 'utf8');
  if (text.length === 0) return 0;
  const lines = text.split(/\r?\n/).length;
  return text.endsWith('\n') ? lines - 1 : lines;
}
