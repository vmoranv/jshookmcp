import { GRAPHQL_MAX_PREVIEW_CHARS } from './handlers.impl.core.runtime.shared.js';
import type { ScriptReplaceRule } from './handlers.impl.core.runtime.shared.js';
import { GraphQLToolHandlersCallGraph } from './handlers.impl.core.runtime.callgraph.js';

export class GraphQLToolHandlersScriptReplace extends GraphQLToolHandlersCallGraph {
  async handleScriptReplacePersist(args: Record<string, unknown>) {
    try {
      const url = this.getStringArg(args, 'url')?.trim();
      const replacement = this.getStringArg(args, 'replacement');
      const matchType = this.parseMatchType(args.matchType);

      if (!url) {
        return this.toError('Missing required argument: url');
      }

      if (typeof replacement !== 'string' || replacement.length === 0) {
        return this.toError('Missing required argument: replacement');
      }

      if (matchType === 'regex') {
        try {
          new RegExp(url);
        } catch (error) {
          return this.toError('Invalid regex in url for matchType=regex', {
            url,
            reason: this.getErrorMessage(error),
          });
        }
      }

      const page = await this.collector.getActivePage();

      const rule: ScriptReplaceRule = {
        id: this.generateRuleId(),
        url,
        replacement,
        matchType,
        createdAt: Date.now(),
        hits: 0,
      };

      this.scriptReplaceRules.push(rule);

      await this.ensureScriptInterception(page);

      await page.evaluateOnNewDocument((payload) => {
        const runtimeWindow = window as unknown as Window & Record<string, unknown>;
        const key = '__scriptReplacePersistRules';

        const existing = Array.isArray(runtimeWindow[key])
          ? (runtimeWindow[key] as Array<Record<string, unknown>>)
          : [];

        const filtered = existing.filter((entry) => entry && entry.id !== payload.id);
        filtered.push(payload);

        runtimeWindow[key] = filtered;
      }, {
        id: rule.id,
        url: rule.url,
        matchType: rule.matchType,
        createdAt: rule.createdAt,
      });

      const replacementPreview = this.createPreview(replacement, GRAPHQL_MAX_PREVIEW_CHARS);

      return this.toResponse({
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
      return this.toError(error);
    }
  }
}