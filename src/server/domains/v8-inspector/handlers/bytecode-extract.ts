import { BytecodeExtractor } from '@modules/v8-inspector';
import { argBool, argNumber, argString } from '@server/domains/shared/parse-args';

interface BytecodeRuntime {
  getPage?: () => Promise<unknown>;
}

export async function handleBytecodeExtract(
  args: Record<string, unknown>,
  runtime?: BytecodeRuntime,
): Promise<unknown> {
  const scriptId = argString(args, 'scriptId', '').trim();
  const functionOffset = argNumber(args, 'functionOffset');
  const includeSourceFallback = argBool(args, 'includeSourceFallback', false);

  if (scriptId.length === 0) {
    return {
      success: false,
      error: 'scriptId is required',
    };
  }

  const extractor = new BytecodeExtractor(runtime?.getPage);
  const nativeAttempt = await extractor.attemptNativeBytecodeExtraction(
    scriptId,
    functionOffset ?? undefined,
  );

  if (!nativeAttempt) {
    return {
      success: false,
      error: `Unable to inspect bytecode for scriptId "${scriptId}"`,
    };
  }

  const hiddenClasses = await extractor.findHiddenClasses(scriptId);
  if (nativeAttempt.available && nativeAttempt.bytecode) {
    const extraction = {
      functionName: nativeAttempt.functionName,
      bytecode: nativeAttempt.bytecode,
      sourcePosition: nativeAttempt.sourcePosition,
    };

    return {
      success: true,
      scriptId,
      functionOffset: functionOffset ?? null,
      mode: 'native',
      bytecodeAvailable: true,
      format: nativeAttempt.format,
      rawIgnitionBytecodeAvailable: nativeAttempt.rawIgnitionBytecodeAvailable,
      supportsNativesSyntax: nativeAttempt.supportsNativesSyntax,
      reason: nativeAttempt.reason,
      extraction,
      disassembly: extractor.disassembleBytecode(nativeAttempt.bytecode),
      hiddenClasses,
      sourceFallback: null,
    };
  }

  const sourceFallback = includeSourceFallback
    ? await extractor.extractBytecode(scriptId, functionOffset ?? undefined)
    : null;

  return {
    success: true,
    scriptId,
    functionOffset: functionOffset ?? null,
    mode: sourceFallback ? 'source-fallback' : 'unavailable',
    bytecodeAvailable: false,
    format: null,
    rawIgnitionBytecodeAvailable: nativeAttempt.rawIgnitionBytecodeAvailable,
    supportsNativesSyntax: nativeAttempt.supportsNativesSyntax,
    reason: nativeAttempt.reason,
    extraction: null,
    disassembly: [],
    hiddenClasses,
    sourceFallback: sourceFallback
      ? {
          format: 'pseudo-bytecode',
          extraction: sourceFallback,
          disassembly: extractor.disassembleBytecode(sourceFallback.bytecode),
        }
      : null,
  };
}
