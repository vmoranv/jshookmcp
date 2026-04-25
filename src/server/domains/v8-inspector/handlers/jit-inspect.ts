import { JITInspector } from '@modules/v8-inspector';
import { argString } from '@server/domains/shared/parse-args';

interface JITRuntime {
  getPage?: () => Promise<unknown>;
}

export async function handleJitInspect(
  args: Record<string, unknown>,
  runtime?: JITRuntime,
): Promise<unknown> {
  const scriptId = argString(args, 'scriptId', '').trim();
  if (scriptId.length === 0) {
    return {
      success: false,
      error: 'scriptId is required',
    };
  }

  const inspector = new JITInspector(runtime?.getPage);
  const inspection = await inspector.inspectJIT(scriptId);

  return {
    success: true,
    scriptId,
    inspectionMode: inspection.inspectionMode,
    supportsNativesSyntax: inspection.supportsNativesSyntax,
    functions: inspection.functions,
  };
}
