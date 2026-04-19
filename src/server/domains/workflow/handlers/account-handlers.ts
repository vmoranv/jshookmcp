/**
 * JS bundle search sub-handler.
 */

import {
  WORKFLOW_JS_BUNDLE_MAX_SIZE_BYTES,
  WORKFLOW_JS_BUNDLE_MAX_REDIRECTS,
  WORKFLOW_JS_BUNDLE_FETCH_TIMEOUT_MS,
} from '@src/constants';
import { argString, argBool, argNumber } from '@server/domains/shared/parse-args';
import { R, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import type { WorkflowSharedState } from './shared';
import { WORKFLOW_CONSTANTS, evictBundleCache } from './shared';
import { parseWorkflowNetworkPolicy, authorizeWorkflowUrl } from './network-policy';

export class AccountHandlers {
  private state: WorkflowSharedState;

  constructor(state: WorkflowSharedState) {
    this.state = state;
  }

  async handleJsBundleSearch(args: Record<string, unknown>): Promise<ToolResponse> {
    const url = argString(args, 'url', '');
    const rawPatterns = args.patterns;
    const patterns: Array<{
      name: string;
      regex: string;
      contextBefore?: number;
      contextAfter?: number;
    }> = Array.isArray(rawPatterns)
      ? rawPatterns
      : typeof rawPatterns === 'string'
        ? (() => {
            try {
              return JSON.parse(rawPatterns);
            } catch {
              return [];
            }
          })()
        : [];
    const cacheBundle = argBool(args, 'cacheBundle', true);
    const stripNoise = argBool(args, 'stripNoise', true);
    const maxMatches = argNumber(args, 'maxMatches', 10);
    const policyResult = parseWorkflowNetworkPolicy(args);

    if (!url || !patterns || patterns.length === 0) {
      return R.fail('url and patterns are required').json();
    }
    if (!policyResult.policy) return R.fail(policyResult.error).json();
    const networkPolicy = policyResult.policy;

    const MAX_BUNDLE_SIZE = WORKFLOW_JS_BUNDLE_MAX_SIZE_BYTES;
    const MAX_REDIRECTS = WORKFLOW_JS_BUNDLE_MAX_REDIRECTS;

    const safeFetch = async (targetUrl: string, signal: AbortSignal): Promise<Response> => {
      let currentUrl = targetUrl;
      for (let hops = 0; hops < MAX_REDIRECTS; hops++) {
        const authorization = await authorizeWorkflowUrl(currentUrl, networkPolicy, {
          label: hops === 0 ? 'bundle URL' : 'redirect target',
          allowRedirectHosts: hops > 0,
          rewriteHttpHostToResolvedIp: true,
        });
        const resp = await fetch(authorization.fetchUrl, {
          signal,
          redirect: 'manual',
          headers: authorization.headers,
        });
        if (resp.status >= 300 && resp.status < 400) {
          const location = resp.headers.get('location');
          if (!location) throw new Error(`Redirect ${resp.status} without Location header`);
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }
        return resp;
      }
      throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
    };

    let bundleText: string;
    let fromCache = false;

    try {
      if (cacheBundle) {
        const cached = this.state.bundleCache.get(url);
        if (cached && Date.now() - cached.cachedAt < WORKFLOW_CONSTANTS.BUNDLE_CACHE_TTL_MS) {
          bundleText = cached.text;
          fromCache = true;
        } else {
          const controller = new AbortController();
          const timeoutId = setTimeout(
            () => controller.abort(),
            WORKFLOW_JS_BUNDLE_FETCH_TIMEOUT_MS,
          );
          try {
            const resp = await safeFetch(url, controller.signal);
            if (!resp.ok)
              return R.fail(`Fetch failed: ${resp.status} ${resp.statusText}`)
                .merge({ url })
                .json();
            bundleText = await resp.text();
            if (bundleText.length > MAX_BUNDLE_SIZE) {
              return R.fail(
                `Response too large: ${bundleText.length} bytes exceeds ${MAX_BUNDLE_SIZE} limit`,
              )
                .merge({ url })
                .json();
            }
            evictBundleCache(this.state);
            this.state.bundleCache.set(url, { text: bundleText, cachedAt: Date.now() });
            this.state.bundleCacheBytes += bundleText.length;
          } finally {
            clearTimeout(timeoutId);
          }
        }
      } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30_000);
        try {
          const resp = await safeFetch(url, controller.signal);
          if (!resp.ok)
            return R.fail(`Fetch failed: ${resp.status} ${resp.statusText}`).merge({ url }).json();
          bundleText = await resp.text();
          if (bundleText.length > MAX_BUNDLE_SIZE) {
            return R.fail(
              `Response too large: ${bundleText.length} bytes exceeds ${MAX_BUNDLE_SIZE} limit`,
            )
              .merge({ url })
              .json();
          }
        } finally {
          clearTimeout(timeoutId);
        }
      }
    } catch (fetchError) {
      return R.fail(fetchError).merge({ url }).json();
    }

    const results: Record<string, Array<{ match: string; index: number; context: string }>> = {};
    for (const pattern of patterns) {
      const contextBefore = pattern.contextBefore ?? 80;
      const contextAfter = pattern.contextAfter ?? 80;
      let re: RegExp;
      try {
        re = new RegExp(pattern.regex, 'g');
      } catch (e) {
        results[pattern.name] = [
          {
            match: '',
            index: -1,
            context: `Invalid regex: ${e instanceof Error ? e.message : String(e)}`,
          },
        ];
        continue;
      }
      const matches: Array<{ match: string; index: number; context: string }> = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(bundleText)) !== null) {
        const s = Math.max(0, m.index - contextBefore);
        const e = Math.min(bundleText.length, m.index + m[0].length + contextAfter);
        const ctx = bundleText.slice(s, e);
        if (stripNoise) {
          if (/[Mm]\d{1,6}(?:\.\d+)?[, ]\d{1,6}(?:\.\d+)?[CLHVSQTAZclhvsqtaz]/.test(ctx)) continue;
          if (/data:[a-z+-]+\/[a-z+-]+;base64,/i.test(ctx)) continue;
          if (ctx.replace(/[^A-Za-z0-9+/=]/g, '').length > ctx.length * 0.85 && ctx.length > 200)
            continue;
        }
        matches.push({ match: m[0], index: m.index, context: ctx });
        if (matches.length >= maxMatches) break;
      }
      results[pattern.name] = matches;
    }

    return R.ok()
      .merge({
        bundleUrl: url,
        bundleSize: bundleText.length,
        cached: fromCache,
        patternsSearched: patterns.length,
        results,
      })
      .json();
  }
}
