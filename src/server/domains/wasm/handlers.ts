/**
 * WASM domain handlers.
 * Implements wasm_dump, wasm_disassemble, wasm_decompile, wasm_inspect_sections,
 * wasm_offline_run, wasm_optimize, wasm_vmp_trace, wasm_memory_inspect.
 */

import { writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, normalize, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveArtifactPath } from '../../../utils/artifacts.js';
import { ExternalToolRunner } from '../../../modules/external/ExternalToolRunner.js';
import { ToolRegistry } from '../../../modules/external/ToolRegistry.js';
import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';

type UnknownRecord = Record<string, unknown>;

interface EvalErrorResult {
  error: string;
}

interface WasmDumpEvalSuccess {
  exports: unknown;
  importMods: unknown;
  size: unknown;
  moduleCount: number;
}

type WasmDumpEvalResult = EvalErrorResult | WasmDumpEvalSuccess;

interface WasmTraceTopFunction {
  name: string;
  count: number;
}

interface WasmTraceEventPreview {
  mod: unknown;
  fn: unknown;
  args: unknown;
  ts: unknown;
}

interface WasmVmpTraceEvalSuccess {
  totalEvents: number;
  capturedEvents: number;
  topFunctions: WasmTraceTopFunction[];
  trace: WasmTraceEventPreview[];
}

type WasmVmpTraceEvalResult = EvalErrorResult | WasmVmpTraceEvalSuccess;

interface WasmMemorySearchResult {
  offset: number;
}

interface WasmMemoryInspectEvalSuccess {
  totalMemoryPages: number;
  totalMemoryBytes: number;
  requestedOffset: number;
  requestedLength: number;
  data: number[];
  searchResults?: WasmMemorySearchResult[];
  memoryInfo: unknown;
}

type WasmMemoryInspectEvalResult = EvalErrorResult | WasmMemoryInspectEvalSuccess;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const hasErrorResult = (value: unknown): value is EvalErrorResult =>
  isRecord(value) && typeof value.error === 'string';

export class WasmToolHandlers {
  private runner: ExternalToolRunner;
  private registry: ToolRegistry;
  private collector: CodeCollector;

  constructor(collector: CodeCollector) {
    this.collector = collector;
    this.registry = new ToolRegistry();
    this.runner = new ExternalToolRunner(this.registry);
  }

  /** Validate user-supplied output path stays under cwd or temp directory. */
  private validateOutputPath(outputPath: string): string {
    const safe = resolve(outputPath);
    const cwd = normalize(process.cwd());
    const tmp = normalize(tmpdir());
    if (!safe.startsWith(`${cwd}${sep}`) && !safe.startsWith(`${tmp}${sep}`)) {
      throw new Error('Path traversal blocked: outputPath must be under project root or temp directory');
    }
    return safe;
  }

  // ── wasm_dump ─────────────────────────────────────────────

  async handleWasmDump(args: Record<string, unknown>) {
    const moduleIndex = (args.moduleIndex as number) ?? 0;
    const outputPath = args.outputPath as string | undefined;

    const page = await this.collector.getActivePage();

    // Inject webassembly-full hook if not already active, then extract the module bytes
    const result: WasmDumpEvalResult = await page.evaluate((idx: number) => {
      const win = window as unknown as { __aiHooks?: Record<string, unknown> };
      const hooksRaw = win.__aiHooks?.['preset-webassembly-full'];
      if (!Array.isArray(hooksRaw) || hooksRaw.length === 0) {
        return { error: 'No WASM modules captured. Ensure the webassembly-full hook preset is active and the page has loaded WASM.' };
      }

      const hooks = hooksRaw as Array<Record<string, unknown>>;
      const instantiatedEvents = hooks.filter((e) => e.type === 'instantiated');
      if (idx >= instantiatedEvents.length) {
        return { error: `Module index ${idx} out of range. Found ${instantiatedEvents.length} instantiated modules.` };
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

    // For the actual binary dump, we need to capture it via the hook
    // The webassembly-full hook stores references — we extract the ArrayBuffer
    const wasmBytes = await page.evaluate((idx: number) => {
      const win = window as unknown as { __wasmModuleStorage?: unknown[] };
      const storage = win.__wasmModuleStorage;
      if (!storage || !storage[idx]) {
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
        const safePath = this.validateOutputPath(outputPath);
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
      content: [{
        type: 'text',
        text: JSON.stringify({
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
        }, null, 2),
      }],
    };
  }

  // ── wasm_disassemble ──────────────────────────────────────

  async handleWasmDisassemble(args: Record<string, unknown>) {
    const inputPath = args.inputPath as string;
    const outputPath = args.outputPath as string | undefined;
    const foldExprs = (args.foldExprs as boolean) ?? true;

    const toolArgs = [inputPath, '-o', '/dev/stdout'];
    if (foldExprs) toolArgs.push('--fold-exprs');

    const result = await this.runner.run({
      tool: 'wabt.wasm2wat',
      args: toolArgs,
      timeoutMs: 60_000,
    });

    if (!result.ok) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.stderr, exitCode: result.exitCode }) }],
      };
    }

    // Save the WAT output
    let savedPath: string;
    if (outputPath) {
      const safePath = this.validateOutputPath(outputPath);
      await writeFile(safePath, result.stdout, 'utf-8');
      savedPath = safePath;
    } else {
      const { absolutePath, displayPath } = await resolveArtifactPath({
        category: 'wasm',
        toolName: 'wasm-disassemble',
        ext: 'wat',
      });
      await writeFile(absolutePath, result.stdout, 'utf-8');
      savedPath = displayPath;
    }

    // Return preview + full artifact path
    const lines = result.stdout.split('\n');
    const preview = lines.slice(0, 50).join('\n');

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          artifactPath: savedPath,
          totalLines: lines.length,
          sizeBytes: result.stdout.length,
          preview: preview + (lines.length > 50 ? '\n... (truncated)' : ''),
          durationMs: result.durationMs,
        }, null, 2),
      }],
    };
  }

  // ── wasm_decompile ────────────────────────────────────────

  async handleWasmDecompile(args: Record<string, unknown>) {
    const inputPath = args.inputPath as string;
    const outputPath = args.outputPath as string | undefined;

    const result = await this.runner.run({
      tool: 'wabt.wasm-decompile',
      args: [inputPath, '-o', '/dev/stdout'],
      timeoutMs: 60_000,
    });

    if (!result.ok) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.stderr, exitCode: result.exitCode }) }],
      };
    }

    let savedPath: string;
    if (outputPath) {
      const safePath = this.validateOutputPath(outputPath);
      await writeFile(safePath, result.stdout, 'utf-8');
      savedPath = safePath;
    } else {
      const { absolutePath, displayPath } = await resolveArtifactPath({
        category: 'wasm',
        toolName: 'wasm-decompile',
        ext: 'dcmp',
      });
      await writeFile(absolutePath, result.stdout, 'utf-8');
      savedPath = displayPath;
    }

    const lines = result.stdout.split('\n');
    const preview = lines.slice(0, 60).join('\n');

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          artifactPath: savedPath,
          totalLines: lines.length,
          preview: preview + (lines.length > 60 ? '\n... (truncated)' : ''),
          durationMs: result.durationMs,
        }, null, 2),
      }],
    };
  }

  // ── wasm_inspect_sections ─────────────────────────────────

  async handleWasmInspectSections(args: Record<string, unknown>) {
    const inputPath = args.inputPath as string;
    const sections = (args.sections as string) ?? 'details';

    const flagMap: Record<string, string> = {
      headers: '-h',
      details: '-x',
      disassemble: '-d',
      all: '-h -x -d',
    };

    const flags = (flagMap[sections] || '-x').split(' ');
    const result = await this.runner.run({
      tool: 'wabt.wasm-objdump',
      args: [...flags, inputPath],
      timeoutMs: 60_000,
    });

    if (!result.ok) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.stderr, exitCode: result.exitCode }) }],
      };
    }

    const lines = result.stdout.split('\n');
    const preview = lines.slice(0, 100).join('\n');

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          totalLines: lines.length,
          preview: preview + (lines.length > 100 ? '\n... (truncated)' : ''),
          durationMs: result.durationMs,
        }, null, 2),
      }],
    };
  }

  // ── wasm_offline_run ──────────────────────────────────────

  async handleWasmOfflineRun(args: Record<string, unknown>) {
    const inputPath = args.inputPath as string;
    const functionName = args.functionName as string;
    const fnArgs = (args.args as string[]) ?? [];
    const runtime = (args.runtime as string) ?? 'auto';
    const timeoutMs = (args.timeoutMs as number) ?? 10_000;

    // Determine which runtime to use
    let toolName: 'runtime.wasmtime' | 'runtime.wasmer';
    if (runtime === 'auto') {
      const probes = await this.runner.probeAll();
      if (probes['runtime.wasmtime']?.available) {
        toolName = 'runtime.wasmtime';
      } else if (probes['runtime.wasmer']?.available) {
        toolName = 'runtime.wasmer';
      } else {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'No WASM runtime found. Install wasmtime or wasmer.',
            }),
          }],
        };
      }
    } else {
      toolName = runtime === 'wasmer' ? 'runtime.wasmer' : 'runtime.wasmtime';
    }

    // Build args for the runtime
    const runArgs = toolName === 'runtime.wasmtime'
      ? ['run', '--invoke', functionName, inputPath, ...fnArgs]
      : ['run', inputPath, '--invoke', functionName, '--', ...fnArgs];

    const result = await this.runner.run({
      tool: toolName,
      args: runArgs,
      timeoutMs,
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: result.ok,
          runtime: toolName,
          functionName,
          args: fnArgs,
          output: result.stdout.trim(),
          stderr: result.stderr.trim() || undefined,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        }, null, 2),
      }],
    };
  }

  // ── wasm_optimize ─────────────────────────────────────────

  async handleWasmOptimize(args: Record<string, unknown>) {
    const inputPath = args.inputPath as string;
    const outputPath = args.outputPath as string | undefined;
    const level = (args.level as string) ?? 'O2';

    let destPath: string;
    if (outputPath) {
      destPath = this.validateOutputPath(outputPath);
    } else {
      const { absolutePath } = await resolveArtifactPath({
        category: 'wasm',
        toolName: 'wasm-opt',
        ext: 'wasm',
      });
      destPath = absolutePath;
    }

    const result = await this.runner.run({
      tool: 'binaryen.wasm-opt',
      args: [`-${level}`, inputPath, '-o', destPath],
      timeoutMs: 120_000,
    });

    if (!result.ok) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: result.stderr, exitCode: result.exitCode }) }],
      };
    }

    // Compare sizes
    let inputSize = 0;
    let outputSize = 0;
    try {
      inputSize = (await stat(inputPath)).size;
      outputSize = (await stat(destPath)).size;
    } catch { /* ignore stat errors */ }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          artifactPath: destPath,
          optimizationLevel: level,
          inputSizeBytes: inputSize,
          outputSizeBytes: outputSize,
          reductionPercent: inputSize > 0 ? ((1 - outputSize / inputSize) * 100).toFixed(1) : '0',
          durationMs: result.durationMs,
        }, null, 2),
      }],
    };
  }

  // ── wasm_vmp_trace ────────────────────────────────────────

  async handleWasmVmpTrace(args: Record<string, unknown>) {
    const maxEvents = (args.maxEvents as number) ?? 5000;
    const filterModule = args.filterModule as string | undefined;

    const page = await this.collector.getActivePage();

    const traceData: WasmVmpTraceEvalResult = await page.evaluate((opts: { maxEvents: number; filterModule?: string }) => {
      const win = window as unknown as { __aiHooks?: Record<string, unknown> };
      const hooksRaw = win.__aiHooks?.['preset-webassembly-full'];
      if (!Array.isArray(hooksRaw) || hooksRaw.length === 0) {
        return { error: 'No WASM hook data. Inject hook_preset("webassembly-full") and reload the page.' };
      }

      const hooks = hooksRaw as Array<Record<string, unknown>>;
      let importCalls = hooks.filter((e) => e.type === 'import_call');
      if (opts.filterModule) {
        importCalls = importCalls.filter((e) => e.mod === opts.filterModule);
      }

      const limited = importCalls.slice(0, opts.maxEvents);

      // Analyze patterns
      const fnCounts: Record<string, number> = {};
      for (const call of limited) {
        const key = `${String(call.mod)}.${String(call.fn)}`;
        fnCounts[key] = (fnCounts[key] || 0) + 1;
      }

      const sorted = Object.entries(fnCounts)
        .sort((a, b) => b[1] - a[1])
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
    }, { maxEvents, filterModule });

    if (hasErrorResult(traceData)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: traceData.error }) }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          ...traceData,
          hint: 'Top functions show VMP handler dispatch patterns. Use wasm_disassemble to analyze their implementation.',
        }, null, 2),
      }],
    };
  }

  // ── wasm_memory_inspect ───────────────────────────────────

  async handleWasmMemoryInspect(args: Record<string, unknown>) {
    const offset = (args.offset as number) ?? 0;
    const length = Math.min((args.length as number) ?? 256, 65536);
    const format = (args.format as string) ?? 'both';
    const searchPattern = args.searchPattern as string | undefined;

    const page = await this.collector.getActivePage();

    const memData: WasmMemoryInspectEvalResult = await page.evaluate((opts: { offset: number; length: number; searchPattern?: string }) => {
      // Find the first WASM memory instance
      const win = window as unknown as {
        __aiHooks?: Record<string, unknown>;
        __wasmInstances?: unknown[];
      };
      const hooksRaw = win.__aiHooks?.['preset-webassembly-full'];
      const hooks = Array.isArray(hooksRaw) ? hooksRaw as Array<Record<string, unknown>> : [];
      const memoryEvents = hooks.filter((e) => e.type === 'memory_created');

      // Try to access the WASM memory directly
      const instances = win.__wasmInstances;
      if (!Array.isArray(instances) || instances.length === 0) {
        return { error: 'No WASM memory available. Ensure the webassembly-full hook is active and a WASM module is instantiated.' };
      }

      try {
        const firstInstance = instances[0] as { exports?: { memory?: { buffer?: ArrayBufferLike } } };
        const memory = firstInstance.exports?.memory;
        if (!memory || !memory.buffer) {
          return { error: 'WASM module has no exported memory.' };
        }

        const buffer = new Uint8Array(memory.buffer);
        const slice = Array.from(buffer.slice(opts.offset, opts.offset + opts.length));

        let searchResults: Array<{ offset: number }> | undefined;
        if (opts.searchPattern) {
          searchResults = [];
          const pattern = opts.searchPattern;
          // Try hex pattern first
          const isHex = /^[0-9a-fA-F\s]+$/.test(pattern);
          if (isHex) {
            const hexBytes = pattern.replace(/\s/g, '').match(/.{2}/g)?.map((h: string) => parseInt(h, 16)) || [];
            for (let i = opts.offset; i <= Math.min(opts.offset + opts.length - hexBytes.length, buffer.length - hexBytes.length); i++) {
              let match = true;
              for (let j = 0; j < hexBytes.length; j++) {
                if (buffer[i + j] !== hexBytes[j]) { match = false; break; }
              }
              if (match) searchResults.push({ offset: i });
            }
          } else {
            // ASCII search
            const encoder = new TextEncoder();
            const patternBytes = encoder.encode(pattern);
            for (let i = opts.offset; i <= Math.min(opts.offset + opts.length - patternBytes.length, buffer.length - patternBytes.length); i++) {
              let match = true;
              for (let j = 0; j < patternBytes.length; j++) {
                if (buffer[i + j] !== patternBytes[j]) { match = false; break; }
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
    }, { offset, length, searchPattern });

    if (hasErrorResult(memData)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: memData.error }) }],
      };
    }

    const data = memData.data;

    // Format output
    let hexDump = '';
    let asciiDump = '';

    if (format === 'hex' || format === 'both') {
      for (let i = 0; i < data.length; i += 16) {
        const row = data.slice(i, i + 16);
        const addr = (offset + i).toString(16).padStart(8, '0');
        const hex = row.map((b: number) => b.toString(16).padStart(2, '0')).join(' ');
        const ascii = row.map((b: number) => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
        hexDump += `${addr}  ${hex.padEnd(48)}  |${ascii}|\n`;
      }
    }

    if (format === 'ascii') {
      asciiDump = data.map((b: number) => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          totalMemoryPages: memData.totalMemoryPages,
          totalMemoryBytes: memData.totalMemoryBytes,
          offset,
          length: data.length,
          hexDump: format !== 'ascii' ? hexDump : undefined,
          asciiDump: format === 'ascii' ? asciiDump : undefined,
          searchResults: memData.searchResults,
        }, null, 2),
      }],
    };
  }
}
