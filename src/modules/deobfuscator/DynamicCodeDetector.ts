import * as parser from '@babel/parser';
import generate from '@babel/generator';
import traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { logger } from '@utils/logger';
import { type ExecutionSandbox } from '@modules/security/ExecutionSandbox';

export interface DynamicCodeResult {
  code: string;
  captures: { type: string; generated: string }[];
  warnings: string[];
  confidence: number;
}

export interface DynamicCodeDetection {
  type:
    | 'eval'
    | 'newFunction'
    | 'import'
    | 'setTimeout'
    | 'setInterval'
    | 'setImmediate'
    | 'Function'
    | 'vm'
    | 'wasm'
    | 'reflect'
    | 'angular'
    | 'react';
  location: string;
  code: string;
}

export function detectDynamicCodePatterns(code: string): DynamicCodeDetection[] {
  const detections: DynamicCodeDetection[] = [];

  const patterns: Array<{ type: DynamicCodeDetection['type']; regex: RegExp }> = [
    { type: 'eval', regex: /eval\s*\(\s*(.+?)\s*\)/s },
    { type: 'newFunction', regex: /new\s+Function\s*\(\s*(.+?)\s*\)/s },
    { type: 'Function', regex: /Function\s*\(\s*(.+?)\s*\)/s },
    {
      type: 'setTimeout',
      regex: /setTimeout\s*\(\s*(?:function|.+\.toString\(\))\s*,\s*\d+\s*\)/s,
    },
    {
      type: 'setInterval',
      regex: /setInterval\s*\(\s*(?:function|.+\.toString\(\))\s*,\s*\d+\s*\)/s,
    },
    { type: 'setImmediate', regex: /setImmediate\s*\(\s*(?:function|.+\.toString\(\))\s*\)/s },
    { type: 'import', regex: /import\s*\(\s*(.+?)\s*\)/s },
  ];

  for (const { type, regex } of patterns) {
    const matches = code.match(regex);
    if (matches) {
      detections.push({
        type,
        location: `offset:${matches.index}`,
        code: matches[1] ?? '',
      });
    }
  }

  return detections;
}

export async function executeDynamicCode(
  code: string,
  sandbox: ExecutionSandbox,
  timeoutMs = 3000,
): Promise<DynamicCodeResult> {
  const warnings: string[] = [];
  const captures: { type: string; generated: string }[] = [];
  let confidence = 0;

  const detections = detectDynamicCodePatterns(code);

  if (detections.length === 0) {
    return { code, captures, warnings, confidence: 0 };
  }

  logger.info(`Dynamic code patterns detected: ${detections.map((d) => d.type).join(', ')}`);

  for (const detection of detections) {
    try {
      if (
        detection.type === 'eval' ||
        detection.type === 'newFunction' ||
        detection.type === 'Function'
      ) {
        const sandboxResult = await sandbox.execute({
          code: detection.code,
          timeoutMs,
        });

        if (sandboxResult.ok && typeof sandboxResult.output === 'string') {
          captures.push({
            type: detection.type,
            generated: sandboxResult.output,
          });
          warnings.push(
            `${detection.type}: captured generated code (${sandboxResult.output.length} chars)`,
          );
        }
      }
    } catch (error) {
      warnings.push(
        `${detection.type}: failed to execute: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (captures.length > 0) {
    confidence = Math.min(0.4 + captures.length * 0.15, 0.9);
  }

  return { code, captures, warnings, confidence };
}

export function detectDynamicImports(code: string): { specifier: string }[] {
  const imports: { specifier: string }[] = [];

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });

    traverse(ast, {
      CallExpression(callPath: NodePath<t.CallExpression>) {
        const callee = callPath.node.callee;
        if (!t.isImport(callee)) return;

        const arg = callPath.node.arguments[0];
        if (!arg) return;

        if (t.isStringLiteral(arg)) {
          imports.push({ specifier: arg.value });
        } else if (t.isTemplateLiteral(arg) && arg.quasis.length === 1) {
          imports.push({ specifier: arg.quasis[0]?.value.cooked ?? '' });
        }
      },
    });
  } catch {
    // ignore parse errors
  }

  return imports;
}

export function detectIndirectEval(code: string): DynamicCodeDetection[] {
  const detections: DynamicCodeDetection[] = [];

  const indirectEvalPatterns = [
    /(?:window|globalThis|this)\s*\[\s*["']eval["']\s*\]\s*\(\s*(.+?)\s*\)/s,
    /\(\s*(?:window|globalThis|this)\s*\)\s*\(\s*(.+?)\s*\)/s,
    /(?:0)\s*\[\s*]\s*\(\s*(.+?)\s*\)/s,
  ];

  for (const regex of indirectEvalPatterns) {
    const matches = code.match(regex);
    if (matches) {
      detections.push({
        type: 'eval',
        location: `indirect:${matches.index}`,
        code: matches[matches.length - 1] ?? '',
      });
    }
  }

  return detections;
}

export function detectVMBasedCode(code: string): DynamicCodeDetection[] {
  const detections: DynamicCodeDetection[] = [];

  const vmPatterns = [
    /new\s+Function\s*\(\s*"use strict"\s*,\s*["']/,
    /runInNewContext|runInThisContext|runInContext/,
    /vm\s*\.\s*compileFunction|vm\s*\.\s*Script/,
    /new\s+vm\s*\.\s*Script/,
    /Worker\s*\(\s*["']function/,
  ];

  for (const pattern of vmPatterns) {
    if (pattern.test(code)) {
      detections.push({
        type: 'vm',
        location: 'vm-sandbox',
        code: '[vm-based code]',
      });
    }
  }

  return detections;
}

export function detectWASMInstantiate(code: string): DynamicCodeDetection[] {
  const detections: DynamicCodeDetection[] = [];

  const wasmPatterns = [
    /WebAssembly\.instantiate\s*\(/,
    /WebAssembly\.compile\s*\(/,
    /new\s+WebAssembly\s*\.\s*\w+/,
    /instantiateArrayBuffer|compileStreaming/,
    /WebAssembly\.validate\s*\(\s*(?:new\s+Uint8Array|\\x70|\\x6f)/,
  ];

  for (const pattern of wasmPatterns) {
    if (pattern.test(code)) {
      detections.push({
        type: 'wasm',
        location: 'wasm-instantiate',
        code: '[wasm-based code]',
      });
    }
  }

  return detections;
}

export function detectReflectObfuscation(code: string): DynamicCodeDetection[] {
  const detections: DynamicCodeDetection[] = [];

  const reflectPatterns = [
    /Reflect\s*\.\s*(?:get|set|has|delete|defineProperty|getOwnPropertyDescriptor)\s*\(/,
    /new\s+Function\s*\(\s*Reflect\s*\./,
    /Function\s*\(\s*Reflect\s*\.\s*construct/,
    /Reflect\.construct\s*\(\s*Function/,
  ];

  for (const pattern of reflectPatterns) {
    if (pattern.test(code)) {
      detections.push({
        type: 'reflect',
        location: 'reflect-based',
        code: '[reflect-based dynamic code]',
      });
    }
  }

  return detections;
}

export function detectAngularDynamic(code: string): DynamicCodeDetection[] {
  const detections: DynamicCodeDetection[] = [];

  const angularPatterns = [
    /\$compile\s*\(/,
    /\$parse\s*\(/,
    /\$watch\s*\(/,
    /angular\.element\s*\(\s*\w+\s*\)\s*\.html\s*\(/,
    /@Component|@Injectable|@NgModule/,
  ];

  for (const pattern of angularPatterns) {
    if (pattern.test(code)) {
      detections.push({
        type: 'angular',
        location: 'angular-dynamic',
        code: '[angular dynamic compilation]',
      });
    }
  }

  return detections;
}

export function detectReactDynamic(code: string): DynamicCodeDetection[] {
  const detections: DynamicCodeDetection[] = [];

  const reactPatterns = [
    /React\.createElement\s*\(\s*["']/,
    /createElement\s*\(\s*(?:["']|React)/,
    /jsx\s*\(|jsxDEV\s*\(/,
    /React\.render\s*\(/,
    /ReactDOM\.render\s*\(/,
    /renderToString\s*\(/,
    /renderToStaticMarkup\s*\(/,
  ];

  for (const pattern of reactPatterns) {
    if (pattern.test(code)) {
      detections.push({
        type: 'react',
        location: 'react-dynamic',
        code: '[react dynamic rendering]',
      });
    }
  }

  return detections;
}

export function detectAllDynamicPatterns(code: string): DynamicCodeDetection[] {
  const allDetections: DynamicCodeDetection[] = [
    ...detectDynamicCodePatterns(code),
    ...detectIndirectEval(code),
    ...detectCryptoBasedDynamicCode(code),
    ...detectVMBasedCode(code),
    ...detectWASMInstantiate(code),
    ...detectReflectObfuscation(code),
    ...detectAngularDynamic(code),
    ...detectReactDynamic(code),
  ];

  const seen = new Set<string>();
  return allDetections.filter((d) => {
    const key = `${d.type}:${d.location}:${d.code.slice(0, 20)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function detectCryptoBasedDynamicCode(code: string): DynamicCodeDetection[] {
  const detections: DynamicCodeDetection[] = [];

  const cryptoPatterns = [
    /crypto\.subtle\.encrypt\s*\(/,
    /crypto\.subtle\.decrypt\s*\(/,
    /crypto\.createCipher/i,
    /crypto\.createDecipher/i,
    /Node\.js\.crypto\./,
    /require\s*\(\s*['"]crypto['"]\s*\)/,
  ];

  for (const pattern of cryptoPatterns) {
    if (pattern.test(code)) {
      detections.push({
        type: 'Function',
        location: 'crypto-based',
        code: '[crypto-based dynamic code]',
      });
    }
  }

  return detections;
}

export interface InlineDynamicCodeOptions {
  stripEval?: boolean;
  stripImport?: boolean;
  stripSetTimeout?: boolean;
  replaceWith?: 'comment' | 'noop';
}

export function inlineDynamicCode(
  code: string,
  options?: InlineDynamicCodeOptions,
): { code: string; inlined: number } {
  let inlined = 0;
  const opts = {
    stripEval: true,
    stripImport: true,
    stripSetTimeout: true,
    replaceWith: 'comment' as const,
    ...options,
  };

  try {
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
    });

    traverse(ast, {
      CallExpression(callPath: NodePath<t.CallExpression>) {
        const callee = callPath.node.callee;

        if (t.isImport(callee) && opts.stripImport) {
          const arg = callPath.node.arguments[0];
          if (t.isStringLiteral(arg)) {
            if (opts.replaceWith === 'comment') {
              callPath.replaceWith(t.stringLiteral(`/* import: ${arg.value} (deferred) */`));
            } else {
              callPath.replaceWith(t.identifier('undefined'));
            }
            inlined++;
          }
          return;
        }

        if (t.isIdentifier(callee) && callee.name === 'eval' && opts.stripEval) {
          const arg = callPath.node.arguments[0];
          if (t.isStringLiteral(arg)) {
            if (opts.replaceWith === 'comment') {
              callPath.replaceWith(
                t.callExpression(t.identifier('eval'), [t.stringLiteral(`/* eval stripped */`)]),
              );
            } else {
              callPath.replaceWith(t.identifier('undefined'));
            }
            inlined++;
          }
          return;
        }

        if (
          t.isIdentifier(callee) &&
          ['setTimeout', 'setInterval', 'setImmediate'].includes(callee.name) &&
          opts.stripSetTimeout
        ) {
          const firstArg = callPath.node.arguments[0];
          if (t.isFunctionExpression(firstArg) || t.isArrowFunctionExpression(firstArg)) {
            if (t.isBlockStatement(firstArg.body)) {
              const stmts = firstArg.body.body.filter((s) => !t.isReturnStatement(s));
              if (stmts.length > 0) {
                if (opts.replaceWith === 'comment') {
                  callPath.replaceWith(t.blockStatement(stmts));
                } else {
                  callPath.replaceWith(t.identifier('undefined'));
                }
                inlined++;
              }
            }
          }
        }
      },
    });

    return {
      code: generate(ast, { comments: false, compact: false }).code,
      inlined,
    };
  } catch {
    return { code, inlined: 0 };
  }
}
