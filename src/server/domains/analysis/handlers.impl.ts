import * as parser from '@babel/parser';
import traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { logger } from '@utils/logger';
import type { ToolArgs, ToolResponse } from '@server/types';
import { asJsonResponse, asTextResponse, serializeError } from '@server/domains/shared/response';
import {
  argString,
  argBool,
  argNumber,
  argStringRequired,
  argObject,
  argEnum,
} from '@server/domains/shared/parse-args';
import {
  ANALYSIS_MAX_SUMMARY_FILES,
  ANALYSIS_MAX_SAFE_COLLECTED_BYTES,
  ANALYSIS_MAX_SAFE_RESPONSE_BYTES,
} from '@src/constants';

const SMART_MODES = new Set(['summary', 'priority', 'incremental', 'full'] as const);
const FOCUS_MODES = new Set(['structure', 'business', 'security', 'all'] as const);
const HOOK_TYPES = new Set([
  'function',
  'xhr',
  'fetch',
  'websocket',
  'localstorage',
  'cookie',
] as const);
const HOOK_ACTIONS = new Set(['log', 'block', 'modify'] as const);
import { type CodeCollector } from '@server/domains/shared/modules';
import { type ScriptManager } from '@server/domains/shared/modules';
import { type Deobfuscator } from '@server/domains/shared/modules';
import { type AdvancedDeobfuscator } from '@server/domains/shared/modules';
import { type ObfuscationDetector } from '@server/domains/shared/modules';
import { type CodeAnalyzer } from '@server/domains/shared/modules';
import { type CryptoDetector } from '@server/domains/shared/modules';
import { type HookManager } from '@server/domains/shared/modules';
import { runWebpackEnumerate } from '@server/domains/analysis/handlers.web-tools';
import { runWebcrack } from '@modules/deobfuscator/webcrack';
import { JSVMPDeobfuscator } from '@modules/deobfuscator/JSVMPDeobfuscator';
import type { DeobfuscateMappingRule } from '@internal-types/deobfuscator';

// Lightweight inline transforms for the pipeline (avoiding circular import from transform domain)
const NUMERIC_BINARY_EXPR = /\b(-?\d+(?:\.\d+)?)\s*([+\-%*/])\s*(-?\d+(?:\.\d+)?)\b/g;
const DEAD_CODE_IF_FALSE = /if\s*\(\s*false\s*\)\s*\{[^}]*\}\s*/g;
const DEAD_CODE_IF_FALSE_WITH_ELSE = /if\s*\(\s*false\s*\)\s*\{[^}]*\}\s*else\s*\{([^}]*)\}/g;
const DEAD_CODE_IF_TRUE = /if\s*\(\s*true\s*\)\s*\{([^}]*)\}\s*(?:else\s*\{[^}]*\}\s*)?/g;
const CFF_PATTERN =
  /var\s+([A-Za-z_$]\w*)\s*=\s*['"]([^'"]+)['"]\.split\(['"]\|['"]\)\s*;\s*var\s+(\w+)\s*=\s*0\s*;\s*while\s*\(\s*!!\[\]\s*\)\s*\{\s*switch\s*\(\s*\1\[\s*\3\+\+\s*\]\s*\)\s*\{([\s\S]*?)\}\s*break;\s*\}/g;
const CFF_PATTERN_VAR2 =
  /var\s+([A-Za-z_$]\w*)\s*=\s*\[(['"][^'"]*['"]\s*(?:,\s*['"][^'"]*['"]\s*)*)\];\s*var\s+(\w+)\s*=\s*(\d+);\s*while\s*\(\s*!!\[\]\s*\)\s*\{\s*switch\s*\(\s*\1\[\s*\3\+\+\]\s*\)\s*\{([\s\S]*?)\}\s*break;\s*\}/g;
const STRING_CONCAT = /['"]([^'"]*)['"]\s*\+\s*['"]([^'"]*)['"]/g;

interface ProtectedRange {
  start: number;
  end: number;
}

type SafeReplaceCallback = (match: string, ...args: any[]) => string;

function cloneRegex(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags);
}

function mergeProtectedRanges(ranges: ProtectedRange[]): ProtectedRange[] {
  if (ranges.length === 0) return [];
  const merged: ProtectedRange[] = [];
  const sorted = ranges.toSorted((a, b) => a.start - b.start || a.end - b.end);
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end) {
      merged.push({ ...range });
      continue;
    }
    last.end = Math.max(last.end, range.end);
  }
  return merged;
}

function collectProtectedRangesWithAst(code: string): ProtectedRange[] | null {
  try {
    const ast = parser.parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });
    const ranges: ProtectedRange[] = [];
    const pushRange = (start: number | null | undefined, end: number | null | undefined) => {
      if (typeof start === 'number' && typeof end === 'number' && end > start) {
        ranges.push({ start, end });
      }
    };

    const comments = Array.isArray(
      (ast as { comments?: Array<{ start?: number; end?: number }> }).comments,
    )
      ? (ast as { comments: Array<{ start?: number; end?: number }> }).comments
      : [];
    for (const comment of comments) {
      pushRange(comment.start, comment.end);
    }

    traverse(ast, {
      StringLiteral(path) {
        pushRange(path.node.start, path.node.end);
        path.skip();
      },
      TemplateElement(path) {
        pushRange(path.node.start, path.node.end);
        path.skip();
      },
      RegExpLiteral(path) {
        pushRange(path.node.start, path.node.end);
        path.skip();
      },
    });

    return mergeProtectedRanges(ranges);
  } catch {
    return null;
  }
}

function getReplaceCallbackOffset(args: unknown[]): number | null {
  const maybeOffset = args[args.length - 2];
  if (typeof maybeOffset === 'number') return maybeOffset;
  const fallbackOffset = args[args.length - 3];
  return typeof fallbackOffset === 'number' ? fallbackOffset : null;
}

function replaceOutsideProtectedRanges(
  code: string,
  pattern: RegExp,
  replacement: string | SafeReplaceCallback,
): string {
  const applyReplacement = (input: string): string =>
    typeof replacement === 'string'
      ? input.replace(cloneRegex(pattern), replacement)
      : input.replace(cloneRegex(pattern), replacement);
  const protectedRanges = collectProtectedRangesWithAst(code);

  if (protectedRanges === null) {
    const regex = cloneRegex(pattern);
    return code.replace(regex, (...args: unknown[]) => {
      const fullMatch = typeof args[0] === 'string' ? args[0] : '';
      const offset = getReplaceCallbackOffset(args);
      if (offset !== null && insideStringLiteralOrComment(code, offset)) {
        return fullMatch;
      }
      return typeof replacement === 'string'
        ? replacement
        : replacement(fullMatch, ...args.slice(1));
    });
  }

  if (protectedRanges.length === 0) {
    return applyReplacement(code);
  }

  let rewritten = '';
  let cursor = 0;
  for (const range of protectedRanges) {
    if (cursor < range.start) {
      rewritten += applyReplacement(code.slice(cursor, range.start));
    }
    rewritten += code.slice(range.start, range.end);
    cursor = range.end;
  }
  if (cursor < code.length) {
    rewritten += applyReplacement(code.slice(cursor));
  }
  return rewritten;
}

function insideStringLiteralOrComment(code: string, offset: number): boolean {
  let inStr: "'" | '"' | '`' | null = null;
  let inBlockComment = false;
  let inLineComment = false;
  let inRegex = false;
  for (let i = 0; i < offset; i++) {
    const ch = code[i]!;
    if (inBlockComment) {
      if (ch === '*' && code[i + 1] === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inRegex) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '/') {
        inRegex = false;
        i++;
        while (i < offset && /[gimsuy]/.test(code[i]!)) i++;
        continue;
      }
      if (ch === '[') {
        i++;
        while (i < offset && code[i] !== ']') {
          if (code[i] === '\\') i++;
          i++;
        }
        continue;
      }
      continue;
    }
    if (inStr) {
      if (ch === '\\' && inStr) {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '/' && code[i + 1] === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && code[i + 1] === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '/' && isRegexOpener(code, i)) {
      inRegex = true;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inStr = ch;
      continue;
    }
  }
  return inStr !== null || inBlockComment || inLineComment || inRegex;
}

const REGEX_OPENER_PREV = new Set([
  '=',
  '(',
  '[',
  ',',
  ';',
  '{',
  '!',
  '&',
  '|',
  '?',
  ':',
  '~',
  '^',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '\n',
]);
function isRegexOpener(code: string, pos: number): boolean {
  let j = pos - 1;
  while (j >= 0 && (code[j] === ' ' || code[j] === '\t' || code[j] === '\r')) j--;
  if (j < 0) return true;
  const prev = code[j]!;
  if (REGEX_OPENER_PREV.has(prev)) return true;
  if (prev === ')') {
    let depth = 1;
    let k = j - 1;
    while (k >= 0 && depth > 0) {
      if (code[k] === ')') depth++;
      if (code[k] === '(') depth--;
      k--;
    }
    k--;
    while (k >= 0 && (code[k] === ' ' || code[k] === '\t')) k--;
    let kw = '';
    while (k >= 0 && /[a-z]/.test(code[k]!)) {
      kw = code[k]! + kw;
      k--;
    }
    return [
      'if',
      'while',
      'for',
      'switch',
      'return',
      'typeof',
      'void',
      'in',
      'of',
      'case',
    ].includes(kw);
  }
  return false;
}

function applyConstantFold(code: string): string {
  let result = code;

  // Numeric binary expressions: 3 + 4 → 7 (skip inside string literals)
  result = replaceOutsideProtectedRanges(
    result,
    NUMERIC_BINARY_EXPR,
    (_full, leftRaw: string, op: string, rightRaw: string) => {
      const left = Number(leftRaw);
      const right = Number(rightRaw);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return _full;
      let value: number | null = null;
      if (op === '+') value = left + right;
      else if (op === '-') value = left - right;
      else if (op === '*') value = left * right;
      else if (op === '/' && right !== 0) value = left / right;
      else if (op === '%' && right !== 0) value = left % right;
      if (value === null || !Number.isFinite(value)) return _full;
      return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(12)));
    },
  );

  // String concatenation: "a" + "b" → "ab"
  result = replaceOutsideProtectedRanges(
    result,
    STRING_CONCAT,
    (_full, left: string, right: string) => JSON.stringify(`${left}${right}`),
  );

  // Unary minus double negative: --5 → 5
  const UNARY_NEG_DOUBLE = /--(\d)/g;
  result = replaceOutsideProtectedRanges(result, UNARY_NEG_DOUBLE, (_full, digit: string) => digit);

  // Unary plus: +42 → 42
  const UNARY_PLUS_NUMBER = /\+\s*(\d+(?:\.\d+)?)/g;
  result = replaceOutsideProtectedRanges(result, UNARY_PLUS_NUMBER, (_full, num: string) => num);

  // Hex to decimal: 0xFF → 255
  const hexPattern = /\b0x([0-9a-fA-F]{2,8})\b/g;
  result = replaceOutsideProtectedRanges(result, hexPattern, (_full, hex: string) => {
    const val = Number.parseInt(hex, 16);
    return Number.isFinite(val) ? String(val) : _full;
  });

  return result;
}

function applyDeadCodeRemove(code: string): string {
  let result = code;

  // if (false) { ... } else { X } → X
  result = replaceOutsideProtectedRanges(
    result,
    DEAD_CODE_IF_FALSE_WITH_ELSE,
    (_full, elseBody: string) => elseBody,
  );

  // if (false) { ... }
  result = replaceOutsideProtectedRanges(result, DEAD_CODE_IF_FALSE, '');

  // if (true) { X } else { ... } → X
  result = replaceOutsideProtectedRanges(
    result,
    DEAD_CODE_IF_TRUE,
    (_full, trueBody: string) => trueBody,
  );

  // Ternary with constant condition: false ? a : b → b, true ? a : b → a
  result = replaceOutsideProtectedRanges(
    result,
    /\btrue\s*\?\s*([^:]+)\s*:\s*([^,;)\]}]+)/g,
    (_full, ifVal: string) => ifVal,
  );
  result = replaceOutsideProtectedRanges(
    result,
    /\bfalse\s*\?\s*[^:]+\s*:\s*([^,;)}\]]+)/g,
    (_full, elseVal: string) => elseVal,
  );

  // Empty if bodies: if (cond) {} → (nothing)
  result = replaceOutsideProtectedRanges(result, /if\s*\([^)]*\)\s*\{\s*\}\s*/g, '');

  return result;
}

function applyControlFlowFlatten(code: string): string {
  let result = code;

  // Pattern 1: String-split dispatcher (var a = "1|2|3".split('|'); while(true) { switch(a[b++]) { ... } })
  result = replaceOutsideProtectedRanges(
    result,
    CFF_PATTERN,
    (_full, _dispatcher: string, orderRaw: string, _cursor: string, switchBody: string) => {
      const caseRegex = /case\s*['"]([^'"]+)['"]\s*:\s*([\s\S]*?)(?=case\s*['"]|default\s*:|$)/g;
      const caseMap = new Map<string, string>();
      let m: RegExpExecArray | null;
      while ((m = caseRegex.exec(switchBody)) !== null) {
        const key = m[1];
        const body = (m[2] ?? '')
          .replace(/\bcontinue\s*;?/g, '')
          .replace(/\bbreak\s*;?/g, '')
          .trim();
        if (key && body.length > 0) caseMap.set(key, body);
      }
      const order = orderRaw.split('|').map((s) => s.trim());
      const rebuilt = order
        .map((tok) => caseMap.get(tok))
        .filter((s): s is string => !!s)
        .join('\n');
      return rebuilt.length > 0 ? rebuilt : _full;
    },
  );

  // Pattern 2: Array literal dispatcher (var a = ["1","2","3"]; var b = 0; while(true) { switch(a[b++]) { ... } })
  result = replaceOutsideProtectedRanges(
    result,
    CFF_PATTERN_VAR2,
    (
      _full,
      _dispatcher: string,
      arrContent: string,
      _cursor: string,
      _startIdx: string,
      switchBody: string,
    ) => {
      const caseRegex = /case\s*['"]([^'"]+)['"]\s*:\s*([\s\S]*?)(?=case\s*['"]|default\s*:|$)/g;
      const caseMap = new Map<string, string>();
      let m: RegExpExecArray | null;
      while ((m = caseRegex.exec(switchBody)) !== null) {
        const key = m[1];
        const body = (m[2] ?? '')
          .replace(/\bcontinue\s*;?/g, '')
          .replace(/\bbreak\s*;?/g, '')
          .trim();
        if (key && body.length > 0) caseMap.set(key, body);
      }
      const order = arrContent.split(/,\s*/).map((s) => s.replace(/^['"]|['"]$/g, '').trim());
      const rebuilt = order
        .map((tok) => caseMap.get(tok))
        .filter((s): s is string => !!s)
        .join('\n');
      return rebuilt.length > 0 ? rebuilt : _full;
    },
  );

  return result;
}

function applyRenameVars(code: string): { code: string; count: number } {
  const declared = new Set<string>();
  // Match single-letter and short obfuscated variable names (1-2 chars, _ prefixed, or hex-like)
  const re = /\b(?:var|let|const)\s+([A-Za-z_$]\w{0,3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    const name = match[1];
    if (name && (name.length <= 2 || name.startsWith('_0x') || name.startsWith('_'))) {
      declared.add(name);
    }
  }
  if (declared.size === 0) return { code, count: 0 };

  const renameMap = new Map<string, string>();
  let counter = 1;
  for (const name of declared) {
    renameMap.set(name, `var_${counter}`);
    counter++;
  }

  const astRenamed = applyRenameVarsWithAst(code, renameMap);
  if (astRenamed !== null) {
    return {
      code: astRenamed,
      count: astRenamed === code ? 0 : renameMap.size,
    };
  }

  // Use word-boundary replacement to avoid replacing substrings in longer identifiers
  const newCode = code.replace(
    new RegExp(
      `\\b(${[...declared].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
      'g',
    ),
    (token, id, offset, full) => {
      const replacement = renameMap.get(id);
      if (!replacement) return token;
      const prev = offset > 0 ? full[offset - 1] : '';
      const prevNonWhitespace = findNonWhitespace(full, offset - 1, -1);
      const nextNonWhitespace = findNonWhitespace(full, offset + token.length, 1);
      // Don't rename inside strings, property access, or template literals
      if (prev === '.' || prev === "'" || prev === '"' || prev === '`' || prev === '$')
        return token;
      // Preserve object literal keys in fallback mode.
      if (
        (prevNonWhitespace === '{' || prevNonWhitespace === ',') &&
        (nextNonWhitespace === ':' || nextNonWhitespace === '(')
      ) {
        return token;
      }
      return replacement;
    },
  );

  return { code: newCode, count: newCode === code ? 0 : renameMap.size };
}

interface TextReplacement {
  start: number;
  end: number;
  text: string;
}

function applyRenameVarsWithAst(code: string, renameMap: Map<string, string>): string | null {
  try {
    const ast = parser.parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
    });
    const replacements = new Map<string, TextReplacement>();

    traverse(ast, {
      ObjectProperty(path) {
        if (
          !path.node.shorthand ||
          !t.isIdentifier(path.node.key) ||
          !t.isIdentifier(path.node.value)
        ) {
          return;
        }
        const valuePath = path.get('value');
        if (!valuePath.isIdentifier()) return;
        const replacement = getBindingReplacement(valuePath, renameMap);
        const { start, end } = path.node;
        if (!replacement || start === null || start === undefined) return;
        if (end === null || end === undefined) return;
        replacements.set(`${start}:${end}`, {
          start,
          end,
          text: `${path.node.key.name}: ${replacement}`,
        });
        path.skip();
      },
      Identifier(path) {
        const replacement = getBindingReplacement(path, renameMap);
        const { start, end } = path.node;
        if (!replacement || start === null || start === undefined) return;
        if (end === null || end === undefined) return;
        replacements.set(`${start}:${end}`, {
          start,
          end,
          text: replacement,
        });
      },
    });

    if (replacements.size === 0) return code;
    return applyTextReplacements(code, [...replacements.values()]);
  } catch {
    return null;
  }
}

function getBindingReplacement(
  path: NodePath<t.Identifier>,
  renameMap: Map<string, string>,
): string | null {
  const replacement = renameMap.get(path.node.name);
  if (!replacement) return null;

  const binding = path.scope.getBinding(path.node.name);
  if (
    !binding ||
    !t.isVariableDeclarator(binding.path.node) ||
    !t.isIdentifier(binding.path.node.id) ||
    !renameMap.has(binding.path.node.id.name)
  ) {
    return null;
  }

  const isBindingId = binding.identifier === path.node;
  const isReference = path.isReferencedIdentifier();
  const isAssignmentTarget = path.key === 'left' && path.parentPath.isAssignmentExpression();
  const isForLoopTarget =
    path.key === 'left' &&
    (path.parentPath.isForInStatement() || path.parentPath.isForOfStatement());
  const isUpdateTarget = path.key === 'argument' && path.parentPath.isUpdateExpression();

  if (!isBindingId && !isReference && !isAssignmentTarget && !isForLoopTarget && !isUpdateTarget) {
    return null;
  }

  return replacement;
}

function applyTextReplacements(code: string, replacements: TextReplacement[]): string {
  const sorted = replacements.toSorted((a, b) => b.start - a.start || b.end - a.end);
  let next = code;
  for (const replacement of sorted) {
    next = `${next.slice(0, replacement.start)}${replacement.text}${next.slice(replacement.end)}`;
  }
  return next;
}

function findNonWhitespace(input: string, start: number, step: -1 | 1): string {
  for (let idx = start; idx >= 0 && idx < input.length; idx += step) {
    const char = input[idx];
    if (char && !/\s/.test(char)) return char;
  }
  return '';
}

interface CoreAnalysisHandlerDeps {
  collector: CodeCollector;
  scriptManager: ScriptManager;
  deobfuscator: Deobfuscator;
  advancedDeobfuscator: AdvancedDeobfuscator;
  obfuscationDetector: ObfuscationDetector;
  analyzer: CodeAnalyzer;
  cryptoDetector: CryptoDetector;
  hookManager: HookManager;
}

export class CoreAnalysisHandlers {
  private readonly collector: CodeCollector;
  private readonly scriptManager: ScriptManager;
  private readonly deobfuscator: Deobfuscator;
  private readonly advancedDeobfuscator: AdvancedDeobfuscator;
  private readonly obfuscationDetector: ObfuscationDetector;
  private readonly analyzer: CodeAnalyzer;
  private readonly cryptoDetector: CryptoDetector;
  private readonly hookManager: HookManager;
  private readonly jsvmpDeobfuscator: JSVMPDeobfuscator;

  constructor(deps: CoreAnalysisHandlerDeps) {
    this.collector = deps.collector;
    this.scriptManager = deps.scriptManager;
    this.deobfuscator = deps.deobfuscator;
    this.advancedDeobfuscator = deps.advancedDeobfuscator;
    this.obfuscationDetector = deps.obfuscationDetector;
    this.analyzer = deps.analyzer;
    this.cryptoDetector = deps.cryptoDetector;
    this.hookManager = deps.hookManager;
    this.jsvmpDeobfuscator = new JSVMPDeobfuscator();
  }

  private requireCodeArg(args: ToolArgs, toolName: string): string | null {
    const code = args.code;
    if (typeof code !== 'string' || code.trim().length === 0) {
      logger.warn(`${toolName} called without valid code argument`);
      return null;
    }
    return code;
  }

  private extractWebcrackArgs(args: ToolArgs) {
    const extracted: Record<string, unknown> = {};

    const unpack = argBool(args, 'unpack');
    const unminify = argBool(args, 'unminify');
    const jsx = argBool(args, 'jsx');
    const mangle = argBool(args, 'mangle');
    const forceOutput = argBool(args, 'forceOutput');
    const includeModuleCode = argBool(args, 'includeModuleCode');
    const outputDir = argString(args, 'outputDir');
    const maxBundleModules = argNumber(args, 'maxBundleModules');

    if (unpack !== undefined) extracted.unpack = unpack;
    if (unminify !== undefined) extracted.unminify = unminify;
    if (jsx !== undefined) extracted.jsx = jsx;
    if (mangle !== undefined) extracted.mangle = mangle;
    if (forceOutput !== undefined) extracted.forceOutput = forceOutput;
    if (includeModuleCode !== undefined) extracted.includeModuleCode = includeModuleCode;
    if (outputDir?.trim()) extracted.outputDir = outputDir;
    if (maxBundleModules !== undefined) extracted.maxBundleModules = maxBundleModules;

    if (Array.isArray(args.mappings)) {
      extracted.mappings = (args.mappings as unknown[]).filter(
        (item): item is DeobfuscateMappingRule =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as { path?: unknown }).path === 'string' &&
          typeof (item as { pattern?: unknown }).pattern === 'string',
      );
    }

    return extracted;
  }

  async handleCollectCode(args: ToolArgs): Promise<ToolResponse> {
    const returnSummaryOnly = argBool(args, 'returnSummaryOnly', false);
    let smartMode = argEnum(args, 'smartMode', SMART_MODES);
    const maxSummaryFiles = ANALYSIS_MAX_SUMMARY_FILES;

    const summarizeFiles = (
      files: Array<{
        url: string;
        type: string;
        size: number;
        content: string;
        metadata?: { truncated?: boolean };
      }>,
    ) =>
      files.slice(0, maxSummaryFiles).map((file) => ({
        url: file.url,
        type: file.type,
        size: file.size,
        sizeKB: (file.size / 1024).toFixed(2),
        truncated: file.metadata?.truncated || false,
        preview: `${file.content.substring(0, 200)}...`,
      }));

    const summarizeResult = (
      result: Awaited<ReturnType<CoreAnalysisHandlerDeps['collector']['collect']>>,
    ) => {
      const rawEntries =
        Array.isArray(result.summaries) && result.summaries.length > 0
          ? result.summaries
          : summarizeFiles(
              result.files as Array<{
                url: string;
                type: string;
                size: number;
                content: string;
                metadata?: { truncated?: boolean };
              }>,
            );
      const entries = rawEntries.slice(0, maxSummaryFiles);
      const filesCount = Array.isArray(result.summaries)
        ? result.summaries.length
        : result.files.length;
      const totalSize =
        result.totalSize > 0
          ? result.totalSize
          : Array.isArray(result.summaries)
            ? result.summaries.reduce(
                (sum, entry) => sum + (typeof entry.size === 'number' ? entry.size : 0),
                0,
              )
            : result.files.reduce((sum, file) => sum + file.size, 0);

      return {
        totalSize,
        totalSizeKB: (totalSize / 1024).toFixed(2),
        filesCount,
        summarizedFiles: entries.length,
        omittedFiles: Math.max(0, filesCount - entries.length),
        collectTime: result.collectTime,
        summary: entries,
      };
    };

    // Default to 'summary' mode to prevent full-collection payload bloat
    if (!smartMode) {
      smartMode = returnSummaryOnly ? 'summary' : 'summary';
    }

    const result = await this.collector.collect({
      url: argStringRequired(args, 'url'),
      includeInline: argBool(args, 'includeInline'),
      includeExternal: argBool(args, 'includeExternal'),
      includeDynamic: argBool(args, 'includeDynamic'),
      smartMode,
      compress: argBool(args, 'compress'),
      maxTotalSize: argNumber(args, 'maxTotalSize'),
      maxFileSize: args.maxFileSize ? argNumber(args, 'maxFileSize', 0) * 1024 : undefined,
      priorities: args.priorities as string[] | undefined,
    });

    if (returnSummaryOnly) {
      const summaryResult = summarizeResult(result);
      return asJsonResponse({
        mode: 'summary',
        ...summaryResult,
        hint: 'Use get_script_source for specific files.',
      });
    }

    const maxSafeCollectedSize = ANALYSIS_MAX_SAFE_COLLECTED_BYTES;
    const maxSafeResponseSize = ANALYSIS_MAX_SAFE_RESPONSE_BYTES;
    const estimatedResponseSize = Buffer.byteLength(JSON.stringify(result), 'utf8');

    if (result.totalSize > maxSafeCollectedSize || estimatedResponseSize > maxSafeResponseSize) {
      logger.warn(
        `Collected code is too large (collected=${(result.totalSize / 1024).toFixed(2)}KB, response=${(estimatedResponseSize / 1024).toFixed(2)}KB), returning summary mode.`,
      );

      const summaryResult = summarizeResult(result);
      return asJsonResponse({
        warning: 'Code size exceeds safe response threshold; summary returned.',
        ...summaryResult,
        estimatedResponseSize,
        estimatedResponseSizeKB: (estimatedResponseSize / 1024).toFixed(2),
        recommendations: [
          'Use get_script_source for targeted files.',
          'Use more specific priority filters.',
          'Use smartMode=summary for initial reconnaissance.',
        ],
      });
    }

    return asJsonResponse(result);
  }

  async handleSearchInScripts(args: ToolArgs): Promise<ToolResponse> {
    await this.scriptManager.init();

    const keyword = argString(args, 'keyword');
    if (!keyword) {
      return asJsonResponse({ success: false, error: 'keyword is required' });
    }

    const maxMatches = argNumber(args, 'maxMatches', 100);
    const returnSummary = argBool(args, 'returnSummary', false);
    const maxContextSize = argNumber(args, 'maxContextSize', 50000);

    const result = await this.scriptManager.searchInScripts(keyword, {
      isRegex: argBool(args, 'isRegex'),
      caseSensitive: argBool(args, 'caseSensitive'),
      contextLines: argNumber(args, 'contextLines'),
      maxMatches,
    });
    type ScriptSearchMatch = {
      scriptId?: string | number;
      url?: string;
      line?: number;
      context?: string;
    };

    const resultSize = JSON.stringify(result).length;
    const shouldSummarize = returnSummary || resultSize > maxContextSize;

    if (shouldSummarize) {
      const matches = (result.matches ?? []) as ScriptSearchMatch[];
      return asJsonResponse({
        success: true,
        keyword: args.keyword,
        totalMatches: matches.length,
        resultSize,
        resultSizeKB: (resultSize / 1024).toFixed(2),
        truncated: resultSize > maxContextSize,
        reason:
          resultSize > maxContextSize
            ? `Result too large (${(resultSize / 1024).toFixed(2)}KB > ${(maxContextSize / 1024).toFixed(2)}KB)`
            : 'Summary mode enabled',
        matchesSummary: matches.slice(0, 10).map((match) => ({
          scriptId: match.scriptId,
          url: match.url,
          line: match.line,
          preview: `${(match.context ?? '').substring(0, 100)}...`,
        })),
        recommendations: [
          'Use more specific keywords.',
          `Reduce maxMatches (current: ${maxMatches}).`,
          'Use get_script_source for targeted file retrieval.',
        ],
      });
    }

    return asJsonResponse(result);
  }

  async handleExtractFunctionTree(args: ToolArgs): Promise<ToolResponse> {
    const scriptId = argString(args, 'scriptId');
    const functionName = argString(args, 'functionName');

    // Validate required parameters
    if (!scriptId) {
      return asJsonResponse({
        success: false,
        error: 'scriptId is required',
        hint: 'Use get_all_scripts() to list available scripts and their scriptIds',
      });
    }

    if (!functionName) {
      return asJsonResponse({
        success: false,
        error: 'functionName is required',
        hint: 'Specify the name of the function to extract',
      });
    }

    await this.scriptManager.init();

    // Check if script exists before attempting extraction
    const scripts = await this.scriptManager.getAllScripts();
    const scriptExists = scripts.some((s) => String(s.scriptId) === String(scriptId));

    if (!scriptExists) {
      const availableScripts = scripts.slice(0, 10).map((s) => ({
        scriptId: s.scriptId,
        url: s.url?.substring(0, 80),
      }));

      return asJsonResponse({
        success: false,
        error: `Script not found: ${scriptId}`,
        hint: 'The specified scriptId does not exist. Use get_all_scripts() to list available scripts.',
        availableScripts:
          availableScripts.length > 0
            ? availableScripts
            : 'No scripts loaded. Navigate to a page first.',
        totalScripts: scripts.length,
      });
    }

    try {
      const result = await this.scriptManager.extractFunctionTree(scriptId, functionName, {
        maxDepth: argNumber(args, 'maxDepth'),
        maxSize: argNumber(args, 'maxSize'),
        includeComments: argBool(args, 'includeComments'),
      });
      return asJsonResponse({ success: true, ...result });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return asJsonResponse({
        success: false,
        error: errorMsg,
        hint: 'Make sure the function name exists in the specified script',
      });
    }
  }

  async handleDeobfuscate(args: ToolArgs): Promise<ToolResponse> {
    const code = this.requireCodeArg(args, 'deobfuscate');
    if (!code) {
      return asJsonResponse({
        success: false,
        error: 'code is required and must be a non-empty string',
      });
    }

    const engine = argEnum(args, 'engine', new Set(['auto', 'webcrack'] as const), 'auto');

    // webcrack engine = former advanced_deobfuscate path
    if (engine === 'webcrack') {
      const result = await this.advancedDeobfuscator.deobfuscate({
        code,
        ...this.extractWebcrackArgs(args),
        ...(typeof args.detectOnly === 'boolean' ? { detectOnly: args.detectOnly } : {}),
        ...(typeof args.aggressiveVM === 'boolean' ? { aggressiveVM: args.aggressiveVM } : {}),
        ...(typeof args.useASTOptimization === 'boolean'
          ? { useASTOptimization: args.useASTOptimization }
          : {}),
        ...(typeof args.timeout === 'number' ? { timeout: args.timeout } : {}),
      });
      return asJsonResponse(result);
    }

    // auto engine = former deobfuscate path
    const result = await this.deobfuscator.deobfuscate({
      code,
      aggressive: argBool(args, 'aggressive'),
      ...this.extractWebcrackArgs(args),
    });

    // Ensure failures always carry an error field for LLM clarity
    if (
      result &&
      typeof result === 'object' &&
      'success' in result &&
      result.success === false &&
      !('error' in result)
    ) {
      return asJsonResponse({
        ...result,
        error: (result as Record<string, unknown>).reason || 'deobfuscation failed',
      });
    }

    return asJsonResponse(result);
  }

  async handleUnderstandCode(args: ToolArgs): Promise<ToolResponse> {
    const code = this.requireCodeArg(args, 'understand_code');
    if (!code) {
      return asJsonResponse({
        success: false,
        error: 'code is required and must be a non-empty string',
      });
    }

    const result = await this.analyzer.understand({
      code,
      context: argObject(args, 'context'),
      focus: argEnum(args, 'focus', FOCUS_MODES, 'all'),
    });

    return asJsonResponse(result);
  }

  async handleDetectCrypto(args: ToolArgs): Promise<ToolResponse> {
    const code = this.requireCodeArg(args, 'detect_crypto');
    if (!code) {
      return asJsonResponse({
        success: false,
        error: 'code is required and must be a non-empty string',
      });
    }

    const result = await this.cryptoDetector.detect({
      code,
    });

    return asJsonResponse(result);
  }

  async handleManageHooks(args: ToolArgs): Promise<ToolResponse> {
    const action = argStringRequired(args, 'action');

    switch (action) {
      case 'create': {
        const result = await this.hookManager.createHook({
          target: argStringRequired(args, 'target'),
          type: argEnum(args, 'type', HOOK_TYPES) ?? 'function',
          action: argEnum(args, 'hookAction', HOOK_ACTIONS, 'log'),
          customCode: argString(args, 'customCode'),
        });
        return asJsonResponse(result);
      }
      case 'list':
        return asJsonResponse({ hooks: this.hookManager.getAllHooks() });
      case 'records':
        return asJsonResponse({
          records: this.hookManager.getHookRecords(argStringRequired(args, 'hookId')),
        });
      case 'clear':
        this.hookManager.clearHookRecords(argString(args, 'hookId'));
        return asJsonResponse({ success: true, message: 'Hook records cleared' });
      default:
        return asJsonResponse({
          success: false,
          message: `Unknown hook action: ${action}. Valid actions: create, list, records, clear`,
        });
    }
  }

  async handleDetectObfuscation(args: ToolArgs): Promise<ToolResponse> {
    const code = this.requireCodeArg(args, 'detect_obfuscation');
    if (!code) {
      return asJsonResponse({
        success: false,
        error: 'code is required and must be a non-empty string',
      });
    }

    const generateReport = argBool(args, 'generateReport', true);
    const result = this.obfuscationDetector.detect(code);

    if (!generateReport) {
      return asJsonResponse(result);
    }

    const report = this.obfuscationDetector.generateReport(result);
    return asTextResponse(`${JSON.stringify(result, null, 2)}\n\n${report}`);
  }

  async handleWebcrackUnpack(args: ToolArgs): Promise<ToolResponse> {
    const code = this.requireCodeArg(args, 'webcrack_unpack');
    if (!code) {
      return asJsonResponse({
        success: false,
        error: 'code is required and must be a non-empty string',
      });
    }

    const result = await runWebcrack(code, {
      unpack: argBool(args, 'unpack', true),
      unminify: argBool(args, 'unminify', true),
      jsx: argBool(args, 'jsx', true),
      mangle: argBool(args, 'mangle', false),
      ...this.extractWebcrackArgs(args),
    });

    if (!result.applied) {
      return asJsonResponse({
        success: false,
        error: result.reason || 'webcrack execution failed',
        optionsUsed: result.optionsUsed,
        engine: 'webcrack',
      });
    }

    return asJsonResponse({
      success: true,
      code: result.code,
      bundle: result.bundle,
      savedTo: result.savedTo,
      savedArtifacts: result.savedArtifacts,
      optionsUsed: result.optionsUsed,
      engine: 'webcrack',
    });
  }

  async handleWebpackEnumerate(args: ToolArgs): Promise<ToolResponse> {
    return runWebpackEnumerate(this.collector, args);
  }

  async handleClearCollectedData(): Promise<ToolResponse> {
    try {
      await this.collector.clearAllData();
      this.scriptManager.clear();
      return asJsonResponse({
        success: true,
        message: 'All collected data cleared.',
        cleared: {
          fileCache: true,
          compressionCache: true,
          collectedUrls: true,
          scriptManager: true,
        },
      });
    } catch (error) {
      logger.error('Failed to clear collected data:', error);
      return asJsonResponse(serializeError(error));
    }
  }

  async handleGetCollectionStats(): Promise<ToolResponse> {
    try {
      const stats = await this.collector.getAllStats();
      return asJsonResponse({
        success: true,
        stats,
        summary: {
          totalCachedFiles: stats.cache.memoryEntries + stats.cache.diskEntries,
          totalCacheSize: `${(stats.cache.totalSize / 1024).toFixed(2)} KB`,
          compressionRatio: `${stats.compression.averageRatio.toFixed(1)}%`,
          cacheHitRate:
            stats.compression.cacheHits > 0
              ? `${(
                  (stats.compression.cacheHits /
                    (stats.compression.cacheHits + stats.compression.cacheMisses)) *
                  100
                ).toFixed(1)}%`
              : '0%',
          collectedUrls: stats.collector.collectedUrls,
        },
      });
    } catch (error) {
      logger.error('Failed to get collection stats:', error);
      return asJsonResponse(serializeError(error));
    }
  }

  async handleJsDeobfuscateJsvmp(args: ToolArgs): Promise<ToolResponse> {
    const code = this.requireCodeArg(args, 'js_deobfuscate_jsvmp');
    if (!code) {
      return asJsonResponse({
        success: false,
        error: 'code is required and must be a non-empty string',
      });
    }

    const detectOnly = argBool(args, 'detectOnly', false);
    const result = await this.jsvmpDeobfuscator.deobfuscate({
      code,
      aggressive: argBool(args, 'aggressive', false),
      extractInstructions: argBool(args, 'extractInstructions', true),
      timeout: argNumber(args, 'timeout', 30000),
    });

    if (detectOnly) {
      return asJsonResponse({
        success: true,
        isJSVMP: result.isJSVMP,
        vmType: result.vmType,
        vmFeatures: result.vmFeatures,
        confidence: result.confidence,
        instructionCount: result.instructions?.length,
      });
    }

    return asJsonResponse({
      success: result.isJSVMP,
      isJSVMP: result.isJSVMP,
      vmType: result.vmType,
      vmFeatures: result.vmFeatures,
      instructions: result.instructions,
      deobfuscatedCode: result.deobfuscatedCode,
      confidence: result.confidence,
      warnings: result.warnings,
      unresolvedParts: result.unresolvedParts,
      stats: result.stats,
    });
  }

  async handleJsDeobfuscatePipeline(args: ToolArgs): Promise<ToolResponse> {
    const code = this.requireCodeArg(args, 'js_deobfuscate_pipeline');
    if (!code) {
      return asJsonResponse({ success: false, error: 'code is required' });
    }

    const useWebcrack = argBool(args, 'useWebcrack', true);
    const aggressive = argBool(args, 'aggressive', false);
    const humanize = argBool(args, 'humanize', true);
    const returnStageDetails = argBool(args, 'returnStageDetails', false);
    const startTime = Date.now();

    // Stage 1: Preprocessor — constant folding, dead code removal
    let preprocessed = code;
    const ppTransforms: string[] = [];

    const afterFold = applyConstantFold(preprocessed);
    if (afterFold !== preprocessed) {
      preprocessed = afterFold;
      ppTransforms.push('constant_fold');
    }

    const afterDeadCode = applyDeadCodeRemove(preprocessed);
    if (afterDeadCode !== preprocessed) {
      preprocessed = afterDeadCode;
      ppTransforms.push('dead_code_remove');
    }

    // Stage 2: Deobfuscator — webcrack
    let deobfuscated = preprocessed;
    let webcrackApplied = false;
    let webcrackWarning: string | undefined;
    let webcrackError: string | undefined;
    if (useWebcrack) {
      try {
        const result = await runWebcrack(preprocessed, { unminify: true, unpack: true });
        if (result.applied) {
          deobfuscated = result.code;
          webcrackApplied = true;
        } else {
          webcrackWarning = result.reason
            ? `webcrack stage did not apply: ${result.reason}`
            : 'webcrack stage did not apply any transformation.';
        }
      } catch (error) {
        webcrackError = error instanceof Error ? error.message : String(error);
      }
    }

    if (aggressive) {
      const afterCFF = applyControlFlowFlatten(deobfuscated);
      if (afterCFF !== deobfuscated) {
        deobfuscated = afterCFF;
      }
    }

    // Stage 3: Humanizer — variable renaming
    let humanized = deobfuscated;
    let renameCount = 0;
    if (humanize) {
      const result = applyRenameVars(humanized);
      if (result.code !== humanized) {
        humanized = result.code;
        renameCount = result.count;
      }
    }

    const totalMs = Date.now() - startTime;
    const reductionRate = code.length > 0 ? 1 - humanized.length / code.length : 0;
    const pipelineSuccess = !webcrackWarning && !webcrackError;

    const response: Record<string, unknown> = {
      success: pipelineSuccess,
      deobfuscatedCode: humanized,
      ...(webcrackWarning ? { warning: webcrackWarning } : {}),
      ...(webcrackError ? { error: `webcrack stage failed: ${webcrackError}` } : {}),
      stats: {
        originalSize: code.length,
        finalSize: humanized.length,
        reductionRate: Math.round(reductionRate * 1000) / 10,
        processingTimeMs: totalMs,
        stages: {
          preprocessor: { transforms: ppTransforms, sizeAfter: preprocessed.length },
          deobfuscator: {
            webcrackApplied,
            sizeAfter: deobfuscated.length,
            ...(webcrackWarning ? { warning: webcrackWarning } : {}),
            ...(webcrackError ? { error: webcrackError } : {}),
          },
          humanizer: { renameCount, sizeAfter: humanized.length },
        },
      },
    };

    if (returnStageDetails) {
      response.stageDetails = {
        preprocessed: preprocessed.substring(0, 5000),
        deobfuscated: deobfuscated.substring(0, 5000),
      };
    }

    return asJsonResponse(response);
  }

  async handleJsAnalyzeVm(args: ToolArgs): Promise<ToolResponse> {
    const code = this.requireCodeArg(args, 'js_analyze_vm');
    if (!code) {
      return asJsonResponse({ success: false, error: 'code is required' });
    }

    const extractBytecode = argBool(args, 'extractBytecode', true);
    const mapOpcodes = argBool(args, 'mapOpcodes', true);

    const vmResult = await this.jsvmpDeobfuscator.deobfuscate({
      code,
      aggressive: false,
      extractInstructions: extractBytecode,
      timeout: 15000,
    });

    if (!vmResult.isJSVMP) {
      return asJsonResponse({
        success: true,
        isVM: false,
        message: 'No VM/JSVMP patterns detected.',
      });
    }

    let dispatchType = 'switch';
    if (/if\s*\(\s*\w+\s*===?\s*\w+/.test(code)) dispatchType = 'if-else-chain';
    if (/while.*switch/s.test(code)) dispatchType = 'while-switch';
    if (/for.*switch/s.test(code)) dispatchType = 'for-switch';

    const analysis: Record<string, unknown> = {
      isVM: true,
      vmType: vmResult.vmType,
      dispatchType,
      complexity: vmResult.vmFeatures?.complexity,
      instructionCount: vmResult.vmFeatures?.instructionCount,
      interpreterLocation: vmResult.vmFeatures?.interpreterLocation,
    };

    if (extractBytecode && vmResult.instructions) {
      analysis.bytecode = vmResult.instructions;
    }

    if (mapOpcodes && vmResult.instructions) {
      const opcodeMap = new Map<string, number>();
      for (const inst of vmResult.instructions) {
        const type = inst.type || 'unknown';
        opcodeMap.set(type, (opcodeMap.get(type) || 0) + 1);
      }
      analysis.opcodeDistribution = Object.fromEntries(opcodeMap);
      analysis.suggestedStrategy =
        vmResult.vmFeatures?.complexity === 'high'
          ? 'Use symbolic execution (js_deobfuscate_jsvmp with aggressive=true) for high-complexity VMs'
          : 'Use standard deobfuscation pipeline (js_deobfuscate_pipeline)';
    }

    return asJsonResponse({ success: true, analysis });
  }

  async handleJsSolveConstraints(args: ToolArgs): Promise<ToolResponse> {
    const code = this.requireCodeArg(args, 'js_solve_constraints');
    if (!code) {
      return asJsonResponse({ success: false, error: 'code is required' });
    }

    const replaceInPlace = argBool(args, 'replaceInPlace', true);
    const maxIterations = argNumber(args, 'maxIterations', 100);

    const solved: Array<{ pattern: string; original: string; result: string }> = [];
    let output = code;

    // --- Stage 1: Constant comparison: if (5 > 3) → always true ---
    const constCmpPattern = /if\s*\(\s*(-?\d+(?:\.\d+)?)\s*([<>!=]+)\s*(-?\d+(?:\.\d+)?)\s*\)/g;
    let iterations = 0;
    output = replaceOutsideProtectedRanges(
      output,
      constCmpPattern,
      (fullMatch, leftRaw: string, op: string, rightRaw: string) => {
        if (iterations >= maxIterations) {
          return fullMatch;
        }
        iterations++;

        const left = Number(leftRaw);
        const right = Number(rightRaw);
        let result: boolean | undefined;
        if (op === '<') result = left < right;
        else if (op === '>') result = left > right;
        else if (op === '<=' || op === '<==') result = left <= right;
        else if (op === '>=' || op === '>==') result = left >= right;
        else if (op === '==' || op === '===') result = left === right;
        else if (op === '!=' || op === '!==') result = left !== right;

        if (result === undefined) {
          return fullMatch;
        }

        solved.push({
          pattern: 'constant-comparison',
          original: fullMatch,
          result: String(result),
        });
        return replaceInPlace ? `/* ${fullMatch} → ${result} */ if (${result})` : `if (${result})`;
      },
    );

    // --- Stage 2: JSFuck-style patterns ---
    // More-specific patterns must run before atomic +[] / ![] rewrites.
    const jsFuckMap: Array<[RegExp, string]> = [
      [
        /\[!\[\]\]\[\(['"]\)constructor['"]\)\]\(!!\[\]\+\[\]\)\(\)/g,
        '"function Boolean() { [native code] }"',
      ],
      [/!!\[\]\+\[\]/g, '"true"'],
      [/!\[\]\+\[\]/g, '"false"'],
      [/\+!!\[\]/g, '1'],
      [/\[\]\+\[\]/g, '""'],
      [/\+\[\]/g, '0'],
    ];
    for (const [re, replacement] of jsFuckMap) {
      output = replaceOutsideProtectedRanges(output, re, (fullMatch) => {
        solved.push({ pattern: 'jsfuck', original: fullMatch, result: replacement });
        return replacement;
      });
    }

    // --- Stage 3: Boolean literal patterns ---
    // !![] → true, ![] → false
    const boolPatterns: Array<[RegExp, string, string]> = [
      [/!!\[\]/g, 'true', 'boolean-literal'],
      [/!\[\]/g, 'false', 'boolean-literal'],
    ];
    for (const [re, replacement, patternName] of boolPatterns) {
      output = replaceOutsideProtectedRanges(output, re, (fullMatch) => {
        solved.push({ pattern: patternName, original: fullMatch, result: replacement });
        return replacement;
      });
    }

    // void 0 → undefined
    output = replaceOutsideProtectedRanges(output, /void\s+0/g, (fullMatch) => {
      solved.push({ pattern: 'undefined-literal', original: fullMatch, result: 'undefined' });
      return 'undefined';
    });

    // --- Stage 4: Opaque predicates (always-true / always-false expressions) ---
    // Pattern: !0 → true, !1 → false, !0x0 → true
    output = replaceOutsideProtectedRanges(output, /!0x0\b|!\b0(?![.\d])/g, (fullMatch) => {
      solved.push({ pattern: 'opaque-truthy', original: fullMatch, result: 'true' });
      return 'true';
    });

    // Pattern: !-1 → false (since -1 is truthy, !(-1) = false)
    // But !0x1 → false, !(1) → false — any !<non-zero-number>
    const opaqueFalsy = /!\s*(-?\d+(?:\.\d+)?)(?![.\d\s\w])/g;
    output = replaceOutsideProtectedRanges(output, opaqueFalsy, (fullMatch, numericRaw: string) => {
      const numVal = Number(numericRaw);
      if (numVal === 0 || !Number.isFinite(numVal)) {
        return fullMatch;
      }
      solved.push({ pattern: 'opaque-falsy', original: fullMatch, result: 'false' });
      return 'false';
    });

    // --- Stage 5: String array access via computed indices ---
    // Pattern: _0x1234('0x1') where _0x1234 is a string array decoder
    // Solve inline: _0x1234 = ['a','b','c']; _0x1234('0x1') → _0x1234[1]
    const stringArrayDecl =
      /(?:var|let|const)\s+(\w+)\s*=\s*\[(['"][^'"]*['"]\s*(?:,\s*['"][^'"]*['"]\s*)*)\]/g;
    const stringArrays = new Map<string, string[]>();
    replaceOutsideProtectedRanges(
      output,
      stringArrayDecl,
      (fullMatch, name: string, arrContent: string) => {
        const items = arrContent.split(/,\s*/).map((s) => s.replace(/^['"]|['"]$/g, ''));
        stringArrays.set(name, items);
        return fullMatch;
      },
    );
    if (stringArrays.size > 0) {
      for (const [name, items] of stringArrays) {
        const accessRe = new RegExp(
          `${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(['"]?(0x[0-9a-fA-F]+|\\d+)['"]?\\)`,
          'g',
        );
        output = replaceOutsideProtectedRanges(output, accessRe, (fullMatch, rawIndex: string) => {
          if (iterations >= maxIterations) {
            return fullMatch;
          }
          iterations++;

          const idx = rawIndex.startsWith('0x') ? Number.parseInt(rawIndex, 16) : Number(rawIndex);
          if (idx < 0 || idx >= items.length) {
            return fullMatch;
          }

          const resolved = JSON.stringify(items[idx]!);
          solved.push({
            pattern: 'string-array-access',
            original: fullMatch,
            result: resolved,
          });
          return resolved;
        });
      }
    }

    // --- Stage 6: Type coercion truths ---
    // typeof undefined === "undefined" → true
    // typeof null === "object" → true
    // null == undefined → true
    // NaN === NaN → false
    const coercionPatterns: Array<[RegExp, string]> = [
      [/typeof\s+undefined\s*===?\s*["']undefined["']/g, 'true'],
      [/typeof\s+null\s*===?\s*["']object["']/g, 'true'],
      [/typeof\s+NaN\s*===?\s*["']number["']/g, 'true'],
      [/null\s*==\s*undefined/g, 'true'],
      [/null\s*===\s*undefined/g, 'false'],
      [/NaN\s*===?\s*NaN/g, 'false'],
    ];
    for (const [re, replacement] of coercionPatterns) {
      output = replaceOutsideProtectedRanges(output, re, (fullMatch) => {
        solved.push({ pattern: 'type-coercion', original: fullMatch, result: replacement });
        return replacement;
      });
    }

    return asJsonResponse({
      success: true,
      solvedCount: solved.length,
      solved,
      transformedCode: replaceInPlace ? output : undefined,
    });
  }
}
