/**
 * PoisonedNameQuarantine — Anti-LLM identifier isolation system.
 *
 * Research (arxiv 2604.04289, 2026) shows that obfuscators now plant
 * "poisoned identifiers" in string tables that survive LLM deobfuscation
 * and propagate misleading names into the output.
 *
 * This module:
 *   1. Detects likely-poisoned names from obfuscator string tables
 *   2. Quarantines them (marks as untrusted)
 *   3. Provides validated renames based on behavior, not string tables
 *   4. Reports LLM-deobfuscation risk for a given sample
 *
 * Key insight: Never trust names from string tables or decoder outputs.
 * Rename from: usage sites, call patterns, dataflow, export roles.
 */

import { logger } from '@utils/logger';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';

// ── Types ──

export interface QuarantinedName {
  /** The original name from the string table / decoder */
  originalName: string;
  /** Why we think it's poisoned */
  reason: 'string-table-origin' | 'decoder-output' | 'hash-like' | 'numeric-mangling' | 'adversarial-pattern' | 'non-ascii' | 'reserved-word-lookalike';
  /** Confidence that this is a poisoned name (0-1) */
  confidence: number;
  /** Suggested safe replacement (derived from behavior, or generated) */
  safeReplacement: string;
  /** Whether this name has been replaced in the code */
  replaced: boolean;
}

export interface QuarantineResult {
  /** All quarantined names found */
  quarantinedNames: QuarantinedName[];
  /** Code with quarantined names replaced */
  code: string;
  /** Number of replacements made */
  replacedCount: number;
  /** LLM deobfuscation risk assessment */
  llmRisk: {
    level: 'low' | 'medium' | 'high';
    score: number;
    description: string;
  };
  /** Warnings */
  warnings: string[];
}

// ── Poisoned Name Detection ──

const ADVERSARIAL_PATTERNS = [
  // Names designed to confuse LLMs: look like keywords but aren't
  /^(?:class|function|return|var|let|const|if|else|for|while|switch|case|break|continue|try|catch|finally|throw|new|delete|typeof|instanceof|void|this|super|import|export|default|yield|async|await|with|debugger|do|in|of)$/,
  // Names that look like built-in globals but aren't
  /^(?:window|document|console|process|global|globalThis|module|require|__dirname|__filename|Buffer|setTimeout|setInterval|setImmediate|clearTimeout|clearInterval|clearImmediate|parseInt|parseFloat|isNaN|isFinite|encodeURI|decodeURI|encodeURIComponent|decodeURIComponent|eval|Function|Array|Object|String|Number|Boolean|Symbol|Date|RegExp|Error|TypeError|RangeError|ReferenceError|SyntaxError|URIError|EvalError|Promise|Map|Set|WeakMap|WeakSet|Proxy|Reflect|Math|JSON|Intl|WebAssembly)$/,
  // Names with suspicious repeated characters or zero-width chars
  /[\u200b-\u200f\u202a-\u202e\ufeff\u2060-\u2064]/,
  // Names that are just hex sequences or random-looking
  /^_0x[0-9a-f]{2,}$/i,
  // Names with numeric suffixes suggesting auto-generation
  /^(?:a|b|c|d|e|f|g|h|i|j|k|l|m|n|o|p|q|r|s|t|u|v|w|x|y|z)(?:\d{3,})$/,
];

const HASH_LIKE_PATTERNS = [
  /^[a-f0-9]{8,}$/i,
  /^[A-Za-z0-9+/=]{20,}$/,
];

const NON_ASCII_PATTERNS = [
  /[^\x00-\x7F]/,
];

export function detectPoisonedNames(code: string): QuarantinedName[] {
  const names: QuarantinedName[] = [];
  const seenNames = new Set<string>();

  try {
    const ast = parser.parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });

    traverse(ast, {
      Identifier(path) {
        const name = path.node.name;
        if (!name || seenNames.has(name)) return;
        seenNames.add(name);

        // Check each adversarial pattern
        for (const pattern of ADVERSARIAL_PATTERNS) {
          if (pattern.test(name)) {
            names.push({
              originalName: name,
              reason: 'adversarial-pattern',
              confidence: 0.9,
              safeReplacement: `quarantined_${names.length}`,
              replaced: false,
            });
            return; // One detection per name
          }
        }

        // Check hash-like
        for (const pattern of HASH_LIKE_PATTERNS) {
          if (pattern.test(name)) {
            names.push({
              originalName: name,
              reason: 'hash-like',
              confidence: 0.7,
              safeReplacement: `hash_${names.length}`,
              replaced: false,
            });
            return;
          }
        }

        // Check non-ASCII (zero-width or foreign chars injected)
        for (const pattern of NON_ASCII_PATTERNS) {
          if (pattern.test(name)) {
            names.push({
              originalName: name,
              reason: 'non-ascii',
              confidence: 0.85,
              safeReplacement: `nonascii_${names.length}`,
              replaced: false,
            });
            return;
          }
        }

        // Check _0x style names (obfuscator.io identifiers)
        if (/^_0x[0-9a-f]{2,}$/i.test(name)) {
          names.push({
            originalName: name,
            reason: 'string-table-origin',
            confidence: 0.65,
            safeReplacement: `obf_${name.replace(/^_0x/i, '')}`,
            replaced: false,
          });
          return;
        }

        // Numeric mangling: names like a1234, z999
        if (/^[a-z]\d{3,}$/i.test(name)) {
          names.push({
            originalName: name,
            reason: 'numeric-mangling',
            confidence: 0.55,
            safeReplacement: `mangled_${names.length}`,
            replaced: false,
          });
        }
      },
    });
  } catch (e) {
    logger.warn(`PoisonedNameQuarantine: AST parse failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return names;
}

// ── Behavioral Rename Derivation ──

/**
 * Derive a meaningful name for a quarantined identifier based on its usage context.
 *
 * Instead of trusting string-table names, we look at:
 * - How the variable is used (call patterns, property accesses)
 * - Whether it's exported / imported
 * - What it returns
 * - Its position in the call graph
 */
export function deriveBehavioralName(
  code: string,
  targetName: string,
): string {
  try {
    const ast = parser.parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });

    let isExported = false;
    let isCalledAsFunction = false;
    let returnTypes: string[] = [];
    let propertyAccesses: string[] = [];

    traverse(ast, {
      Identifier(path) {
        if (path.node.name !== targetName) return;

        const parent = path.parent;

        // Check if it's exported
        if (
          t.isExportNamedDeclaration(parent) ||
          t.isExportDefaultDeclaration(parent) ||
          (t.isMemberExpression(parent) && t.isIdentifier(parent.object, { name: 'exports' }))
        ) {
          isExported = true;
        }

        // Check if it's called as a function
        if (t.isCallExpression(parent) && t.isIdentifier(parent.callee, { name: targetName })) {
          isCalledAsFunction = true;
        }

        // Check what it returns (if it's a function with return statements)
        if (t.isReturnStatement(parent) && t.isIdentifier(parent.argument, { name: targetName })) {
          returnTypes.push('returned');
        }

        // Check property accesses
        if (t.isMemberExpression(parent) && t.isIdentifier(parent.object, { name: targetName })) {
          if (t.isIdentifier(parent.property)) {
            propertyAccesses.push(parent.property.name);
          }
        }
      },
    });

    // Build name from behavior
    const parts: string[] = [];

    if (isCalledAsFunction) {
      parts.push('fn');
    }

    if (isExported) {
      parts.push('exported');
    }

    if (propertyAccesses.length > 0) {
      parts.push(propertyAccesses.slice(0, 3).join('_'));
    }

    if (returnTypes.length > 0) {
      parts.push('retval');
    }

    if (parts.length === 0) {
      return `var_${targetName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20)}`;
    }

    return parts.join('_');
  } catch {
    return `safe_${targetName.slice(0, 16)}`;
  }
}

// ── Quarantine Application ──

export function applyQuarantine(
  code: string,
  quarantinedNames: QuarantinedName[],
  options?: { useBehavioralNames?: boolean },
): { code: string; replacedCount: number; updatedNames: QuarantinedName[] } {
  let current = code;
  let replacedCount = 0;
  const updatedNames: QuarantinedName[] = [];

  for (const qn of quarantinedNames) {
    if (qn.replaced) {
      updatedNames.push(qn);
      continue;
    }

    // Derive behavioral name if requested
    const safeName = options?.useBehavioralNames
      ? deriveBehavioralName(code, qn.originalName)
      : qn.safeReplacement;

    // Replace all occurrences of the poisoned name
    // Use word-boundary-aware replacement to avoid partial matches
    const namePattern = new RegExp(`\\b${qn.originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    const before = current;
    current = current.replace(namePattern, safeName);

    if (current !== before) {
      replacedCount++;
      updatedNames.push({ ...qn, safeReplacement: safeName, replaced: true });
    } else {
      updatedNames.push(qn);
    }
  }

  return { code: current, replacedCount, updatedNames };
}

// ── LLM Risk Assessment ──

export function assessLLMDeobfuscationRisk(code: string): QuarantineResult['llmRisk'] {
  const poisonedNames = detectPoisonedNames(code);
  const hasStringTables = /var\s+_0x\w+\s*=\s*\[/.test(code);
  const hasSelfDefending = /debugger|while\s*\(\s*!?\w+\s*\)\s*\{|Function\.prototype\.toString/.test(code);

  let score = 0;

  // Each poisoned name increases risk
  score += Math.min(poisonedNames.length * 0.05, 0.3);

  // String tables are high-risk channels for poisoning
  if (hasStringTables) score += 0.2;

  // Self-defending code resists deobfuscation
  if (hasSelfDefending) score += 0.15;

  // Lots of _0x identifiers suggest heavy obfuscator.io
  const hexIdentCount = (code.match(/_0x[0-9a-f]{2,}/gi) ?? []).length;
  if (hexIdentCount > 20) score += 0.1;

  score = Math.min(score, 1.0);

  const level = score >= 0.6 ? 'high' : score >= 0.3 ? 'medium' : 'low';

  return {
    level,
    score,
    description: score >= 0.6
      ? `High risk: ${poisonedNames.length} poisoned identifiers, string tables present. LLM will likely propagate misleading names.`
      : score >= 0.3
        ? `Medium risk: ${poisonedNames.length} poisoned identifiers detected. LLM may introduce some misleading names.`
        : `Low risk: ${poisonedNames.length} poisoned identifiers. LLM deobfuscation should be relatively safe.`,
  };
}

// ── Main Entry Point ──

export function quarantinePoisonedNames(
  code: string,
  options?: { useBehavioralNames?: boolean },
): QuarantineResult {
  const warnings: string[] = [];
  const startTime = Date.now();

  logger.info('PoisonedNameQuarantine: detecting poisoned names...');

  const quarantinedNames = detectPoisonedNames(code);
  const llmRisk = assessLLMDeobfuscationRisk(code);

  logger.info(`PoisonedNameQuarantine: found ${quarantinedNames.length} poisoned names, LLM risk=${llmRisk.level} (${llmRisk.score.toFixed(2)})`);

  if (quarantinedNames.length === 0) {
    return {
      quarantinedNames,
      code,
      replacedCount: 0,
      llmRisk,
      warnings: ['No poisoned names detected'],
    };
  }

  const { code: updatedCode, replacedCount, updatedNames } = applyQuarantine(code, quarantinedNames, options);

  logger.info(`PoisonedNameQuarantine: replaced ${replacedCount} names in ${Date.now() - startTime}ms`);

  return {
    quarantinedNames: updatedNames,
    code: updatedCode,
    replacedCount,
    llmRisk,
    warnings,
  };
}