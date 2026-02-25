import type { ConsoleMonitor } from '../../../../modules/monitor/ConsoleMonitor.js';
import type { DetailedDataManager } from '../../../../utils/DetailedDataManager.js';

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
    const type = args.type as any;
    const limit = args.limit as number;
    const since = args.since as number;

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
    const expression = args.expression as string;

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
