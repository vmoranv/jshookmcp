/**
 * Search rejection fixture — the negative-control complement to the
 * search-quality fixture, consumed ONLY by the retrieval benchmark
 * (tests/server/benchmarks/retrieval-metrics.test.ts). It is deliberately NOT
 * part of `search-quality.fixture.ts`: that fixture is the shared source of
 * truth for the SearchQuality regression test (which auto-expands every case
 * into a top-K relevance assertion) and the search-tune optimizer (whose
 * objective has no rejection term). Folding out-of-domain queries there would
 * break both contracts; keeping them here gives the rejection layer its own
 * measurable set.
 *
 * What "rejection" means here: the engine's out-of-domain gate
 * (`shouldRejectOutOfDomain`, default on) must return ZERO results for queries
 * whose intent is unrelated to any registered tool. A search layer that always
 * "finds" a tool for any English sentence is worse than useless — it hands the
 * agent a confident-looking wrong tool. This set pins that behavior the same
 * way the positive set pins ranking quality (the guide's ~10% unanswerable
 * requirement, applied to tool retrieval).
 *
 * Gate semantics this set relies on (do not regress silently):
 *   - queries with <4 unique content tokens bypass the gate by design;
 *   - queries carrying an intent bonus, a category boost, or an explicit tool
 *     mention bypass the gate by design;
 *   - everything else with in-vocab ratio <0.3 (or ≥4 unknown tokens) must
 *     produce an empty result list.
 * Every query below therefore avoids invocation verbs, tool names, and
 * category-trigger vocabulary (crypto/web/debug/…); they are everyday
 * out-of-domain sentences — the shape real misuse actually has.
 */

export interface SearchRejectionCase {
  /** Stable case id, e.g. "rej/cooking-recipe". */
  readonly name: string;
  /** Human-readable one-liner naming the out-of-domain intent. */
  readonly title: string;
  /** The query — must match NO registered tool. */
  readonly query: string;
  /** Why this query must be rejected (kept next to the case for triage). */
  readonly reason: string;
}

const OUT_OF_DOMAIN_QUERIES: readonly SearchRejectionCase[] = [
  {
    name: 'rej/cooking-recipe',
    title: 'cooking request has no tool analogue',
    query: 'best pasta carbonara recipe with pancetta and guanciale',
    reason: 'culinary vocabulary shares no tokens with the tool catalog',
  },
  {
    name: 'rej/romantic-poetry',
    title: 'literary question has no tool analogue',
    query: 'who wrote the famous poem about golden daffodils wandering lonely',
    reason: 'poetry/literature vocabulary is fully out of vocab',
  },
  {
    name: 'rej/houseplant-care',
    title: 'gardening advice has no tool analogue',
    query: 'repotting an overwatered monstera with mushy smelly roots indoors',
    reason: 'houseplant care terms share nothing with reverse-engineering tools',
  },
  {
    name: 'rej/travel-planning',
    title: 'travel logistics has no tool analogue',
    query: 'cheapest overnight trains from lisbon to kyoto passing through madrid',
    reason: 'travel geography terms are out of vocab',
  },
  {
    name: 'rej/guitar-chords',
    title: 'music learning has no tool analogue',
    query: 'beginner acoustic guitar chord progressions for folk ballads',
    reason: 'music vocabulary shares no tokens with the catalog',
  },
  {
    name: 'rej/home-renovation',
    title: 'construction regulation has no tool analogue',
    query: 'renovating victorian terrace chimney removal permits',
    reason: 'construction/regulatory terms are out of vocab',
  },
  {
    name: 'rej/cycling-tactics',
    title: 'sports commentary has no tool analogue',
    query: 'mountain descent pacing tactics for alpine grand tours',
    reason: 'sports vocabulary shares nothing with registered tools',
  },
  {
    name: 'rej/knitting-pattern',
    title: 'craft instruction has no tool analogue',
    query: 'knitting a chunky wool scarf with cable stitch panels',
    reason: 'craft terms are fully out of vocab',
  },
  {
    name: 'rej/baking-troubleshooting',
    title: 'baking diagnosis has no tool analogue',
    query: 'sourdough starter smells like acetone after feeding twice',
    reason: 'baking vocabulary is out of vocab',
  },
  {
    name: 'rej/companion-planting',
    title: 'agriculture advice has no tool analogue',
    query: 'companion planting tomatoes beside basil improves yields',
    reason: 'agricultural terms share no tokens with the catalog',
  },
  {
    name: 'rej/maritime-licence',
    title: 'hobby certification has no tool analogue',
    query: 'coastal navigation licence exam practice questions flashes',
    reason: 'maritime terms are out of vocab (deliberately avoids the word code)',
  },
  {
    name: 'rej/furniture-restoration',
    title: 'woodworking has no tool analogue',
    query: 'stripping varnish from an oak dining table without sanding',
    reason: 'woodworking terms share nothing with registered tools',
  },
];

export function buildSearchRejectionCases(): readonly SearchRejectionCase[] {
  return OUT_OF_DOMAIN_QUERIES;
}
