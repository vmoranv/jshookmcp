/**
 * External tool registry.
 * Maintains a whitelist of allowed external tools with their specifications.
 * Only registered tools can be invoked through ExternalToolRunner.
 */

import { EXTERNAL_TOOL_PROBE_CACHE_TTL_MS } from '@src/constants';

import type { ExternalToolName, ExternalToolSpec } from '@modules/external/types';
import { probeCommand, type ProbeResult } from '@modules/external/ToolProbe';
import { logger } from '@utils/logger';

const DEFAULT_SPECS = [
  // wabt toolchain
  {
    name: 'wabt.wasm2wat',
    command: 'wasm2wat',
    versionArgs: ['--version'],
    required: false,
    envAllowlist: [],
  },
  {
    name: 'wabt.wasm-objdump',
    command: 'wasm-objdump',
    versionArgs: ['--version'],
    required: false,
    envAllowlist: [],
  },
  {
    name: 'wabt.wasm-decompile',
    command: 'wasm-decompile',
    versionArgs: ['--version'],
    required: false,
    envAllowlist: [],
  },
  {
    name: 'wabt.wasm2c',
    command: 'wasm2c',
    versionArgs: ['--version'],
    required: false,
    envAllowlist: [],
  },
  {
    name: 'wabt.wat2wasm',
    command: 'wat2wasm',
    versionArgs: ['--version'],
    required: false,
    envAllowlist: [],
  },

  // binaryen
  {
    name: 'binaryen.wasm-opt',
    command: 'wasm-opt',
    versionArgs: ['--version'],
    required: false,
    envAllowlist: [],
  },

  // WASM runtimes
  {
    name: 'runtime.wasmtime',
    command: 'wasmtime',
    versionArgs: ['--version'],
    required: false,
    envAllowlist: [],
  },
  {
    name: 'runtime.wasmer',
    command: 'wasmer',
    versionArgs: ['--version'],
    required: false,
    envAllowlist: [],
  },

  // Mini-program package unpacker
  {
    name: 'miniapp.unpacker',
    command: 'unveilr',
    versionArgs: ['--version'],
    required: false,
    envAllowlist: [],
  },

  // Java decompiler (APK/DEX/AAR)
  {
    name: 'platform.jadx',
    command: 'jadx',
    versionArgs: ['--version'],
    required: false,
    envAllowlist: [],
  },

  // JS analysis tools
  {
    name: 'analysis.ast-grep',
    command: 'ast-grep',
    versionArgs: ['--version'],
    required: false,
    envAllowlist: [],
  },
  {
    name: 'analysis.wakaru',
    command: 'wakaru',
    versionArgs: ['--version'],
    required: false,
    envAllowlist: [],
  },
  {
    name: 'analysis.restringer',
    command: 'restringer',
    versionArgs: ['--version'],
    required: false,
    envAllowlist: [],
  },

  // SMT solver
  {
    name: 'analysis.z3',
    command: 'z3',
    versionArgs: ['--version'],
    required: false,
    envAllowlist: [],
  },

  // Linux syscall tracing
  {
    name: 'syscall.strace',
    command: 'strace',
    versionArgs: ['--version'],
    required: false,
    envAllowlist: [],
  },
  {
    name: 'syscall.bpftrace',
    command: 'bpftrace',
    versionArgs: ['--version'],
    required: false,
    envAllowlist: [],
  },
] satisfies ExternalToolSpec[];

/**
 * Probe results are process-wide, not per-registry. Several domains each
 * construct their own `new ToolRegistry()` (platform, wasm, environmentDoctor);
 * with a per-instance cache every new handler re-ran the full N-subprocess
 * `probeAll()` batch (~120-240ms cold). Sharing the cache across instances means
 * the second domain reuses the first domain's probes within the TTL.
 *
 * `force=true` (used by environmentDoctor) still refreshes globally. The TTL
 * matches EXTERNAL_TOOL_PROBE_CACHE_TTL_MS so behaviour is otherwise identical.
 */
const sharedProbeCache = new Map<ExternalToolName, ProbeResult>();
let sharedProbeCacheExpiry = 0;
let sharedProbeInFlight: Promise<void> | null = null;

/** Test hook: clear the process-wide probe cache. */
export function resetSharedProbeCacheForTesting(): void {
  sharedProbeCache.clear();
  sharedProbeCacheExpiry = 0;
  sharedProbeInFlight = null;
}

export class ToolRegistry {
  private specs = new Map<ExternalToolName, ExternalToolSpec>();
  private readonly PROBE_CACHE_TTL = EXTERNAL_TOOL_PROBE_CACHE_TTL_MS;

  constructor(additionalSpecs?: ExternalToolSpec[]) {
    for (const spec of DEFAULT_SPECS) {
      this.specs.set(spec.name, spec);
    }
    if (additionalSpecs) {
      for (const spec of additionalSpecs) {
        this.specs.set(spec.name, spec);
      }
    }
  }

  /**
   * Get the spec for a tool. Throws if not registered.
   */
  getSpec(name: ExternalToolName): ExternalToolSpec {
    const spec = this.specs.get(name);
    if (!spec) {
      throw new Error(`Tool '${name}' is not registered in the allowlist`);
    }
    return spec;
  }

  /**
   * Check if a tool name is registered.
   */
  isRegistered(name: string): name is ExternalToolName {
    return this.specs.has(name as ExternalToolName);
  }

  /**
   * Get all registered tool names.
   */
  getRegisteredTools(): ExternalToolName[] {
    return Array.from(this.specs.keys());
  }

  /**
   * Probe all registered tools for availability. Results are cached PROCESS-WIDE
   * (shared across every ToolRegistry instance) for the TTL window, so a second
   * domain that constructs its own registry does not re-run the whole N-subprocess
   * batch. A concurrent call joins the in-flight batch instead of spawning a
   * duplicate one. `force=true` bypasses the cache and refreshes it globally.
   */
  async probeAll(force = false): Promise<Record<ExternalToolName, ProbeResult>> {
    const now = Date.now();
    const names = Array.from(this.specs.keys());

    const fromSharedCache = (): Record<ExternalToolName, ProbeResult> | null => {
      if (sharedProbeCacheExpiry === 0 || now >= sharedProbeCacheExpiry) return null;
      // This instance may carry additionalSpecs not in the shared cache; only a
      // full hit is a valid reuse, otherwise probe to fill the gaps.
      if (!names.every((n) => sharedProbeCache.has(n))) return null;
      const out: Record<string, ProbeResult> = {};
      for (const n of names) out[n] = sharedProbeCache.get(n)!;
      return out as Record<ExternalToolName, ProbeResult>;
    };

    if (!force) {
      const cached = fromSharedCache();
      if (cached) return cached;
      // Another registry may already be probing the same default set; join it.
      if (sharedProbeInFlight) {
        await sharedProbeInFlight;
        const afterWait = fromSharedCache();
        if (afterWait) return afterWait;
      }
    }

    const results: Record<string, ProbeResult> = {};
    const run = async (): Promise<void> => {
      const promises: Promise<void>[] = [];
      for (const [name, spec] of this.specs) {
        promises.push(
          probeCommand(spec.command, spec.versionArgs)
            .then((result) => {
              results[name] = result;
            })
            .catch((error: unknown) => {
              // A single probe must never fail the whole batch (that would also
              // prevent the cache from ever becoming valid, forcing a full
              // re-probe on every call). Degrade to unavailable, surface reason.
              const reason = error instanceof Error ? error.message : String(error);
              results[name] = { available: false, reason: `Probe threw: ${reason}` };
            }),
        );
      }
      await Promise.all(promises);
      // Commit to the shared cache atomically, then set the expiry. Refresh the
      // expiry even when some probes failed, so partial results are reused.
      for (const [n, r] of Object.entries(results)) {
        sharedProbeCache.set(n as ExternalToolName, r);
      }
      sharedProbeCacheExpiry = now + this.PROBE_CACHE_TTL;
    };

    // Publish the in-flight promise before awaiting so a concurrent caller on a
    // different instance can join this exact batch.
    sharedProbeInFlight = run().finally(() => {
      sharedProbeInFlight = null;
    });
    await sharedProbeInFlight;

    const available = Object.values(results).filter((r) => r.available).length;
    logger.info(`[ToolRegistry] Probed ${this.specs.size} tools: ${available} available`);

    return results as Record<ExternalToolName, ProbeResult>;
  }

  /** Get the (process-wide) cached probe result for a specific tool. */
  getCachedProbe(name: ExternalToolName): ProbeResult | undefined {
    return sharedProbeCache.get(name);
  }

  /** Register a new tool spec at runtime. */
  register(spec: ExternalToolSpec): void {
    this.specs.set(spec.name, spec);
    sharedProbeCache.delete(spec.name); // Invalidate cache for this tool
    logger.debug(`[ToolRegistry] Registered tool: ${spec.name} -> ${spec.command}`);
  }
}
