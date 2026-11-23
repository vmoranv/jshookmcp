#!/usr/bin/env node
/**
 * Audit: the tool count stated in README *prose* must equal the runtime registry count.
 *
 * WHY THIS EXISTS
 * ---------------
 * README.md / README.zh.md state the tool count in TWO independent places:
 *
 *   (1) the generated `<!-- metadata-sync:start -->` block, written by
 *       scripts/generate/metadata.mjs straight from the runtime registry, and
 *   (2) hand-written prose — "…exposes all 735 tools…" / "…全部 735 个工具…".
 *
 * `metadata:check` only ever validated (1). On 2026-10-04 the frida tools landed,
 * `metadata:sync` bumped (1) to 735, and (2) stayed at 733 — through the 0.4.0,
 * 0.4.1 and 0.4.2 releases, with CI green the whole time. This audit closes (2).
 *
 * FAILS THE BUILD
 *   1. Every "<n> tools" occurrence in README.md equals the registry tool count.
 *   2. Every "<n> 工具" occurrence in README.zh.md equals the registry tool count.
 *
 * ABORTS (exit 2) — "my conclusion is untrustworthy", which is a different claim
 * from "the repo is wrong":
 *   A. The matcher self-check disagrees with a labelled micro-fixture. A matcher
 *      that silently stopped matching would report zero problems — a PASS that
 *      means nothing. The fixtures are bidirectional (positive AND negative), so
 *      a matcher stuck at "always matches" is caught too.
 *   B. A README has no generated sync block, so we cannot prove we are reading
 *      the metadata-managed file we think we are.
 *
 * NOT A FAILURE, BY DESIGN: a README that states no tool count at all. There is
 * then no second copy to drift out of sync, so there is nothing to contradict.
 *
 * The prose is deliberately NOT rewritten by `metadata:sync`. Prose is authored
 * text; this audit's job is to refuse to let it drift *silently*, not to rewrite
 * somebody's sentence. A failure here is meant to be fixed by hand — which is
 * exactly why it must be loud.
 *
 * This audit is wired into `metadata:check` (so `pnpm check` and CI cover it)
 * and also runs standalone: `pnpm audit:readme-counts`.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

// Markdown emphasis may sit between the number and the noun ("all **735** tools"),
// so the gap class allows whitespace and emphasis characters. It is deliberately
// narrow: it cannot skip letters, so a match can never jump across words.
// `tools?` + \b keeps "735 toolsets" from counting as a tool count.
const EN_PROSE = /(\d[\d,]*)[\s*_`]*tools?\b/gi;
// Chinese needs no word-boundary escape (no case, no plural), but "个" is
// optional: both "735 个工具" and "735 工具" appear in the real README.
const ZH_PROSE = /(\d[\d,]*)[\s*_`]*(?:个)?\s*工具/g;

// Canary: the generated block. Its count sits AFTER the noun ("Built-in tools: `735`"),
// so it never satisfies the prose matchers above — the two sets are disjoint.
const EN_SYNC = /- Built-in tools:\s*`(\d[\d,]*)`/;
const ZH_SYNC = /- 内置工具数：\s*`(\d[\d,]*)`/;

export const LANGUAGES = {
  en: { id: 'en', pattern: EN_PROSE, syncBlock: EN_SYNC, noun: 'tools' },
  zh: { id: 'zh', pattern: ZH_PROSE, syncBlock: ZH_SYNC, noun: '工具' },
};

// ---------------------------------------------------------------------------
// Matcher self-check (runs on every invocation)
// ---------------------------------------------------------------------------

// Every entry is a labelled micro-fixture. `expect` is the list of numbers the
// matcher must extract. The negative cases matter as much as the positive ones:
// without them, a matcher broken into "always match" would sail through.
const MATCHER_SELF_CHECK = [
  {
    id: 'en-plain',
    lang: 'en',
    text: 'exposes all 735 tools at around 40K tokens',
    expect: ['735'],
  },
  { id: 'en-parenthesised', lang: 'en', text: '`full` (all 735 tools)', expect: ['735'] },
  { id: 'en-emphasis', lang: 'en', text: 'exposes all **735** tools', expect: ['735'] },
  { id: 'en-thousands-separator', lang: 'en', text: '1,024 tools', expect: ['1024'] },
  { id: 'en-singular', lang: 'en', text: '1 tool', expect: ['1'] },
  {
    id: 'en-negative-tokens',
    lang: 'en',
    text: 'loads about 3K tokens of tool metadata',
    expect: [],
  },
  { id: 'en-negative-count-after-noun', lang: 'en', text: '- Built-in tools: `735`', expect: [] },
  { id: 'en-negative-longer-word', lang: 'en', text: '735 toolsets are shipped', expect: [] },
  { id: 'zh-plain', lang: 'zh', text: '一次性暴露全部 735 个工具，约 40K token', expect: ['735'] },
  { id: 'zh-parenthesised', lang: 'zh', text: '`full`（全部 735 工具）', expect: ['735'] },
  { id: 'zh-negative-token', lang: 'zh', text: '加载约 3K token 的工具元数据', expect: [] },
  { id: 'zh-negative-count-after-noun', lang: 'zh', text: '- 内置工具数：`735`', expect: [] },
];

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/** @returns {{ raw: string, value: number, line: number, match: string }[]} */
export function collectProseCounts(text, lang) {
  const { pattern } = LANGUAGES[lang];
  if (!pattern) throw new Error(`unknown language "${lang}"`);
  // Fresh RegExp per call: a shared /g regex carries lastIndex between calls.
  const re = new RegExp(pattern.source, pattern.flags);
  return [...text.matchAll(re)].map((m) => ({
    raw: m[1],
    value: Number(m[1].replaceAll(',', '')),
    line: text.slice(0, m.index).split('\n').length,
    match: m[0],
  }));
}

/** @returns {string[]} one line per disagreement; empty means the matcher is healthy. */
export function runMatcherSelfCheck() {
  const problems = [];
  for (const fixture of MATCHER_SELF_CHECK) {
    const actual = collectProseCounts(fixture.text, fixture.lang).map((hit) => String(hit.value));
    if (actual.join(',') !== fixture.expect.join(',')) {
      problems.push(
        `${fixture.id}: expected [${fixture.expect.join(', ')}] but got [${actual.join(', ')}]`,
      );
    }
  }
  return problems;
}

/**
 * @param {object} input
 * @param {number} input.expectedToolCount
 * @param {{ name: string, lang: 'en'|'zh', text: string }[]} input.files
 * @returns {{ failures: object[], aborts: object[] }}
 */
export function auditReadmeCounts({ expectedToolCount, files }) {
  const failures = [];
  const aborts = [];

  // (A) Prove the matcher still works before trusting any "no problems" result.
  const matcherProblems = runMatcherSelfCheck();
  if (matcherProblems.length > 0) {
    aborts.push({ kind: 'matcher-self-check-failed', problems: matcherProblems });
    return { failures, aborts };
  }

  for (const file of files) {
    const lang = LANGUAGES[file.lang];
    if (!lang) {
      aborts.push({ kind: 'unknown-language', file: file.name, language: file.lang });
      continue;
    }

    // (B) Canary: this must be the metadata-managed README.
    if (!lang.syncBlock.test(file.text)) {
      aborts.push({
        kind: 'missing-sync-block',
        file: file.name,
        expected: `/${lang.syncBlock.source}/`,
      });
      continue;
    }

    for (const hit of collectProseCounts(file.text, lang.id)) {
      if (hit.value !== expectedToolCount) {
        failures.push({
          kind: 'stale-prose-count',
          file: file.name,
          line: hit.line,
          stated: hit.value,
          expected: expectedToolCount,
          match: hit.match,
        });
      }
    }
  }

  return { failures, aborts };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

// Generic renderer: iterate whatever keys the payload has rather than naming
// them. A hand-written key list would silently print nothing the day a new
// failure kind is added — the exact rot this audit exists to prevent.
function formatDetail(entry) {
  if (entry === null || entry === undefined) return '(no detail)';
  if (typeof entry !== 'object') return String(entry);
  return Object.entries(entry)
    .map(
      ([key, value]) =>
        `${key}=${value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value)}`,
    )
    .join('  ');
}

export function reportAudit(result, { expectedToolCount }) {
  for (const abort of result.aborts) {
    console.error(`[readme-counts] ABORT: ${abort.kind}`);
    console.error(`    ${formatDetail(abort)}`);
  }
  if (result.aborts.some((a) => a.kind === 'matcher-self-check-failed')) {
    console.error(
      '[readme-counts] the matcher is broken, so "no problems found" would be meaningless.',
    );
  }

  for (const failure of result.failures) {
    console.error(
      `[readme-counts] STALE: ${failure.file}:${failure.line} states "${failure.match}"`,
    );
    console.error(`    expected ${expectedToolCount}, found ${failure.stated} — fix it by hand.`);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

async function main() {
  // Leaf module: the audit CLI needs the registry probe without the rest of
  // generate-metadata (which statically imports this module's pure functions —
  // the probe lived there and created the cycle).
  const { loadRegistrySummary } = await import('../lib/registry-probe.mjs');
  const summary = await loadRegistrySummary();

  const files = [
    { name: 'README.md', lang: 'en', text: await readFile(join(projectRoot, 'README.md'), 'utf8') },
    {
      name: 'README.zh.md',
      lang: 'zh',
      text: await readFile(join(projectRoot, 'README.zh.md'), 'utf8'),
    },
  ];

  const result = auditReadmeCounts({ expectedToolCount: summary.toolCount, files });

  if (result.aborts.length > 0) {
    reportAudit(result, { expectedToolCount: summary.toolCount });
    process.exit(2);
  }
  if (result.failures.length > 0) {
    reportAudit(result, { expectedToolCount: summary.toolCount });
    console.error(`[readme-counts] FAIL: ${result.failures.length} stale prose count(s).`);
    process.exit(1);
  }

  console.log(
    `[readme-counts] PASS: README prose agrees with the runtime registry (tools=${summary.toolCount}).`,
  );
}

const isCliEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isCliEntry) {
  main().catch((error) => {
    console.error(
      `[readme-counts] Fatal error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  });
}
