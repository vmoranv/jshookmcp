import type { LLMService } from '../../services/LLMService.js';
import { generateVMAnalysisMessages } from '../../services/prompts/deobfuscation.js';
import type { UnresolvedPart, VMType } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { ExecutionSandbox } from '../security/ExecutionSandbox.js';

type RestoreResult = {
  code: string;
  confidence: number;
  warnings: string[];
  unresolvedParts?: UnresolvedPart[];
};

type RestoreContext = {
  llm?: LLMService;
  sandbox: ExecutionSandbox;
};

export async function restoreJSVMPCode(
  context: RestoreContext,
  code: string,
  vmType: VMType,
  aggressive: boolean
): Promise<RestoreResult> {
  const warnings: string[] = [];
  const unresolvedParts: UnresolvedPart[] = [];

  if (vmType === 'obfuscator.io') {
    return restoreObfuscatorIO(context, code, aggressive, warnings, unresolvedParts);
  }
  if (vmType === 'jsfuck') {
    return restoreJSFuck(context, code, warnings);
  }
  if (vmType === 'jjencode') {
    return restoreJJEncode(context, code, warnings);
  }
  return restoreCustomVM(context, code, aggressive, warnings, unresolvedParts);
}

async function restoreObfuscatorIO(
  context: RestoreContext,
  code: string,
  aggressive: boolean,
  warnings: string[],
  unresolvedParts: UnresolvedPart[]
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
          timeoutMs: 3000,
        });
        const stringArray = sandboxResult.ok ? sandboxResult.output : undefined;

        if (Array.isArray(stringArray)) {
          logger.info(`String array detected, ${stringArray.length} strings found`);

          const refPattern = new RegExp(`${arrayName}\\[(\\d+)\\]`, 'g');
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
      ''
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
  warnings: string[]
): Promise<RestoreResult> {
  try {
    logger.info('JSFuck detected, attempting deobfuscation...');

    try {
      if (code.length > 100000) {
        warnings.push('JSFuck code detected, file too large to process directly.');
        warnings.push('Consider using an online JSFuck decoder tool.');
        return {
          code,
          confidence: 0.1,
          warnings,
        };
      }

      const sandboxResult = await context.sandbox.execute({ code: `return ${code};`, timeoutMs: 5000 });
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
  warnings: string[]
): Promise<RestoreResult> {
  try {
    logger.info('JJEncode detected, attempting deobfuscation...');

    try {
      const lines = code.split('\n').filter((line) => line.trim());
      const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';

      if (lastLine && lastLine.includes('$$$$')) {
        const sandboxResult = await context.sandbox.execute({
          code: `${code}; return $$$$()`,
          timeoutMs: 5000,
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

      const sandboxResult = await context.sandbox.execute({ code, timeoutMs: 5000 });
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
  context: RestoreContext,
  code: string,
  aggressive: boolean,
  warnings: string[],
  unresolvedParts: UnresolvedPart[]
): Promise<RestoreResult> {
  if (!context.llm) {
    warnings.push('LLM service unavailable, using fallback');
    warnings.push('Configure DeepSeek/OpenAI API key for AI-assisted deobfuscation');

    return restoreCustomVMBasic(code, aggressive, warnings, unresolvedParts);
  }

  try {
    logger.info(' LLMVM...');

    const response = await context.llm.chat(generateVMAnalysisMessages(code));

    const analysisText = response.content;

    logger.info(' LLM');
    logger.info(`: ${analysisText.substring(0, 200)}...`);

    let vmAnalysis: Record<string, unknown> | undefined;
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed && typeof parsed === 'object') {
          vmAnalysis = parsed as Record<string, unknown>;
        }
      }
    } catch {
      warnings.push('LLM analysis failed, using fallback');
      return restoreCustomVMBasic(code, aggressive, warnings, unresolvedParts);
    }

    if (vmAnalysis) {
      warnings.push(
        `LLMVM: ${typeof vmAnalysis.vmType === 'string' ? vmAnalysis.vmType : 'Unknown'}`
      );

      const vmWarnings = vmAnalysis.warnings;
      if (Array.isArray(vmWarnings)) {
        warnings.push(...(vmWarnings as string[]));
      }

      const restorationSteps = vmAnalysis.restorationSteps;
      if (Array.isArray(restorationSteps)) {
        unresolvedParts.push({
          location: 'VM Restoration',
          reason: 'LLM',
          suggestion: (restorationSteps as unknown[]).join('\n'),
        });
      }

      return {
        code,
        confidence: 0.6,
        warnings,
        unresolvedParts: unresolvedParts.length > 0 ? unresolvedParts : undefined,
      };
    }

    return restoreCustomVMBasic(code, aggressive, warnings, unresolvedParts);
  } catch (error) {
    logger.error('LLM', error);
    warnings.push(`LLM: ${error}`);
    return restoreCustomVMBasic(code, aggressive, warnings, unresolvedParts);
  }
}

export function restoreCustomVMBasic(
  code: string,
  aggressive: boolean,
  warnings: string[],
  unresolvedParts: UnresolvedPart[]
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
