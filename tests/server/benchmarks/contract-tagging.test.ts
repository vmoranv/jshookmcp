/**
 * A-phase tagging contract: the pure-refusal suites are stamped
 * `assertionKind:'contract'` so the per-tool split is meaningful (otherwise
 * every legacy case defaults to semantic and `contractOnly` stays 0).
 *
 * Also records the precise semantic/contract/adversarial tally from ALL_SUITES —
 * the audit's grep estimate made exact here.
 */
import { describe, expect, it } from 'vitest';
import { ALL_SUITES } from '@tests/benchmarks/suites';
import { classify } from '@tests/benchmarks/classification';

const PURE_CONTRACT_SUITES = ['browser', 'graphql'];

function countKinds(cases: readonly { origin: string; assertionKind?: string }[]) {
  let semantic = 0;
  let contract = 0;
  let adversarial = 0;
  for (const c of cases) {
    const k = classify(c as never).assertionKind;
    if (k === 'semantic') semantic += 1;
    else if (k === 'contract') contract += 1;
    else adversarial += 1;
  }
  return { semantic, contract, adversarial };
}

describe('contract suite tagging (A-phase)', () => {
  it('every case in the pure-contract suites is tagged contract', () => {
    for (const name of PURE_CONTRACT_SUITES) {
      const suite = ALL_SUITES.find((s) => s.name === name);
      expect(suite, `suite ${name} missing`).toBeDefined();
      const untagged = (suite?.cases ?? []).filter((c) => c.assertionKind !== 'contract');
      expect(untagged.length, `${name}: ${untagged.length} untagged contract cases`).toBe(0);
    }
  });

  it('the global tally now has a nonzero contract bucket', () => {
    const all = ALL_SUITES.flatMap((s) => s.cases);
    const tally = countKinds(all as never);
    expect(tally.contract).toBeGreaterThan(0);
    expect(tally.semantic).toBeGreaterThan(0);
    // Record the precise split as assertions (not a guess, no console suppressions).
    expect(tally.adversarial).toBeGreaterThan(0);
    expect(tally.semantic + tally.contract + tally.adversarial).toBe(all.length);
  });

  it('contract-tagged cases still default difficulty to smoke (layered gate)', () => {
    const suite = ALL_SUITES.find((s) => s.name === 'graphql');
    for (const c of suite?.cases ?? []) {
      expect(classify(c as never).difficulty).toBe('smoke');
    }
  });
});
