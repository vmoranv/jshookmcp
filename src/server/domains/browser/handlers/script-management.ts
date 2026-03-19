import type { ScriptManager } from '@server/domains/shared/modules';
import type { DetailedDataManager } from '@utils/DetailedDataManager';
import { argString, argNumber, argBool } from '@server/domains/shared/parse-args';
import { SCRIPTS_MAX_CAP } from '@src/constants';

interface ScriptManagementHandlersDeps {
  scriptManager: ScriptManager;
  detailedDataManager: DetailedDataManager;
}

export class ScriptManagementHandlers {
  constructor(private deps: ScriptManagementHandlersDeps) {}

  async handleGetAllScripts(args: Record<string, unknown>) {
    const includeSource = argBool(args, 'includeSource', false);
    const MAX_SCRIPTS_CAP = SCRIPTS_MAX_CAP;
    const maxScripts = Math.min(
      argNumber(args, 'maxScripts', includeSource ? 200 : 1000),
      MAX_SCRIPTS_CAP
    );

    const scripts = await this.deps.scriptManager.getAllScripts(includeSource, maxScripts);

    const data = { count: scripts.length, scripts };
    const processed = this.deps.detailedDataManager.smartHandle(data);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(processed, null, 2),
        },
      ],
    };
  }

  async handleGetScriptSource(args: Record<string, unknown>) {
    const scriptId = argString(args, 'scriptId');
    const url = argString(args, 'url');
    const preview = argBool(args, 'preview', false);
    const maxLines = argNumber(args, 'maxLines', 100);
    const startLine = argNumber(args, 'startLine');
    const endLine = argNumber(args, 'endLine');

    const script = await this.deps.scriptManager.getScriptSource(scriptId, url);

    if (!script) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'Script not found',
              },
              null,
              2
            ),
          },
        ],
      };
    }

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

      const result = {
        success: true,
        scriptId: script.scriptId,
        url: script.url,
        preview: true,
        totalLines,
        size,
        sizeKB: (size / 1024).toFixed(1) + 'KB',
        showingLines: `${actualStartLine}-${actualEndLine}`,
        content: previewContent,
        hint:
          size > 51200
            ? `Script is large (${(size / 1024).toFixed(1)}KB). Use startLine/endLine to get specific sections, or set preview=false to get full source (will return detailId).`
            : 'Set preview=false to get full source',
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    const processedScript = this.deps.detailedDataManager.smartHandle(script, 51200);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(processedScript, null, 2),
        },
      ],
    };
  }
}
