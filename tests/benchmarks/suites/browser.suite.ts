/**
 * browser domain benchmark — contract subset for the 59 CDP/page-bound tools.
 *
 * No live browser is involved: the substrate raises the same
 * PrerequisiteError the real collector/page controller raise when nothing is
 * attached, so every case asserts a real product contract.
 */
import type { BenchSuite } from '../harness';
import { browserContractCases } from './browser.contracts';

export const browserSuite: BenchSuite = {
  name: 'browser',
  domain: 'browser',
  description:
    'CDP/page-bound browser tools: named no-browser failures with no fabricated payload (screenshots/metrics/verdicts), plus argument validation before any page access (59 tools)',
  cases: [...browserContractCases],
};
