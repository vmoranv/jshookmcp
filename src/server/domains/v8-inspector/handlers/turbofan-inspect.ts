/**
 * TurboFan Inspect Handler — v8_turbofan_inspect
 *
 * Inspects TurboFan compilation state for a specific script/function:
 *   - optimization status (interpreted/maglev/turbofan)
 *   - force optimization via %OptimizeFunctionOnNextCall
 *   - force deoptimization via %DeoptimizeFunction
 *   - TurboFan IR availability check
 *
 * Requires V8 natives syntax. Falls back to heuristic inspection.
 */

import { argString, argNumber } from '@server/domains/shared/parse-args';
import { normalizeSessionSource, resolveTargetSession } from './cdp-session';
import type { SessionSource } from './cdp-session';

// ── Types ──────────────────────────────────────────────────────────────────────

interface FunctionOptStatus {
  functionName: string;
  statusCode?: number;
  tier: 'interpreted' | 'maglev' | 'turbofan' | 'unknown';
  optimized: boolean;
}

interface TurboFanInspectResult {
  success: boolean;
  error?: string;
  scriptId: string;
  mode: 'natives' | 'heuristic';
  supportsNativesSyntax: boolean;
  functions: FunctionOptStatus[];
  action?: {
    requested: string;
    applied: boolean;
    detail?: string;
  };
}

// ── V8 Status Bit Mapping (V8 runtime.h OptimizationStatus) ───────────────────
//
// Correct bit positions per V8 source (as of V8 v13+):
//   bit 5  (32)   = kTurboFanned
//   bit 4  (16)   = kMaglevved
//   bit 6  (64)   = kInterpreted
//   bit 3  (8)    = kOptimized (any tier)
//   bit 14 (16384) = kBaseline (Sparkplug)

function mapTier(status: number): { optimized: boolean; tier: FunctionOptStatus['tier'] } {
  if ((status & 32) !== 0) return { optimized: true, tier: 'turbofan' };
  if ((status & 16) !== 0) return { optimized: true, tier: 'maglev' };
  if ((status & 8) !== 0) return { optimized: true, tier: 'turbofan' };
  if ((status & 16384) !== 0) return { optimized: false, tier: 'interpreted' };
  if ((status & 64) !== 0) return { optimized: false, tier: 'interpreted' };
  return { optimized: false, tier: 'interpreted' };
}

// ── CDP Helpers ────────────────────────────────────────────────────────────────

// resolveTargetSession imported from shared cdp-session.ts

// ── Handler ────────────────────────────────────────────────────────────────────

export async function handleTurbofanInspect(
  args: Record<string, unknown>,
  source?: SessionSource,
): Promise<TurboFanInspectResult> {
  const scriptId = argString(args, 'scriptId', '').trim();
  if (scriptId.length === 0) {
    return {
      success: false,
      error: 'scriptId is required',
      scriptId: '',
      mode: 'heuristic',
      supportsNativesSyntax: false,
      functions: [],
    };
  }

  const functionName = argString(args, 'functionName', '').trim();
  const action = argString(args, 'action', 'inspect').trim(); // inspect | optimize | deoptimize
  const topN = argNumber(args, 'topN', 10);

  const resolver = normalizeSessionSource(source);
  const { session, owned } = await resolveTargetSession(resolver);
  if (!session) {
    return {
      success: false,
      error: 'No CDP session available',
      scriptId,
      mode: 'heuristic',
      supportsNativesSyntax: false,
      functions: [],
    };
  }

  let supportsNatives = false;
  const functions: FunctionOptStatus[] = [];

  try {
    // Check natives availability
    const nativeCheck = await session.send<{ result?: { value?: unknown } }>('Runtime.evaluate', {
      expression: 'typeof %GetOptimizationStatus === "function"',
      returnByValue: true,
    });
    supportsNatives = nativeCheck?.result?.value === true;

    if (supportsNatives) {
      const selected = await collectNativeTargetFunctions(session, scriptId, functionName, topN);
      for (const fnName of selected) {
        functions.push(await inspectNativeFunction(session, fnName, action));
      }
    } else {
      await collectHeuristicFunctions(resolver, scriptId, functions);
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      scriptId,
      mode: supportsNatives ? 'natives' : 'heuristic',
      supportsNativesSyntax: supportsNatives,
      functions,
    };
  } finally {
    if (owned) await session.detach().catch(() => {});
  }

  return {
    success: true,
    scriptId,
    mode: supportsNatives ? 'natives' : 'heuristic',
    supportsNativesSyntax: supportsNatives,
    functions,
    ...(action !== 'inspect'
      ? {
          action: {
            requested: action,
            applied: supportsNatives,
            detail: supportsNatives
              ? `${action} applied to ${functions.length} functions`
              : 'natives syntax not available — action not applied',
          },
        }
      : {}),
  };
}

type TurbofanSession = NonNullable<Awaited<ReturnType<typeof resolveTargetSession>>['session']>;

/** Natives path phase 1: precise-coverage pass to pick target function names. */
async function collectNativeTargetFunctions(
  session: TurbofanSession,
  scriptId: string,
  functionName: string,
  topN: number,
): Promise<string[]> {
  await session.send('Profiler.enable');
  await session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  const covResp = await session.send<{ result?: unknown }>('Profiler.takePreciseCoverage');

  const targetFunctions: string[] = [];

  if (Array.isArray(covResp?.result)) {
    for (const entry of covResp.result as Array<Record<string, unknown>>) {
      if (entry.scriptId !== scriptId) continue;
      const funcs = Array.isArray(entry.functions) ? entry.functions : [];
      for (const fn of funcs) {
        if (typeof fn !== 'object' || !fn) continue;
        const name =
          typeof (fn as Record<string, unknown>).functionName === 'string'
            ? ((fn as Record<string, unknown>).functionName as string)
            : 'anonymous';
        if (functionName && !name.includes(functionName)) continue;
        if (!targetFunctions.includes(name)) {
          targetFunctions.push(name);
        }
      }
    }
  }

  await session.send('Profiler.stopPreciseCoverage').catch(() => {});
  await session.send('Profiler.disable').catch(() => {});

  // Limit to topN
  return targetFunctions.slice(0, topN || targetFunctions.length);
}

/** Apply the optimize/deoptimize action to a function, if requested. */
async function applyTurbofanAction(
  session: TurbofanSession,
  fnName: string,
  action: string,
): Promise<void> {
  if (action !== 'optimize' && action !== 'deoptimize') return;
  const intrinsic = action === 'optimize' ? '%OptimizeFunctionOnNextCall' : '%DeoptimizeFunction';
  await session.send('Runtime.evaluate', {
    expression: `
              (() => {
                try {
                  const f = globalThis[${JSON.stringify(fnName)}];
                  if (typeof f === 'function') ${intrinsic}(f);
                } catch(e) {}
              })()
            `,
  });
}

/** Natives path phase 2: apply the action and read %GetOptimizationStatus. */
async function inspectNativeFunction(
  session: TurbofanSession,
  fnName: string,
  action: string,
): Promise<FunctionOptStatus> {
  await applyTurbofanAction(session, fnName, action);

  // Query optimization status
  const statusResp = await session.send<{ result?: { value?: unknown } }>('Runtime.evaluate', {
    expression: `
            (() => {
              try {
                const f = globalThis[${JSON.stringify(fnName)}];
                if (typeof f !== 'function') return null;
                return %GetOptimizationStatus(f);
              } catch(e) { return null; }
            })()
          `,
    returnByValue: true,
  });
  const statusCode =
    typeof statusResp?.result?.value === 'number' ? statusResp.result.value : undefined;

  const { optimized, tier } =
    statusCode !== undefined ? mapTier(statusCode) : { optimized: false, tier: 'unknown' as const };

  return {
    functionName: fnName,
    statusCode,
    tier,
    optimized,
  };
}

/** Heuristic mode — use JITInspector for basic info. */
async function collectHeuristicFunctions(
  resolver: ReturnType<typeof normalizeSessionSource>,
  scriptId: string,
  functions: FunctionOptStatus[],
): Promise<void> {
  const { JITInspector } = await import('@modules/v8-inspector');
  const inspector = new JITInspector(resolver.getPage);
  const inspection = await inspector.inspectJIT(scriptId);

  for (const info of inspection.functions) {
    functions.push({
      functionName: info.functionName,
      tier: info.tier as FunctionOptStatus['tier'],
      optimized: info.optimized,
    });
  }
}
