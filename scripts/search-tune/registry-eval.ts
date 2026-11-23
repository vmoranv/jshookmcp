/**
 * Registry-level evaluation entry (739 tools).
 *
 * Thin adapter over the single seam: it only selects corpus=registry and a
 * default request shape. No metric semantics live here.
 */

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { runSearchEvaluation } from './evaluation';
import type { EvaluationReport } from './evaluation';

export async function evaluateRegistry(outPath?: string): Promise<EvaluationReport> {
  const report = await runSearchEvaluation({
    corpus: 'registry',
    latencyRepeats: 2,
    include: { ledger: true, perCase: false, significance: false },
  });
  const json = JSON.stringify(report, null, 2);
  if (outPath && outPath.length > 0) await writeFile(outPath, json, 'utf8');
  else console.log(json);
  return report;
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const index = args.indexOf('--out');
  const out = index >= 0 ? args[index + 1] : undefined;
  await evaluateRegistry(out);
}
