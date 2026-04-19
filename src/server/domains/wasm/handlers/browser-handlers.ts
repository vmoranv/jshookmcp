/**
 * Browser sub-handler — dump, vmpTrace, memoryInspect.
 */

import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolveArtifactPath } from '@utils/artifacts';
import { argNumber, argString } from '@server/domains/shared/parse-args';
import type { WasmSharedState } from './shared';
import { validateOutputPath, hasErrorResult } from './shared';
import type {
  WasmDumpEvalResult,
  WasmVmpTraceEvalResult,
  WasmMemoryInspectEvalResult,
} from './shared';

export class BrowserHandlers {
  private state: WasmSharedState;

  constructor(state: WasmSharedState) {
    this.state = state;
  }

  async handleWasmDump(args: Record<string, unknown>) {
    const moduleIndex = argNumber(args, 'moduleIndex', 0);
    const outputPath = argString(args, 'outputPath');

    const page = await this.state.collector.getActivePage();

    const result: WasmDumpEvalResult = await page.evaluate((idx: number) => {
      const win = window as unknown as { __aiHooks?: Record<string, unknown> };
      const hooksRaw = win.__aiHooks?.['preset-webassembly-full'];
      if (!Array.isArray(hooksRaw) || hooksRaw.length === 0) {
        return {
          error:
            'No WASM modules captured. Ensure the webassembly-full hook preset is active and the page has loaded WASM.',
        };
      }

      const hooks = hooksRaw as Array<Record<string, unknown>>;
      const instantiatedEvents = hooks.filter((e) => e.type === 'instantiated');
      if (idx >= instantiatedEvents.length) {
        return {
          error: `Module index ${idx} out of range. Found ${instantiatedEvents.length} instantiated modules.`,
        };
      }

      const event = instantiatedEvents[idx]!;
      return {
        exports: event.exports,
        importMods: event.importMods,
        size: event.size,
        moduleCount: instantiatedEvents.length,
      };
    }, moduleIndex);

    if (hasErrorResult(result)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.error }) }],
      };
    }

    const wasmBytes = await page.evaluate((idx: number) => {
      const win = window as unknown as { __wasmModuleStorage?: unknown[] };
      const storage = win.__wasmModuleStorage;
      if (!storage?.[idx]) {
        return null;
      }
      const buffer = storage[idx] as ArrayBufferLike;
      return Array.from(new Uint8Array(buffer));
    }, moduleIndex);

    let savedPath: string;
    let hash: string | undefined;

    if (wasmBytes) {
      const buffer = Buffer.from(wasmBytes as number[]);
      hash = createHash('sha256').update(buffer).digest('hex').substring(0, 16);

      if (outputPath) {
        const safePath = validateOutputPath(outputPath);
        await writeFile(safePath, buffer);
        savedPath = safePath;
      } else {
        const { absolutePath, displayPath } = await resolveArtifactPath({
          category: 'wasm',
          toolName: 'wasm-dump',
          target: hash,
          ext: 'wasm',
        });
        await writeFile(absolutePath, buffer);
        savedPath = displayPath;
      }
    } else {
      savedPath = '(binary not available — hook did not store raw bytes)';
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              artifactPath: savedPath,
              hash,
              size: result.size,
              exports: result.exports,
              importModules: result.importMods,
              totalModules: result.moduleCount,
              hint: wasmBytes
                ? 'Use wasm_disassemble or wasm_decompile on the dumped file for further analysis.'
                : 'Binary not captured. Inject hook_preset("webassembly-full") BEFORE page navigation, with window.__wasmModuleStorage patching.',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleWasmVmpTrace(args: Record<string, unknown>) {
    const maxEvents = argNumber(args, 'maxEvents', 5000);
    const filterModule = argString(args, 'filterModule');

    const page = await this.state.collector.getActivePage();

    const traceData: WasmVmpTraceEvalResult = await page.evaluate(
      (opts: { maxEvents: number; filterModule?: string }) => {
        const win = window as unknown as { __aiHooks?: Record<string, unknown> };
        const hooksRaw = win.__aiHooks?.['preset-webassembly-full'];
        if (!Array.isArray(hooksRaw) || hooksRaw.length === 0) {
          return {
            error: 'No WASM hook data. Inject hook_preset("webassembly-full") and reload the page.',
          };
        }

        const hooks = hooksRaw as Array<Record<string, unknown>>;
        let importCalls = hooks.filter((e) => e.type === 'import_call');
        if (opts.filterModule) {
          importCalls = importCalls.filter((e) => e.mod === opts.filterModule);
        }

        const limited = importCalls.slice(0, opts.maxEvents);

        const fnCounts: Record<string, number> = {};
        for (const call of limited) {
          const key = `${String(call.mod)}.${String(call.fn)}`;
          fnCounts[key] = (fnCounts[key] || 0) + 1;
        }

        const sorted = Object.entries(fnCounts)
          .toSorted((a, b) => b[1] - a[1])
          .slice(0, 30)
          .map(([name, count]) => ({ name, count }));

        return {
          totalEvents: importCalls.length,
          capturedEvents: limited.length,
          topFunctions: sorted,
          trace: limited.slice(0, 200).map((e) => ({
            mod: e.mod,
            fn: e.fn,
            args: e.args,
            ts: e.ts,
          })),
        };
      },
      { maxEvents, filterModule },
    );

    if (hasErrorResult(traceData)) {
      return {
        content: [
          { type: 'text', text: JSON.stringify({ success: false, error: traceData.error }) },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              ...traceData,
              hint: 'Top functions show VMP handler dispatch patterns. Use wasm_disassemble to analyze their implementation.',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleWasmMemoryInspect(args: Record<string, unknown>) {
    const offset = argNumber(args, 'offset', 0);
    const length = Math.min(argNumber(args, 'length', 256), 65536);
    const format = argString(args, 'format', 'both');
    const searchPattern = argString(args, 'searchPattern');

    const page = await this.state.collector.getActivePage();

    const memData: WasmMemoryInspectEvalResult = await page.evaluate(
      (opts: { offset: number; length: number; searchPattern?: string }) => {
        const win = window as unknown as {
          __aiHooks?: Record<string, unknown>;
          __wasmInstances?: unknown[];
        };
        const hooksRaw = win.__aiHooks?.['preset-webassembly-full'];
        const hooks = Array.isArray(hooksRaw) ? (hooksRaw as Array<Record<string, unknown>>) : [];
        const memoryEvents = hooks.filter((e) => e.type === 'memory_created');

        const instances = win.__wasmInstances;
        if (!Array.isArray(instances) || instances.length === 0) {
          return {
            error:
              'No WASM memory available. Ensure the webassembly-full hook is active and a WASM module is instantiated.',
          };
        }

        try {
          const firstInstance = instances[0] as {
            exports?: { memory?: { buffer?: ArrayBufferLike } };
          };
          const memory = firstInstance.exports?.memory;
          if (!memory?.buffer) {
            return { error: 'WASM module has no exported memory.' };
          }

          const buffer = new Uint8Array(memory.buffer);
          const slice = Array.from(buffer.slice(opts.offset, opts.offset + opts.length));

          let searchResults: Array<{ offset: number }> | undefined;
          if (opts.searchPattern) {
            searchResults = [];
            const pattern = opts.searchPattern;
            const isHex = /^[0-9a-fA-F\s]+$/.test(pattern);
            if (isHex) {
              const hexBytes =
                pattern
                  .replace(/\s/g, '')
                  .match(/.{2}/g)
                  ?.map((h: string) => parseInt(h, 16)) || [];
              for (
                let i = opts.offset;
                i <=
                Math.min(
                  opts.offset + opts.length - hexBytes.length,
                  buffer.length - hexBytes.length,
                );
                i++
              ) {
                let match = true;
                for (let j = 0; j < hexBytes.length; j++) {
                  if (buffer[i + j] !== hexBytes[j]) {
                    match = false;
                    break;
                  }
                }
                if (match) searchResults.push({ offset: i });
              }
            } else {
              const encoder = new TextEncoder();
              const patternBytes = encoder.encode(pattern);
              for (
                let i = opts.offset;
                i <=
                Math.min(
                  opts.offset + opts.length - patternBytes.length,
                  buffer.length - patternBytes.length,
                );
                i++
              ) {
                let match = true;
                for (let j = 0; j < patternBytes.length; j++) {
                  if (buffer[i + j] !== patternBytes[j]) {
                    match = false;
                    break;
                  }
                }
                if (match) searchResults.push({ offset: i });
              }
            }
          }

          return {
            totalMemoryPages: memory.buffer.byteLength / 65536,
            totalMemoryBytes: memory.buffer.byteLength,
            requestedOffset: opts.offset,
            requestedLength: opts.length,
            data: slice,
            searchResults,
            memoryInfo: memoryEvents[0] || null,
          };
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          return { error: `Failed to read WASM memory: ${message}` };
        }
      },
      { offset, length, searchPattern },
    );

    if (hasErrorResult(memData)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: memData.error }) }],
      };
    }

    const data = memData.data;

    let hexDump = '';
    let asciiDump = '';

    if (format === 'hex' || format === 'both') {
      for (let i = 0; i < data.length; i += 16) {
        const row = data.slice(i, i + 16);
        const addr = (offset + i).toString(16).padStart(8, '0');
        const hex = row.map((b: number) => b.toString(16).padStart(2, '0')).join(' ');
        const ascii = row
          .map((b: number) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'))
          .join('');
        hexDump += `${addr}  ${hex.padEnd(48)}  |${ascii}|\n`;
      }
    }

    if (format === 'ascii') {
      asciiDump = data
        .map((b: number) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'))
        .join('');
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              totalMemoryPages: memData.totalMemoryPages,
              totalMemoryBytes: memData.totalMemoryBytes,
              offset,
              length: data.length,
              hexDump: format !== 'ascii' ? hexDump : undefined,
              asciiDump: format === 'ascii' ? asciiDump : undefined,
              searchResults: memData.searchResults,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
