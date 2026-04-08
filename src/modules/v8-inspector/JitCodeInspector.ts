export interface LegacyJitInspectionResultUnavailable {
  available: false;
  reason: string;
  action: string;
}

export interface LegacyJitInspectionResultAvailable {
  available: true;
  functionName: string;
  assembly: string;
  machineCodeSize: number;
  optimizationLevel: string;
  bailouts: string[];
}

export type LegacyJitInspectionResult =
  | LegacyJitInspectionResultAvailable
  | LegacyJitInspectionResultUnavailable;

function readAssembly(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (
    value &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>)['value'] === 'string'
  ) {
    return (value as Record<string, unknown>)['value'] as string;
  }

  return undefined;
}

function detectOptimizationLevel(assembly: string): string {
  const lower = assembly.toLowerCase();
  if (lower.includes('turbofan')) {
    return 'TurboFan (optimized)';
  }
  if (lower.includes('ignition')) {
    return 'Ignition (interpreted)';
  }
  if (lower.includes('maglev')) {
    return 'Maglev (optimized)';
  }
  return 'Unknown';
}

function detectBailouts(assembly: string): string[] {
  return assembly
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /deopt|bailout/i.test(line));
}

export async function inspectJitFunction(
  evaluateFn: (expression: string) => Promise<unknown>,
  functionName: string,
): Promise<LegacyJitInspectionResult> {
  try {
    const nativesType = await evaluateFn('typeof %DisassembleFunction');
    if (nativesType !== 'function') {
      return {
        available: false,
        reason: 'V8 disassembler is unavailable in the current target.',
        action: 'Enable V8 natives syntax or attach to a debuggable runtime.',
      };
    }
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : 'Failed to probe disassembler support.',
      action: 'Verify the target runtime allows %DisassembleFunction.',
    };
  }

  try {
    const result = await evaluateFn(`%DisassembleFunction(${functionName})`);
    const assembly = readAssembly(result);
    if (!assembly || assembly === 'undefined') {
      return {
        available: false,
        reason: `Function "${functionName}" was not found.`,
        action: 'Verify the function name is defined in the target runtime.',
      };
    }

    return {
      available: true,
      functionName,
      assembly,
      machineCodeSize: assembly.length,
      optimizationLevel: detectOptimizationLevel(assembly),
      bailouts: detectBailouts(assembly),
    };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : 'Failed to inspect JIT state.',
      action: 'Retry after reconnecting to the target runtime.',
    };
  }
}
