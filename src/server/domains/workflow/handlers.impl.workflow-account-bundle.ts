import { logger } from '../../../utils/logger.js';
import { isSsrfTarget, isPrivateHost } from '../network/replay.js';
import { lookup } from 'node:dns/promises';
import { WorkflowHandlersBase } from './handlers.impl.workflow-base.js';
import { WorkflowHandlersApi } from './handlers.impl.workflow-api.js';

export class WorkflowHandlersAccountBundle extends WorkflowHandlersApi {
  async handleRegisterAccountFlow(args: Record<string, unknown>) {
    const registerUrl = args.registerUrl as string;
    const fields = (args.fields as Record<string, string>) ?? {};
    const submitSelector = (args.submitSelector as string) ?? "button[type='submit']";
    const emailProviderUrl = args.emailProviderUrl as string | undefined;
    const verificationLinkPattern = (args.verificationLinkPattern as string) ?? '/auth';
    const rawCheckboxSelectors = args.checkboxSelectors;
    const checkboxSelectors: string[] = Array.isArray(rawCheckboxSelectors)
      ? rawCheckboxSelectors
      : typeof rawCheckboxSelectors === 'string'
        ? (() => { try { return JSON.parse(rawCheckboxSelectors); } catch { return []; } })()
        : [];
    const timeoutMs = (args.timeoutMs as number) ?? 60000;

    const steps: string[] = [];
    const warnings: string[] = [];
    let registeredEmail = '';
    let verificationUrl = '';

    try {
      // Step 1: Enable network monitoring
      steps.push('network_enable');
      await this.deps.advancedHandlers.handleNetworkEnable({ enableExceptions: true });

      // Step 2: Navigate to registration page
      steps.push(`page_navigate(${registerUrl})`);
      await this.deps.browserHandlers.handlePageNavigate({
        url: registerUrl,
        waitUntil: 'domcontentloaded',
        enableNetworkMonitoring: true,
      });

      // Step 3: Fill fields
      for (const [name, value] of Object.entries(fields)) {
        steps.push(`page_type(input[name='${name}'], ...)`);
        try {
          await this.deps.browserHandlers.handlePageType({
            selector: `input[name='${name}']`,
            text: value,
            delay: 20,
          });
          if (name === 'email') registeredEmail = value;
        } catch (e) {
          warnings.push(`Field "${name}" fill failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // Step 4: Click checkboxes
      for (const cbSelector of checkboxSelectors) {
        steps.push(`page_click(${cbSelector})`);
        try {
          // Try React-compatible checkbox activation
          await this.deps.browserHandlers.handlePageEvaluate({
            code: `(function(){const cb=document.querySelector('${cbSelector.replace(/'/g, "\\'")}');if(!cb)return false;cb.click();cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
          });
        } catch (e) {
          warnings.push(`Checkbox "${cbSelector}" click failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // Step 5: Submit form
      steps.push(`page_click(${submitSelector})`);
      await this.deps.browserHandlers.handlePageClick({ selector: submitSelector });

      // Step 6: Wait and collect registration request
      await new Promise((r) => setTimeout(r, 2000));
      steps.push('network_extract_auth');
      const authResult = await this.deps.advancedHandlers.handleNetworkExtractAuth({ minConfidence: 0.3 });
      const authText = authResult.content[0]?.text;
      if (typeof authText !== 'string') {
        throw new Error('Failed to extract auth result text');
      }
      const authData = JSON.parse(authText);

      // Step 7: Email verification (if provider URL given)
      if (emailProviderUrl) {
        steps.push(`tab_workflow:alias_open(emailTab, ${emailProviderUrl})`);

        // Bind tab 0 as register, open email provider
        await this.deps.browserHandlers.handleTabWorkflow({ action: 'alias_bind', alias: 'register', index: 0 });

        const openResult = await this.deps.browserHandlers.handleTabWorkflow({
          action: 'alias_open',
          alias: 'emailTab',
          url: emailProviderUrl,
        });

        const openText = openResult.content[0]?.text;
        if (typeof openText !== 'string') {
          throw new Error('Failed to extract open tab result text');
        }
        const openData = JSON.parse(openText);
        if (!openData.success) {
          warnings.push('Could not open email provider tab: ' + (openData.error ?? 'unknown'));
        } else {
          // Wait for verification email
          steps.push(`tab_workflow:wait_for(emailTab, "${verificationLinkPattern}")`);
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            try {
              const linkResult = await this.deps.browserHandlers.handleTabWorkflow({
                action: 'transfer',
                fromAlias: 'emailTab',
                key: '__verificationLink',
                expression: `(function(){const links=Array.from(document.querySelectorAll('a'));const l=links.find(a=>(a.href||'').includes('${verificationLinkPattern.replace(/'/g, "\\'")}'));return l?l.href:null;})()`,
              });
              const linkText = linkResult.content[0]?.text;
              if (typeof linkText !== 'string') {
                throw new Error('Failed to extract verification link result text');
              }
              const linkData = JSON.parse(linkText);
              if (linkData && linkData.success && typeof linkData.value === 'string') {
                verificationUrl = linkData.value;
                break;
              }
            } catch { /* keep polling */ }
            await new Promise((r) => setTimeout(r, 2000));
          }

          if (verificationUrl) {
            steps.push(`page_navigate(${verificationUrl})`);
            await this.deps.browserHandlers.handlePageNavigate({
              url: verificationUrl,
              waitUntil: 'domcontentloaded',
            });
          } else {
            warnings.push(`Verification link matching "${verificationLinkPattern}" not found within timeout`);
          }
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            steps,
            warnings: warnings.length > 0 ? warnings : undefined,
            result: {
              registeredEmail,
              verificationUrl,
              verified: !!verificationUrl,
              authFindings: authData.findings ?? [],
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('[register_account_flow] Error:', error);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            steps,
            warnings,
            error: error instanceof Error ? error.message : String(error),
          }, null, 2),
        }],
      };
    }
  }

  // ── js_bundle_search ─────────────────────────────────────────────────────

  async handleJsBundleSearch(args: Record<string, unknown>) {
    const url = args.url as string;
    const rawPatterns = args.patterns;
    const patterns: Array<{
      name: string;
      regex: string;
      contextBefore?: number;
      contextAfter?: number;
    }> = Array.isArray(rawPatterns)
      ? rawPatterns
      : typeof rawPatterns === 'string'
        ? (() => { try { return JSON.parse(rawPatterns); } catch { return []; } })()
        : [];
    const cacheBundle = (args.cacheBundle as boolean) ?? true;
    const stripNoise = (args.stripNoise as boolean) ?? true;
    const maxMatches = (args.maxMatches as number) ?? 10;

    if (!url || !patterns || patterns.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: false, error: 'url and patterns are required' }),
        }],
      };
    }

    // SSRF guard: reject private/link-local destinations
    if (await isSsrfTarget(url)) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: false, error: `Blocked: target URL "${url}" resolves to a private/reserved address` }),
        }],
      };
    }

    const MAX_BUNDLE_SIZE = 20 * 1024 * 1024; // 20 MB hard limit
    const MAX_REDIRECTS = 5;

    /**
     * Safe fetch with SSRF-aware redirect following and DNS pinning.
     * Uses `redirect: 'manual'` so each hop is validated against the SSRF denylist.
     * Pins DNS per hop to prevent rebinding between check and fetch.
     */
    const safeFetch = async (targetUrl: string, signal: AbortSignal): Promise<Response> => {
      let currentUrl = targetUrl;
      for (let hops = 0; hops < MAX_REDIRECTS; hops++) {
        // Per-hop DNS pinning: resolve, validate, and replace hostname with IP
        const parsed = new URL(currentUrl);
        const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
        let fetchUrl = currentUrl;
        const headers: Record<string, string> = {};

        // Only pin non-IP hostnames
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname) && !hostname.startsWith('[')) {
          try {
            const { address: resolvedIp } = await lookup(hostname);
            if (isPrivateHost(resolvedIp)) {
              throw new Error(`Blocked: "${currentUrl}" resolved to private IP ${resolvedIp}`);
            }
            const originalHost = parsed.host;
            parsed.hostname = resolvedIp.includes(':') ? `[${resolvedIp}]` : resolvedIp;
            fetchUrl = parsed.toString();
            headers['Host'] = originalHost;
          } catch (e) {
            if (e instanceof Error && e.message.startsWith('Blocked:')) throw e;
            throw new Error(`DNS resolution failed for "${currentUrl}"`);
          }
        }

        const resp = await fetch(fetchUrl, { signal, redirect: 'manual', headers });
        if (resp.status >= 300 && resp.status < 400) {
          const location = resp.headers.get('location');
          if (!location) throw new Error(`Redirect ${resp.status} without Location header`);
          currentUrl = new URL(location, currentUrl).toString();
          if (await isSsrfTarget(currentUrl)) {
            throw new Error(`Redirect blocked: "${currentUrl}" resolves to a private/reserved address`);
          }
          continue;
        }
        return resp;
      }
      throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
    };

    // Fetch bundle text (with optional cache)
    let bundleText: string;
    let fromCache = false;

    try {
      if (cacheBundle) {
        const cached = this.bundleCache.get(url);
        if (cached && (Date.now() - cached.cachedAt) < WorkflowHandlersBase.BUNDLE_CACHE_TTL_MS) {
          bundleText = cached.text;
          fromCache = true;
        } else {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30_000);
          try {
            const resp = await safeFetch(url, controller.signal);
            if (!resp.ok) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({ success: false, error: `Fetch failed: ${resp.status} ${resp.statusText}`, url }),
                }],
              };
            }
            bundleText = await resp.text();
            if (bundleText.length > MAX_BUNDLE_SIZE) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({ success: false, error: `Response too large: ${bundleText.length} bytes exceeds ${MAX_BUNDLE_SIZE} limit`, url }),
                }],
              };
            }
            this.evictBundleCache();
            this.bundleCache.set(url, { text: bundleText, cachedAt: Date.now() });
            this.bundleCacheBytes += bundleText.length;
          } finally {
            clearTimeout(timeoutId);
          }
        }
      } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30_000);
        try {
          const resp = await safeFetch(url, controller.signal);
          if (!resp.ok) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: `Fetch failed: ${resp.status} ${resp.statusText}`, url }),
              }],
            };
          }
          bundleText = await resp.text();
          if (bundleText.length > MAX_BUNDLE_SIZE) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: `Response too large: ${bundleText.length} bytes exceeds ${MAX_BUNDLE_SIZE} limit`, url }),
              }],
            };
          }
        } finally {
          clearTimeout(timeoutId);
        }
      }
    } catch (fetchError) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: `Fetch error: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
            url,
          }),
        }],
      };
    }

    // Search patterns
    const results: Record<string, Array<{ match: string; index: number; context: string }>> = {};

    for (const pattern of patterns) {
      const contextBefore = pattern.contextBefore ?? 80;
      const contextAfter = pattern.contextAfter ?? 80;
      let re: RegExp;
      try {
        re = new RegExp(pattern.regex, 'g');
      } catch (e) {
        results[pattern.name] = [{ match: '', index: -1, context: `Invalid regex: ${e instanceof Error ? e.message : String(e)}` }];
        continue;
      }

      const matches: Array<{ match: string; index: number; context: string }> = [];
      let m: RegExpExecArray | null;

      while ((m = re.exec(bundleText)) !== null) {
        const s = Math.max(0, m.index - contextBefore);
        const e = Math.min(bundleText.length, m.index + m[0].length + contextAfter);
        const ctx = bundleText.slice(s, e);

        // Noise filtering: skip matches inside SVG path data or base64 blobs
        if (stripNoise) {
          // SVG coordinate sequences (M/m followed by numbers)
          if (/[Mm]\d{1,6}(?:\.\d+)?[, ]\d{1,6}(?:\.\d+)?[CLHVSQTAZclhvsqtaz]/.test(ctx)) continue;
          // base64 data URI context
          if (/data:[a-z+\-]+\/[a-z+\-]+;base64,/i.test(ctx)) continue;
          // Long unbroken base64-alphabet string surrounding the match
          if (ctx.replace(/[^A-Za-z0-9+/=]/g, '').length > ctx.length * 0.85 && ctx.length > 200) continue;
        }

        matches.push({ match: m[0], index: m.index, context: ctx });
        if (matches.length >= maxMatches) break;
      }

      results[pattern.name] = matches;
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          bundleUrl: url,
          bundleSize: bundleText.length,
          cached: fromCache,
          patternsSearched: patterns.length,
          results,
        }, null, 2),
      }],
    };
  }
}
