import type { ConsoleMonitor } from '@server/domains/shared/modules';
import type { DetailedDataManager } from '@utils/DetailedDataManager';
import { argString, argNumber, argBool } from '@server/domains/shared/parse-args';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { applyEvaluationPostFilters } from '@server/domains/browser/handlers/evaluation-utils';

interface ConsoleHandlersDeps {
  consoleMonitor: ConsoleMonitor;
  detailedDataManager: DetailedDataManager;
}

export class ConsoleHandlers {
  constructor(private deps: ConsoleHandlersDeps) {}

  async handleConsoleMonitor(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const action = argString(args, 'action') as 'enable' | 'disable';
      if (action === 'enable') {
        await this.deps.consoleMonitor.enable();
        return R.ok().build({ message: 'Console monitoring enabled' });
      } else {
        await this.deps.consoleMonitor.disable();
        return R.ok().build({ message: 'Console monitoring disabled' });
      }
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleConsoleGetLogs(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const type = argString(args, 'type') as NonNullable<
        Parameters<ConsoleMonitor['getLogs']>[0]
      >['type'];
      const limit = argNumber(args, 'limit') as number;
      const since = argNumber(args, 'since') as number;

      const logs = this.deps.consoleMonitor.getLogs({ type, limit, since });

      const result = {
        count: logs.length,
        logs,
      };

      const processedResult = this.deps.detailedDataManager.smartHandle(result, 51200);
      return R.ok()
        .merge(processedResult as Record<string, unknown>)
        .build();
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleConsoleExecute(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const expression = argString(args, 'expression', '');
      const maxSize = argNumber(args, 'maxSize', 10485760);
      const stripBase64 = argBool(args, 'stripBase64', false);

      if (!expression.trim()) {
        return R.fail('expression is required').build();
      }

      const raw = await this.deps.consoleMonitor.execute(expression);

      // Apply smartHandle + optional base64 stripping before returning.
      // This mirrors the post-processing in page_evaluate / browser_evaluate_cdp_target.
      const result = applyEvaluationPostFilters(raw, this.deps.detailedDataManager, {
        autoSummarize: true,
        maxSize,
        stripBase64,
      });

      return R.ok().build({ result });
    } catch (e) {
      return R.fail(e).build();
    }
  }
}
