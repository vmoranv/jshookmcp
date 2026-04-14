import type { PageController } from '@server/domains/shared/modules';
import type { DetailedDataManager } from '@utils/DetailedDataManager';
import { argString, argNumber, argBool, argStringArray } from '@server/domains/shared/parse-args';
import { applyEvaluationPostFilters } from '@server/domains/browser/handlers/evaluation-utils';

interface TargetEvaluationHandlersDeps {
  pageController: PageController;
  detailedDataManager: DetailedDataManager;
}

export class TargetEvaluationHandlers {
  constructor(private deps: TargetEvaluationHandlersDeps) {}

  async handleBrowserEvaluateCdpTarget(args: Record<string, unknown>) {
    const code = argString(args, 'script', '') || argString(args, 'code', '');
    const autoSummarize = argBool(args, 'autoSummarize', true);
    const maxSize = argNumber(args, 'maxSize', 51200);
    const fieldFilterArg = argStringArray(args, 'fieldFilter');
    const doStripBase64 = argBool(args, 'stripBase64', false);
    const returnByValue = argBool(args, 'returnByValue', true);
    const awaitPromise = argBool(args, 'awaitPromise', true);

    if (!code) {
      throw new Error('code is required');
    }

    const activeTarget = this.deps.pageController.getAttachedTargetInfo();
    if (!activeTarget) {
      throw new Error(
        'No CDP target is currently attached. Call browser_attach_cdp_target(targetId="...") first.',
      );
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

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              target: activeTarget,
              result: processedResult,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
