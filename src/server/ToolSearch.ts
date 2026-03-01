/**
 * BM25-based tool search engine for progressive tool discovery.
 *
 * Builds an inverted index from all tool definitions at startup and
 * supports fast keyword search with BM25 scoring.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { type ToolDomain, allTools, getToolDomain } from './ToolCatalog.js';

/* ---------- public types ---------- */

export interface ToolSearchResult {
  name: string;
  domain: ToolDomain | null;
  shortDescription: string;
  score: number;
  /** Whether this tool is currently registered with the MCP server. */
  isActive: boolean;
}

/* ---------- internal types ---------- */

interface ToolDocument {
  name: string;
  domain: ToolDomain | null;
  description: string;
  shortDescription: string;
  /** Pre-tokenised bag-of-words (lowercased). */
  tokens: string[];
  /** Token count (for BM25 length normalisation). */
  length: number;
}

interface PostingEntry {
  docIndex: number;
  /** Term frequency in this document. */
  tf: number;
  /** Weight multiplier (name=3, domain=2, description=1). */
  weight: number;
}

/* ---------- BM25 parameters ---------- */

const K1 = 1.5;
/** Lowered from standard 0.75 to reduce description-length bias in tool ranking. */
const B = 0.3;

/* ---------- tokenisation ---------- */

/**
 * Simple tokeniser that handles:
 *  - snake_case splitting (e.g. page_navigate → page, navigate)
 *  - camelCase splitting (e.g. WebSocket → web, socket, websocket)
 *  - CJK character splitting (each char becomes a token)
 *  - lowercasing
 *  - Preserves original compound words alongside splits
 */
function tokenise(text: string): string[] {
  // Replace underscores and hyphens with spaces
  let normalised = text.replace(/[_\-]/g, ' ');
  // Split CJK characters into individual tokens
  normalised = normalised.replace(/([\u4e00-\u9fff])/g, ' $1 ');
  // Split on whitespace first
  const words = normalised.split(/[^a-zA-Z0-9\u4e00-\u9fff]+/).filter(Boolean);

  const result: string[] = [];
  for (const word of words) {
    const lower = word.toLowerCase();
    // Split camelCase: "WebSocket" → ["Web", "Socket"]
    const camelParts = word.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/);
    if (camelParts.length > 1) {
      // Emit individual parts AND the combined form
      for (const part of camelParts) {
        result.push(part.toLowerCase());
      }
      // Combined form: "WebSocket" → "websocket"
      result.push(lower);
    } else {
      result.push(lower);
    }
  }
  return result;
}

/* ---------- ToolSearchEngine ---------- */

export class ToolSearchEngine {
  private readonly docs: ToolDocument[] = [];
  private readonly invertedIndex = new Map<string, PostingEntry[]>();
  private readonly avgDocLength: number;
  private readonly docCount: number;

  constructor(tools?: Tool[]) {
    const source = tools ?? allTools;
    this.docCount = source.length;

    // Phase 1: build documents
    let totalLength = 0;
    for (let i = 0; i < source.length; i++) {
      const tool = source[i]!;
      const domain = getToolDomain(tool.name);
      const description = tool.description ?? '';
      const shortDescription = extractShortDescription(description);

      // Build token bag with weighting:
      //   name tokens → weight 3
      //   domain tokens → weight 2
      //   description tokens → weight 1
      const nameTokens = tokenise(tool.name);
      const domainTokens = domain ? tokenise(domain) : [];
      const descTokens = tokenise(description);

      const allTokens = [...nameTokens, ...domainTokens, ...descTokens];

      const doc: ToolDocument = {
        name: tool.name,
        domain,
        description,
        shortDescription,
        tokens: allTokens,
        length: allTokens.length,
      };
      this.docs.push(doc);
      totalLength += doc.length;

      // Build inverted index with weights
      const termFreqs = new Map<string, { tf: number; weight: number }>();

      for (const token of nameTokens) {
        const entry = termFreqs.get(token) ?? { tf: 0, weight: 0 };
        entry.tf++;
        entry.weight = Math.max(entry.weight, 3);
        termFreqs.set(token, entry);
      }
      for (const token of domainTokens) {
        const entry = termFreqs.get(token) ?? { tf: 0, weight: 0 };
        entry.tf++;
        entry.weight = Math.max(entry.weight, 2);
        termFreqs.set(token, entry);
      }
      for (const token of descTokens) {
        const entry = termFreqs.get(token) ?? { tf: 0, weight: 0 };
        entry.tf++;
        entry.weight = Math.max(entry.weight, 1);
        termFreqs.set(token, entry);
      }

      for (const [token, { tf, weight }] of termFreqs) {
        let postings = this.invertedIndex.get(token);
        if (!postings) {
          postings = [];
          this.invertedIndex.set(token, postings);
        }
        postings.push({ docIndex: i, tf, weight });
      }
    }

    this.avgDocLength = this.docCount > 0 ? totalLength / this.docCount : 1;
  }

  /**
   * Search for tools matching the given query.
   *
   * @param query  Free-text query (supports multi-word, CJK, snake_case)
   * @param topK   Maximum number of results (default 10)
   * @param activeToolNames  Set of currently registered tool names (for isActive flag)
   * @returns Ranked search results
   */
  search(
    query: string,
    topK = 10,
    activeToolNames?: ReadonlySet<string>
  ): ToolSearchResult[] {
    const queryTokens = tokenise(query);
    if (queryTokens.length === 0) {
      return [];
    }

    // Accumulate BM25 scores per document
    const scores = new Float64Array(this.docCount);

    for (const qToken of queryTokens) {
      // Exact match
      this.scoreToken(qToken, scores);

      // Prefix match (for partial queries like "debug" matching "debugger")
      if (qToken.length >= 3) {
        for (const [indexToken, postings] of this.invertedIndex) {
          if (indexToken !== qToken && indexToken.startsWith(qToken)) {
            // Prefix match gets 0.5x weight penalty
            this.scorePostings(postings, this.docCount, scores, 0.5);
          }
        }
      }
    }

    // Phase 2: Name alignment bonus — rewards tools whose names closely match the query.
    // This counteracts BM25's tendency to favour short-description tools when name match is equal.
    const queryNormalised = query.toLowerCase().replace(/[\s\-]+/g, '_');
    const queryTokenSet = new Set(queryTokens);

    for (let i = 0; i < this.docCount; i++) {
      if (scores[i]! <= 0) continue;
      const doc = this.docs[i]!;

      // Exact full-name match: massive bonus (query IS the tool name)
      if (doc.name === queryNormalised) {
        scores[i]! *= 2.5;
        continue;
      }

      // Partial name alignment
      const nameTokens = tokenise(doc.name);
      const nameTokenSet = new Set(nameTokens);
      const matchedCount = queryTokens.filter((qt) => nameTokenSet.has(qt)).length;

      if (matchedCount > 0) {
        // coverage: fraction of name tokens matched by query (higher = query is more specific to this tool)
        const coverage = matchedCount / nameTokenSet.size;
        // precision: fraction of query tokens found in name (higher = name is more relevant to query)
        const precision = matchedCount / queryTokenSet.size;
        // Multiplier: up to 1.5x for perfect coverage+precision
        scores[i]! *= 1 + 0.5 * coverage * precision;
      }
    }

    // Collect top-K
    const active = activeToolNames ?? new Set<string>();
    const candidates: ToolSearchResult[] = [];

    for (let i = 0; i < this.docCount; i++) {
      if (scores[i]! > 0) {
        const doc = this.docs[i]!;
        candidates.push({
          name: doc.name,
          domain: doc.domain,
          shortDescription: doc.shortDescription,
          score: Math.round(scores[i]! * 1000) / 1000,
          isActive: active.has(doc.name),
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, topK);
  }

  /** Get all domains and their tool counts. */
  getDomainSummary(): Array<{ domain: ToolDomain | null; count: number; tools: string[] }> {
    const domainMap = new Map<ToolDomain | null, string[]>();
    for (const doc of this.docs) {
      const list = domainMap.get(doc.domain) ?? [];
      list.push(doc.name);
      domainMap.set(doc.domain, list);
    }
    return Array.from(domainMap.entries())
      .map(([domain, tools]) => ({ domain, count: tools.length, tools }))
      .sort((a, b) => b.count - a.count);
  }

  private scoreToken(token: string, scores: Float64Array): void {
    const postings = this.invertedIndex.get(token);
    if (!postings) return;
    this.scorePostings(postings, this.docCount, scores, 1.0);
  }

  private scorePostings(
    postings: PostingEntry[],
    _N: number,
    scores: Float64Array,
    multiplier: number
  ): void {
    const df = postings.length;
    // IDF = ln((N - df + 0.5) / (df + 0.5) + 1)
    const idf = Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1);

    for (const { docIndex, tf, weight } of postings) {
      const doc = this.docs[docIndex]!;
      const norm = 1 - B + B * (doc.length / this.avgDocLength);
      // BM25 score component
      const tfNorm = (tf * (K1 + 1)) / (tf + K1 * norm);
      scores[docIndex]! += idf * tfNorm * weight * multiplier;
    }
  }
}

/* ---------- helpers ---------- */

/** Extract the first sentence of a description as a short summary. */
function extractShortDescription(description: string): string {
  if (!description) return '';
  // Try to get first sentence (up to period, or first line)
  const firstSentence = description.match(/^[^.!?\n]+[.!?]?/);
  if (firstSentence) {
    const result = firstSentence[0]!.trim();
    return result.length > 120 ? result.slice(0, 117) + '...' : result;
  }
  return description.length > 120 ? description.slice(0, 117) + '...' : description;
}
