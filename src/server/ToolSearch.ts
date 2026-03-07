/**
 * BM25-based tool search engine for progressive tool discovery.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { allTools, getToolDomain } from '@server/ToolCatalog';

/* ---------- public types ---------- */

export interface ToolSearchResult {
  name: string;
  domain: string | null;
  shortDescription: string;
  score: number;
  isActive: boolean;
}

/* ---------- internal types ---------- */

interface ToolDocument {
  name: string;
  domain: string | null;
  description: string;
  shortDescription: string;
  tokens: string[];
  length: number;
}

interface PostingEntry {
  docIndex: number;
  tf: number;
  weight: number;
}

/* ---------- BM25 parameters ---------- */

const K1 = 1.5;
const B = 0.3;

/* ---------- tokenisation ---------- */

function tokenise(text: string): string[] {
  let normalised = text.replace(/[_\-]/g, ' ');
  normalised = normalised.replace(/([\u4e00-\u9fff])/g, ' $1 ');
  const words = normalised.split(/[^a-zA-Z0-9\u4e00-\u9fff]+/).filter(Boolean);

  const result: string[] = [];
  for (const word of words) {
    const lower = word.toLowerCase();
    const camelParts = word.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/);
    if (camelParts.length > 1) {
      for (const part of camelParts) {
        result.push(part.toLowerCase());
      }
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
  /** Sorted index keys for O(log V) prefix lookup instead of O(V) scan. */
  private readonly sortedKeys: string[];
  private readonly avgDocLength: number;
  private readonly docCount: number;
  private readonly domainOverrides?: ReadonlyMap<string, string>;
  private readonly domainScoreMultipliers?: ReadonlyMap<string, number>;
  private readonly toolScoreMultipliers?: ReadonlyMap<string, number>;

  constructor(
    tools?: Tool[],
    domainOverrides?: ReadonlyMap<string, string>,
    domainScoreMultipliers?: ReadonlyMap<string, number>,
    toolScoreMultipliers?: ReadonlyMap<string, number>,
  ) {
    const source = tools ?? allTools;
    this.domainOverrides = domainOverrides;
    this.domainScoreMultipliers = domainScoreMultipliers;
    this.toolScoreMultipliers = toolScoreMultipliers;
    this.docCount = source.length;

    let totalLength = 0;
    for (let i = 0; i < source.length; i++) {
      const tool = source[i]!;
      const domain = this.domainOverrides?.get(tool.name) ?? getToolDomain(tool.name);
      const description = tool.description ?? '';
      const shortDescription = extractShortDescription(description);

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
    this.sortedKeys = [...this.invertedIndex.keys()].sort();
  }

  search(
    query: string,
    topK = 10,
    activeToolNames?: ReadonlySet<string>
  ): ToolSearchResult[] {
    const queryTokens = tokenise(query);
    if (queryTokens.length === 0) {
      return [];
    }

    const scores = new Float64Array(this.docCount);

    for (const qToken of queryTokens) {
      this.scoreToken(qToken, scores);
      if (qToken.length >= 3) {
        // O(log V + P) prefix lookup via binary search on sorted keys,
        // replacing the previous O(V) full-scan approach.
        const prefixMatches = this.findPrefixMatches(qToken);
        for (const indexToken of prefixMatches) {
          if (indexToken !== qToken) {
            const postings = this.invertedIndex.get(indexToken);
            if (postings) {
              this.scorePostings(postings, this.docCount, scores, 0.5);
            }
          }
        }
      }
    }

    const queryNormalised = query.toLowerCase().replace(/[\s\-]+/g, '_');
    const queryTokenSet = new Set(queryTokens);

    for (let i = 0; i < this.docCount; i++) {
      if (scores[i]! <= 0) continue;
      const doc = this.docs[i]!;

      if (doc.name === queryNormalised) {
        scores[i]! *= 2.5;
        continue;
      }

      const nameTokens = tokenise(doc.name);
      const nameTokenSet = new Set(nameTokens);
      const matchedCount = queryTokens.filter((qt) => nameTokenSet.has(qt)).length;

      if (matchedCount > 0 && nameTokenSet.size > 0 && queryTokenSet.size > 0) {
        const coverage = matchedCount / nameTokenSet.size;
        const precision = matchedCount / queryTokenSet.size;
        scores[i]! *= 1 + 0.5 * coverage * precision;
      }

      const domainMultiplier = doc.domain
        ? (this.domainScoreMultipliers?.get(doc.domain) ?? 1)
        : 1;
      if (domainMultiplier !== 1) {
        scores[i]! *= domainMultiplier;
      }

      const toolMultiplier = this.toolScoreMultipliers?.get(doc.name) ?? 1;
      if (toolMultiplier !== 1) {
        scores[i]! *= toolMultiplier;
      }
    }

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

  getDomainSummary(): Array<{ domain: string | null; count: number; tools: string[] }> {
    const domainMap = new Map<string | null, string[]>();
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

  /**
   * Binary-search the sorted key array to find all tokens starting with `prefix`.
   * O(log V + P) where P = number of prefix matches, instead of O(V) full scan.
   */
  private findPrefixMatches(prefix: string): string[] {
    const keys = this.sortedKeys;
    // Binary search for the first key >= prefix
    let lo = 0;
    let hi = keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (keys[mid]! < prefix) lo = mid + 1;
      else hi = mid;
    }
    // Collect all keys that start with prefix
    const matches: string[] = [];
    while (lo < keys.length && keys[lo]!.startsWith(prefix)) {
      matches.push(keys[lo]!);
      lo++;
    }
    return matches;
  }

  private scorePostings(
    postings: PostingEntry[],
    _N: number,
    scores: Float64Array,
    multiplier: number
  ): void {
    const df = postings.length;
    const idf = Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1);

    for (const { docIndex, tf, weight } of postings) {
      const doc = this.docs[docIndex]!;
      const norm = 1 - B + B * (doc.length / this.avgDocLength);
      const tfNorm = (tf * (K1 + 1)) / (tf + K1 * norm);
      scores[docIndex]! += idf * tfNorm * weight * multiplier;
    }
  }
}

function extractShortDescription(description: string): string {
  if (!description) return '';
  const firstSentence = description.match(/^[^.!?\n]+[.!?]?/);
  if (firstSentence) {
    const result = firstSentence[0]!.trim();
    return result.length > 120 ? result.slice(0, 117) + '...' : result;
  }
  return description.length > 120 ? description.slice(0, 117) + '...' : description;
}
