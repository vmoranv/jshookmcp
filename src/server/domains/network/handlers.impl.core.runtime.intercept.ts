import { AdvancedToolHandlersRuntime as AdvancedToolHandlersReplay } from '@server/domains/network/handlers.impl.core.runtime.replay';

interface InterceptRuleInput {
  urlPattern: string;
  urlPatternType?: 'glob' | 'regex';
  stage?: 'Request' | 'Response';
  responseCode?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export class AdvancedToolHandlersIntercept extends AdvancedToolHandlersReplay {
  /**
   * network_intercept_response — Add response interception rules using CDP Fetch domain.
   */
  async handleNetworkInterceptResponse(args: Record<string, unknown>) {
    try {
      // Parse rules from args
      const rules: InterceptRuleInput[] = [];

      if (Array.isArray(args.rules)) {
        // Batch mode: multiple rules
        for (const rawRule of args.rules) {
          if (isObjectRecord(rawRule) && typeof rawRule.urlPattern === 'string') {
            rules.push({
              urlPattern: rawRule.urlPattern,
              urlPatternType:
                rawRule.urlPatternType === 'regex' ? 'regex' : 'glob',
              stage: rawRule.stage === 'Request' ? 'Request' : 'Response',
              responseCode:
                typeof rawRule.responseCode === 'number' ? rawRule.responseCode : 200,
              responseHeaders: isObjectRecord(rawRule.responseHeaders)
                ? (rawRule.responseHeaders as Record<string, string>)
                : undefined,
              responseBody:
                typeof rawRule.responseBody === 'string'
                  ? rawRule.responseBody
                  : typeof rawRule.responseBody === 'object'
                    ? JSON.stringify(rawRule.responseBody)
                    : undefined,
            });
          }
        }
      } else if (typeof args.urlPattern === 'string') {
        // Single rule mode (convenience)
        rules.push({
          urlPattern: args.urlPattern,
          urlPatternType:
            args.urlPatternType === 'regex' ? 'regex' : 'glob',
          stage: args.stage === 'Request' ? 'Request' : 'Response',
          responseCode:
            typeof args.responseCode === 'number' ? args.responseCode : 200,
          responseHeaders: isObjectRecord(args.responseHeaders)
            ? (args.responseHeaders as Record<string, string>)
            : undefined,
          responseBody:
            typeof args.responseBody === 'string'
              ? args.responseBody
              : typeof args.responseBody === 'object' && args.responseBody !== null
                ? JSON.stringify(args.responseBody)
                : undefined,
        });
      }

      if (rules.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error:
                    'No valid rules provided. Provide either "urlPattern" (single) or "rules" array (batch).',
                  usage: {
                    single: {
                      urlPattern: '*api/status*',
                      responseCode: 200,
                      responseBody: '{"status":"active"}',
                    },
                    batch: {
                      rules: [
                        {
                          urlPattern: '*api/status*',
                          responseBody: '{"status":"active"}',
                        },
                      ],
                    },
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const createdRules = await this.consoleMonitor.enableFetchIntercept(rules);
      const status = this.consoleMonitor.getFetchInterceptStatus();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: `Added ${createdRules.length} interception rule(s)`,
                createdRules: createdRules.map((r) => ({
                  id: r.id,
                  urlPattern: r.urlPattern,
                  stage: r.stage,
                  responseCode: r.responseCode,
                })),
                totalActiveRules: status.rules.length,
                hint: 'Use network_intercept_list to see all rules and hit counts. Use network_intercept_disable to remove rules.',
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                hint: 'Ensure browser is launched and a page is active before enabling interception.',
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  /**
   * network_intercept_list — List active interception rules with hit statistics.
   */
  async handleNetworkInterceptList(_args: Record<string, unknown>) {
    const status = this.consoleMonitor.getFetchInterceptStatus();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              ...status,
              hint: status.rules.length > 0
                ? 'Use network_intercept_disable(ruleId) to remove a specific rule, or network_intercept_disable(all=true) to remove all.'
                : 'No active interception rules. Use network_intercept_response to add rules.',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  /**
   * network_intercept_disable — Remove specific rules or disable all interception.
   */
  async handleNetworkInterceptDisable(args: Record<string, unknown>) {
    const ruleId = typeof args.ruleId === 'string' ? args.ruleId : undefined;
    const all = args.all === true;

    if (!ruleId && !all) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'Provide either "ruleId" to remove a specific rule, or "all": true to disable all.',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    try {
      if (all) {
        const result = await this.consoleMonitor.disableFetchIntercept();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: `Disabled all interception. Removed ${result.removedRules} rule(s).`,
                  removedRules: result.removedRules,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const removed = await this.consoleMonitor.removeFetchInterceptRule(ruleId!);
      const status = this.consoleMonitor.getFetchInterceptStatus();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: removed,
                message: removed
                  ? `Rule ${ruleId} removed.`
                  : `Rule ${ruleId} not found.`,
                remainingRules: status.rules.length,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }
}
