/**
 * VMHandlerCanonicalizer — Normalize and classify VM handler functions.
 *
 * Modern javascript-obfuscator and JS-Confuser VM modes use:
 *   - Dynamic opcode derivation (base36 encode/decode, rotated keys)
 *   - Stateful dispatch (while/switch with variable opcodes)
 *   - Per-build mutation (different opcode maps for each build)
 *   - Integrity checks that detect handler modification
 *
 * This module:
 *   1. Extracts VM handler functions from the obfuscated code
 *   2. Canonicalizes handler signatures (normalizes variable names, removes mutation)
 *   3. Builds an "opcode genome" — a fingerprint of the VM's instruction set
 *   4. Maps handlers to semantic operations (ADD, PUSH, CALL, JMP, etc.)
 *   5. Enables cross-build comparison of VM-obfuscated samples
 *
 * Inspired by:
 *   - webcrack's reference-driven transforms and conflict-safe rename
 *   - VMProtect-devirtualization research
 *   - Google/jsir's abstract domain extensions for VM opcode analysis
 *
 * Design: Functional, immutable, small components. All string handling is UTF-8 safe.
 */

import { logger } from '@utils/logger';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';

// ── Types ──

export interface VMHandler {
  /** Canonical handler ID (stable across builds with same genome) */
  id: string;
  /** Original case/opcode label (e.g., "case 42:") */
  rawOpcode: string;
  /** Canonical opcode name (e.g., "PUSH_STACK", "ADD", "CALL") */
  canonicalOpcode: string;
  /** The handler function's AST node */
  handlerNode: t.Statement | null;
  /** Canonicalized source of the handler */
  canonicalSource: string;
  /** Semantic classification */
  semanticCategory: HandlerCategory;
  /** Stack effect of this handler */
  stackEffect: { push: number; pop: number };
  /** Confidence in classification (0-1) */
  confidence: number;
  /** Which prelude functions this handler references */
  preludeRefs: string[];
}

export type HandlerCategory =
  | 'stack-op' // push, pop, dup, swap
  | 'arithmetic' // add, sub, mul, div, mod
  | 'comparison' // eq, neq, lt, gt, lte, gte
  | 'logic' // and, or, xor, not
  | 'control-flow' // jmp, jz, jnz, call, ret
  | 'memory' // load, store, get, set
  | 'string-op' // concat, charAt, substring, split
  | 'type-coercion' // toNumber, toString, typeof
  | 'environment' // window, document, navigator access
  | 'crypto' // hash, encrypt, decrypt
  | 'unknown';

export interface OpcodeGenome {
  /** Hash of the full genome for cross-sample comparison */
  genomeHash: string;
  /** Number of handlers */
  handlerCount: number;
  /** Handler categories histogram */
  categoryHistogram: Record<HandlerCategory, number>;
  /** All handlers in dispatch order */
  handlers: VMHandler[];
  /** String table reference pattern (e.g., _0x1a2b) */
  stringTablePattern: string | null;
  /** Dispatch variable name */
  dispatchVarName: string | null;
  /** Whether the VM uses rotated opcodes */
  hasRotatedOpcodes: boolean;
  /** Whether the VM has integrity checks */
  hasIntegrityChecks: boolean;
  /** Overall VM complexity score */
  complexityScore: number;
  /** Obfuscation tool identifier (if known) */
  toolIdentifier: string | null;
}

export interface CanonicalizeResult {
  /** Whether canonicalization succeeded */
  ok: boolean;
  /** The opcode genome */
  genome: OpcodeGenome;
  /** Warnings during canonicalization */
  warnings: string[];
  /** Number of handlers that were successfully classified */
  classifiedCount: number;
  /** Number of handlers that remain unknown */
  unknownCount: number;
}

// ── Opcode Detection Patterns ──

/** Patterns that identify handler categories by AST structure */
const CATEGORY_PATTERNS: Array<{
  category: HandlerCategory;
  patterns: Array<(node: t.Statement) => boolean>;
  stackPush: number;
  stackPop: number;
}> = [
  {
    category: 'stack-op',
    patterns: [
      // stack.push(...)
      (n) => generate(n).code.includes('.push('),
      // stack.pop()
      (n) => generate(n).code.includes('.pop()'),
      // stack[stack.length - 1]
      (n) => /\[\s*\w+\.length\s*-\s*1\s*\]/.test(generate(n).code),
    ],
    stackPush: 1,
    stackPop: 0,
  },
  {
    category: 'arithmetic',
    patterns: [
      (n) => /\b(\w+)\s*[+\-*/%]\s*(\w+)\b/.test(generate(n).code),
      (n) => containsOperator(n, ['+', '-', '*', '/', '%']),
    ],
    stackPush: 1,
    stackPop: 2,
  },
  {
    category: 'comparison',
    patterns: [
      (n) => containsOperator(n, ['===', '!==', '==', '!=', '<', '>', '<=', '>=']),
      (n) => /\bif\s*\(/.test(generate(n).code) && /\?|:/.test(generate(n).code),
    ],
    stackPush: 1,
    stackPop: 2,
  },
  {
    category: 'logic',
    patterns: [
      (n) => containsOperator(n, ['&&', '||']),
      (n) => /\b(~|&|\||\^)\b/.test(generate(n).code),
    ],
    stackPush: 1,
    stackPop: 2,
  },
  {
    category: 'control-flow',
    patterns: [
      (n) =>
        /\b(push|unshift|shift)\s*\(/.test(generate(n).code) &&
        /\b=\s*[\w$]+\s*[\+\-](\d+|[\w$]+)/.test(generate(n).code),
      (n) => /\bcontinue\b|\bbreak\b/.test(generate(n).code) && /\bswitch\b/.test(generate(n).code),
    ],
    stackPush: 0,
    stackPop: 0,
  },
  {
    category: 'memory',
    patterns: [
      (n) =>
        /\[\s*['"][\w$]+['"]\s*\]/.test(generate(n).code) &&
        !/\bpush\b|\bpop\b/.test(generate(n).code),
      (n) =>
        /\bvar\b[\s\S]*=\s*\w+\[/.test(generate(n).code) && /\b=\s*\w+\[/.test(generate(n).code),
    ],
    stackPush: 1,
    stackPop: 1,
  },
  {
    category: 'string-op',
    patterns: [
      (n) =>
        /\b(charAt|substring|slice|split|indexOf|replace|toLowerCase|toUpperCase|trim)\b/.test(
          generate(n).code,
        ),
      (n) => /\b\+\s*['"]/.test(generate(n).code) || /['"]\s*\+/.test(generate(n).code),
    ],
    stackPush: 1,
    stackPop: 1,
  },
  {
    category: 'type-coercion',
    patterns: [
      (n) => /\b(Number|String|Boolean|parseInt|parseFloat|typeof)\s*\(/.test(generate(n).code),
      (n) => /\b!!\b/.test(generate(n).code) || /^\s*!\s*!/.test(generate(n).code),
    ],
    stackPush: 1,
    stackPop: 1,
  },
  {
    category: 'environment',
    patterns: [
      (n) => /\b(window|document|navigator|location|history|screen)\b/.test(generate(n).code),
      (n) => /\bconsole\.\w+\s*\(/.test(generate(n).code),
    ],
    stackPush: 0,
    stackPop: 0,
  },
  {
    category: 'crypto',
    patterns: [
      (n) => /\b(crypto|CryptoJS|md5|sha|aes|rsa|hmac)\b/i.test(generate(n).code),
      (n) => /\bdigest\b|\bencrypt\b|\bdecrypt\b/i.test(generate(n).code),
    ],
    stackPush: 1,
    stackPop: 1,
  },
];

/** Known VM tool signatures */
const TOOL_SIGNATURES: Array<{
  tool: string;
  patterns: RegExp[];
}> = [
  {
    tool: 'javascript-obfuscator',
    patterns: [
      /_0x[0-9a-f]{4,}/i,
      /function\s+_0x[0-9a-f]+\s*\(/,
      /\[\s*_0x[0-9a-f]+\s*\(\s*['"][\w$]+['"]\s*\)\s*\]/,
    ],
  },
  {
    tool: 'js-confuser',
    patterns: [
      /var\s+_\w+\s*=\s*_0x[0-9a-f]+/i,
      /function\s+\w+\s*\(\s*\w+\s*,\s*\w+\s*\)\s*\{[\s\S]*?return\s+\w+\s*\+\s*\w+/i,
    ],
  },
  {
    tool: 'jscrambler',
    patterns: [/\\u[0-9a-f]{4}/, /var\s+_\w+\s*=\s*\[\s*\]/, /self\s*\|\|/],
  },
  {
    tool: 'jsdefender',
    patterns: [/console\[('|`|")/, /debugger;/, /function\s+\w+\s*\(\s*\)\s*\{\s*debugger\s*;/],
  },
];

// ── Main API ──

/**
 * Extract and canonicalize VM handler functions from obfuscated code.
 *
 * This is the primary entry point. It:
 *   1. Parses the code into an AST
 *   2. Locates the VM dispatch loop (while/switch)
 *   3. Extracts individual handler cases
 *   4. Canonicalizes each handler
 *   5. Classifies handlers into semantic categories
 *   6. Builds the opcode genome
 */
export function canonicalizeVMHandlers(code: string): CanonicalizeResult {
  const warnings: string[] = [];
  let ast: t.File;

  try {
    const safeCode = ensureUTF8Safe(code);
    ast = parser.parse(safeCode, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript', 'decorators-legacy'],
      errorRecovery: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`VMHandlerCanonicalizer: parse failed: ${msg}`);
    return {
      ok: false,
      genome: emptyGenome(),
      warnings: [`Parse failed: ${msg}`],
      classifiedCount: 0,
      unknownCount: 0,
    };
  }

  // Step 1: Find VM dispatch structures
  const dispatchStructures = findVMDispatchStructures(ast);
  if (dispatchStructures.length === 0) {
    warnings.push('No VM dispatch structures found');
    return {
      ok: false,
      genome: emptyGenome(),
      warnings,
      classifiedCount: 0,
      unknownCount: 0,
    };
  }

  // Step 2: Extract handlers from each dispatch structure
  const allHandlers: VMHandler[] = [];
  let dispatchVarName: string | null = null;
  let stringTablePattern: string | null = null;
  let hasRotatedOpcodes = false;
  let hasIntegrityChecks = false;

  for (const ds of dispatchStructures) {
    const handlers = extractHandlers(ds);
    allHandlers.push(...handlers);

    if (!dispatchVarName) {
      dispatchVarName = ds.dispatchVarName;
    }

    if (!stringTablePattern) {
      stringTablePattern = ds.stringTablePattern;
    }

    if (ds.hasRotatedOpcodes) hasRotatedOpcodes = true;
    if (ds.hasIntegrityChecks) hasIntegrityChecks = true;
  }

  if (allHandlers.length === 0) {
    warnings.push('No handlers extracted from dispatch structures');
    return {
      ok: false,
      genome: emptyGenome(),
      warnings,
      classifiedCount: 0,
      unknownCount: 0,
    };
  }

  // Step 3: Classify handlers
  for (const handler of allHandlers) {
    classifyHandler(handler);
  }

  // Step 4: Detect tool
  const toolIdentifier = detectTool(code);

  // Step 5: Build genome
  const categoryHistogram = buildCategoryHistogram(allHandlers);
  const genomeHash = computeGenomeHash(allHandlers);
  const complexityScore = computeComplexity(allHandlers, hasRotatedOpcodes, hasIntegrityChecks);

  const classifiedCount = allHandlers.filter((h) => h.semanticCategory !== 'unknown').length;
  const unknownCount = allHandlers.filter((h) => h.semanticCategory === 'unknown').length;

  const genome: OpcodeGenome = {
    genomeHash,
    handlerCount: allHandlers.length,
    categoryHistogram,
    handlers: allHandlers,
    stringTablePattern,
    dispatchVarName,
    hasRotatedOpcodes,
    hasIntegrityChecks,
    complexityScore,
    toolIdentifier,
  };

  logger.info(
    `VMHandlerCanonicalizer: extracted ${allHandlers.length} handlers, ` +
      `${classifiedCount} classified, ${unknownCount} unknown, ` +
      `tool=${toolIdentifier ?? 'unknown'}, complexity=${complexityScore.toFixed(2)}`,
  );

  return {
    ok: true,
    genome,
    warnings,
    classifiedCount,
    unknownCount,
  };
}

/**
 * Compare two opcode genomes to determine if they represent the same VM type.
 * Useful for clustering obfuscation samples by VM fingerprint.
 */
export function compareGenomes(
  a: OpcodeGenome,
  b: OpcodeGenome,
): {
  similarity: number;
  sameVM: boolean;
  sharedCategories: HandlerCategory[];
} {
  // Compare category histograms
  const allCategories = new Set<HandlerCategory>([
    ...(Object.keys(a.categoryHistogram) as HandlerCategory[]),
    ...(Object.keys(b.categoryHistogram) as HandlerCategory[]),
  ]);

  let histogramSimilarity = 0;
  const totalHandlers = Math.max(a.handlerCount, b.handlerCount);
  const sharedCategories: HandlerCategory[] = [];

  if (totalHandlers > 0) {
    let shared = 0;
    for (const cat of allCategories) {
      const aCount = a.categoryHistogram[cat] ?? 0;
      const bCount = b.categoryHistogram[cat] ?? 0;
      if (aCount > 0 && bCount > 0) {
        shared += Math.min(aCount, bCount);
        sharedCategories.push(cat);
      }
    }
    histogramSimilarity = shared / totalHandlers;
  }

  // Compare genome hashes (exact match = same VM)
  const hashMatch = a.genomeHash === b.genomeHash ? 1 : 0;

  // Compare tool identifiers
  const toolMatch =
    a.toolIdentifier && b.toolIdentifier && a.toolIdentifier === b.toolIdentifier ? 0.3 : 0;

  // Weighted similarity
  const similarity = histogramSimilarity * 0.5 + hashMatch * 0.3 + toolMatch * 0.2;

  return {
    similarity,
    sameVM: similarity > 0.7,
    sharedCategories,
  };
}

// ── VM Dispatch Structure Detection ──

interface VMDispatchStructure {
  node: t.Node;
  caseCount: number;
  dispatchVarName: string | null;
  stringTablePattern: string | null;
  hasRotatedOpcodes: boolean;
  hasIntegrityChecks: boolean;
}

function findVMDispatchStructures(ast: t.File): VMDispatchStructure[] {
  const structures: VMDispatchStructure[] = [];

  traverse(ast, {
    // while(true) { switch(x) { case N: ... } }
    WhileStatement(path) {
      if (!t.isBooleanLiteral(path.node.test, { value: true })) return;

      const body = path.node.body;
      if (!t.isBlockStatement(body)) return;

      for (const stmt of body.body) {
        if (t.isSwitchStatement(stmt)) {
          const dispatchVar = extractDispatchVariable(stmt);
          const caseCount = stmt.cases.length;

          if (caseCount >= 5) {
            const source = generate(stmt).code;

            const stringTableMatch = source.match(/_0x[0-9a-f]{4,}/i);
            const stringTablePattern = stringTableMatch ? stringTableMatch[0] : null;

            const hasRotatedOpcodes = /\.push\s*\(\s*\w+\.shift\s*\(\s*\)\s*\)/.test(source);

            const hasIntegrityChecks =
              /debugger/.test(source) || /self\s*\|\|/.test(source) || /console\[/.test(source);

            structures.push({
              node: stmt,
              caseCount,
              dispatchVarName: dispatchVar,
              stringTablePattern,
              hasRotatedOpcodes,
              hasIntegrityChecks,
            });
          }
        }
      }
    },

    // for(;;) { switch(x) { case N: ... } }
    ForStatement(path) {
      if (path.node.test !== null && !t.isBooleanLiteral(path.node.test, { value: true })) return;
      if (path.node.update !== null && !isEmptyExpression(path.node.update)) return;

      const body = path.node.body;
      if (!t.isBlockStatement(body)) return;

      for (const stmt of body.body) {
        if (t.isSwitchStatement(stmt)) {
          const caseCount = stmt.cases.length;
          if (caseCount >= 5) {
            const source = generate(stmt).code;
            structures.push({
              node: stmt,
              caseCount,
              dispatchVarName: extractDispatchVariable(stmt),
              stringTablePattern: source.match(/_0x[0-9a-f]{4,}/i)?.[0] ?? null,
              hasRotatedOpcodes: /\.push\s*\(\s*\w+\.shift\s*\(\s*\)\s*\)/.test(source),
              hasIntegrityChecks: /debugger/.test(source),
            });
          }
        }
      }
    },
  });

  return structures;
}

function extractDispatchVariable(switchStmt: t.SwitchStatement): string | null {
  const discriminant = switchStmt.discriminant;
  if (t.isIdentifier(discriminant)) {
    return discriminant.name;
  }
  if (t.isMemberExpression(discriminant) && t.isIdentifier(discriminant.object)) {
    return generate(discriminant).code.slice(0, 50);
  }
  return null;
}

// ── Handler Extraction ──

function extractHandlers(ds: VMDispatchStructure): VMHandler[] {
  const handlers: VMHandler[] = [];

  if (!t.isSwitchStatement(ds.node)) return handlers;

  for (const switchCase of ds.node.cases) {
    const opcode = extractOpcode(switchCase);
    const handlerSource = switchCase.consequent.map((s) => generate(s).code).join('\n');
    const canonicalSource = canonicalizeHandlerSource(handlerSource);

    handlers.push({
      id: generateHandlerId(opcode, canonicalSource),
      rawOpcode: opcode,
      canonicalOpcode: '', // Will be filled by classifyHandler
      handlerNode:
        switchCase.consequent.length > 0 ? (switchCase.consequent[0]! as t.Statement) : null,
      canonicalSource,
      semanticCategory: 'unknown',
      stackEffect: { push: 0, pop: 0 },
      confidence: 0,
      preludeRefs: extractPreludeRefs(handlerSource),
    });
  }

  return handlers;
}

function extractOpcode(switchCase: t.SwitchCase): string {
  if (switchCase.test === null || switchCase.test === undefined) {
    return 'default';
  }
  if (t.isNumericLiteral(switchCase.test)) {
    return String(switchCase.test.value);
  }
  if (t.isStringLiteral(switchCase.test)) {
    return switchCase.test.value;
  }
  return generate(switchCase.test).code;
}

function canonicalizeHandlerSource(source: string): string {
  let canonical = source;

  // Normalize whitespace
  canonical = canonical.replace(/\s+/g, ' ').trim();

  // Replace hex identifiers with normalized names (_0x1a2b → _v0)
  let varCounter = 0;
  canonical = canonical.replace(/_0x[0-9a-f]{4,}/gi, () => `_v${varCounter++}`);
  canonical = canonical.replace(/\b_0x([0-9a-f]+)\b/gi, () => `_v${varCounter++}`);

  // Normalize numeric literals (keep structure, normalize values)
  canonical = canonical.replace(/\b0x[0-9a-f]+\b/gi, (match) => `NUM(${parseInt(match, 16)})`);

  // Normalize string literals (keep length, replace content)
  canonical = canonical.replace(/(["'`])([^"'`]{3,})\1/g, (_match, quote, content) => {
    return `${quote}STR${content.length}${quote}`;
  });

  // Normalize variable names that are single letters followed by digits
  let singleLetterCounter = 0;
  canonical = canonical.replace(/\b([a-z])(\d{2,})\b/g, () => `_sv${singleLetterCounter++}`);

  // Sort comma-separated expressions (for structural comparison)
  canonical = sortCommaSeparated(canonical);

  return canonical;
}

function extractPreludeRefs(source: string): string[] {
  const refs: string[] = [];
  // Match decoder function calls: _0x1a2b('0x1')  or  decoder('key')
  const decoderPattern = /(_0x[0-9a-f]{4,}|[\w$]+)\s*\(\s*['"][\w$]+['"]\s*\)/gi;
  let match: RegExpExecArray | null;
  const regex = new RegExp(decoderPattern.source, decoderPattern.flags);
  while ((match = regex.exec(source)) !== null) {
    if (match[1]) {
      refs.push(match[1]);
    }
  }
  return [...new Set(refs)];
}

// ── Handler Classification ──

function classifyHandler(handler: VMHandler): void {
  let bestCategory: HandlerCategory = 'unknown';
  let bestConfidence = 0;
  let bestStackEffect = { push: 0, pop: 0 };

  const handlerSource = handler.canonicalSource;

  for (const categoryPattern of CATEGORY_PATTERNS) {
    let matchCount = 0;
    for (const pattern of categoryPattern.patterns) {
      // Some patterns need AST analysis, others need source analysis
      // We use source analysis here for speed
      if (handler.handlerNode) {
        try {
          const nodeSource = generate(handler.handlerNode).code;
          // Try source-based pattern first
          const regexPatterns: RegExp[] = [];
          if (categoryPattern.category === 'stack-op') {
            regexPatterns.push(/\.push\s*\(/, /\.pop\s*\(/, /\.length\s*-\s*1/);
          } else if (categoryPattern.category === 'arithmetic') {
            regexPatterns.push(/[+\-*/%]=?/, /\bMath\.\w+\s*\(/);
          } else if (categoryPattern.category === 'comparison') {
            regexPatterns.push(/[=!]==?/, /[<>]=?/);
          } else if (categoryPattern.category === 'string-op') {
            regexPatterns.push(
              /\b(charAt|substring|slice|split|indexOf|replace|toLowerCase|toUpperCase|trim)\s*\(/,
            );
          }

          for (const re of regexPatterns) {
            if (re.test(nodeSource)) matchCount++;
          }
        } catch {
          // If generate fails, skip AST pattern
        }
      }

      // Also test the canonical source
      if (pattern(handler.handlerNode ?? t.emptyStatement())) {
        matchCount++;
      }
    }

    // Simple source-based patterns for canonicalized handler
    if (categoryPattern.category === 'stack-op') {
      if (/\.push\(/.test(handlerSource)) matchCount++;
      if (/\.pop\(\)/.test(handlerSource)) matchCount++;
    } else if (categoryPattern.category === 'arithmetic') {
      if (/[+\-*/%]/.test(handlerSource) && /NUM\(/.test(handlerSource)) matchCount++;
    } else if (categoryPattern.category === 'control-flow') {
      if (/\bcontinue\b|\bbreak\b/.test(handlerSource)) matchCount++;
    } else if (categoryPattern.category === 'string-op') {
      if (
        /STR\d+/.test(handlerSource) &&
        /\b(charAt|substring|slice|split|indexOf|replace)\b/.test(handlerSource)
      )
        matchCount++;
    } else if (categoryPattern.category === 'environment') {
      if (/\b(window|document|navigator|location)\b/.test(handlerSource)) matchCount++;
    }

    const confidence =
      categoryPattern.patterns.length > 0
        ? Math.min(matchCount / categoryPattern.patterns.length, 1.0)
        : 0;

    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestCategory = categoryPattern.category;
      bestStackEffect = { push: categoryPattern.stackPush, pop: categoryPattern.stackPop };
    }
  }

  handler.semanticCategory = bestCategory;
  handler.canonicalOpcode = mapCategoryToOpcode(bestCategory, handler.rawOpcode);
  handler.stackEffect = bestStackEffect;
  handler.confidence = bestConfidence;
}

function mapCategoryToOpcode(category: HandlerCategory, rawOpcode: string): string {
  const categoryPrefixes: Record<HandlerCategory, string> = {
    'stack-op': 'PUSH',
    arithmetic: 'ARITH',
    comparison: 'CMP',
    logic: 'LOGIC',
    'control-flow': 'JMP',
    memory: 'MEM',
    'string-op': 'STR',
    'type-coercion': 'CAST',
    environment: 'ENV',
    crypto: 'CRYPTO',
    unknown: 'OP',
  };

  return `${categoryPrefixes[category]}_${rawOpcode}`;
}

function detectTool(code: string): string | null {
  for (const sig of TOOL_SIGNATURES) {
    const matchCount = sig.patterns.filter((p) => p.test(code)).length;
    if (matchCount >= 2) {
      return sig.tool;
    }
  }
  return null;
}

// ── Genome Building ──

function buildCategoryHistogram(handlers: VMHandler[]): Record<HandlerCategory, number> {
  const histogram: Record<HandlerCategory, number> = {
    'stack-op': 0,
    arithmetic: 0,
    comparison: 0,
    logic: 0,
    'control-flow': 0,
    memory: 0,
    'string-op': 0,
    'type-coercion': 0,
    environment: 0,
    crypto: 0,
    unknown: 0,
  };

  for (const handler of handlers) {
    histogram[handler.semanticCategory]++;
  }

  return histogram;
}

function computeGenomeHash(handlers: VMHandler[]): string {
  // Hash based on semantic categories in dispatch order
  const genomeStr = handlers
    .map((h) => `${h.semanticCategory}:${h.stackEffect.push}:${h.stackEffect.pop}`)
    .join('|');

  let hash = 5381;
  for (let i = 0; i < genomeStr.length; i++) {
    hash = ((hash << 5) + hash + genomeStr.charCodeAt(i)) & 0x7fffffff;
  }
  return hash.toString(36);
}

function computeComplexity(
  handlers: VMHandler[],
  hasRotatedOpcodes: boolean,
  hasIntegrityChecks: boolean,
): number {
  let complexity = handlers.length * 0.1;

  // Add complexity for unknown handlers
  const unknownCount = handlers.filter((h) => h.semanticCategory === 'unknown').length;
  complexity += unknownCount * 0.3;

  // Add complexity for rotated opcodes
  if (hasRotatedOpcodes) complexity += 2;

  // Add complexity for integrity checks
  if (hasIntegrityChecks) complexity += 1.5;

  // Higher variety of categories = more complex
  const categories = new Set(handlers.map((h) => h.semanticCategory));
  complexity += categories.size * 0.5;

  return Math.min(complexity, 10);
}

function generateHandlerId(opcode: string, canonicalSource: string): string {
  // Stable ID based on canonical source hash
  let hash = 0;
  const source = canonicalSource.slice(0, 200); // Use first 200 chars for stability
  for (let i = 0; i < source.length; i++) {
    hash = ((hash << 5) - hash + source.charCodeAt(i)) & 0x7fffffff;
  }
  return `handler_${opcode}_${hash.toString(36)}`;
}

// ── Utility Functions ──

function containsOperator(node: t.Statement, ops: string[]): boolean {
  try {
    const code = generate(node).code;
    return ops.some((op) => code.includes(op));
  } catch {
    return false;
  }
}

function isEmptyExpression(expr: t.Expression | null | undefined): boolean {
  return expr === null || expr === undefined || t.isNullLiteral(expr as t.Node);
}

function sortCommaSeparated(source: string): string {
  // Sort sequences like "a,b,c" → "a,b,c" (sorted)
  return source.replace(/([^,({[]+)(,([^,)\]}\s]+))+/g, (match) => {
    const parts = match.split(',');
    if (parts.length <= 2) return match;
    const sorted = [...parts].sort();
    return sorted.join(',');
  });
}

function emptyGenome(): OpcodeGenome {
  return {
    genomeHash: 'empty',
    handlerCount: 0,
    categoryHistogram: {
      'stack-op': 0,
      arithmetic: 0,
      comparison: 0,
      logic: 0,
      'control-flow': 0,
      memory: 0,
      'string-op': 0,
      'type-coercion': 0,
      environment: 0,
      crypto: 0,
      unknown: 0,
    },
    handlers: [],
    stringTablePattern: null,
    dispatchVarName: null,
    hasRotatedOpcodes: false,
    hasIntegrityChecks: false,
    complexityScore: 0,
    toolIdentifier: null,
  };
}

/**
 * Ensure string is UTF-8 safe — replace invalid sequences with replacement character.
 * Addresses the user-reported issue where js-beautify/webcrack truncated files to 0
 * on certain charset/encoding edge cases.
 */
function ensureUTF8Safe(str: string): string {
  try {
    if (typeof str !== 'string') return '';
    return str
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD')
      .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
  } catch {
    return str.replace(/[^\x00-\x7F]/g, '\uFFFD');
  }
}
