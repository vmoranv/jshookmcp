import {
  argNumber,
  argString,
  argStringArray,
  argStringRequired,
} from '@server/domains/shared/parse-args';
import { WASM_OPTIMIZE_TIMEOUT_MS } from '@src/constants';
import { ExternalToolHandlersBase } from './external-base';

export class ExternalRuntimeHandlers extends ExternalToolHandlersBase {
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
        return this.fail('No WASM runtime found. Install wasmtime or wasmer.');
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

    return this.ok({
      runtime: toolName,
      functionName,
      args: fnArgs,
      output: result.stdout.trim(),
      stderr: result.stderr.trim() || undefined,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      success: result.ok,
    });
  }

  async handleWasmOptimize(args: Record<string, unknown>) {
    const inputPath = argStringRequired(args, 'inputPath');
    const outputPath = argString(args, 'outputPath');
    const level = argString(args, 'level', 'O2');
    const destPath = await this.resolveArtifactOutputPath({
      outputPath,
      artifact: {
        category: 'wasm',
        toolName: 'wasm-opt',
        ext: 'wasm',
      },
      pathMode: 'absolute',
    });

    const result = await this.state.runner.run({
      tool: 'binaryen.wasm-opt',
      args: [`-${level}`, inputPath, '-o', destPath],
      timeoutMs: WASM_OPTIMIZE_TIMEOUT_MS,
    });

    if (!result.ok) {
      return this.fail(result.stderr, result.exitCode ?? undefined);
    }

    const inputSize = await this.tryStatSize(inputPath);
    const outputSize = await this.tryStatSize(destPath);

    return this.ok({
      artifactPath: destPath,
      optimizationLevel: level,
      inputSizeBytes: inputSize,
      outputSizeBytes: outputSize,
      reductionPercent: inputSize > 0 ? ((1 - outputSize / inputSize) * 100).toFixed(1) : '0',
      durationMs: result.durationMs,
    });
  }
}
