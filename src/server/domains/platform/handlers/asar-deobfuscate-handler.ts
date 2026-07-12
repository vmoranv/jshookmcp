/**
 * asar_deobfuscate — batch obfuscation inventory + extraction for ASAR JS files.
 *
 * Scans every .js entry inside an ASAR archive for obfuscation indicators
 * (string-array arrays, webpack bundles, control-flow flattening, dynamic
 * code, minification heuristics), classifies each file, and optionally
 * extracts flagged files to a directory for downstream deobfuscation.
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import type { ToolResponse } from '@server/types';
import { parseAsarBuffer } from '@server/domains/platform/handlers/electron-asar-helpers';
import {
  parseStringArg,
  parseBooleanArg,
  pathExists,
  resolveOutputDirectory,
  resolveSafeOutputPath,
  toDisplayPath,
  toErrorResponse,
  toTextResponse,
} from '@server/domains/platform/handlers/platform-utils';

export type ObfuscationClassification =
  | 'clean'
  | 'minified'
  | 'webpack-bundle'
  | 'obfuscated'
  | 'heavy-obfuscation'
  | 'packed'
  | 'encrypted';

export interface AsarFileObfuscationReport {
  path: string;
  size: number;
  classification: ObfuscationClassification;
  score: number;
  indicators: Record<string, number | boolean | string>;
}

export interface AsarDeobfuscateResult {
  success: boolean;
  tool: 'asar_deobfuscate';
  inputPath: string;
  filesScanned: number;
  summary: Record<ObfuscationClassification, number>;
  flaggedFiles: AsarFileObfuscationReport[];
  outputDir: string | null;
  extractedCount: number;
}

const MIN_FLAG_SCORE = 30;

// Pre-compiled hot-path regexes — these were previously created fresh per
// file inside analyzeFile(), which re-jitted the same patterns hundreds of
// times across a 500-file ASAR scan. Hoisting them to module scope makes the
// scan O(files × filesize) in matching cost, with zero per-file compile.
const HEX_NAME_RE = /_0x[0-9a-fA-F]{4,8}/g;
const EVAL_ATOB_RE = /\beval\s*\(\s*atob\s*\(/;
const NEW_FUNCTION_RE = /\bnew\s+Function\s*\(/;
const EVAL_BASE64_RE = /\beval\s*\(\s*(?:window\.|global\.)?atob\s*\(/;
const HEX_LITERAL_RE = /\b0x[0-9a-fA-F]{4,}\b/g;
const LOOP_SWITCH_RE =
  /(?:while\s*\([^)]*\)\s*\{|for\s*\([^)]*\)\s*\{)[\s\S]{0,2000}?\bswitch\s*\(/g;
const HEX_CASE_RE = /case\s+0x[0-9a-fA-F]+:/g;
const DECIMAL_CASE_RE = /case\s+\d+:/g;

export async function handleAsarDeobfuscate(args: Record<string, unknown>): Promise<ToolResponse> {
  try {
    const inputPath = parseStringArg(args, 'inputPath', true);
    if (!inputPath) throw new Error('inputPath is required');

    const fileGlob = parseStringArg(args, 'fileGlob') || '*.js';
    const extract = parseBooleanArg(args, 'extract', true);
    const outputDirArg = parseStringArg(args, 'outputDir');
    const maxFiles = typeof args.maxFiles === 'number' && args.maxFiles > 0 ? args.maxFiles : 500;

    const absInputPath = resolve(inputPath);
    if (!(await pathExists(absInputPath))) {
      return toTextResponse({
        success: false,
        tool: 'asar_deobfuscate',
        error: `File does not exist: ${inputPath}`,
      });
    }

    const asarBuffer = await readFile(absInputPath);
    const parsedAsar = parseAsarBuffer(asarBuffer);

    const globExt = fileGlob.startsWith('*.') ? fileGlob.slice(1).toLowerCase() : null;
    const matchAll = fileGlob === '*';

    const jsEntries = parsedAsar.files.filter((entry) => {
      if (entry.unpacked || entry.size <= 0) return false;
      if (matchAll) return true;
      if (globExt) return extname(entry.path).toLowerCase() === globExt;
      return extname(entry.path).toLowerCase() === '.js';
    });

    const reports: AsarFileObfuscationReport[] = [];
    let scanned = 0;

    for (const entry of jsEntries) {
      if (scanned >= maxFiles) break;
      const start = parsedAsar.dataOffset + entry.offset;
      const end = start + entry.size;
      if (start < 0 || end > asarBuffer.length || end < start) continue;

      const bytes = asarBuffer.subarray(start, end);
      reports.push(analyzeFile(entry.path, entry.size, bytes.toString('utf-8'), bytes));
      scanned += 1;
    }

    // Flag files that warrant extraction: anything that is not clean or merely
    // minified. Webpack bundles, obfuscated, heavy-obfuscation, packed and
    // encrypted files are extracted even at low numeric scores so they reach
    // downstream deobf tools. Packed/encrypted payloads in particular score ~0
    // on the code-shape heuristics but must still be surfaced.
    const flagged = reports.filter(
      (report) =>
        report.score >= MIN_FLAG_SCORE ||
        report.classification === 'webpack-bundle' ||
        report.classification === 'obfuscated' ||
        report.classification === 'heavy-obfuscation' ||
        report.classification === 'packed' ||
        report.classification === 'encrypted',
    );
    flagged.sort((a, b) => b.score - a.score);

    let outputDir: { absolutePath: string; displayPath: string } | null = null;
    let extractedCount = 0;

    if (extract && flagged.length > 0) {
      outputDir = await resolveOutputDirectory(
        'asar-deobfuscate',
        basename(absInputPath, extname(absInputPath)),
        outputDirArg,
      );

      for (const report of flagged) {
        const entry = parsedAsar.files.find((file) => file.path === report.path);
        if (!entry || entry.unpacked) continue;
        const start = parsedAsar.dataOffset + entry.offset;
        const end = start + entry.size;
        if (end > asarBuffer.length) continue;
        const data = asarBuffer.subarray(start, end);
        const outputPath = resolveSafeOutputPath(outputDir.absolutePath, report.path);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, data);
        extractedCount += 1;
      }
    }

    const summary: Record<ObfuscationClassification, number> = {
      clean: 0,
      minified: 0,
      'webpack-bundle': 0,
      obfuscated: 0,
      'heavy-obfuscation': 0,
      packed: 0,
      encrypted: 0,
    };
    for (const report of reports) {
      summary[report.classification] += 1;
    }

    const result: AsarDeobfuscateResult = {
      success: true,
      tool: 'asar_deobfuscate',
      inputPath: toDisplayPath(absInputPath),
      filesScanned: scanned,
      summary,
      flaggedFiles: flagged,
      outputDir: outputDir?.displayPath ?? null,
      extractedCount,
    };

    return toTextResponse(result);
  } catch (error) {
    return toErrorResponse('asar_deobfuscate', error);
  }
}

/**
 * Analyze a single JS file's source for obfuscation indicators and return a
 * classification + numeric score. Indicators are intentionally cheap regex /
 * counting heuristics — they flag files for deeper analysis, not produce a
 * deobfuscated output directly.
 */
function analyzeFile(
  path: string,
  size: number,
  content: string,
  bytes: Buffer,
): AsarFileObfuscationReport {
  const indicators: Record<string, number | boolean | string> = {};
  let score = 0;

  // Shannon entropy over the raw byte slice (high entropy ⇒ packed / encrypted
  // payload; plain JS code sits around 4.5–5.0 bits/byte). Computed from bytes
  // rather than the utf-8 string so binary / non-UTF-8 payloads score correctly.
  const entropy = computeShannonEntropy(bytes);
  indicators.entropy = Number(entropy.toFixed(3));

  // String-array obfuscation: high density of _0x[0-9a-f]{4,} identifiers.
  // Reset lastIndex because the regex is module-scoped (shared state) and
  // match() returns null on a non-global flag — but we use the g-flag pattern
  // via String.match which is stateless for the global flag.
  const hexNameMatches = content.match(HEX_NAME_RE);
  const hexNameCount = hexNameMatches ? hexNameMatches.length : 0;
  indicators.hexNameCount = hexNameCount;
  if (hexNameCount > 50) {
    score += 45;
  } else if (hexNameCount > 20) {
    score += 30;
  }

  // Webpack bundling.
  const webpackRequireCount = countOccurrences(content, '__webpack_require__');
  const webpackModulesCount = countOccurrences(content, '__webpack_modules__');
  indicators.webpackRequireCount = webpackRequireCount;
  indicators.webpackModulesCount = webpackModulesCount;
  if (webpackRequireCount > 0 || webpackModulesCount > 0) {
    score += 10;
  }

  // Dynamic code execution.
  const evalAtob = EVAL_ATOB_RE.test(content);
  const newFunction = NEW_FUNCTION_RE.test(content);
  const evalBase64 = EVAL_BASE64_RE.test(content);
  indicators.dynamicCode = evalAtob || newFunction || evalBase64;
  if (indicators.dynamicCode) {
    score += 25;
  }

  // Minification heuristic: average line length + long-line ratio.
  const lines = content.split('\n');
  const lineCount = lines.length;
  const longLines = lines.filter((line) => line.length > 500).length;
  const avgLineLength = lineCount > 0 ? Math.round(content.length / lineCount) : 0;
  const longLineRatio = lineCount > 0 ? longLines / lineCount : 0;
  indicators.lineCount = lineCount;
  indicators.avgLineLength = avgLineLength;
  indicators.longLineRatio = Number(longLineRatio.toFixed(2));
  if (avgLineLength > 500 && longLineRatio > 0.3) {
    score += 20;
    indicators.minified = true;
  } else {
    indicators.minified = false;
  }

  // Control-flow flattening: large switch inside a while/for loop.
  const switchInLoop = detectSwitchInLoop(content);
  indicators.switchInLoop = switchInLoop;
  if (switchInLoop) {
    score += 25;
  }

  // Numeric/string literal flood (common in packed payloads).
  const numericLiteralMatches = content.match(HEX_LITERAL_RE);
  const hexLiteralCount = numericLiteralMatches ? numericLiteralMatches.length : 0;
  indicators.hexLiteralCount = hexLiteralCount;
  if (hexLiteralCount > 100) {
    score += 10;
  }

  const classification = classify(score, indicators);
  if (score > 100) score = 100;

  return {
    path,
    size,
    classification,
    score,
    indicators,
  };
}

function classify(
  score: number,
  indicators: Record<string, number | boolean | string>,
): ObfuscationClassification {
  const entropy = typeof indicators.entropy === 'number' ? indicators.entropy : 0;
  // Near-uniform random byte distribution almost never occurs in valid JS — it
  // signals an encrypted / opaque blob. Override before code-shape checks.
  if (entropy >= 7.5) return 'encrypted';
  if (score >= 60) return 'heavy-obfuscation';
  if (score >= 30) return 'obfuscated';
  if ((indicators.webpackRequireCount as number) > 0) return 'webpack-bundle';
  // Compressed / packed payloads (gzip, eval-packed base64) land here: high but
  // not uniform entropy and no JS-shape signal.
  if (entropy >= 6.5) return 'packed';
  if (indicators.minified === true) return 'minified';
  return 'clean';
}

/**
 * Shannon entropy over a byte slice, in bits/byte (0–8). A plain-text / source
 * file sits around 4–5; compressed data around 6.5–7.5; encrypted or random
 * data approaches 8. Single-pass byte histogram — O(n) with a 256-entry table.
 */
function computeShannonEntropy(bytes: Buffer): number {
  if (bytes.length === 0) return 0;
  const histogram = Array.from({ length: 256 }, () => 0);
  for (let i = 0; i < bytes.length; i += 1) {
    histogram[bytes[i]!] = (histogram[bytes[i]!] ?? 0) + 1;
  }
  let entropy = 0;
  const total = bytes.length;
  for (const count of histogram) {
    if (count === 0) continue;
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Detect control-flow flattening: a `while`/`for` loop containing a `switch`
 * with many sequential numeric case labels (the dispatcher pattern).
 */
function detectSwitchInLoop(content: string): boolean {
  // LOOP_SWITCH_RE carries the global flag; reset lastIndex so a previous
  // caller's state never bleeds into this scan (defensive — exec advances it).
  LOOP_SWITCH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LOOP_SWITCH_RE.exec(content)) !== null) {
    const switchStart = match.index + match[0].length;
    const switchBody = content.slice(switchStart, switchStart + 4000);
    const caseLabels = switchBody.match(HEX_CASE_RE);
    if (caseLabels && caseLabels.length >= 5) {
      return true;
    }
    const decimalCases = switchBody.match(DECIMAL_CASE_RE);
    if (decimalCases && decimalCases.length >= 5) {
      return true;
    }
  }
  return false;
}
