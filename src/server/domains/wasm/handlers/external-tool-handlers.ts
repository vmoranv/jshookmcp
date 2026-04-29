/**
 * External tool sub-handler — disassemble, decompile, inspectSections, offlineRun, optimize.
 */

import { writeFile, stat, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { resolveArtifactPath } from '@utils/artifacts';
import {
  argNumber,
  argString,
  argStringRequired,
  argBool,
  argStringArray,
} from '@server/domains/shared/parse-args';
import {
  WASM_OPTIMIZE_TIMEOUT_MS,
  WASM_TOOL_TIMEOUT_MS,
  WASM_DEAD_CODE_MIN_MATCHES,
  WASM_BITWISE_OPS_THRESHOLD,
  WASM_VM_DISPATCH_MIN_LOOPS,
} from '@src/constants';
import type { WasmSharedState } from './shared';
import { validateOutputPath } from './shared';

function isExplicitLocalFilePath(input: string): boolean {
  return (
    /^[a-z]:[\\/]/i.test(input) ||
    /^\\\\[^\\]+\\[^\\]+/i.test(input) ||
    /^file:\/\//i.test(input) ||
    /^\/(?:Users|home|tmp|var|etc|opt|usr|srv|mnt|media|private|root|run|dev|proc|sys|Library|Volumes)(?:\/|$)/.test(
      input,
    )
  );
}

export class ExternalToolHandlers {
  private state: WasmSharedState;

  constructor(state: WasmSharedState) {
    this.state = state;
  }

  async handleWasmDisassemble(args: Record<string, unknown>) {
    const inputPath = argStringRequired(args, 'inputPath');
    const outputPath = argString(args, 'outputPath');
    const foldExprs = argBool(args, 'foldExprs', true);

    const toolArgs = [inputPath, '-o', '/dev/stdout'];
    if (foldExprs) toolArgs.push('--fold-exprs');

    const result = await this.state.runner.run({
      tool: 'wabt.wasm2wat',
      args: toolArgs,
      timeoutMs: WASM_TOOL_TIMEOUT_MS,
    });

    if (!result.ok) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: result.stderr,
              exitCode: result.exitCode,
            }),
          },
        ],
      };
    }

    let savedPath: string;
    if (outputPath) {
      const safePath = validateOutputPath(outputPath);
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

    const lines = result.stdout.split('\n');
    const preview = lines.slice(0, 50).join('\n');

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              artifactPath: savedPath,
              totalLines: lines.length,
              sizeBytes: result.stdout.length,
              preview: preview + (lines.length > 50 ? '\n... (truncated)' : ''),
              durationMs: result.durationMs,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleWasmDecompile(args: Record<string, unknown>) {
    const inputPath = argStringRequired(args, 'inputPath');
    const outputPath = argString(args, 'outputPath');

    const result = await this.state.runner.run({
      tool: 'wabt.wasm-decompile',
      args: [inputPath, '-o', '/dev/stdout'],
      timeoutMs: WASM_TOOL_TIMEOUT_MS,
    });

    if (!result.ok) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: result.stderr,
              exitCode: result.exitCode,
            }),
          },
        ],
      };
    }

    let savedPath: string;
    if (outputPath) {
      const safePath = validateOutputPath(outputPath);
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
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              artifactPath: savedPath,
              totalLines: lines.length,
              preview: preview + (lines.length > 60 ? '\n... (truncated)' : ''),
              durationMs: result.durationMs,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleWasmInspectSections(args: Record<string, unknown>) {
    const inputPath = argStringRequired(args, 'inputPath');
    const sections = argString(args, 'sections', 'details');

    const flagMap: Record<string, string> = {
      headers: '-h',
      details: '-x',
      disassemble: '-d',
      all: '-h -x -d',
    };

    const flags = (flagMap[sections] || '-x').split(' ');
    const result = await this.state.runner.run({
      tool: 'wabt.wasm-objdump',
      args: [...flags, inputPath],
      timeoutMs: WASM_TOOL_TIMEOUT_MS,
    });

    if (!result.ok) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: result.stderr,
              exitCode: result.exitCode,
            }),
          },
        ],
      };
    }

    const lines = result.stdout.split('\n');
    const preview = lines.slice(0, 100).join('\n');

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              totalLines: lines.length,
              preview: preview + (lines.length > 100 ? '\n... (truncated)' : ''),
              durationMs: result.durationMs,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleWasmOfflineRun(args: Record<string, unknown>) {
    const inputPath = argStringRequired(args, 'inputPath');
    const functionName = argStringRequired(args, 'functionName');
    const fnArgs = argStringArray(args, 'args');
    const runtime = argString(args, 'runtime', 'auto');
    const timeoutMs = argNumber(args, 'timeoutMs', 10_000);

    let toolName: 'runtime.wasmtime' | 'runtime.wasmer';
    if (runtime === 'auto') {
      const probes = await this.state.runner.probeAll();
      if (probes['runtime.wasmtime']?.available) {
        toolName = 'runtime.wasmtime';
      } else if (probes['runtime.wasmer']?.available) {
        toolName = 'runtime.wasmer';
      } else {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'No WASM runtime found. Install wasmtime or wasmer.',
              }),
            },
          ],
        };
      }
    } else {
      toolName = runtime === 'wasmer' ? 'runtime.wasmer' : 'runtime.wasmtime';
    }

    const runArgs =
      toolName === 'runtime.wasmtime'
        ? ['run', '--invoke', functionName, inputPath, ...fnArgs]
        : ['run', inputPath, '--invoke', functionName, '--', ...fnArgs];

    const result = await this.state.runner.run({
      tool: toolName,
      args: runArgs,
      timeoutMs,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: result.ok,
              runtime: toolName,
              functionName,
              args: fnArgs,
              output: result.stdout.trim(),
              stderr: result.stderr.trim() || undefined,
              exitCode: result.exitCode,
              durationMs: result.durationMs,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleWasmOptimize(args: Record<string, unknown>) {
    const inputPath = argStringRequired(args, 'inputPath');
    const outputPath = argString(args, 'outputPath');
    const level = argString(args, 'level', 'O2');

    let destPath: string;
    if (outputPath) {
      destPath = validateOutputPath(outputPath);
    } else {
      const { absolutePath } = await resolveArtifactPath({
        category: 'wasm',
        toolName: 'wasm-opt',
        ext: 'wasm',
      });
      destPath = absolutePath;
    }

    const result = await this.state.runner.run({
      tool: 'binaryen.wasm-opt',
      args: [`-${level}`, inputPath, '-o', destPath],
      timeoutMs: WASM_OPTIMIZE_TIMEOUT_MS,
    });

    if (!result.ok) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: result.stderr,
              exitCode: result.exitCode,
            }),
          },
        ],
      };
    }

    let inputSize = 0;
    let outputSize = 0;
    try {
      inputSize = (await stat(inputPath)).size;
      outputSize = (await stat(destPath)).size;
    } catch {
      /* ignore stat errors */
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              artifactPath: destPath,
              optimizationLevel: level,
              inputSizeBytes: inputSize,
              outputSizeBytes: outputSize,
              reductionPercent:
                inputSize > 0 ? ((1 - outputSize / inputSize) * 100).toFixed(1) : '0',
              durationMs: result.durationMs,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleWasmToC(args: Record<string, unknown>) {
    const inputPath = argStringRequired(args, 'inputPath');
    const outputDir = argString(args, 'outputDir');

    let destDir: string;
    if (outputDir) {
      destDir = validateOutputPath(outputDir);
    } else {
      const { absolutePath } = await resolveArtifactPath({
        category: 'wasm',
        toolName: 'wasm2c',
        ext: 'dir',
      });
      destDir = absolutePath;
    }

    await mkdir(destDir, { recursive: true });

    const baseName = resolve(inputPath).replace(/\.wasm$/i, '');
    const nameOnly = baseName.split(/[/\\]/).pop() || 'output';
    const cFile = join(destDir, `${nameOnly}.c`);
    const hFile = join(destDir, `${nameOnly}.h`);

    const result = await this.state.runner.run({
      tool: 'wabt.wasm2c',
      args: [inputPath, '-o', cFile],
      timeoutMs: WASM_TOOL_TIMEOUT_MS,
    });

    if (!result.ok) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: result.stderr,
              exitCode: result.exitCode,
            }),
          },
        ],
      };
    }

    let cSize = 0;
    let hSize = 0;
    try {
      cSize = (await stat(cFile)).size;
      hSize = (await stat(hFile)).size;
    } catch {
      /* header may not exist for all inputs */
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              outputDir: destDir,
              cFile,
              hFile,
              cSizeBytes: cSize,
              hSizeBytes: hSize,
              durationMs: result.durationMs,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleWasmDetectObfuscation(args: Record<string, unknown>) {
    const inputPath = argStringRequired(args, 'inputPath');
    const verbose = argBool(args, 'verbose', false);

    // First get WAT disassembly for text analysis
    const disasmResult = await this.state.runner.run({
      tool: 'wabt.wasm2wat',
      args: [inputPath],
      timeoutMs: WASM_TOOL_TIMEOUT_MS,
    });

    if (!disasmResult.ok) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `Failed to disassemble: ${disasmResult.stderr}`,
            }),
          },
        ],
      };
    }

    const wat = disasmResult.stdout;
    const detections: Array<{
      type: string;
      confidence: number;
      description: string;
      evidence?: string;
    }> = [];

    // Control flow flattening: dense br_table with many targets
    const brTableMatches = wat.match(/br_table\s+\([^)]+\)/g) || [];
    for (const match of brTableMatches) {
      const targets = match.split(/\s+/).length - 2;
      if (targets > 8) {
        detections.push({
          type: 'control-flow-flattening',
          confidence: Math.min(targets / 16, 1.0),
          description: `Large br_table with ${targets} targets — indicates CFF dispatcher`,
          ...(verbose ? { evidence: match.substring(0, 200) } : {}),
        });
      }
    }

    // Opaque predicates: constant condition branches
    const opaquePattern = /i32\.const\s+\d+\s+\n\s*\w+\s+\n\s*br_if/g;
    const opaqueMatches = wat.match(opaquePattern) || [];
    if (opaqueMatches.length > 5) {
      detections.push({
        type: 'opaque-predicates',
        confidence: Math.min(opaqueMatches.length / 20, 0.9),
        description: `${opaqueMatches.length} constant-condition branches — likely opaque predicates`,
        ...(verbose ? { evidence: opaqueMatches.slice(0, 3).join('\n---\n') } : {}),
      });
    }

    // Constant encoding: XOR/shift chains on i32 constants
    const xorChainCount = (wat.match(/i32\.xor/g) || []).length;
    const rotCount = (wat.match(/i32\.rotl|i32\.rotr/g) || []).length;
    const shiftCount = (wat.match(/i32\.shl|i32\.shr_[su]/g) || []).length;
    if (xorChainCount + rotCount + shiftCount > WASM_BITWISE_OPS_THRESHOLD) {
      detections.push({
        type: 'constant-encoding',
        confidence: Math.min((xorChainCount + rotCount + shiftCount) / 50, 0.9),
        description: `High density of bitwise ops (${xorChainCount} xor, ${shiftCount} shift, ${rotCount} rotate) — constant decoding`,
      });
    }

    // Dead code injection: unreachable blocks after unconditional br
    const deadCodePattern = /br\s+(?:\$\d+|\d+)\s*\n\s*(?!end\b|\))\S.*$/gm;
    const deadCodeMatches = wat.match(deadCodePattern) || [];
    if (deadCodeMatches.length > WASM_DEAD_CODE_MIN_MATCHES) {
      detections.push({
        type: 'dead-code-injection',
        confidence: Math.min(deadCodeMatches.length / 30, 0.85),
        description: `${deadCodeMatches.length} code blocks after unconditional branches`,
      });
    }

    // VM dispatch pattern: loop + br_table + local.get (program counter)
    const hasLoop = /\(loop/.test(wat);
    const hasBrTable = /br_table/.test(wat);
    const hasLocalGet = /local\.get\s+\d+/.test(wat);
    if (hasLoop && hasBrTable && hasLocalGet) {
      const loopCount = (wat.match(/\(loop/g) || []).length;
      if (loopCount > WASM_VM_DISPATCH_MIN_LOOPS) {
        detections.push({
          type: 'vm-dispatch',
          confidence: 0.75,
          description: `Loop + br_table + local.get pattern (${loopCount} loops) — possible WASM VM interpreter`,
        });
      }
    }

    // Code size vs function count ratio (bloated = likely obfuscated)
    const funcCount = (wat.match(/\(func\s/g) || []).length;
    const totalSize = wat.length;
    if (funcCount > 0 && totalSize / funcCount > 5000) {
      detections.push({
        type: 'code-bloat',
        confidence: 0.5,
        description: `Average ${(totalSize / funcCount).toFixed(0)} chars/function across ${funcCount} functions — unusually large`,
      });
    }

    const hasObfuscation = detections.length > 0;
    const maxConfidence = detections.reduce((max, d) => Math.max(max, d.confidence), 0);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              inputPath,
              hasObfuscation,
              overallConfidence: hasObfuscation ? maxConfidence : 0,
              detectionCount: detections.length,
              detections,
              summary: hasObfuscation
                ? `Detected ${detections.length} obfuscation pattern(s). Highest confidence: ${(maxConfidence * 100).toFixed(0)}%`
                : 'No obfuscation patterns detected.',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleWasmInstrumentTrace(args: Record<string, unknown>) {
    const inputPath = argStringRequired(args, 'inputPath');
    const allHooks = argBool(args, 'allHooks', true);
    const hookTypes = argStringArray(args, 'hooks');
    const outputPath = argString(args, 'outputPath');

    // First disassemble to WAT
    const disasmResult = await this.state.runner.run({
      tool: 'wabt.wasm2wat',
      args: [inputPath],
      timeoutMs: WASM_TOOL_TIMEOUT_MS,
    });

    if (!disasmResult.ok) {
      return {
        content: [
          { type: 'text', text: JSON.stringify({ success: false, error: disasmResult.stderr }) },
        ],
      };
    }

    const wat = disasmResult.stdout;
    const hooks = allHooks
      ? ['call', 'memory', 'branch', 'loop', 'local']
      : hookTypes.length > 0
        ? hookTypes
        : ['call'];

    // Count functions and exports for instrumentation scope
    const funcMatches = wat.match(/\(func\s/g) || [];
    const exportMatches = wat.match(/\(export/g) || [];
    const importMatches = wat.match(/\(import/g) || [];
    const tableMatches = wat.match(/\(table\b/g) || [];
    const callIndirectMatches = wat.match(/\bcall_indirect\b/g) || [];

    // Generate instrumentation wrapper (Wasabi-style)
    // Extract export names and import names from WAT for precise hook generation
    const exportNames: string[] = [];
    const importEntries: Array<{ module: string; name: string }> = [];
    const funcBodies: Array<{ name: string; params: string[]; results: string[] }> = [];
    const exportRe = /\(export\s+"([^"]+)"\s+\((\w+)\s+(\$?[\w.]+)\)\)/g;
    const funcSigRe = /\(func\s+(?:\(\$?(\w+)\))?\s*\(([^)]*)\)\s*(?:\(([^)]*)\))?/g;
    let em: RegExpExecArray | null;
    while ((em = exportRe.exec(wat)) !== null) {
      if (em[1]) exportNames.push(em[1]);
    }
    while ((em = funcSigRe.exec(wat)) !== null) {
      const fname = em[1] || `func_${funcBodies.length}`;
      const params = em[2] ? em[2].split(/\s+/).filter(Boolean) : [];
      const results = em[3] ? em[3].split(/\s+/).filter(Boolean) : [];
      funcBodies.push({ name: fname, params, results });
    }
    const importRe = /\(import\s+"([^"]+)"\s+"([^"]+)"/g;
    while ((em = importRe.exec(wat)) !== null) {
      if (em[1] && em[2]) {
        importEntries.push({ module: em[1], name: em[2] });
      }
    }

    // Shared: plain-object copy of exports that hooks can freely reassign.
    // WebAssembly.Instance.exports is frozen (non-writable, non-configurable),
    // so we must work on a separate object.
    const hookPreamble = `
  const hookedExports = {};
  for (const [k, v] of Object.entries(instance.exports)) { hookedExports[k] = v; }`;

    const hookInitCode: Record<string, string> = {
      call: `
  // === Call Hook: Proxy-based export wrapping for entry/exit logging ===
  const callLog = [];
  for (const [name, value] of Object.entries(instance.exports)) {
    if (typeof value === 'function') {
      hookedExports[name] = new Proxy(value, {
        apply(target, thisArg, argumentsList) {
          const entry = { type: 'call', name, args: argumentsList.map(String), timestamp: Date.now() };
          callLog.push(entry);
          try {
            const result = Reflect.apply(target, thisArg, argumentsList);
            callLog.push({ type: 'return', name, result: String(result), timestamp: Date.now() });
            return result;
          } catch (err) {
            callLog.push({ type: 'throw', name, error: String(err), timestamp: Date.now() });
            throw err;
          }
        }
      });
    }
  }`,
      memory: `
  // === Memory Hook: DataView-based memory access tracking ===
  const memoryLog = [];
  const originalMemory = instance.exports.memory || Object.values(instance.exports).find(e => e instanceof WebAssembly.Memory);
  const memTracker = { reads: 0, writes: 0, growEvents: [] };
  if (originalMemory) {
    const memSnapshot = () => {
      const view = new DataView(originalMemory.buffer);
      return { byteLength: view.byteLength, pages: view.byteLength / 65536 };
    };
    memTracker.snapshot = memSnapshot;
    const origGrow = originalMemory.grow?.bind(originalMemory);
    if (origGrow) {
      originalMemory.grow = function(delta) {
        const beforePages = originalMemory.buffer.byteLength / 65536;
        memoryLog.push({ op: 'grow', delta, beforePages, timestamp: Date.now() });
        memTracker.growEvents.push({ delta, beforePages });
        return origGrow(delta);
      };
    }
    // Wrap Memory in a Proxy that tracks buffer reads.
    // Assigned to hookedExports (a plain object), NOT instance.exports (which is frozen).
    const memProxy = new Proxy(originalMemory, {
      get(target, prop) {
        if (prop === 'buffer') {
          memTracker.reads++;
        }
        const val = Reflect.get(target, prop, target);
        return typeof val === 'function' ? val.bind(target) : val;
      }
    });
    const memExportName = Object.entries(instance.exports).find(([, v]) => v === originalMemory)?.[0] || 'memory';
    hookedExports[memExportName] = memProxy;
    memTracker.buffer = originalMemory.buffer;
  }`,
      branch: `
  // === Branch Hook: Tracks JS-visible WebAssembly.Table access only ===
  // Internal call_indirect dispatch stays inside the Wasm engine and is not observable from JS.
  const branchLog = [];
  for (const [tableName, table] of Object.entries(instance.exports)) {
    if (!(table instanceof WebAssembly.Table)) continue;
    const origGet = table.get.bind(table);
    const origGrow = table.grow?.bind(table);
    // Wrap Table in Proxy and assign to hookedExports (plain object).
    hookedExports[tableName] = new Proxy(table, {
        get(t, prop) {
          if (prop === 'get') {
            return (idx) => {
              branchLog.push({ type: 'table_get', table: tableName, index: idx, timestamp: Date.now() });
              return origGet(idx);
            };
          }
          if (prop === 'grow' && origGrow) {
            return (delta) => {
              branchLog.push({ type: 'table_grow', table: tableName, delta, timestamp: Date.now() });
              return origGrow(delta);
            };
          }
          const val = t[prop];
          return typeof val === 'function' ? val.bind(t) : val;
        }
      });
  }`,
      loop: `
  // === Loop Hook: Track iteration counts via independent call frequency analysis ===
  const loopLog = [];
  const loopCallCounts = {};
  const loopSource = hookedExports;
  for (const [name, value] of Object.entries(loopSource)) {
    if (typeof value === 'function') {
      hookedExports[name] = new Proxy(value, {
        apply(target, thisArg, args) {
          loopCallCounts[name] = (loopCallCounts[name] || 0) + 1;
          if (loopCallCounts[name] > 1) {
            loopLog.push({ type: 'loop-iteration', func: name, count: loopCallCounts[name], timestamp: Date.now() });
          }
          return Reflect.apply(target, thisArg, args);
        }
      });
    }
  }`,
      local: `
  // === Local Hook: Track Global export value changes via Proxy ===
  const localLog = [];
  for (const [globalName, global] of Object.entries(instance.exports)) {
    if (!(global instanceof WebAssembly.Global)) continue;
    hookedExports[globalName] = new Proxy(global, {
      get(target, prop) {
        if (prop === 'valueOf' || prop === Symbol.toPrimitive) {
          return (...args) => Reflect.apply(target.valueOf, target, args);
        }
        const val = Reflect.get(target, prop, target);
        if (prop === 'value' && typeof val === 'function') {
          return target.valueOf();
        }
        return typeof val === 'function' ? val.bind(target) : val;
      },
      set(target, prop, newValue) {
        if (prop === 'value') {
          const oldValue = target.valueOf();
          localLog.push({ type: 'global-set', name: globalName, oldValue, newValue, timestamp: Date.now() });
          target.value = newValue;
          return true;
        }
        return Reflect.set(target, prop, newValue, target);
      }
    });
  }`,
    };

    const activeHooks = hooks.filter((h) => h in hookInitCode);
    const activeHookCode =
      hookPreamble + '\n' + activeHooks.map((h) => hookInitCode[h]!).join('\n');

    const inputPathLiteral = JSON.stringify(inputPath);
    const importModules = [...new Set(importEntries.map(({ module }) => module))].filter(
      (moduleName) => moduleName !== 'env',
    );
    const importNamespaceCode = importModules
      .map((moduleName) => `    ${JSON.stringify(moduleName)}: {},`)
      .join('\n');
    const importStubCode = importEntries
      .map(({ module, name }) => {
        const safeModule = JSON.stringify(module);
        const safeName = JSON.stringify(name);
        return `if (!imports[${safeModule}]) imports[${safeModule}] = {};\n  if (!imports[${safeModule}][${safeName}]) imports[${safeModule}][${safeName}] = () => {};`;
      })
      .join('\n  ');
    const wrapper = `// WASM Instrumentation Wrapper (Wasabi-style)
// Generated by jshookmcp wasm_instrument_trace
// Hooks: ${activeHooks.join(', ')}
// Functions: ${funcMatches.length} | Exports: ${exportNames.join(', ') || 'none'} | Imports: ${importEntries.length}

(async function() {
  const wasmBytes = await fetch(${inputPathLiteral}).then(r => r.arrayBuffer());
  const module = await WebAssembly.compile(wasmBytes);

  // Provide required imports (env.abort, env.memory, etc.)
  const imports = {
    env: {
      abort: () => console.warn('[wasabi] abort called'),
      memory: new WebAssembly.Memory({ initial: 256, maximum: 1024 }),
      seed: () => Math.random(),
      'Math.log': Math.log,
      'Math.random': Math.random,
      console: { log: (...a) => console.log('[wasabi]', ...a) },
    },
${
  importNamespaceCode
    ? `${importNamespaceCode}
`
    : ''
}  };

  // Satisfy any detected import requirements
  ${importStubCode}

  const instance = await WebAssembly.instantiate(module, imports);

${activeHookCode}

  // Build the traced API surface (hookedExports is a plain object, safe to modify)
  const tracedExports = hookedExports;

  return {
    instance,
    exports: tracedExports,
    hooks: {
${activeHooks
  .map((h) => {
    const varName =
      h === 'call'
        ? 'callLog'
        : h === 'memory'
          ? 'memoryLog'
          : h === 'branch'
            ? 'branchLog'
            : h === 'loop'
              ? 'loopLog'
              : 'localLog';
    return `      ${h}: ${varName}`;
  })
  .join(',\n')}
    },
    stats: {
      functions: ${funcMatches.length},
      exports: ${exportMatches.length},
      imports: ${importMatches.length},
      exportNames: ${JSON.stringify(exportNames)},
      hookTypes: ${JSON.stringify(activeHooks)}
    }
  };
})();
`;

    let savedPath: string;
    if (outputPath) {
      const safePath = validateOutputPath(outputPath);
      await writeFile(safePath, wrapper, 'utf-8');
      savedPath = safePath;
    } else {
      const { absolutePath, displayPath } = await resolveArtifactPath({
        category: 'wasm',
        toolName: 'wasm-instrument',
        ext: 'js',
      });
      await writeFile(absolutePath, wrapper, 'utf-8');
      savedPath = displayPath;
    }

    const inputPathLooksLocal = isExplicitLocalFilePath(inputPath);
    const warnings = [
      inputPathLooksLocal
        ? 'Wrapper embeds the provided inputPath into browser-side fetch(). Local filesystem paths are not browser-accessible; provide an http(s) URL instead, or upload the module with wasm_dump and use the resulting URL.'
        : undefined,
      activeHooks.includes('branch') && callIndirectMatches.length > 0
        ? `Branch hook only observes JS-visible WebAssembly.Table access. This module contains ${callIndirectMatches.length} call_indirect site(s), which are dispatched inside the Wasm engine and will not appear in branch logs.`
        : undefined,
    ].filter((warning): warning is string => typeof warning === 'string' && warning.length > 0);
    const warning = warnings.length > 0 ? warnings.join(' ') : undefined;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              artifactPath: savedPath,
              hookTypes: activeHooks,
              functionCount: funcMatches.length,
              exportCount: exportMatches.length,
              importCount: importMatches.length,
              wrapperSizeBytes: wrapper.length,
              note: 'Wasabi-style instrumentation wrapper generated. Load in browser with WASM module to trace execution.',
              metadata: {
                inputPathKind: inputPathLooksLocal ? 'local-path' : 'url',
                wrapperFetchesBrowserUrl: true,
                ...(activeHooks.includes('branch')
                  ? {
                      branchHookMode: 'js-table-access-only',
                      callIndirectSites: callIndirectMatches.length,
                      tableCount: tableMatches.length,
                    }
                  : {}),
              },
              ...(warning ? { warning } : {}),
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
