/**
 * Script replacement handler.
 *
 * Persistently replaces matching script responses via CDP request interception.
 */

import type { Page } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '@server/domains/shared/modules';
import {
  toResponse,
  toError,
  getErrorMessage,
  createPreview,
  parseMatchType,
  generateRuleId,
  ensureScriptInterception,
} from '@server/domains/graphql/handlers/shared';
import { GRAPHQL_MAX_PREVIEW_CHARS } from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import type { ScriptReplaceRule } from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import { argString } from '@server/domains/shared/parse-args';

export class ScriptReplaceHandlers {
  private readonly scriptReplaceRules: ScriptReplaceRule[] = [];
  private readonly interceptionInstalledPages: WeakSet<Page> = new WeakSet();

  constructor(private collector: CodeCollector) {}

  async handleScriptReplacePersist(args: Record<string, unknown>) {
    try {
      const url = argString(args, 'url')?.trim();
      const replacement = argString(args, 'replacement');
      const matchType = parseMatchType(args.matchType);

      if (!url) {
        return toError('Missing required argument: url');
      }

      if (typeof replacement !== 'string' || replacement.length === 0) {
        return toError('Missing required argument: replacement');
      }

      if (matchType === 'regex') {
        try {
          RegExp(url);
        } catch (error) {
          return toError('Invalid regex in url for matchType=regex', {
            url,
            reason: getErrorMessage(error),
          });
        }
      }

      const page = await this.collector.getActivePage();

      const rule: ScriptReplaceRule = {
        id: generateRuleId(),
        url,
        replacement,
        matchType,
        createdAt: Date.now(),
        hits: 0,
      };

      this.scriptReplaceRules.push(rule);

      await ensureScriptInterception(
        this.scriptReplaceRules,
        this.interceptionInstalledPages,
        page,
      );

      await page.evaluateOnNewDocument(
        (payload) => {
          const runtimeWindow = window as unknown as Window & Record<string, unknown>;
          const key = '__scriptReplacePersistRules';

          const existing = Array.isArray(runtimeWindow[key])
            ? (runtimeWindow[key] as Array<Record<string, unknown>>)
            : [];

          const filtered = existing.filter((entry) => entry && entry.id !== payload.id);
          filtered.push(payload);

          runtimeWindow[key] = filtered;
        },
        {
          id: rule.id,
          url: rule.url,
          matchType: rule.matchType,
          createdAt: rule.createdAt,
        },
      );

      const replacementPreview = createPreview(replacement, GRAPHQL_MAX_PREVIEW_CHARS);

      return toResponse({
        success: true,
        message: 'Script replacement rule registered and interception enabled',
        rule: {
          id: rule.id,
          url: rule.url,
          matchType: rule.matchType,
          createdAt: rule.createdAt,
        },
        replacement: {
          length: replacement.length,
          preview: replacementPreview.preview,
          truncated: replacementPreview.truncated,
        },
        activeRuleCount: this.scriptReplaceRules.length,
      });
    } catch (error) {
      return toError(error);
    }
  }
}
