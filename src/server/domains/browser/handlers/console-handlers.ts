import type { ConsoleMonitor } from '@server/domains/shared/modules';
import type { DetailedDataManager } from '@utils/DetailedDataManager';
import { argString, argNumber } from '@server/domains/shared/parse-args';

interface ConsoleHandlersDeps {
  consoleMonitor: ConsoleMonitor;
  detailedDataManager: DetailedDataManager;
}

export class ConsoleHandlers {
  constructor(private deps: ConsoleHandlersDeps) {}

  async handleConsoleEnable(_args: Record<string, unknown>) {
    await this.deps.consoleMonitor.enable();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Console monitoring enabled',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleConsoleGetLogs(args: Record<string, unknown>) {
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

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(processedResult, null, 2),
        },
      ],
    };
  }

  async handleConsoleExecute(args: Record<string, unknown>) {
    const expression = argString(args, 'expression', '');

    const result = await this.deps.consoleMonitor.execute(expression);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              result,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
