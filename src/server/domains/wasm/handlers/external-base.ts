import { stat, writeFile } from 'node:fs/promises';
import { resolveArtifactPath } from '@utils/artifacts';
import type { ArtifactCategory } from '@utils/artifacts';
import type { WasmSharedState } from './shared';
import { validateOutputPath } from './shared';

interface ArtifactTargetOptions {
  category: ArtifactCategory;
  toolName: string;
  ext: string;
  target?: string;
}

type ArtifactPathMode = 'absolute' | 'display';

type TextToolResponse = {
  content: Array<{
    type: 'text';
    text: string;
  }>;
};

export class ExternalToolHandlersBase {
  constructor(protected readonly state: WasmSharedState) {}

  protected ok(payload: Record<string, unknown>): TextToolResponse {
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true, ...payload }, null, 2) }],
    };
  }

  protected fail(error: string, exitCode?: number): TextToolResponse {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              error,
              ...(exitCode === undefined ? {} : { exitCode }),
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  protected async writeTextArtifact(options: {
    outputPath?: string;
    artifact: ArtifactTargetOptions;
    content: string;
    pathMode?: ArtifactPathMode;
  }): Promise<string> {
    const { outputPath, artifact, content, pathMode = 'display' } = options;
    if (outputPath) {
      const safePath = validateOutputPath(outputPath);
      await writeFile(safePath, content, 'utf-8');
      return safePath;
    }

    const { absolutePath, displayPath } = await resolveArtifactPath(artifact);
    await writeFile(absolutePath, content, 'utf-8');
    return pathMode === 'absolute' ? absolutePath : displayPath;
  }

  protected async resolveArtifactOutputPath(options: {
    outputPath?: string;
    artifact: ArtifactTargetOptions;
    pathMode?: ArtifactPathMode;
  }): Promise<string> {
    const { outputPath, artifact, pathMode = 'absolute' } = options;
    if (outputPath) {
      return validateOutputPath(outputPath);
    }

    const { absolutePath, displayPath } = await resolveArtifactPath(artifact);
    return pathMode === 'display' ? displayPath : absolutePath;
  }

  protected preview(text: string, maxLines: number): string {
    const lines = text.split('\n');
    return (
      lines.slice(0, maxLines).join('\n') + (lines.length > maxLines ? '\n... (truncated)' : '')
    );
  }

  protected async tryStatSize(path: string): Promise<number> {
    try {
      return (await stat(path)).size;
    } catch {
      return 0;
    }
  }
}
