import type { UnresolvedPart, VMType } from '@internal-types/index';
import { logger } from '@utils/logger';
import { type ExecutionSandbox } from '@modules/security/ExecutionSandbox';
import { int } from '@src/constants/helpers';
import { DEOBF_JSFUCK_MAX_CODE_SIZE } from '@src/constants/transform';

/**
 * Sandbox budget (ms) for statically evaluating an obfuscator.io string
 * array — a bounded array literal, so a short timeout suffices.
 *
 * @env JSVMP_STRING_ARRAY_SANDBOX_TIMEOUT_MS
 * @default 3000
 */
const STRING_ARRAY_SANDBOX_TIMEOUT_MS = int('JSVMP_STRING_ARRAY_SANDBOX_TIMEOUT_MS', 3_000);

/**
 * Sandbox budget (ms) for executing whole-program evaluations (JSFuck /
 * JJEncode payloads), which can be arbitrarily large.
 *
 * @env JSVMP_EVAL_SANDBOX_TIMEOUT_MS
 * @default 5000
 */
const EVAL_SANDBOX_TIMEOUT_MS = int('JSVMP_EVAL_SANDBOX_TIMEOUT_MS', 5_000);

/**
 * JSFuck payloads larger than this are not evaluated locally — decoding is
 * quadratic-ish in practice and risks long sandbox runs.
 */
const JSFUCK_MAX_CODE_SIZE = DEOBF_JSFUCK_MAX_CODE_SIZE;

type RestoreResult = {
  code: string;
  confidence: number;
  warnings: string[];
  unresolvedParts?: UnresolvedPart[];
};

type RestoreContext = {
  llm?: any;
  sandbox: ExecutionSandbox;
};

export interface RestoreBudget {
  /** Sandbox evaluation timeout in ms (applies to every sandbox.execute). */
  timeoutMs?: number;
  /** Iteration cap for loop-based restore passes. */
  maxIterations?: number;
}

export async function restoreJSVMPCode(
  context: RestoreContext,
  code: string,
  vmType: VMType,
  aggressive: boolean,
  budget?: RestoreBudget,
): Promise<RestoreResult> {
  const warnings: string[] = [];
  const unresolvedParts: UnresolvedPart[] = [];

  if (vmType === 'obfuscator.io') {
    return restoreObfuscatorIO(context, code, aggressive, warnings, unresolvedParts, budget);
  }
  if (vmType === 'jsfuck') {
    return restoreJSFuck(context, code, warnings, budget);
  }
  if (vmType === 'jjencode') {
    return restoreJJEncode(context, code, warnings, budget);
  }
  return restoreCustomVM(context, code, aggressive, warnings, unresolvedParts, budget);
}

async function restoreObfuscatorIO(
  context: RestoreContext,
  code: string,
  aggressive: boolean,
  warnings: string[],
  unresolvedParts: UnresolvedPart[],
  budget?: RestoreBudget,
): Promise<RestoreResult> {
  let restored = code;
  let confidence = 0.5;

  try {
    const stringArrayMatch = code.match(/var\s+(_0x[a-f0-9]+)\s*=\s*(\[.*?\]);/s);
    if (stringArrayMatch) {
      const arrayName = stringArrayMatch[1];
      const arrayContent = stringArrayMatch[2];

      logger.info(` : ${arrayName}`);

      try {
        const sandboxResult = await context.sandbox.execute({
          code: `return ${arrayContent || '[]'};`,
          timeoutMs: budget?.timeoutMs ?? STRING_ARRAY_SANDBOX_TIMEOUT_MS,
        });
        const stringArray = sandboxResult.ok ? sandboxResult.output : undefined;

        if (!sandboxResult.ok) {
          // Surface the failure instead of silently returning a half-restored
          // result that looks as if the array had been resolved.
          const reason =
            typeof sandboxResult.error === 'string'
              ? sandboxResult.error
              : 'string-array sandbox evaluation failed';
          warnings.push(`String array unresolved: ${reason}`);
          unresolvedParts.push({
            location: 'String Array',
            reason,
            suggestion: 'The string array could not be evaluated lazily; review it manually.',
          });
        }

        if (Array.isArray(stringArray)) {
          logger.info(`String array detected, ${stringArray.length} strings found`);

          // Anchor the array name with a word boundary so `_0x12[0]` does not
          // also rewrite `_0x123[0]`.
          const refPattern = new RegExp(`${arrayName}(?!\\w)\\[(\\d+)\\]`, 'g');
          restored = restored.replace(refPattern, (_match, index) => {
            const idx = parseInt(index, 10);
            if (idx < stringArray.length) {
              return JSON.stringify(stringArray[idx]);
            }
            return _match;
          });

          confidence += 0.2;
        }
      } catch (e) {
        warnings.push(`: ${e}`);
        unresolvedParts.push({
          location: 'String Array',
          reason: '',
          suggestion: '',
        });
      }
    }

    restored = restored.replace(
      /\(function\s*\(_0x[a-f0-9]+,\s*_0x[a-f0-9]+\)\s*\{[\s\S]*?\}\(_0x[a-f0-9]+,\s*0x[a-f0-9]+\)\);?/g,
      '',
    );

    if (aggressive) {
      restored = restored.replace(/\(function\s*\(\)\s*\{([\s\S]*)\}\(\)\);?/g, '$1');
      confidence += 0.1;
    }

    restored = restored.replace(/0x([0-9a-f]+)/gi, (_match, hex) => {
      return String(parseInt(hex, 16));
    });

    restored = restored.replace(/;\s*;/g, ';');
    restored = restored.replace(/\{\s*\}/g, '{}');

    warnings.push('obfuscator.io detected, may need special handling');

    return {
      code: restored,
      confidence: Math.min(confidence, 1.0),
      warnings,
      unresolvedParts: unresolvedParts.length > 0 ? unresolvedParts : undefined,
    };
  } catch (error) {
    warnings.push(`obfuscator.io: ${error}`);
    return {
      code,
      confidence: 0.2,
      warnings,
      unresolvedParts,
    };
  }
}

async function restoreJSFuck(
  context: RestoreContext,
  code: string,
  warnings: string[],
  budget?: RestoreBudget,
): Promise<RestoreResult> {
  try {
    logger.info('JSFuck detected, attempting deobfuscation...');

    try {
      if (code.length > JSFUCK_MAX_CODE_SIZE) {
        warnings.push('JSFuck code detected, file too large to process directly.');
        warnings.push('Consider using an online JSFuck decoder tool.');
        return {
          code,
          confidence: 0.1,
          warnings,
        };
      }

      const sandboxResult = await context.sandbox.execute({
        code: `return ${code};`,
        timeoutMs: budget?.timeoutMs ?? EVAL_SANDBOX_TIMEOUT_MS,
      });
      const result = sandboxResult.ok ? sandboxResult.output : undefined;

      if (typeof result === 'string') {
        logger.info(' JSFuck');
        return {
          code: result,
          confidence: 0.9,
          warnings: ['JSFuck'],
        };
      }

      warnings.push('JSFuck');
      return {
        code,
        confidence: 0.2,
        warnings,
      };
    } catch (execError) {
      warnings.push(`JSFuck: ${execError}`);
      warnings.push('Consider using an online JSFuck decoder tool.');
      return {
        code,
        confidence: 0.1,
        warnings,
      };
    }
  } catch (error) {
    warnings.push(`JSFuck: ${error}`);
    return {
      code,
      confidence: 0.1,
      warnings,
    };
  }
}

async function restoreJJEncode(
  context: RestoreContext,
  code: string,
  warnings: string[],
  budget?: RestoreBudget,
): Promise<RestoreResult> {
  try {
    logger.info('JJEncode detected, attempting deobfuscation...');

    try {
      const lines = code.split('\n').filter((line) => line.trim());
      const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';

      if (lastLine?.includes('$$$$')) {
        const sandboxResult = await context.sandbox.execute({
          code: `${code}; return $$$$()`,
          timeoutMs: budget?.timeoutMs ?? EVAL_SANDBOX_TIMEOUT_MS,
        });
        const result = sandboxResult.ok ? sandboxResult.output : undefined;

        if (typeof result === 'string') {
          logger.info(' JJEncode');
          return {
            code: result,
            confidence: 0.9,
            warnings: ['JJEncode'],
          };
        }
      }

      const sandboxResult = await context.sandbox.execute({
        code,
        timeoutMs: budget?.timeoutMs ?? EVAL_SANDBOX_TIMEOUT_MS,
      });
      if (!sandboxResult.ok) {
        logger.warn('JJEncode sandbox execution failed:', sandboxResult.error);
      }

      warnings.push('JJEncode deobfuscation may be incomplete');
      warnings.push('Result may still contain JJEncode fragments');
      return {
        code,
        confidence: 0.2,
        warnings,
      };
    } catch (execError) {
      warnings.push(`JJEncode: ${execError}`);
      warnings.push('Result may contain evaluation artifacts');
      return {
        code,
        confidence: 0.1,
        warnings,
      };
    }
  } catch (error) {
    warnings.push(`JJEncode: ${error}`);
    return {
      code,
      confidence: 0.1,
      warnings,
    };
  }
}

async function restoreCustomVM(
  _context: RestoreContext,
  code: string,
  aggressive: boolean,
  warnings: string[],
  unresolvedParts: UnresolvedPart[],
  _budget?: RestoreBudget,
): Promise<RestoreResult> {
  warnings.push('AI-assisted deobfuscation removed, using fallback directly.');
  return restoreCustomVMBasic(code, aggressive, warnings, unresolvedParts);
}

export function restoreCustomVMBasic(
  code: string,
  aggressive: boolean,
  warnings: string[],
  unresolvedParts: UnresolvedPart[],
): RestoreResult {
  let restored = code;
  let confidence = 0.3;

  try {
    restored = restored.replace(/if\s*\([^)]*\)\s*\{\s*\}/g, '');

    restored = restored.replace(/!!\s*\(/g, 'Boolean(');

    restored = restored.replace(/""\s*\+\s*/g, '');

    if (aggressive) {
      restored = restored.replace(/debugger;?/g, '');
      confidence += 0.1;

      restored = restored.replace(/\?\s*([^:]+)\s*:\s*\1/g, '$1');
      confidence += 0.05;
    }

    warnings.push('Analysis incomplete, partial results may be returned');
    warnings.push('For better results, configure an LLM API key');

    unresolvedParts.push({
      location: 'Custom VM',
      reason: 'VM',
      suggestion: 'VM protection detected, LLM-assisted analysis recommended',
    });

    return {
      code: restored,
      confidence,
      warnings,
      unresolvedParts: unresolvedParts.length > 0 ? unresolvedParts : undefined,
    };
  } catch (error) {
    warnings.push(`: ${error}`);
    return {
      code,
      confidence: 0.1,
      warnings,
      unresolvedParts,
    };
  }
}
