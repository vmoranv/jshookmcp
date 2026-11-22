import { BytecodeExtractor } from '@modules/v8-inspector';
import type { DebuggerManager } from '@modules/debugger/DebuggerManager';
import { argString, argNumber, argBool } from '@server/domains/shared/parse-args';

/**
 * Debugger disassembly-at-pause handler.
 *
 * Bridges the paused debugger state to the V8 bytecode extractor (shared
 * `@modules/v8-inspector` module — same proven path as `v8_bytecode_extract`).
 * The debugger-specific value: the target scriptId is resolved automatically
 * from the current paused call frame, so the user does not have to plumb a
 * scriptId manually after hitting a breakpoint in obfuscated/VM code.
 */
interface DisassembleHandlersDeps {
  debuggerManager: DebuggerManager;
  getPage?: () => Promise<unknown>;
}

interface ResolvedLocation {
  scriptId: string;
  lineNumber: number;
  columnNumber?: number;
}

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export class DisassembleHandlers {
  private deps: DisassembleHandlersDeps;
  constructor(deps: DisassembleHandlersDeps) {
    this.deps = deps;
  }

  async handleDebuggerDisassemble(args: Record<string, unknown>) {
    const explicitScriptId = argString(args, 'scriptId');
    const callFrameId = argString(args, 'callFrameId');
    const functionOffset = argNumber(args, 'functionOffset');
    const includeSourceFallback = argBool(args, 'includeSourceFallback', false);

    // Resolve target scriptId: explicit arg → named paused frame → current paused top frame.
    let scriptId = explicitScriptId;
    let resolvedFrom: 'explicit' | 'paused' | null = explicitScriptId ? 'explicit' : null;
    let location: ResolvedLocation | undefined;

    if (!scriptId) {
      const paused = this.deps.debuggerManager.getPausedState();
      const frames = paused?.callFrames;
      if (frames && frames.length > 0) {
        const frame = callFrameId ? frames.find((f) => f.callFrameId === callFrameId) : frames[0];
        if (!frame) {
          return textResult({
            success: false,
            error: `No paused call frame with callFrameId "${callFrameId}"`,
          });
        }
        const loc = frame.location;
        location = {
          scriptId: loc.scriptId,
          lineNumber: loc.lineNumber,
          columnNumber: loc.columnNumber,
        };
        scriptId = loc.scriptId;
        if (scriptId) resolvedFrom = 'paused';
      }
    }

    if (!scriptId) {
      return textResult({
        success: false,
        error:
          'No scriptId resolved. Pass scriptId explicitly, or pause at a breakpoint first ' +
          '(debugger_disassemble defaults to the current paused frame).',
        resolvedFrom,
      });
    }

    if (!this.deps.getPage) {
      return textResult({
        success: false,
        error: 'Page context unavailable — browser must be launched with a page controller.',
        scriptId,
        resolvedFrom,
        location,
      });
    }

    const extractor = new BytecodeExtractor(this.deps.getPage);
    const native = await extractor.attemptNativeBytecodeExtraction(
      scriptId,
      functionOffset ?? undefined,
    );

    if (!native) {
      return textResult({
        success: false,
        error: `Unable to inspect bytecode for scriptId "${scriptId}"`,
        scriptId,
        resolvedFrom,
        location,
      });
    }

    const hiddenClasses = await extractor.findHiddenClasses(scriptId);

    if (native.available && native.bytecode) {
      return textResult({
        success: true,
        scriptId,
        resolvedFrom,
        location,
        functionOffset: functionOffset ?? null,
        mode: 'native',
        bytecodeAvailable: true,
        format: native.format,
        rawIgnitionBytecodeAvailable: native.rawIgnitionBytecodeAvailable,
        supportsNativesSyntax: native.supportsNativesSyntax,
        reason: native.reason,
        extraction: {
          functionName: native.functionName,
          bytecode: native.bytecode,
          sourcePosition: native.sourcePosition,
        },
        disassembly: extractor.disassembleBytecode(native.bytecode),
        hiddenClasses,
        sourceFallback: null,
      });
    }

    const sourceFallback = includeSourceFallback
      ? await extractor.extractBytecode(scriptId, functionOffset ?? undefined)
      : null;

    return textResult({
      success: true,
      scriptId,
      resolvedFrom,
      location,
      functionOffset: functionOffset ?? null,
      mode: sourceFallback ? 'source-fallback' : 'unavailable',
      bytecodeAvailable: false,
      format: null,
      rawIgnitionBytecodeAvailable: native.rawIgnitionBytecodeAvailable,
      supportsNativesSyntax: native.supportsNativesSyntax,
      reason: native.reason,
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
    });
  }
}
