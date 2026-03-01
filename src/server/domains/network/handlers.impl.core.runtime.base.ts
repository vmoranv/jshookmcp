import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';
import type { ConsoleMonitor } from '../../../modules/monitor/ConsoleMonitor.js';
import { PerformanceMonitor } from '../../../modules/monitor/PerformanceMonitor.js';
import { DetailedDataManager } from '../../../utils/DetailedDataManager.js';

export class AdvancedToolHandlersBase {
  protected performanceMonitor: PerformanceMonitor | null = null;
  protected detailedDataManager: DetailedDataManager;

  constructor(
    protected collector: CodeCollector,
    protected consoleMonitor: ConsoleMonitor
  ) {
    this.detailedDataManager = DetailedDataManager.getInstance();
  }

  protected getPerformanceMonitor(): PerformanceMonitor {
    if (!this.performanceMonitor) {
      this.performanceMonitor = new PerformanceMonitor(this.collector);
    }
    return this.performanceMonitor;
  }

  protected parseBooleanArg(value: unknown, defaultValue: boolean): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
      return defaultValue;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
    return defaultValue;
  }

  protected parseNumberArg(
    value: unknown,
    options: { defaultValue: number; min?: number; max?: number; integer?: boolean }
  ): number {
    let parsed: number | undefined;
    if (typeof value === 'number' && Number.isFinite(value)) {
      parsed = value;
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        const n = Number(trimmed);
        if (Number.isFinite(n)) {
          parsed = n;
        }
      }
    }
    if (parsed === undefined) {
      parsed = options.defaultValue;
    }
    if (options.integer) {
      parsed = Math.trunc(parsed);
    }
    if (typeof options.min === 'number') {
      parsed = Math.max(options.min, parsed);
    }
    if (typeof options.max === 'number') {
      parsed = Math.min(options.max, parsed);
    }
    return parsed;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected async ensureNetworkEnabled(options: {
    autoEnable: boolean;
    enableExceptions: boolean;
  }): Promise<{ enabled: boolean; autoEnabled: boolean; error?: string }> {
    if (this.consoleMonitor.isNetworkEnabled()) {
      return { enabled: true, autoEnabled: false };
    }

    if (!options.autoEnable) {
      return { enabled: false, autoEnabled: false };
    }

    try {
      await this.consoleMonitor.enable({
        enableNetwork: true,
        enableExceptions: options.enableExceptions,
      });
      return {
        enabled: this.consoleMonitor.isNetworkEnabled(),
        autoEnabled: true,
      };
    } catch (error) {
      return {
        enabled: false,
        autoEnabled: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async handleNetworkEnable(args: Record<string, unknown>) {
    const enableExceptions = this.parseBooleanArg(args.enableExceptions, true);

    await this.consoleMonitor.enable({
      enableNetwork: true,
      enableExceptions,
    });

    const status = this.consoleMonitor.getNetworkStatus();

    const result = {
      success: true,
      message: ' Network monitoring enabled successfully',
      enabled: status.enabled,
      cdpSessionActive: status.cdpSessionActive,
      listenerCount: status.listenerCount,
      usage: {
        step1: 'Network monitoring is now active',
        step2: 'Navigate to a page using page_navigate tool',
        step3: 'Use network_get_requests to retrieve captured requests',
        step4: 'Use network_get_response_body to get response content',
      },
      important: 'Network monitoring must be enabled BEFORE navigating to capture requests',
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

  async handleNetworkDisable(_args: Record<string, unknown>) {
    await this.consoleMonitor.disable();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Network monitoring disabled',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleNetworkGetStatus(_args: Record<string, unknown>) {
    const status = this.consoleMonitor.getNetworkStatus();

    type NetworkStatusResult =
      | {
          success: false;
          enabled: false;
          message: string;
          requestCount: number;
          responseCount: number;
          nextSteps: {
            step1: string;
            step2: string;
            step3: string;
          };
          example: string;
        }
      | {
          success: true;
          enabled: true;
          message: string;
          requestCount: number;
          responseCount: number;
          listenerCount: number;
          cdpSessionActive: boolean;
          nextSteps:
            | {
                hint: string;
                action: string;
              }
            | {
                hint: string;
                action: string;
              };
        };

    let result: NetworkStatusResult;

    if (!status.enabled) {
      result = {
        success: false,
        enabled: false,
        message: ' Network monitoring is NOT enabled',
        requestCount: 0,
        responseCount: 0,
        nextSteps: {
          step1: 'Call network_enable tool to start monitoring',
          step2: 'Then navigate to a page using page_navigate',
          step3: 'Finally use network_get_requests to see captured requests',
        },
        example: 'network_enable -> page_navigate -> network_get_requests',
      };
    } else {
      result = {
        success: true,
        enabled: true,
        message: ` Network monitoring is active. Captured ${status.requestCount} requests and ${status.responseCount} responses.`,
        requestCount: status.requestCount,
        responseCount: status.responseCount,
        listenerCount: status.listenerCount,
        cdpSessionActive: status.cdpSessionActive,
        nextSteps:
          status.requestCount === 0
            ? {
                hint: 'No requests captured yet',
                action: 'Navigate to a page using page_navigate to capture network traffic',
              }
            : {
                hint: `${status.requestCount} requests captured`,
                action: 'Use network_get_requests to retrieve them',
              },
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
}
