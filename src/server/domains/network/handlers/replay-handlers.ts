/**
 * Replay and analysis handlers — auth extraction, HAR export, request replay.
 *
 * Extracted from AdvancedToolHandlersRuntime (handlers.impl.core.runtime.replay.ts).
 */

import { extractAuthFromRequests } from '@server/domains/network/auth-extractor';
import { buildHar } from '@server/domains/network/har';
import type { BuildHarParams } from '@server/domains/network/har';
import { replayRequest } from '@server/domains/network/replay';
import { handleSafe, R } from '@server/domains/shared/ResponseBuilder';
import type { ConsoleMonitor } from '@server/domains/shared/modules/collector';
import {
  parseReplayRequestArgs,
  writeHarToSafePath,
} from '@server/domains/network/handlers/replay-security';
import { getDetailedDataManager, parseBooleanArg, parseNumberArg } from './shared';

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

export interface ReplayHandlerDeps {
  consoleMonitor: ConsoleMonitor;
}

export class ReplayHandlers {
  private detailedDataManager = getDetailedDataManager();

  constructor(private deps: ReplayHandlerDeps) {}

  async handleNetworkExtractAuth(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const minConfidence = parseNumberArg(args.minConfidence, { defaultValue: 0.4 });
      const requests = this.deps.consoleMonitor.getNetworkRequests();

      if (requests.length === 0) {
        throw new Error(
          'No captured requests found. Call network_enable then page_navigate first.',
        );
      }

      const findings = extractAuthFromRequests(requests).filter(
        (f) => f.confidence >= minConfidence,
      );

      return {
        scannedRequests: requests.length,
        found: findings.length,
        findings,
        note: 'Values are masked (first 6 + last 4 chars). Use network_replay_request to test with actual values.',
      };
    });
  }

  async handleNetworkExportHar(args: Record<string, unknown>) {
    try {
      const outputPathValue = args.outputPath;
      if (outputPathValue !== undefined && typeof outputPathValue !== 'string') {
        return R.fail('outputPath must be a string').json();
      }
      const outputPath = outputPathValue?.trim() || undefined;
      const includeBodies = parseBooleanArg(args.includeBodies, false);

      const requests = this.deps.consoleMonitor.getNetworkRequests();

      if (requests.length === 0) {
        return R.fail(
          'No captured requests to export. Call network_enable then page_navigate first.',
        ).json();
      }

      const getResponse: BuildHarParams['getResponse'] = (id) =>
        this.deps.consoleMonitor.getNetworkActivity(id)?.response as ReturnType<
          BuildHarParams['getResponse']
        >;

      const har = await buildHar({
        requests,
        getResponse,
        getResponseBody: async (id) => {
          try {
            return await this.deps.consoleMonitor.getResponseBody(id);
          } catch {
            return null;
          }
        },
        includeBodies,
        creatorVersion: '1.0.0',
      });

      if (outputPath) {
        const resolvedOutputPath = await writeHarToSafePath(outputPath, har);
        return R.ok()
          .merge({
            message: `HAR exported to ${resolvedOutputPath}`,
            entryCount: har.log.entries.length,
            outputPath: resolvedOutputPath,
          })
          .json();
      }

      const result = this.detailedDataManager.smartHandle(
        {
          entryCount: har.log.entries.length,
          har,
        },
        51200,
      );

      return R.ok()
        .merge(result as unknown as Record<string, unknown>)
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleNetworkReplayRequest(args: Record<string, unknown>) {
    try {
      const parsedArgs = parseReplayRequestArgs(args);
      const requests = this.deps.consoleMonitor.getNetworkRequests();
      const base = requests.find(
        (request: unknown): request is ReplayableRequest =>
          isReplayableRequest(request) && request.requestId === parsedArgs.requestId,
      );

      if (!base) {
        return R.fail(`Request ${parsedArgs.requestId} not found in captured requests`)
          .set('hint', 'Use network_get_requests to see available request IDs')
          .json();
      }

      return handleSafe(async () => {
        const result = await replayRequest(base, parsedArgs);

        return result;
      });
    } catch (error) {
      return R.fail(error).json();
    }
  }
}
