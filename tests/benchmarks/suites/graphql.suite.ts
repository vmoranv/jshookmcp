/**
 * graphql domain benchmark — contract subset (no live page, no external network).
 *
 * Every case asserts an admission or SSRF decision that is testable on any
 * machine: a page-bound tool refuses with a named PREREQUISITE reason, a
 * private/reserved endpoint is blocked by name, and a missing required
 * argument is rejected before any page or network access.
 */
import type { BenchSuite } from '../harness';
import { graphqlContractCases } from './graphql.contracts';

export const graphqlSuite: BenchSuite = {
  name: 'graphql',
  domain: 'graphql',
  description:
    'graphql admission + SSRF contracts: page prerequisites, private-endpoint refusal, required endpoint/url/replacement arguments (7 tools)',
  cases: [...graphqlContractCases],
};
