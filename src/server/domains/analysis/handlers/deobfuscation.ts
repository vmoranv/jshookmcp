/**
 * Deobfuscation handlers: deobfuscate, webcrack_unpack, analysis_decode_string_array
 */

import { logger } from '@utils/logger';
import { cpuLimit } from '@utils/concurrency';
import { MAX_ANALYSIS_CODE_BYTES } from '@src/constants';
import { argBool, argEnum, argNumber, argString } from '@server/domains/shared/parse-args';
import { asJsonResponse } from '@server/domains/shared/response';
import type { AdvancedDeobfuscator } from '@modules/deobfuscator/AdvancedDeobfuscator';
import type { Deobfuscator } from '@modules/deobfuscator/Deobfuscator';
import type { ToolArgs, ToolResponse } from '@server/types';
import type { DeobfuscateMappingRule } from '@internal-types/deobfuscator';
import { derotateStringArray } from '@modules/deobfuscator/AdvancedDeobfuscator.ast';
import { runWebcrack } from '@modules/deobfuscator/webcrack';
import type { WebcrackPool } from '@modules/deobfuscator/webcrack-worker';
import type { JscramblerPool } from '@modules/deobfuscator/jscrambler-worker';
import {
  DECODE_STRING_ARRAY_JOB_TIMEOUT_MS,
  type DecodeStringArrayPool,
} from '@modules/deobfuscator/decode-string-array-worker';
import { resolveBabelUrls } from '@modules/deobfuscator/babel-urls';
import { JScramberDeobfuscator } from '@modules/deobfuscator/JScramblerDeobfuscator';
import { UniversalUnpacker } from '@modules/deobfuscator/PackerDeobfuscator';
import { VMDeobfuscator } from '@modules/deobfuscator/VMDeobfuscator';
import { parseCode, traverseAst, generateCode, t } from '../shared/ast-utils';
import type { NodePath } from '@babel/traverse';

type CodeArgResult = { ok: true; code: string } | { ok: false; error: string };

function exceedsLimitError(): string {
  return `code exceeds MAX_ANALYSIS_CODE_BYTES (${MAX_ANALYSIS_CODE_BYTES} bytes)`;
}

function requireCodeArg(args: ToolArgs, toolName: string): CodeArgResult {
  const code = args.code;
  if (typeof code !== 'string' || code.trim().length === 0) {
    logger.warn(`${toolName} called without valid code argument`);
    return { ok: false, error: 'code is required and must be a non-empty string' };
  }
  if (Buffer.byteLength(code, 'utf8') > MAX_ANALYSIS_CODE_BYTES) {
    logger.warn(`${toolName} code exceeds MAX_ANALYSIS_CODE_BYTES`);
    return { ok: false, error: exceedsLimitError() };
  }
  return { ok: true, code };
}

function extractWebcrackArgs(args: ToolArgs) {
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

export async function handleDeobfuscate(
  args: ToolArgs,
  deobfuscator: Deobfuscator,
  advancedDeobfuscator: AdvancedDeobfuscator,
  jscramblerDeobfuscator: JScramberDeobfuscator,
  packerDeobfuscator: UniversalUnpacker,
  vmDeobfuscator: VMDeobfuscator,
  webcrackPool?: WebcrackPool,
  jscramblerPool?: JscramblerPool,
): Promise<ToolResponse> {
  const codeArg = requireCodeArg(args, 'deobfuscate');
  if (!codeArg.ok) {
    return asJsonResponse({ success: false, error: codeArg.error });
  }
  const code = codeArg.code;

  const engine = argEnum(
    args,
    'engine',
    new Set(['auto', 'webcrack', 'jscrambler', 'packer', 'vm'] as const),
    'auto',
  );

  // All engines are CPU-heavy (webcrack/Babel/AST): run behind the global gate.
  return cpuLimit(async (): Promise<ToolResponse> => {
    // jscrambler engine
    if (engine === 'jscrambler') {
      const result = await jscramblerDeobfuscator.deobfuscate({ code }, jscramblerPool);
      return asJsonResponse(result);
    }

    // packer engine (UniversalUnpacker auto-detects Dean Edwards/AAEncode/URLEncode)
    if (engine === 'packer') {
      const result = await packerDeobfuscator.deobfuscate(code);
      return asJsonResponse(result);
    }

    // vm engine
    if (engine === 'vm') {
      const detection = vmDeobfuscator.detectVMProtection(code);
      if (!detection.detected) {
        return asJsonResponse({
          success: false,
          error: 'No VM protection detected in the provided code',
          detection,
        });
      }
      const result = await vmDeobfuscator.deobfuscateVM(code, {
        type: detection.type,
        instructionCount: detection.instructionCount,
      });
      return asJsonResponse({ ...result, detection });
    }

    // webcrack engine = former advanced_deobfuscate path
    if (engine === 'webcrack') {
      const result = await advancedDeobfuscator.deobfuscate(
        {
          code,
          ...extractWebcrackArgs(args),
          ...(typeof args.detectOnly === 'boolean' ? { detectOnly: args.detectOnly } : {}),
        },
        webcrackPool,
      );
      return asJsonResponse(result);
    }

    // auto engine = former deobfuscate path
    const result = await deobfuscator.deobfuscate(
      {
        code,
        ...extractWebcrackArgs(args),
      },
      webcrackPool,
    );

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
  });
}

export async function handleWebcrackUnpack(
  args: ToolArgs,
  pool?: WebcrackPool,
): Promise<ToolResponse> {
  const codeArg = requireCodeArg(args, 'webcrack_unpack');
  if (!codeArg.ok) {
    return asJsonResponse({ success: false, error: codeArg.error });
  }
  const code = codeArg.code;

  return cpuLimit(async (): Promise<ToolResponse> => {
    const result = await runWebcrack(
      code,
      {
        unpack: argBool(args, 'unpack', true),
        unminify: argBool(args, 'unminify', true),
        jsx: argBool(args, 'jsx', true),
        mangle: argBool(args, 'mangle', false),
        ...extractWebcrackArgs(args),
      },
      pool,
    );

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
  });
}

export async function handleAnalysisDecodeStringArray(
  args: ToolArgs,
  decodePool?: DecodeStringArrayPool,
): Promise<ToolResponse> {
  const code = argString(args, 'code');
  if (!code) {
    return asJsonResponse({ success: false, error: 'code is required' });
  }
  if (Buffer.byteLength(code, 'utf8') > MAX_ANALYSIS_CODE_BYTES) {
    return asJsonResponse({ success: false, error: exceedsLimitError() });
  }

  const maxReplacements = argNumber(args, 'maxReplacements', 200);
  const removeRotation = argBool(args, 'removeRotation', true);

  return cpuLimit(async (): Promise<ToolResponse> => {
    // Worker path: run derotate + parse/traverse/generate off the event loop.
    if (decodePool) {
      const result = await decodePool.submit(
        { code, babelUrls: resolveBabelUrls(), maxReplacements, removeRotation },
        DECODE_STRING_ARRAY_JOB_TIMEOUT_MS,
      );
      return asJsonResponse(result);
    }

    const preparedCode = removeRotation ? derotateStringArray(code) : code;

    const stringArrays = new Map<string, string[]>();
    let ast: ReturnType<typeof parseCode>;
    try {
      ast = parseCode(preparedCode);
    } catch (err) {
      return asJsonResponse({
        success: false,
        error: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    traverseAst(ast, {
      VariableDeclarator(path: NodePath) {
        if (!path.isVariableDeclarator()) return;
        const node = path.node;
        if (!t.isIdentifier(node.id) || !t.isArrayExpression(node.init)) return;
        const items: string[] = [];
        for (const element of node.init.elements) {
          if (!t.isStringLiteral(element)) return;
          items.push(element.value);
        }
        stringArrays.set(node.id.name, items);
      },
    });

    const replacements: Array<{
      arrayName: string;
      index: number;
      value: string;
      original: string;
    }> = [];
    let replacedCount = 0;

    traverseAst(ast, {
      CallExpression(path: NodePath) {
        if (replacedCount >= maxReplacements) {
          path.stop();
          return;
        }
        if (!path.isCallExpression()) return;
        const node = path.node;
        if (!t.isIdentifier(node.callee)) return;
        const arrayName = node.callee.name;
        const items = stringArrays.get(arrayName);
        if (!items || node.arguments.length !== 1) return;
        const firstArg = node.arguments[0];
        if (!t.isNumericLiteral(firstArg) && !t.isStringLiteral(firstArg)) {
          return;
        }

        const index = t.isNumericLiteral(firstArg)
          ? firstArg.value
          : firstArg.value.startsWith('0x')
            ? Number.parseInt(firstArg.value, 16)
            : Number(firstArg.value);
        if (!Number.isInteger(index) || index < 0 || index >= items.length) return;

        const value = items[index];
        if (typeof value !== 'string') return;

        // Extract original code from source using node positions. Positions are
        // relative to `preparedCode` (post-derotation), not the raw input —
        // slicing `code` here would misalign whenever rotation was removed.
        const originalCode = preparedCode.slice(node.start ?? 0, node.end ?? 0);

        replacements.push({
          arrayName,
          index,
          value,
          original: originalCode,
        });
        path.replaceWith(t.stringLiteral(value));
        replacedCount += 1;
      },
    });

    return asJsonResponse({
      success: true,
      code: generateCode(ast, { retainLines: true }),
      replacedCount,
      arraysFound: stringArrays.size,
      rotationRemoved: removeRotation && preparedCode !== code,
      replacements,
    });
  });
}
