import { capabilityReport, type CapabilityEntryOptions } from '@server/domains/shared/capabilities';
import { R, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import type { WasmSharedState } from './shared';

type WasmPageProbe = {
  url: string;
  hookEventCount: number;
  instantiatedCount: number;
  importCallCount: number;
  memoryEventCount: number;
  storageCount: number;
  instanceCount: number;
};

function toolCapability(
  capability: string,
  toolName: 'wabt.wasm2wat' | 'wabt.wasm-decompile' | 'wabt.wasm-objdump' | 'binaryen.wasm-opt',
  available: boolean,
  reason: string | undefined,
  fix: string,
  tools: string[],
  probe?: { path?: string; version?: string },
): CapabilityEntryOptions {
  return {
    capability,
    status: available ? 'available' : 'unavailable',
    reason,
    fix: available ? undefined : fix,
    details: {
      tools,
      ...(probe?.path ? { path: probe.path } : {}),
      ...(probe?.version ? { version: probe.version } : {}),
      backend: toolName,
    },
  };
}

export class CapabilityHandlers {
  constructor(private readonly state: WasmSharedState) {}

  async handleWasmCapabilities(): Promise<ToolResponse> {
    const probes = await this.state.runner.probeAll();
    const currentPageCapability = await this.getCurrentPageCapability();
    const hasOfflineRuntime =
      probes['runtime.wasmtime']?.available === true ||
      probes['runtime.wasmer']?.available === true;

    return R.raw(
      capabilityReport('wasm_capabilities', [
        currentPageCapability,
        toolCapability(
          'wabt_wasm2wat',
          'wabt.wasm2wat',
          probes['wabt.wasm2wat']?.available === true,
          probes['wabt.wasm2wat']?.reason,
          'Install WABT so wasm2wat is available on PATH.',
          ['wasm_disassemble'],
          probes['wabt.wasm2wat'],
        ),
        toolCapability(
          'wabt_wasm_decompile',
          'wabt.wasm-decompile',
          probes['wabt.wasm-decompile']?.available === true,
          probes['wabt.wasm-decompile']?.reason,
          'Install WABT so wasm-decompile is available on PATH.',
          ['wasm_decompile'],
          probes['wabt.wasm-decompile'],
        ),
        toolCapability(
          'wabt_wasm_objdump',
          'wabt.wasm-objdump',
          probes['wabt.wasm-objdump']?.available === true,
          probes['wabt.wasm-objdump']?.reason,
          'Install WABT so wasm-objdump is available on PATH.',
          ['wasm_inspect_sections'],
          probes['wabt.wasm-objdump'],
        ),
        toolCapability(
          'binaryen_wasm_opt',
          'binaryen.wasm-opt',
          probes['binaryen.wasm-opt']?.available === true,
          probes['binaryen.wasm-opt']?.reason,
          'Install Binaryen so wasm-opt is available on PATH.',
          ['wasm_optimize'],
          probes['binaryen.wasm-opt'],
        ),
        {
          capability: 'wasm_offline_runtime',
          status: hasOfflineRuntime ? 'available' : 'unavailable',
          reason: hasOfflineRuntime ? undefined : 'No offline WASM runtime is available on PATH.',
          fix: hasOfflineRuntime
            ? undefined
            : 'Install wasmtime or wasmer to enable wasm_offline_run.',
          details: {
            tools: ['wasm_offline_run'],
            runtimes: {
              wasmtime: probes['runtime.wasmtime'],
              wasmer: probes['runtime.wasmer'],
            },
            preferredRuntime: probes['runtime.wasmtime']?.available
              ? 'runtime.wasmtime'
              : probes['runtime.wasmer']?.available
                ? 'runtime.wasmer'
                : null,
          },
        },
      ]),
    );
  }

  private async getCurrentPageCapability(): Promise<CapabilityEntryOptions> {
    let page;
    try {
      page = await this.state.collector.getActivePage();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        capability: 'wasm_browser_capture_current_page',
        status: 'unknown',
        reason: `Current page probe failed: ${message}`,
        fix: 'Attach or launch a browser page before using browser-backed WASM tools.',
        details: {
          tools: ['wasm_dump', 'wasm_vmp_trace', 'wasm_memory_inspect'],
          pageAttached: false,
        },
      };
    }

    if (!page) {
      return {
        capability: 'wasm_browser_capture_current_page',
        status: 'unknown',
        reason: 'No active page is attached.',
        fix: 'Attach or launch a browser page before using browser-backed WASM tools.',
        details: {
          tools: ['wasm_dump', 'wasm_vmp_trace', 'wasm_memory_inspect'],
          pageAttached: false,
        },
      };
    }

    try {
      const probe = (await page.evaluate(() => {
        const win = window as unknown as {
          __aiHooks?: Record<string, unknown>;
          __wasmModuleStorage?: unknown[];
          __wasmInstances?: unknown[];
        };
        const hooksRaw = win.__aiHooks?.['preset-webassembly-full'];
        const hooks = Array.isArray(hooksRaw) ? (hooksRaw as Array<Record<string, unknown>>) : [];

        return {
          url: location.href,
          hookEventCount: hooks.length,
          instantiatedCount: hooks.filter((entry) => entry.type === 'instantiated').length,
          importCallCount: hooks.filter((entry) => entry.type === 'import_call').length,
          memoryEventCount: hooks.filter((entry) => entry.type === 'memory_created').length,
          storageCount: Array.isArray(win.__wasmModuleStorage) ? win.__wasmModuleStorage.length : 0,
          instanceCount: Array.isArray(win.__wasmInstances) ? win.__wasmInstances.length : 0,
        } satisfies WasmPageProbe;
      })) as WasmPageProbe;

      const available =
        probe.instantiatedCount > 0 ||
        probe.memoryEventCount > 0 ||
        probe.storageCount > 0 ||
        probe.instanceCount > 0;

      return {
        capability: 'wasm_browser_capture_current_page',
        status: available ? 'available' : 'unavailable',
        reason: available
          ? undefined
          : 'No captured WASM modules or exported memory are visible on the current page.',
        fix: available
          ? undefined
          : 'Load a page that instantiates WASM. For dump/trace flows, inject hook_preset("webassembly-full") before navigation.',
        details: {
          tools: ['wasm_dump', 'wasm_vmp_trace', 'wasm_memory_inspect'],
          pageAttached: true,
          ...probe,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        capability: 'wasm_browser_capture_current_page',
        status: 'unknown',
        reason: `Current page probe failed: ${message}`,
        fix: 'Ensure an attached page is still reachable before using browser-backed WASM tools.',
        details: {
          tools: ['wasm_dump', 'wasm_vmp_trace', 'wasm_memory_inspect'],
          pageAttached: true,
        },
      };
    }
  }
}
