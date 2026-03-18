/**
 * Hybrid BM25 + TF-IDF cosine tool search engine for progressive tool discovery.
 *
 * GraphBoost-inspired enhancements (see GraphBoost paper):
 * - TF-IDF cosine hybrid scoring (§4.1.3 hybrid retrieval)
 * - Tool affinity graph with prefix-group expansion (§4.1.4 dependency hull)
 * - Query category adaptive domain weights (§4.1.3 task-type encoding)
 * - LRU query result cache (§4.3 CSAPC cross-session caching)
 *
 * @deprecated Use @server/search/ToolSearchEngine instead
 */
export { ToolSearchEngine, type ToolSearchResult } from './search/ToolSearchEngineImpl';
