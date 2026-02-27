import type { ScriptManager } from '../../../../modules/debugger/ScriptManager.js';
import type { DetailedDataManager } from '../../../../utils/DetailedDataManager.js';

interface ScriptManagementHandlersDeps {
  scriptManager: ScriptManager;
  detailedDataManager: DetailedDataManager;
}

export class ScriptManagementHandlers {
  constructor(private deps: ScriptManagementHandlersDeps) {}

  async handleGetAllScripts(args: Record<string, unknown>) {
    const includeSource = (args.includeSource as boolean) ?? false;

    const scripts = await this.deps.scriptManager.getAllScripts(includeSource);

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
    const scriptId = args.scriptId as string | undefined;
    const url = args.url as string | undefined;
    const preview = (args.preview as boolean) ?? false;
    const maxLines = (args.maxLines as number) ?? 100;
    const startLine = args.startLine as number | undefined;
    const endLine = args.endLine as number | undefined;

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
