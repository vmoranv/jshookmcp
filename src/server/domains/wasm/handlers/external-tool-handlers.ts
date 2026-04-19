/**
 * External tool sub-handler — disassemble, decompile, inspectSections, offlineRun, optimize.
 */

import { writeFile, stat } from 'node:fs/promises';
import { resolveArtifactPath } from '@utils/artifacts';
import {
  argNumber,
  argString,
  argStringRequired,
  argBool,
  argStringArray,
} from '@server/domains/shared/parse-args';
import { WASM_OPTIMIZE_TIMEOUT_MS, WASM_TOOL_TIMEOUT_MS } from '@src/constants';
import type { WasmSharedState } from './shared';
import { validateOutputPath } from './shared';

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
}
