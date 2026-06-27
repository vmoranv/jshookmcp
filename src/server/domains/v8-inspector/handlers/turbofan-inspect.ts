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

// ── CDP Helpers ────────────────────────────────────────────────────────────────

interface CDPSessionLike {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  detach(): Promise<void>;
}

async function createCDPSession(getPage?: () => Promise<unknown>): Promise<CDPSessionLike | null> {
  if (!getPage) return null;
  try {
    const page = await getPage();
    if (
      page &&
      typeof page === 'object' &&
      'createCDPSession' in page &&
      typeof (page as Record<string, unknown>).createCDPSession === 'function'
    ) {
      const factory = (page as Record<string, unknown>).createCDPSession as () => Promise<unknown>;
      return (await factory()) as CDPSessionLike;
    }
    return null;
  } catch {
    return null;
  }
}

function mapTier(status: number): { optimized: boolean; tier: FunctionOptStatus['tier'] } {
  if ((status & 128) !== 0) return { optimized: true, tier: 'maglev' };
  if ((status & 64) !== 0) return { optimized: true, tier: 'turbofan' };
  if ((status & 16) !== 0 || (status & 32) !== 0) return { optimized: true, tier: 'turbofan' };
  return { optimized: false, tier: 'interpreted' };
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function handleTurbofanInspect(
  args: Record<string, unknown>,
  getPage?: () => Promise<unknown>,
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

  const session = await createCDPSession(getPage);
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
      // Get function names from script coverage
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
      const selected = targetFunctions.slice(0, topN || targetFunctions.length);

      // Inspect each function
      for (const fnName of selected) {
        // Apply action if requested
        if (action === 'optimize') {
          await session.send('Runtime.evaluate', {
            expression: `
              (() => {
                try {
                  const f = globalThis[${JSON.stringify(fnName)}];
                  if (typeof f === 'function') %OptimizeFunctionOnNextCall(f);
                } catch(e) {}
              })()
            `,
          });
        } else if (action === 'deoptimize') {
          await session.send('Runtime.evaluate', {
            expression: `
              (() => {
                try {
                  const f = globalThis[${JSON.stringify(fnName)}];
                  if (typeof f === 'function') %DeoptimizeFunction(f);
                } catch(e) {}
              })()
            `,
          });
        }

        // Query optimization status
        const statusResp = await session.send<{ result?: { value?: unknown } }>(
          'Runtime.evaluate',
          {
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
          },
        );
        const statusCode =
          typeof statusResp?.result?.value === 'number' ? statusResp.result.value : undefined;

        const { optimized, tier } =
          statusCode !== undefined
            ? mapTier(statusCode)
            : { optimized: false, tier: 'unknown' as const };

        functions.push({
          functionName: fnName,
          statusCode,
          tier,
          optimized,
        });
      }
    } else {
      // Heuristic mode — use JITInspector for basic info
      const { JITInspector } = await import('@modules/v8-inspector');
      const inspector = new JITInspector(getPage);
      const inspection = await inspector.inspectJIT(scriptId);

      for (const info of inspection.functions) {
        functions.push({
          functionName: info.functionName,
          tier: info.tier as FunctionOptStatus['tier'],
          optimized: info.optimized,
        });
      }
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
    await session.detach().catch(() => {});
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
