/**
 * External tool registry.
 * Maintains a whitelist of allowed external tools with their specifications.
 * Only registered tools can be invoked through ExternalToolRunner.
 */

import type { ExternalToolName, ExternalToolSpec } from './types.js';
import { probeCommand, type ProbeResult } from './ToolProbe.js';
import { logger } from '../../utils/logger.js';

const DEFAULT_SPECS: ExternalToolSpec[] = [
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
];

export class ToolRegistry {
  private specs = new Map<ExternalToolName, ExternalToolSpec>();
  private probeCache = new Map<ExternalToolName, ProbeResult>();
  private probeCacheExpiry = 0;
  private readonly PROBE_CACHE_TTL = 60_000; // 1 minute

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
   * Probe all registered tools for availability. Results are cached.
   */
  async probeAll(force = false): Promise<Record<ExternalToolName, ProbeResult>> {
    const now = Date.now();
    if (!force && this.probeCache.size > 0 && now < this.probeCacheExpiry) {
      return Object.fromEntries(this.probeCache) as Record<ExternalToolName, ProbeResult>;
    }

    const results: Record<string, ProbeResult> = {};
    const promises: Promise<void>[] = [];

    for (const [name, spec] of this.specs) {
      promises.push(
        probeCommand(spec.command, spec.versionArgs).then((result) => {
          results[name] = result;
          this.probeCache.set(name, result);
        })
      );
    }

    await Promise.all(promises);
    this.probeCacheExpiry = now + this.PROBE_CACHE_TTL;

    const available = Object.values(results).filter((r) => r.available).length;
    logger.info(`[ToolRegistry] Probed ${this.specs.size} tools: ${available} available`);

    return results as Record<ExternalToolName, ProbeResult>;
  }

  /**
   * Get cached probe result for a specific tool.
   */
  getCachedProbe(name: ExternalToolName): ProbeResult | undefined {
    return this.probeCache.get(name);
  }

  /**
   * Register a new tool spec at runtime.
   */
  register(spec: ExternalToolSpec): void {
    this.specs.set(spec.name, spec);
    this.probeCache.delete(spec.name); // Invalidate cache for this tool
    logger.debug(`[ToolRegistry] Registered tool: ${spec.name} -> ${spec.command}`);
  }
}
