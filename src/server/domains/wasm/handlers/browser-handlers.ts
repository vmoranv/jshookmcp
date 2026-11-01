/**
 * Browser sub-handler — dump, vmpTrace, memoryInspect.
 */

import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolveArtifactPath } from '@utils/artifacts';
import { argBool, argNumber, argString } from '@server/domains/shared/parse-args';
import type { WasmSharedState } from './shared';
import { validateOutputPath, hasErrorResult } from './shared';
import type {
  WasmDumpEvalResult,
  WasmVmpTraceEvalResult,
  WasmMemoryInspectEvalResult,
} from './shared';

/**
 * Auto-inject capture script for `wasm_dump` `autoInject`. The stock
 * `webassembly-full` preset records instantiate/import-call/memory events but
 * does NOT store raw module bytes, so `wasm_dump` cannot recover the binary
 * from it. This script hooks `WebAssembly.instantiate` / `compile` (plus their
 * streaming variants) to push raw bytes into `window.__wasmModuleStorage` and
 * an `instantiated` event into the same `__aiHooks['preset-webassembly-full']`
 * channel the reader expects, then delegates to the original API. Streaming
 * variants are funneled through the (hooked) buffer-source overloads so a
 * `fetch().then(arrayBuffer())` path still captures bytes.
 *
 * ES5 syntax on purpose: this runs in the page before any site script.
 */
const WASM_CAPTURE_SCRIPT = `(function () {
  if (typeof WebAssembly === 'undefined') return;
  window.__wasmModuleStorage = [];
  window.__aiHooks = window.__aiHooks || {};
  window.__aiHooks['preset-webassembly-full'] = [];
  function toBytes(bs) {
    try {
      if (bs instanceof ArrayBuffer) return new Uint8Array(bs);
      if (ArrayBuffer.isView(bs)) return new Uint8Array(bs.buffer, bs.byteOffset, bs.byteLength);
      if (bs && typeof bs.byteLength === 'number') return new Uint8Array(bs);
    } catch (_) {}
    return null;
  }
  function record(bs, inst, importObject) {
    var u8 = toBytes(bs);
    if (u8) window.__wasmModuleStorage.push(Array.from(u8));
    var exp = inst && inst.exports ? Object.keys(inst.exports) : [];
    var imps = importObject && typeof importObject === 'object' ? Object.keys(importObject) : [];
    window.__aiHooks['preset-webassembly-full'].push({
      type: 'instantiated', size: u8 ? u8.length : 0, exports: exp, importMods: imps, ts: Date.now()
    });
  }
  var origInst = WebAssembly.instantiate;
  WebAssembly.instantiate = function (bs, importObject) {
    return origInst.call(this, bs, importObject).then(function (result) {
      var inst = result && result.instance ? result.instance : result;
      record(bs, inst, importObject);
      return result;
    });
  };
  var origInstStream = WebAssembly.instantiateStreaming;
  if (origInstStream) {
    WebAssembly.instantiateStreaming = function (source, importObject) {
      return fetch(source).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
        return WebAssembly.instantiate(buf, importObject);
      });
    };
  }
  var origCompile = WebAssembly.compile;
  WebAssembly.compile = function (bs) {
    return origCompile.call(this, bs).then(function (mod) {
      var u8 = toBytes(bs);
      if (u8) window.__wasmModuleStorage.push(Array.from(u8));
      window.__aiHooks['preset-webassembly-full'].push({
        type: 'instantiated', size: u8 ? u8.length : 0, exports: [], importMods: [], ts: Date.now()
      });
      return mod;
    });
  };
  var origCompileStream = WebAssembly.compileStreaming;
  if (origCompileStream) {
    WebAssembly.compileStreaming = function (source) {
      return fetch(source).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
        return WebAssembly.compile(buf);
      });
    };
  }
})();`;

export class BrowserHandlers {
  private state: WasmSharedState;

  constructor(state: WasmSharedState) {
    this.state = state;
  }

  async handleWasmDump(args: Record<string, unknown>) {
    const moduleIndex = argNumber(args, 'moduleIndex', 0);
    const outputPath = argString(args, 'outputPath');
    const autoInject = argBool(args, 'autoInject', false);

    const page = await this.state.collector.getActivePage();

    // Read the instantiated-module metadata for `moduleIndex`. Captured as a
    // closure so the autoInject retry re-reads after reload without duplicating
    // the evaluate body. It closes over `page` + `moduleIndex`, so it is not
    // flagged by unicorn/consistent-function-scoping.
    const readEvents = (): Promise<WasmDumpEvalResult> =>
      page.evaluate((idx: number) => {
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

    let result: WasmDumpEvalResult = await readEvents();

    // Auto-inject path: when no WASM is captured and the caller opts in, install
    // a bytes-capturing hook (the webassembly-full preset records events only,
    // not raw bytes), reload so the hook runs against page WASM, then re-read.
    // The page must instantiate its WASM at load time for the re-capture to
    // observe anything.
    if (hasErrorResult(result) && autoInject) {
      await page.evaluateOnNewDocument(WASM_CAPTURE_SCRIPT);
      await page.reload({ waitUntil: 'domcontentloaded' });
      result = await readEvents();
    }

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
        const safePath = await validateOutputPath(outputPath);
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
                : 'Binary not captured. Inject hook_preset("webassembly-full") BEFORE page navigation, with ' +
                  'window.__wasmModuleStorage patching.',
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
              hint:
                'Top functions show VMP handler dispatch patterns. Use wasm_disassemble to analyze their ' +
                'implementation.',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleWasmMemoryInspect(args: Record<string, unknown>) {
    const instanceIndex = argNumber(args, 'instanceIndex', 0);
    const offset = argNumber(args, 'offset', 0);
    const length = Math.min(argNumber(args, 'length', 256), 65536);
    const format = argString(args, 'format', 'both');
    const searchPattern = argString(args, 'searchPattern');

    const page = await this.state.collector.getActivePage();

    const memData: WasmMemoryInspectEvalResult = await page.evaluate(
      (opts: { instanceIndex: number; offset: number; length: number; searchPattern?: string }) => {
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

        // Always build an instance inventory so the caller can never silently read
        // the wrong module on a multi-WASM page (DRM/anti-bot/crypto commonly load several).
        // The memory-buffer probe is defensive: a throwing getter is treated as "no memory"
        // here, and the real read below surfaces the error from the targeted instance.
        const availableInstances = instances.map((inst, idx) => {
          const exportsObj =
            inst && typeof inst === 'object' && 'exports' in (inst as object)
              ? ((inst as { exports?: Record<string, unknown> }).exports ?? {})
              : {};
          let hasMemory = false;
          try {
            hasMemory = !!(exportsObj as { memory?: { buffer?: unknown } }).memory?.buffer;
          } catch {
            hasMemory = false;
          }
          return {
            idx,
            exports: Object.keys(exportsObj),
            hasMemory,
          };
        });

        /** Byte pattern from the search argument: hex string or UTF-8 text. */
        // eslint-disable-next-line unicorn/consistent-function-scoping -- runs inside page.evaluate
        const patternBytesOf = (pattern: string): number[] => {
          if (/^[0-9a-fA-F\s]+$/.test(pattern)) {
            return (
              pattern
                .replace(/\s/g, '')
                .match(/.{2}/g)
                ?.map((h: string) => parseInt(h, 16)) ?? []
            );
          }
          return Array.from(new TextEncoder().encode(pattern));
        };

        /** Naive byte scan over [from, to); returns match offsets. */
        // eslint-disable-next-line unicorn/consistent-function-scoping -- runs inside page.evaluate
        const scanForPattern = (
          buffer: Uint8Array,
          patternBytes: number[],
          from: number,
          to: number,
        ): Array<{ offset: number }> => {
          const results: Array<{ offset: number }> = [];
          if (patternBytes.length === 0) return results;
          const last = Math.min(to - patternBytes.length, buffer.length - patternBytes.length);
          for (let i = from; i <= last; i++) {
            let match = true;
            for (let j = 0; j < patternBytes.length; j++) {
              if (buffer[i + j] !== patternBytes[j]) {
                match = false;
                break;
              }
            }
            if (match) results.push({ offset: i });
          }
          return results;
        };

        try {
          const targetInstance = instances[opts.instanceIndex] as
            | { exports?: { memory?: { buffer?: ArrayBufferLike } } }
            | undefined;
          if (!targetInstance) {
            return {
              error: `instanceIndex ${opts.instanceIndex} out of range (totalInstances: ${instances.length}). Available instances: ${JSON.stringify(availableInstances)}`,
            };
          }
          const memory = targetInstance.exports?.memory;
          if (!memory?.buffer) {
            return {
              error: `WASM instance #${opts.instanceIndex} has no exported memory. Available instances: ${JSON.stringify(availableInstances)}`,
            };
          }

          const buffer = new Uint8Array(memory.buffer);
          const slice = Array.from(buffer.slice(opts.offset, opts.offset + opts.length));

          const searchResults = opts.searchPattern
            ? scanForPattern(
                buffer,
                patternBytesOf(opts.searchPattern),
                opts.offset,
                opts.offset + opts.length,
              )
            : undefined;

          return {
            totalMemoryPages: memory.buffer.byteLength / 65536,
            totalMemoryBytes: memory.buffer.byteLength,
            requestedOffset: opts.offset,
            requestedLength: opts.length,
            instanceIndex: opts.instanceIndex,
            totalInstances: instances.length,
            availableInstances,
            data: slice,
            searchResults,
            memoryInfo: memoryEvents[0] || null,
          };
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          return { error: `Failed to read WASM memory: ${message}` };
        }
      },
      { instanceIndex, offset, length, searchPattern },
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
              instanceIndex: memData.instanceIndex,
              totalInstances: memData.totalInstances,
              availableInstances: memData.availableInstances,
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
