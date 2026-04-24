/**
 * PreludeCarver — Isolate obfuscation machinery before heavy transforms.
 *
 * Inspired by CASCADE (google/jsir) and JSIMPLIFIER (NDSS 2026).
 *
 * The "prelude" is the obfuscation infrastructure:
 *   - String decoders / decoders with rotation
 *   - Wrapper factories
 *   - VM bootstrap + opcode derivation
 *   - Integrity / tamper scaffolding
 *   - Anti-LLM poisoned identifier reservoirs
 *   - Self-defending / anti-debug guards
 *
 * By carving the prelude first, subsequent passes can:
 *   1. Replace decoder calls with their resolved values
 *   2. Remove bootstrapping code
 *   3. Quarantine poisoned names from string tables
 *   4. Skip integrity checks
 *
 * Design:
 *   detectPrelude() → identify prelude functions
 *   evaluatePrelude() → sandbox-evaluate string tables, decoders, wrapper factories
 *   carvePrelude() → separate prelude from "payload" code
 *   replacePreludeCalls() → inline resolved values into payload
 *   reconstructCode() → merge carved payload + replacements
 */

import { logger } from '@utils/logger';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { type ExecutionSandbox } from '@modules/security/ExecutionSandbox';
import { detectJSDefenderPatterns } from '@modules/deobfuscator/JSDefenderDeobfuscator';

// ── Types ──

export interface PreludeFunction {
  /** Name or inferred role of the prelude function */
  name: string;
  /** Category of prelude machinery */
  category:
    | 'decoder'
    | 'rotator'
    | 'wrapper'
    | 'vm-bootstrap'
    | 'integrity'
    | 'anti-debug'
    | 'string-table'
    | 'opcode-derivation';
  /** Confidence in detection */
  confidence: number;
  /** Source snippet */
  snippet: string;
  /** AST node type */
  nodeType: string;
  /** Whether the prelude function has been evaluated */
  evaluated: boolean;
  /** Resolved value (if evaluated successfully) */
  resolvedValue?: string;
}

export interface PreludeCarverResult {
  /** Detected prelude functions */
  preludeFunctions: PreludeFunction[];
  /** Code with prelude calls replaced by resolved values */
  code: string;
  /** Separated prelude code */
  preludeCode: string;
  /** Separated payload code (business logic) */
  payloadCode: string;
  /** Number of replaced calls */
  replaced: number;
  /** Warnings */
  warnings: string[];
  /** Whether carving was successful */
  success: boolean;
}

// ── Detection ──

const DECODER_PATTERNS = [
  // String decode function: takes index, returns decoded string
  /function\s+\w+\s*\(\s*\w+\s*\)\s*\{\s*(?:return\s+)?\w+\[\s*\w+\s*\]/,
  // Base64/RC4 decoder
  /function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?atob\s*\(|[\s\S]*?charCodeAt\s*\(/,
  // Decoder with push/shift rotation
  /\.push\s*\(\s*\w+\.shift\s*\(\s*\)\s*\)/,
];

const ROTATOR_PATTERNS = [
  /\(\s*function\s*\(\s*\w+\s*,\s*\w+\s*\)\s*\{[\s\S]*?\.push\s*\(\s*\w+\.shift\s*\(\s*\)\s*\)/,
  /\w+\[\s*["']push["']\s*\]\(\s*\w+\[\s*["']shift["']\s*\]\(\s*\)\s*\)/,
];

const WRAPPER_PATTERNS = [
  /function\s+\w+\s*\(\s*\)\s*\{\s*return\s+\w+\s*\(\s*\w+\s*\)/,
  /var\s+\w+\s*=\s*function\s*\([^)]*\)\s*\{\s*return\s+\w+\s*\(/,
  // Hash-preserving clone wrappers (JSDefender)
  /function\s+\w+\s*\([^)]*\)\s*\{\s*try\s*\{[\s\S]*?_0x\w+\s*\(/,
];

const VM_BOOTSTRAP_PATTERNS = [
  /while\s*\(\s*true\s*\)\s*\{[\s\S]{0,300}switch\s*\(/i,
  /var\s+\w+\s*=\s*\[\s*\d+(?:\s*,\s*\d+){10,}\s*\]/i,
  /\w+\[pc\+\+\]/i,
  /new\s+Function\s*\(\s*["']use strict["']/i,
];

const INTEGRITY_PATTERNS = [
  /Function\.prototype\.toString\s*\(/,
  /function\s+\w+\s*\(\s*\)\s*\{\s*if\s*\([^)]*===[^)]*\)\s*throw/,
  /debugger/,
  /while\s*\(\s*!?\w+\s*\)\s*\{[^}]*console[^}]*\}/,
];

const ANTI_DEBUG_PATTERNS = [
  /setInterval\s*\(\s*function\s*\(\s*\)\s*\{\s*debugger/,
  /console\.\w+\s*=\s*function/,
  /Object\.defineProperty\s*\(\s*console/,
];

const STRING_TABLE_PATTERNS = [
  /var\s+_0x\w+\s*=\s*\[/,
  /let\s+_0x\w+\s*=\s*\[/,
  /const\s+_0x\w+\s*=\s*\[/,
];

const OPCODE_DERIVATION_PATTERNS = [
  /parseInt\s*\(\s*["']?\s*\+\s*\w+\[/,
  /\w+\s*=\s*\w+\s*\+\s*parseInt/,
  /\w+\[.*?%.*?\]/,
];

export function detectPrelude(code: string): PreludeFunction[] {
  const preludeFunctions: PreludeFunction[] = [];

  try {
    const ast = parser.parse(code, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });

    traverse(ast, {
      FunctionDeclaration(path) {
        const fnName = path.node.id?.name ?? '';
        const source = code.slice(path.node.start ?? 0, path.node.end ?? 0);
        const snippet = source.slice(0, 200);
        const nodeType = path.node.type;

        for (const pattern of DECODER_PATTERNS) {
          if (pattern.test(source)) {
            preludeFunctions.push({
              name: fnName,
              category: 'decoder',
              confidence: 0.85,
              snippet,
              nodeType,
              evaluated: false,
            });
            return;
          }
        }

        for (const pattern of ROTATOR_PATTERNS) {
          if (pattern.test(source)) {
            preludeFunctions.push({
              name: fnName,
              category: 'rotator',
              confidence: 0.8,
              snippet,
              nodeType,
              evaluated: false,
            });
            return;
          }
        }

        for (const pattern of WRAPPER_PATTERNS) {
          if (pattern.test(source)) {
            preludeFunctions.push({
              name: fnName,
              category: 'wrapper',
              confidence: 0.75,
              snippet,
              nodeType,
              evaluated: false,
            });
            return;
          }
        }

        for (const pattern of VM_BOOTSTRAP_PATTERNS) {
          if (pattern.test(source)) {
            preludeFunctions.push({
              name: fnName,
              category: 'vm-bootstrap',
              confidence: 0.9,
              snippet,
              nodeType,
              evaluated: false,
            });
            return;
          }
        }

        for (const pattern of INTEGRITY_PATTERNS) {
          if (pattern.test(source)) {
            preludeFunctions.push({
              name: fnName,
              category: 'integrity',
              confidence: 0.7,
              snippet,
              nodeType,
              evaluated: false,
            });
            return;
          }
        }

        for (const pattern of ANTI_DEBUG_PATTERNS) {
          if (pattern.test(source)) {
            preludeFunctions.push({
              name: fnName,
              category: 'anti-debug',
              confidence: 0.75,
              snippet,
              nodeType,
              evaluated: false,
            });
            return;
          }
        }

        for (const pattern of OPCODE_DERIVATION_PATTERNS) {
          if (pattern.test(source)) {
            preludeFunctions.push({
              name: fnName,
              category: 'opcode-derivation',
              confidence: 0.8,
              snippet,
              nodeType,
              evaluated: false,
            });
            return;
          }
        }
      },

      VariableDeclarator(path) {
        if (!t.isIdentifier(path.node.id)) return;
        const varName = path.node.id.name;
        const init = path.node.init;
        if (!init) return;

        // String tables: large arrays of string/numeric literals
        if (t.isArrayExpression(init) && init.elements.length > 15) {
          const hasStrings = init.elements.some((el) => t.isStringLiteral(el));
          const hasHex = init.elements.some((el) => t.isNumericLiteral(el));
          if (hasStrings || hasHex) {
            for (const pattern of STRING_TABLE_PATTERNS) {
              const source = code.slice(path.node.start ?? 0, path.node.end ?? 0);
              if (pattern.test(source)) {
                const snippet = source.slice(0, 200);
                preludeFunctions.push({
                  name: varName,
                  category: 'string-table',
                  confidence: 0.85,
                  snippet,
                  nodeType: 'VariableDeclarator',
                  evaluated: false,
                });
                return;
              }
            }
          }
        }
      },
    });
  } catch (e) {
    logger.warn(
      `PreludeCarver: AST parse failed, falling back to regex detection: ${e instanceof Error ? e.message : String(e)}`,
    );
    // Regex fallback
    for (const pattern of [...DECODER_PATTERNS, ...ROTATOR_PATTERNS, ...WRAPPER_PATTERNS]) {
      const match = code.match(pattern);
      if (match) {
        preludeFunctions.push({
          name: '',
          category: 'decoder',
          confidence: 0.6,
          snippet: match[0].slice(0, 200),
          nodeType: 'regex-match',
          evaluated: false,
        });
      }
    }
  }

  // Also check for JSDefender patterns
  const jsDefPatterns = detectJSDefenderPatterns(code);
  for (const p of jsDefPatterns) {
    preludeFunctions.push({
      name: p.pattern,
      category: 'integrity',
      confidence: p.confidence,
      snippet: p.pattern,
      nodeType: 'JSDefender',
      evaluated: false,
    });
  }

  return preludeFunctions;
}

// ── Evaluation ──

export async function evaluatePrelude(
  preludeFunctions: PreludeFunction[],
  code: string,
  sandbox: ExecutionSandbox,
  timeoutMs = 5000,
): Promise<PreludeFunction[]> {
  const evaluated = [...preludeFunctions];

  for (let i = 0; i < evaluated.length; i++) {
    const pf = evaluated[i];
    if (!pf) continue;

    if (pf.category === 'string-table' && pf.name) {
      try {
        // Extract the array and evaluate it in the sandbox
        const arrayMatch = code.match(
          new RegExp(`(?:var|let|const)\\s+${pf.name}\\s*=\\s*\\[([\\s\\S]*?)\\]`),
        );
        if (arrayMatch?.[1]) {
          const evalCode = `
            try {
              var __arr = [${arrayMatch[1]}];
              var __result = __arr.map(function(v) {
                if (typeof v === 'function') return '[function]';
                return String(v);
              });
              return JSON.stringify(__result);
            } catch(e) { return 'ERROR'; }
          `;
          const result = await sandbox.execute({ code: evalCode, timeoutMs });
          if (result.ok && typeof result.output === 'string' && result.output !== 'ERROR') {
            evaluated[i] = { ...pf, evaluated: true, resolvedValue: result.output };
          }
        }
      } catch {
        // Non-fatal
      }
    }

    if (pf.category === 'decoder' && pf.name) {
      try {
        // Try to resolve decoder calls by finding usage sites and evaluating
        const decoderCallPattern = new RegExp(`${pf.name}\\s*\\(\\s*(\\d+)\\s*\\)`, 'g');
        let match;
        const resolutions: string[] = [];
        while ((match = decoderCallPattern.exec(code)) !== null && resolutions.length < 100) {
          const idx = match[1];
          const evalCode = `
            try {
              ${code.slice(0, Math.min(code.indexOf(pf.name!) + 2000, code.length))}
              return String(${pf.name}(${idx}));
            } catch(e) { return 'ERROR'; }
          `;
          const result = await sandbox.execute({
            code: evalCode,
            timeoutMs: Math.min(timeoutMs, 3000),
          });
          if (result.ok && typeof result.output === 'string' && result.output !== 'ERROR') {
            resolutions.push(`${idx}:${result.output}`);
          }
        }
        if (resolutions.length > 0) {
          evaluated[i] = { ...pf, evaluated: true, resolvedValue: resolutions.join(';') };
        }
      } catch {
        // Non-fatal
      }
    }
  }

  return evaluated;
}

// ── Carving ──

export function carvePrelude(
  code: string,
  preludeFunctions: PreludeFunction[],
): PreludeCarverResult {
  const warnings: string[] = [];
  let replaced = 0;
  const preludeNames = new Set(preludeFunctions.map((pf) => pf.name).filter(Boolean));

  let current = code;
  const preludeParts: string[] = [];
  const payloadParts: string[] = [];

  // Split code into lines and classify
  const lines = current.split('\n');
  for (const line of lines) {
    const isPrelude =
      line.trim().length > 0 &&
      preludeNames.size > 0 &&
      Array.from(preludeNames).some((name) => {
        if (!name) return false;
        // Check if line defines or references this prelude function
        const lineDefRegexp = new RegExp(
          `(?:function\\s+${name}|var\\s+${name}|let\\s+${name}|const\\s+${name}|${name}\\s*=)`,
        );
        return lineDefRegexp.test(line);
      });

    if (isPrelude) {
      preludeParts.push(line);
    } else {
      payloadParts.push(line);
    }
  }

  // Replace evaluated string-table accesses
  for (const pf of preludeFunctions) {
    if (pf.evaluated && pf.resolvedValue && pf.name && pf.category === 'string-table') {
      try {
        const parsed = JSON.parse(pf.resolvedValue) as string[];
        for (let idx = 0; idx < parsed.length; idx++) {
          const accessPattern = new RegExp(`${pf.name}\\s*\\[\\s*${idx}\\s*\\]`, 'g');
          const replacement = `"${parsed[idx]?.replace(/"/g, '\\"') ?? ''}"`;
          const before = current;
          current = current.replace(accessPattern, replacement);
          if (current !== before) replaced++;
        }
      } catch {
        warnings.push(`Failed to parse resolved string table for ${pf.name}`);
      }
    }
  }

  // Replace evaluated decoder calls
  for (const pf of preludeFunctions) {
    if (pf.evaluated && pf.resolvedValue && pf.name && pf.category === 'decoder') {
      try {
        const pairs = pf.resolvedValue.split(';');
        for (const pair of pairs) {
          const [idx, val] = pair.split(':');
          if (idx && val) {
            const callPattern = new RegExp(`${pf.name}\\s*\\(\\s*${idx}\\s*\\)`, 'g');
            const replacement = `"${val.replace(/"/g, '\\"')}"`;
            const before = current;
            current = current.replace(callPattern, replacement);
            if (current !== before) replaced++;
          }
        }
      } catch {
        warnings.push(`Failed to replace decoder calls for ${pf.name}`);
      }
    }
  }

  return {
    preludeFunctions,
    code: current,
    preludeCode: preludeParts.join('\n'),
    payloadCode: payloadParts.join('\n'),
    replaced,
    warnings,
    success: replaced > 0,
  };
}

// ── Main Entry Point ──

export async function carvePreludeFromCode(
  code: string,
  sandbox: ExecutionSandbox,
  timeoutMs = 5000,
): Promise<PreludeCarverResult> {
  const startTime = Date.now();
  logger.info('PreludeCarver: detecting prelude functions...');

  const preludeFunctions = detectPrelude(code);
  logger.info(
    `PreludeCarver: detected ${preludeFunctions.length} prelude functions: ${preludeFunctions.map((pf) => `${pf.name}(${pf.category})`).join(', ')}`,
  );

  if (preludeFunctions.length === 0) {
    return {
      preludeFunctions,
      code,
      preludeCode: '',
      payloadCode: code,
      replaced: 0,
      warnings: ['No prelude functions detected'],
      success: false,
    };
  }

  // Evaluate prelude functions in sandbox
  logger.info('PreludeCarver: evaluating prelude functions in sandbox...');
  const evaluated = await evaluatePrelude(preludeFunctions, code, sandbox, timeoutMs);
  const evalCount = evaluated.filter((pf) => pf.evaluated).length;
  logger.info(`PreludeCarver: evaluated ${evalCount}/${preludeFunctions.length} prelude functions`);

  // Carve and replace
  const result = carvePrelude(code, evaluated);
  logger.info(
    `PreludeCarver: complete in ${Date.now() - startTime}ms, ${result.replaced} calls replaced`,
  );

  return result;
}
