import type { ScriptManager } from '@modules/debugger/ScriptManager';
import type { DetailedDataManager } from '@utils/DetailedDataManager';
import { argString, argNumber, argBool } from '@server/domains/shared/parse-args';
import { DETAILED_DATA_SMART_THRESHOLD_BYTES, SCRIPTS_MAX_CAP } from '@src/constants';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';

interface ScriptManagementHandlersDeps {
  scriptManager: ScriptManager;
  detailedDataManager: DetailedDataManager;
}

export class ScriptManagementHandlers {
  private deps: ScriptManagementHandlersDeps;
  constructor(deps: ScriptManagementHandlersDeps) {
    this.deps = deps;
  }

  async handleGetAllScripts(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const includeSource = argBool(args, 'includeSource', false);
      const maxScripts = Math.min(
        argNumber(args, 'maxScripts', includeSource ? 200 : 1000),
        SCRIPTS_MAX_CAP,
      );
      const scripts = await this.deps.scriptManager.getAllScripts(includeSource, maxScripts);
      return (await this.deps.detailedDataManager.smartHandle({
        count: scripts.length,
        scripts,
      })) as Record<string, unknown>;
    });
  }

  async handleGetScriptSource(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const scriptId = argString(args, 'scriptId');
      const url = argString(args, 'url');
      const preview = argBool(args, 'preview', true);
      const maxLines = argNumber(args, 'maxLines', 100);
      const startLine = argNumber(args, 'startLine');
      const endLine = argNumber(args, 'endLine');

      const script = await this.deps.scriptManager.getScriptSource(scriptId, url);
      if (!script) throw new Error('Script not found');

      if (preview || startLine !== undefined || endLine !== undefined) {
        const source = script.source || '';
        const lines = source.split('\n');
        const totalLines = lines.length;
        const size = source.length;

        let previewContent: string;
        let actualStartLine: number;
        let actualEndLine: number;

        if (startLine !== undefined && endLine !== undefined) {
          actualStartLine = Math.max(1, startLine);
          actualEndLine = Math.min(totalLines, endLine);
          previewContent = lines.slice(actualStartLine - 1, actualEndLine).join('\n');
        } else {
          actualStartLine = 1;
          actualEndLine = Math.min(maxLines, totalLines);
          previewContent = lines.slice(0, maxLines).join('\n');
        }

        return {
          scriptId: script.scriptId,
          url: script.url,
          preview: true,
          totalLines,
          size,
          sizeKB: (size / 1024).toFixed(1) + 'KB',
          showingLines: `${actualStartLine}-${actualEndLine}`,
          content: previewContent,
          hint:
            // Keep the hint threshold in sync with the smartHandle threshold
            // (DETAILED_DATA_SMART_THRESHOLD_BYTES, env-configurable).
            size > DETAILED_DATA_SMART_THRESHOLD_BYTES
              ? `Script is large (${(size / 1024).toFixed(1)}KB). Use startLine/endLine to get specific sections, or ` +
                `set preview=false to get full source (will return detailId).`
              : 'Set preview=false to get full source',
        };
      }

      return (await this.deps.detailedDataManager.smartHandle(script)) as unknown as Record<
        string,
        unknown
      >;
    });
  }
}
