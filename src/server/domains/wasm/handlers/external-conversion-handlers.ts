import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { argBool, argString, argStringRequired } from '@server/domains/shared/parse-args';
import { WASM_TOOL_TIMEOUT_MS } from '@src/constants';
import { ExternalToolHandlersBase } from './external-base';

export class ExternalConversionHandlers extends ExternalToolHandlersBase {
  async handleWasmDisassemble(args: Record<string, unknown>) {
    const inputPath = argStringRequired(args, 'inputPath');
    const outputPath = argString(args, 'outputPath');
    const foldExprs = argBool(args, 'foldExprs', true);

    const toolArgs = [inputPath, '-o', '/dev/stdout'];
    if (foldExprs) {
      toolArgs.push('--fold-exprs');
    }

    const result = await this.state.runner.run({
      tool: 'wabt.wasm2wat',
      args: toolArgs,
      timeoutMs: WASM_TOOL_TIMEOUT_MS,
    });

    if (!result.ok) {
      return this.fail(result.stderr, result.exitCode ?? undefined);
    }

    const savedPath = await this.writeTextArtifact({
      outputPath,
      artifact: {
        category: 'wasm',
        toolName: 'wasm-disassemble',
        ext: 'wat',
      },
      content: result.stdout,
    });

    return this.ok({
      artifactPath: savedPath,
      totalLines: result.stdout.split('\n').length,
      sizeBytes: result.stdout.length,
      preview: this.preview(result.stdout, 50),
      durationMs: result.durationMs,
    });
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
      return this.fail(result.stderr, result.exitCode ?? undefined);
    }

    const savedPath = await this.writeTextArtifact({
      outputPath,
      artifact: {
        category: 'wasm',
        toolName: 'wasm-decompile',
        ext: 'dcmp',
      },
      content: result.stdout,
    });

    return this.ok({
      artifactPath: savedPath,
      totalLines: result.stdout.split('\n').length,
      preview: this.preview(result.stdout, 60),
      durationMs: result.durationMs,
    });
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
      return this.fail(result.stderr, result.exitCode ?? undefined);
    }

    return this.ok({
      totalLines: result.stdout.split('\n').length,
      preview: this.preview(result.stdout, 100),
      durationMs: result.durationMs,
    });
  }

  async handleWasmToC(args: Record<string, unknown>) {
    const inputPath = argStringRequired(args, 'inputPath');
    const outputDir = argString(args, 'outputDir');
    const destDir = await this.resolveArtifactOutputPath({
      outputPath: outputDir,
      artifact: {
        category: 'wasm',
        toolName: 'wasm2c',
        ext: 'dir',
      },
      pathMode: 'absolute',
    });

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
      return this.fail(result.stderr, result.exitCode ?? undefined);
    }

    return this.ok({
      outputDir: destDir,
      cFile,
      hFile,
      cSizeBytes: await this.tryStatSize(cFile),
      hSizeBytes: await this.tryStatSize(hFile),
      durationMs: result.durationMs,
    });
  }
}
