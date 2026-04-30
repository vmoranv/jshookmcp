import { writeFile } from 'node:fs/promises';
import {
  argBool,
  argString,
  argStringArray,
  argStringRequired,
} from '@server/domains/shared/parse-args';
import {
  WASM_BITWISE_OPS_THRESHOLD,
  WASM_DEAD_CODE_MIN_MATCHES,
  WASM_TOOL_TIMEOUT_MS,
  WASM_VM_DISPATCH_MIN_LOOPS,
} from '@src/constants';
import { validateOutputPath } from './shared';
import { ExternalToolHandlersBase } from './external-base';

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

export class ExternalAnalysisHandlers extends ExternalToolHandlersBase {
  async handleWasmDetectObfuscation(args: Record<string, unknown>) {
    const inputPath = argStringRequired(args, 'inputPath');
    const verbose = argBool(args, 'verbose', false);

    const disasmResult = await this.state.runner.run({
      tool: 'wabt.wasm2wat',
      args: [inputPath],
      timeoutMs: WASM_TOOL_TIMEOUT_MS,
    });

    if (!disasmResult.ok) {
      return this.fail(`Failed to disassemble: ${disasmResult.stderr}`);
    }

    const wat = disasmResult.stdout;
    const detections: Array<{ type: string; confidence: number; description: string }> = [];

    const brTableCount = (wat.match(/br_table/g) || []).length;
    if (brTableCount > 5) {
      detections.push({
        type: 'control-flow-flattening',
        confidence: Math.min(brTableCount / 20, 0.95),
        description: `${brTableCount} br_table dispatches detected — likely flattened control flow`,
      });
    }

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

    const deadCodePattern = /br\s+(?:\$\d+|\d+)\s*\n\s*(?!end\b|\))\S.*$/gm;
    const deadCodeMatches = wat.match(deadCodePattern) || [];
    if (deadCodeMatches.length > WASM_DEAD_CODE_MIN_MATCHES) {
      detections.push({
        type: 'dead-code-injection',
        confidence: Math.min(deadCodeMatches.length / 30, 0.85),
        description: `${deadCodeMatches.length} code blocks after unconditional branches`,
      });
    }

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
    const maxConfidence = detections.reduce(
      (max, detection) => Math.max(max, detection.confidence),
      0,
    );

    return this.ok({
      inputPath,
      hasObfuscation,
      overallConfidence: hasObfuscation ? maxConfidence : 0,
      detectionCount: detections.length,
      detections,
      summary: hasObfuscation
        ? `Detected ${detections.length} obfuscation pattern(s). Highest confidence: ${(maxConfidence * 100).toFixed(0)}%`
        : 'No obfuscation patterns detected.',
      ...(verbose ? { watPreview: this.preview(wat, 200) } : {}),
    });
  }

  async handleWasmInstrumentTrace(args: Record<string, unknown>) {
    const inputPath = argStringRequired(args, 'inputPath');
    const allHooks = argBool(args, 'allHooks', true);
    const hookTypes = argStringArray(args, 'hooks');
    const outputPath = argString(args, 'outputPath');

    const disasmResult = await this.state.runner.run({
      tool: 'wabt.wasm2wat',
      args: [inputPath],
      timeoutMs: WASM_TOOL_TIMEOUT_MS,
    });

    if (!disasmResult.ok) {
      return this.fail(disasmResult.stderr);
    }

    const wat = disasmResult.stdout;
    const hooks = allHooks
      ? ['call', 'memory', 'branch', 'loop', 'local']
      : hookTypes.length > 0
        ? hookTypes
        : ['call'];

    const funcMatches = wat.match(/\(func\s/g) || [];
    const exportMatches = wat.match(/\(export/g) || [];
    const importMatches = wat.match(/\(import/g) || [];
    const tableMatches = wat.match(/\(table\b/g) || [];
    const callIndirectMatches = wat.match(/\bcall_indirect\b/g) || [];

    const exportNames: string[] = [];
    const importEntries: Array<{ module: string; name: string }> = [];
    const exportRe = /\(export\s+"([^"]+)"\s+\((\w+)\s+(\$?[\w.]+)\)\)/g;
    const importRe = /\(import\s+"([^"]+)"\s+"([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = exportRe.exec(wat)) !== null) {
      if (match[1]) {
        exportNames.push(match[1]);
      }
    }
    while ((match = importRe.exec(wat)) !== null) {
      if (match[1] && match[2]) {
        importEntries.push({ module: match[1], name: match[2] });
      }
    }

    const hookPreamble = `
  const hookedExports = {};
  for (const [k, v] of Object.entries(instance.exports)) { hookedExports[k] = v; }`;

    const hookInitCode: Record<string, string> = {
      call: `
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

    const activeHooks = hooks.filter((hook) => hook in hookInitCode);
    const activeHookCode =
      hookPreamble + '\n' + activeHooks.map((hook) => hookInitCode[hook]!).join('\n');

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

  const imports = {
    env: {
      abort: () => console.warn('[wasabi] abort called'),
      memory: new WebAssembly.Memory({ initial: 256, maximum: 1024 }),
      seed: () => Math.random(),
      'Math.log': Math.log,
      'Math.random': Math.random,
      console: { log: (...a) => console.log('[wasabi]', ...a) },
    },
${importNamespaceCode ? `${importNamespaceCode}\n` : ''}  };

  ${importStubCode}

  const instance = await WebAssembly.instantiate(module, imports);

${activeHookCode}

  const tracedExports = hookedExports;

  return {
    instance,
    exports: tracedExports,
    hooks: {
${activeHooks
  .map((hook) => {
    const varName =
      hook === 'call'
        ? 'callLog'
        : hook === 'memory'
          ? 'memoryLog'
          : hook === 'branch'
            ? 'branchLog'
            : hook === 'loop'
              ? 'loopLog'
              : 'localLog';
    return `      ${hook}: ${varName}`;
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
      savedPath = await this.writeTextArtifact({
        artifact: {
          category: 'wasm',
          toolName: 'wasm-instrument',
          ext: 'js',
        },
        content: wrapper,
      });
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

    return this.ok({
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
    });
  }
}
