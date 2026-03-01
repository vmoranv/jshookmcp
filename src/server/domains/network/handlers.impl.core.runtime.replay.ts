import { promises as fs } from 'node:fs';
import { extractAuthFromRequests } from './auth-extractor.js';
import { buildHar } from './har.js';
import type { BuildHarParams } from './har.js';
import { replayRequest } from './replay.js';
import { AdvancedToolHandlersConsole } from './handlers.impl.core.runtime.console.js';

interface ReplayableRequest {
  requestId: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  postData?: string;
}

const isReplayableRequest = (value: unknown): value is ReplayableRequest => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.requestId === 'string' &&
    typeof record.url === 'string' &&
    typeof record.method === 'string'
  );
};

export class AdvancedToolHandlersRuntime extends AdvancedToolHandlersConsole {
  async handleNetworkExtractAuth(args: Record<string, unknown>) {
    const minConfidence = (args.minConfidence as number) ?? 0.4;
    const requests = this.consoleMonitor.getNetworkRequests();

    if (requests.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: 'No captured requests found. Call network_enable then page_navigate first.',
          }, null, 2),
        }],
      };
    }

    const findings = extractAuthFromRequests(requests).filter((f) => f.confidence >= minConfidence);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          scannedRequests: requests.length,
          found: findings.length,
          findings,
          note: 'Values are masked (first 6 + last 4 chars). Use network_replay_request to test with actual values.',
        }, null, 2),
      }],
    };
  }

  async handleNetworkExportHar(args: Record<string, unknown>) {
    const outputPath = args.outputPath as string | undefined;
    const includeBodies = (args.includeBodies as boolean) ?? false;

    let resolvedOutputPath: string | undefined;
    if (outputPath) {
      const path = await import('node:path');
      const fsDynamic = await import('node:fs/promises');
      const resolved = path.resolve(outputPath);
      const cwd = await fsDynamic.realpath(process.cwd());
      const tmpDir = await fsDynamic.realpath((await import('node:os')).tmpdir());
      const parentDir = path.dirname(resolved);
      let realParent: string;
      try {
        realParent = await fsDynamic.realpath(parentDir);
      } catch {
        realParent = parentDir;
      }
      const realPath = path.join(realParent, path.basename(resolved));
      const inCwd = realPath === cwd || realPath.startsWith(cwd + path.sep);
      const inTmp = realPath === tmpDir || realPath.startsWith(tmpDir + path.sep);
      if (!inCwd && !inTmp) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'outputPath must be within the current working directory or system temp dir.',
            }, null, 2),
          }],
        };
      }
      resolvedOutputPath = realPath;
    }

    const requests = this.consoleMonitor.getNetworkRequests();

    if (requests.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: 'No captured requests to export. Call network_enable then page_navigate first.',
          }, null, 2),
        }],
      };
    }

    try {
      const getResponse: BuildHarParams['getResponse'] = (id) =>
        this.consoleMonitor.getNetworkActivity(id)?.response as ReturnType<BuildHarParams['getResponse']>;

      const har = await buildHar({
        requests,
        getResponse,
        getResponseBody: async (id) => {
          try {
            return await this.consoleMonitor.getResponseBody(id);
          } catch {
            return null;
          }
        },
        includeBodies,
        creatorVersion: '1.0.0',
      });

      if (resolvedOutputPath) {
        try {
          const stat = await fs.lstat(resolvedOutputPath);
          if (stat.isSymbolicLink()) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ success: false, error: 'outputPath must not be a symbolic link.' }, null, 2),
              }],
            };
          }
        } catch {
          // File doesn't exist yet
        }

        await fs.writeFile(resolvedOutputPath, JSON.stringify(har, null, 2), 'utf-8');
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `HAR exported to ${resolvedOutputPath}`,
              entryCount: har.log.entries.length,
              outputPath: resolvedOutputPath,
            }, null, 2),
          }],
        };
      }

      const result = this.detailedDataManager.smartHandle(
        {
          success: true,
          entryCount: har.log.entries.length,
          har,
        },
        51200
      );

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }, null, 2),
        }],
      };
    }
  }

  async handleNetworkReplayRequest(args: Record<string, unknown>) {
    const requestId = args.requestId as string;
    if (!requestId) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: false, error: 'requestId is required' }, null, 2),
        }],
      };
    }

    const requests = this.consoleMonitor.getNetworkRequests();
    const base = requests.find(
      (request: unknown): request is ReplayableRequest =>
        isReplayableRequest(request) && request.requestId === requestId
    );

    if (!base) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Request ${requestId} not found in captured requests`,
            hint: 'Use network_get_requests to list available requestIds',
          }, null, 2),
        }],
      };
    }

    try {
      const result = await replayRequest(base, {
        requestId,
        headerPatch: args.headerPatch as Record<string, string> | undefined,
        bodyPatch: args.bodyPatch as string | undefined,
        methodOverride: args.methodOverride as string | undefined,
        urlOverride: args.urlOverride as string | undefined,
        timeoutMs: args.timeoutMs as number | undefined,
        dryRun: args.dryRun !== false,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, ...result }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }, null, 2),
        }],
      };
    }
  }
}
