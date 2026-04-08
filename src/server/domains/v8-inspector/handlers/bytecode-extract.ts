import { BytecodeExtractor } from '@modules/v8-inspector';
import { argNumber, argString } from '@server/domains/shared/parse-args';

interface BytecodeRuntime {
  getPage?: () => Promise<unknown>;
}

export async function handleBytecodeExtract(
  args: Record<string, unknown>,
  runtime?: BytecodeRuntime,
): Promise<unknown> {
  const scriptId = argString(args, 'scriptId', '').trim();
  const functionOffset = argNumber(args, 'functionOffset');

  if (scriptId.length === 0) {
    return {
      success: false,
      error: 'scriptId is required',
    };
  }

  const extractor = new BytecodeExtractor(runtime?.getPage);
  const extraction = await extractor.extractBytecode(scriptId, functionOffset ?? undefined);

  if (!extraction) {
    return {
      success: false,
      error: `Unable to extract bytecode for scriptId "${scriptId}"`,
    };
  }

  return {
    success: true,
    scriptId,
    functionOffset: functionOffset ?? null,
    extraction,
    disassembly: extractor.disassembleBytecode(extraction.bytecode),
    hiddenClasses: await extractor.findHiddenClasses(scriptId),
  };
}
