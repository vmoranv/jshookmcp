/**
 * Network interception handlers — response interception, rule management.
 *
 * Extracted from AdvancedToolHandlersIntercept (handlers.impl.core.runtime.intercept.ts).
 */

import type { ConsoleMonitor } from '@server/domains/shared/modules';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import { R } from '@server/domains/shared/ResponseBuilder';
import { emitEvent } from './shared';

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

export interface InterceptHandlerDeps {
  consoleMonitor: ConsoleMonitor;
  eventBus?: EventBus<ServerEventMap>;
}

export class InterceptHandlers {
  constructor(private deps: InterceptHandlerDeps) {}

  async handleNetworkInterceptResponse(args: Record<string, unknown>) {
    try {
      const rules = this.parseInterceptRules(args);

      if (rules.length === 0) {
        return R.fail(
          'No valid rules provided. Provide either "urlPattern" (single) or "rules" array (batch).',
        )
          .merge({
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
          })
          .json();
      }

      const createdRules = await this.deps.consoleMonitor.enableFetchIntercept(rules);
      const status = this.deps.consoleMonitor.getFetchInterceptStatus();
      emitEvent(this.deps.eventBus, 'network:intercept_started', {
        interceptType: 'fetch',
        timestamp: new Date().toISOString(),
      });

      return R.ok()
        .merge({
          message: `Added ${createdRules.length} interception rule(s)`,
          createdRules: createdRules.map((r) => ({
            id: r.id,
            urlPattern: r.urlPattern,
            stage: r.stage,
            responseCode: r.responseCode,
          })),
          totalActiveRules: status.rules.length,
          hint: 'Use network_intercept(action: "list") to see all rules and hit counts. Use network_intercept(action: "disable") to remove rules.',
        })
        .json();
    } catch (error) {
      return R.fail(error instanceof Error ? error.message : String(error))
        .merge({
          hint: 'Ensure browser is launched and a page is active before enabling interception.',
        })
        .json();
    }
  }

  async handleNetworkInterceptList(_args: Record<string, unknown>) {
    const status = this.deps.consoleMonitor.getFetchInterceptStatus();

    return R.ok()
      .merge(status as unknown as Record<string, unknown>)
      .merge({
        hint:
          status.rules.length > 0
            ? 'Use network_intercept(action: "disable", ruleId) to remove a specific rule, or network_intercept(action: "disable", all: true) to remove all.'
            : 'No active interception rules. Use network_intercept(action: "add") to add rules.',
      })
      .json();
  }

  async handleNetworkInterceptDisable(args: Record<string, unknown>) {
    const ruleId = typeof args.ruleId === 'string' ? args.ruleId : undefined;
    const all = args.all === true;

    if (!ruleId && !all) {
      return R.fail(
        'Provide either "ruleId" to remove a specific rule, or "all": true to disable all.',
      ).json();
    }

    try {
      if (all) {
        const result = await this.deps.consoleMonitor.disableFetchIntercept();
        return R.ok()
          .merge({
            message: `Disabled all interception. Removed ${result.removedRules} rule(s).`,
            removedRules: result.removedRules,
          })
          .json();
      }

      const removed = await this.deps.consoleMonitor.removeFetchInterceptRule(ruleId!);
      const status = this.deps.consoleMonitor.getFetchInterceptStatus();

      return R.ok()
        .merge({
          success: removed,
          message: removed ? `Rule ${ruleId} removed.` : `Rule ${ruleId} not found.`,
          remainingRules: status.rules.length,
        })
        .json();
    } catch (error) {
      return R.fail(error instanceof Error ? error.message : String(error)).json();
    }
  }

  // ── Private Helpers ──

  private parseInterceptRules(args: Record<string, unknown>): InterceptRuleInput[] {
    const rules: InterceptRuleInput[] = [];

    if (Array.isArray(args.rules)) {
      for (const rawRule of args.rules) {
        if (isObjectRecord(rawRule) && typeof rawRule.urlPattern === 'string') {
          rules.push(this.toInterceptRule(rawRule));
        }
      }
    } else if (typeof args.urlPattern === 'string') {
      rules.push(this.toInterceptRule(args));
    }

    return rules;
  }

  private toInterceptRule(source: Record<string, unknown>): InterceptRuleInput {
    return {
      urlPattern: source.urlPattern as string,
      urlPatternType: source.urlPatternType === 'regex' ? 'regex' : 'glob',
      stage: source.stage === 'Request' ? 'Request' : 'Response',
      responseCode: typeof source.responseCode === 'number' ? source.responseCode : 200,
      responseHeaders: isObjectRecord(source.responseHeaders)
        ? (source.responseHeaders as Record<string, string>)
        : undefined,
      responseBody:
        typeof source.responseBody === 'string'
          ? source.responseBody
          : typeof source.responseBody === 'object'
            ? JSON.stringify(source.responseBody)
            : undefined,
    };
  }
}
