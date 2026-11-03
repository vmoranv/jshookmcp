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
import { buildWasmHookCode } from './wasm-instrument-helper';
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
        description:
          `High density of bitwise ops (${xorChainCount} xor, ${shiftCount} shift, ${rotCount} ` +
          `rotate) — constant ` +
          `decoding`,
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
        description:
          `Average ${(totalSize / funcCount).toFixed(0)} chars/function across ${funcCount} ` +
          `functions — unusually ` +
          `large`,
      });
    }

    // call_indirect density: high call_indirect ratio suggests VM dispatch table
    const callIndirectCount = (wat.match(/\bcall_indirect\b/g) || []).length;
    const callDirectCount = (wat.match(/\bcall\s+(?!indirect)/g) || []).length;
    if (callIndirectCount > 3 && callIndirectCount >= callDirectCount * 0.3) {
      detections.push({
        type: 'indirect-call-dispatch',
        confidence: Math.min(callIndirectCount / 15, 0.85),
        description:
          `${callIndirectCount} call_indirect vs ${callDirectCount} direct calls — ` +
          `indirect call ratio suggests dispatch-based VM or obfuscation`,
      });
    }

    // Import pattern: obfuscated modules often import env with unusual functions
    const importEnvMatches = wat.match(/\(import\s+"env"\s+"(\w+)"/g) || [];
    const importedFunctions = importEnvMatches.map((m) => m.split('"')[3] ?? '');
    const nonStubImports = importedFunctions.filter(
      (f) => !['memory', 'table', '__linear_memory', '__indirect_function_table'].includes(f),
    );
    if (nonStubImports.length > 20) {
      detections.push({
        type: 'large-import-surface',
        confidence: Math.min(nonStubImports.length / 50, 0.7),
        description: `${nonStubImports.length} env imports — large import surface typical of obfuscated/wrapped modules`,
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
        ? `Detected ${detections.length} obfuscation pattern(s). Highest confidence: ` +
          `${(maxConfidence * 100).toFixed(0)}%`
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

    const { activeHooks, activeHookCode } = buildWasmHookCode(hooks);

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
        return (
          `if (!imports[${safeModule}]) imports[${safeModule}] = {};\n  if (!imports[${safeModule}][` +
          `${safeName}]) ` +
          `imports[${safeModule}][${safeName}] = () => {};`
        );
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
      const safePath = await validateOutputPath(outputPath);
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
        ? 'Wrapper embeds the provided inputPath into browser-side fetch(). Local filesystem paths are not ' +
          'browser-accessible; provide an http(s) URL instead, or upload the module with wasm_dump and use the ' +
          'resulting URL.'
        : undefined,
      activeHooks.includes('branch') && callIndirectMatches.length > 0
        ? `Branch hook only observes JS-visible WebAssembly.Table access. This module contains ` +
          `${callIndirectMatches.length} call_indirect site(s), which are dispatched inside the Wasm engine and will ` +
          `not appear in branch logs.`
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
