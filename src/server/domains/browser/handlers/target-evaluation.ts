import type { PageController } from '@server/domains/shared/modules';
import type { DetailedDataManager } from '@utils/DetailedDataManager';
import { argString, argNumber, argBool, argStringArray } from '@server/domains/shared/parse-args';
import { applyEvaluationPostFilters } from '@server/domains/browser/handlers/evaluation-utils';
import { R, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { logger } from '@utils/logger';

interface TargetEvaluationHandlersDeps {
  pageController: PageController;
  detailedDataManager: DetailedDataManager;
}

export class TargetEvaluationHandlers {
  constructor(private deps: TargetEvaluationHandlersDeps) {}

  async handleBrowserEvaluateCdpTarget(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const code = argString(args, 'script', '') || argString(args, 'code', '');
      const autoSummarize = argBool(args, 'autoSummarize', true);
      const maxSize = argNumber(args, 'maxSize', 51200);
      const fieldFilterArg = argStringArray(args, 'fieldFilter');
      const doStripBase64 = argBool(args, 'stripBase64', false);
      const returnByValue = argBool(args, 'returnByValue', true);
      const awaitPromise = argBool(args, 'awaitPromise', true);

      if (!code) {
        return R.fail('code is required').build();
      }

      const activeTarget = this.deps.pageController.getAttachedTargetInfo();
      if (!activeTarget) {
        return R.fail(
          'No CDP target is currently attached. Call browser_attach_cdp_target(targetId="...") first.',
        ).build();
      }

      const rawResult = await this.deps.pageController.evaluateAttachedTarget(code, {
        returnByValue,
        awaitPromise,
      });

      const processedResult = applyEvaluationPostFilters(rawResult, this.deps.detailedDataManager, {
        autoSummarize,
        maxSize,
        fieldFilter: fieldFilterArg ?? undefined,
        stripBase64: doStripBase64,
      });

      return R.ok().build({
        target: activeTarget,
        result: processedResult,
      });
    } catch (error) {
      logger.error('Failed to evaluate in CDP target:', error);
      return R.fail(error instanceof Error ? error.message : String(error)).build();
    }
  }
}
