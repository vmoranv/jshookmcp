/**
 * Workflow Handlers — composite tools that orchestrate lower-level primitives.
 *
 * Each handler coordinates multiple browser/network operations to provide
 * an end-to-end workflow with a single tool call.
 */

import { logger } from '../../../utils/logger.js';
import { isSsrfTarget, isPrivateHost } from '../network/replay.js';
import { lookup } from 'node:dns/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

interface WorkflowHandlersDeps {
  browserHandlers: any;  // BrowserToolHandlers
  advancedHandlers: any; // AdvancedToolHandlers
}

interface ScriptEntry {
  code: string;
  description: string;
}

interface BundleCacheEntry {
  text: string;
  cachedAt: number;
}

export class WorkflowHandlers {
  private readonly scriptRegistry = new Map<string, ScriptEntry>();
  private readonly bundleCache = new Map<string, BundleCacheEntry>();
  private static readonly BUNDLE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly MAX_SCRIPTS = 100;
  private static readonly MAX_BUNDLE_CACHE = 50;

  constructor(private deps: WorkflowHandlersDeps) {
    this.initBuiltinScripts();
  }

  /** Evict expired or oldest entries when bundleCache exceeds capacity. */
  private evictBundleCache(): void {
    // First pass: remove expired entries
    const now = Date.now();
    for (const [k, v] of this.bundleCache) {
      if (now - v.cachedAt >= WorkflowHandlers.BUNDLE_CACHE_TTL_MS) {
        this.bundleCache.delete(k);
      }
    }
    // Second pass: evict oldest if still over limit
    while (this.bundleCache.size >= WorkflowHandlers.MAX_BUNDLE_CACHE) {
      const oldest = this.bundleCache.keys().next().value;
      if (oldest !== undefined) this.bundleCache.delete(oldest);
      else break;
    }
  }

  private normalizeOutputPath(inputPath: string | undefined, defaultPath: string, preferredDir: string): string {
    const requested = inputPath?.trim();
    if (!requested) {
      return defaultPath;
    }
    const normalizedRequested = requested.replace(/\\/g, '/');
    if (
      normalizedRequested.startsWith('/') ||
      /^[A-Za-z]:/.test(normalizedRequested) ||
      normalizedRequested.split('/').includes('..')
    ) {
      return defaultPath;
    }
    if (!normalizedRequested.includes('/')) {
      return `${preferredDir}/${normalizedRequested}`;
    }
    return normalizedRequested;
  }

  private async ensureParentDirectory(filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
  }

  private buildWebApiCaptureReportMarkdown(args: {
    generatedAt: string;
    url: string;
    waitUntil: string;
    waitAfterActionsMs: number;
    steps: string[];
    warnings: string[];
    totalCaptured: number;
    authFindings: any[];
    harExported: boolean;
    harOutputPath?: string;
  }): string {
    const lines: string[] = [
      '# Web API Capture Report',
      '',
      `- Generated At: ${args.generatedAt}`,
      `- URL: ${args.url}`,
      `- Wait Until: ${args.waitUntil}`,
      `- Wait After Actions (ms): ${args.waitAfterActionsMs}`,
      `- Captured Requests: ${args.totalCaptured}`,
      `- Auth Findings: ${args.authFindings.length}`,
      `- HAR Exported: ${args.harExported ? 'yes' : 'no'}`,
      `- HAR Path: ${args.harOutputPath ?? 'n/a'}`,
      '',
      '## Steps',
    ];

    if (args.steps.length === 0) {
      lines.push('- (none)');
    } else {
      for (const step of args.steps) {
        lines.push(`- ${step}`);
      }
    }

    lines.push('', '## Auth Findings');
    if (args.authFindings.length === 0) {
      lines.push('- (none)');
    } else {
      for (const finding of args.authFindings) {
        const type = String(finding?.type ?? 'unknown');
        const location = String(finding?.location ?? 'unknown');
        const confidenceRaw = finding?.confidence;
        const confidence = typeof confidenceRaw === 'number' ? confidenceRaw.toFixed(2) : String(confidenceRaw ?? 'n/a');
        const value = String(
          finding?.maskedValue ??
          finding?.masked ??
          finding?.value ??
          finding?.token ??
          ''
        );
        lines.push(`- type=${type}, location=${location}, confidence=${confidence}${value ? `, value=${value}` : ''}`);
      }
    }

    lines.push('', '## Warnings');
    if (args.warnings.length === 0) {
      lines.push('- (none)');
    } else {
      for (const warning of args.warnings) {
        lines.push(`- ${warning}`);
      }
    }

    return lines.join('\n');
  }

  private initBuiltinScripts(): void {
    this.scriptRegistry.set('auth_extract', {
      description: 'Extract auth tokens from localStorage and cookies',
      code: `(function(){
  var keys=['token','active_token','access_token','jwt','auth_token','userRole','id_token','refresh_token'];
  var r={};
  for(var i=0;i<keys.length;i++){var v=localStorage.getItem(keys[i]);if(v)r[keys[i]]=v;}
  r._cookies=document.cookie;
  return r;
})()`,
    });

    this.scriptRegistry.set('bundle_search', {
      description:
        'Fetch a remote JS bundle and search it with regex patterns. params: { url: string, patterns: string[] }',
      code: `(async function(){
  var p=typeof __params__!=='undefined'?__params__:{};
  if(!p.url)return{error:'params.url required'};
  var resp=await fetch(p.url);
  var text=await resp.text();
  var patterns=p.patterns||[];
  var results={};
  for(var i=0;i<patterns.length;i++){
    var re=new RegExp(patterns[i],'g');
    var matches=[];var m;
    while((m=re.exec(text))!==null){
      var s=Math.max(0,m.index-80),e=Math.min(text.length,m.index+m[0].length+80);
      matches.push({match:m[0],ctx:text.slice(s,e)});
      if(matches.length>=10)break;
    }
    results[patterns[i]]=matches;
  }
  return{size:text.length,results:results};
})()`,
    });

    this.scriptRegistry.set('react_fill_form', {
      description:
        'Fill React controlled form inputs using native setter trick. params: { fields: { "selector": "value" } }',
      code: `(function(){
  var p=typeof __params__!=='undefined'?__params__:{};
  var fields=p.fields||{};
  var ns=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  var r={};
  var entries=Object.entries(fields);
  for(var i=0;i<entries.length;i++){
    var sel=entries[i][0],val=entries[i][1];
    var el=document.querySelector(sel);
    if(!el){r[sel]='not found';continue;}
    ns.call(el,val);
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    r[sel]='filled';
  }
  return r;
})()`,
    });

    this.scriptRegistry.set('dom_find_upgrade_buttons', {
      description: 'Scan the current page for upgrade/subscription/tier-related UI elements',
      code: `(function(){
  var kw=['upgrade','plus','pro','premium','subscribe','plan','tier','vip','membership'];
  var r=[];
  document.querySelectorAll('button,a,[role=button],[class*=upgrade],[class*=premium],[class*=plus]').forEach(function(el){
    var t=(el.textContent||'').toLowerCase().trim();
    var c=(el.className||'').toLowerCase();
    if(kw.some(function(k){return t.includes(k)||c.includes(k);})){
      r.push({tag:el.tagName,text:t.slice(0,120),cls:c.slice(0,100),href:el.href||null,id:el.id||null});
    }
  });
  return r;
})()`,
    });
  }

  // ── page_script_register ─────────────────────────────────────────────────

  async handlePageScriptRegister(args: Record<string, unknown>) {
    const name = args.name as string;
    const code = args.code as string;
    const description = (args.description as string | undefined) ?? '';

    if (!name || !code) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: false, error: 'name and code are required' }),
        }],
      };
    }

    const isUpdate = this.scriptRegistry.has(name);
    if (!isUpdate && this.scriptRegistry.size >= WorkflowHandlers.MAX_SCRIPTS) {
      // Evict oldest non-builtin entry
      for (const k of this.scriptRegistry.keys()) {
        if (!['auth_extract', 'bundle_search', 'react_fill_form', 'dom_find_upgrade_buttons'].includes(k)) {
          this.scriptRegistry.delete(k);
          break;
        }
      }
    }
    this.scriptRegistry.set(name, { code, description });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          action: isUpdate ? 'updated' : 'registered',
          name,
          description,
          totalScripts: this.scriptRegistry.size,
          available: Array.from(this.scriptRegistry.keys()),
        }),
      }],
    };
  }

  // ── page_script_run ──────────────────────────────────────────────────────

  async handlePageScriptRun(args: Record<string, unknown>) {
    const name = args.name as string;
    const params = args.params as Record<string, unknown> | undefined;

    const entry = this.scriptRegistry.get(name);
    if (!entry) {
      const available = Array.from(this.scriptRegistry.keys());
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: `Script "${name}" not found`,
            available,
          }),
        }],
      };
    }

    // Wrap with params injection if provided
    let codeToRun: string;
    if (params !== undefined) {
      const paramsJson = JSON.stringify(params);
      codeToRun = `(function(){var __params__=${paramsJson};return(${entry.code});})()`;
    } else {
      codeToRun = entry.code;
    }

    try {
      const result = await this.deps.browserHandlers.handlePageEvaluate({ code: codeToRun });
      return result;
    } catch (error) {
      logger.error(`[page_script_run] Script "${name}" failed:`, error);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            script: name,
            error: error instanceof Error ? error.message : String(error),
          }),
        }],
      };
    }
  }

  // ── api_probe_batch ──────────────────────────────────────────────────────

  async handleApiProbeBatch(args: Record<string, unknown>) {
    const baseUrl = (args.baseUrl as string).replace(/\/$/, '');
    const rawPaths = args.paths;
    const paths: string[] = Array.isArray(rawPaths)
      ? rawPaths
      : typeof rawPaths === 'string'
        ? (() => { try { return JSON.parse(rawPaths); } catch { return []; } })()
        : [];
    const method = ((args.method as string | undefined) ?? 'GET').toUpperCase();
    const extraHeaders = (args.headers as Record<string, string> | undefined) ?? {};
    const bodyTemplate = (args.bodyTemplate as string | undefined) ?? null;
    const includeBodyStatuses = (args.includeBodyStatuses as number[] | undefined) ?? [200, 201, 204];
    const maxBodySnippetLength = (args.maxBodySnippetLength as number | undefined) ?? 500;
    const autoInjectAuth = (args.autoInjectAuth as boolean | undefined) ?? true;

    if (!paths || paths.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: false, error: 'paths array is required and must not be empty' }),
        }],
      };
    }

    const probeCode = `(async function() {
  var baseUrl = ${JSON.stringify(baseUrl)};
  var paths = ${JSON.stringify(paths)};
  var method = ${JSON.stringify(method)};
  var extraHeaders = ${JSON.stringify(extraHeaders)};
  var includeBodyStatuses = ${JSON.stringify(includeBodyStatuses)};
  var maxSnippetLen = ${maxBodySnippetLength};
  var autoInjectAuth = ${autoInjectAuth};
  var bodyTemplate = ${JSON.stringify(bodyTemplate)};

  var headers = Object.assign({'Content-Type':'application/json'}, extraHeaders);
  if (autoInjectAuth) {
    var token = localStorage.getItem('token') || localStorage.getItem('active_token') || localStorage.getItem('access_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
  }

  var results = {};
  for (var i = 0; i < paths.length; i++) {
    var path = paths[i];
    try {
      var opts = {method: method, headers: headers};
      if (bodyTemplate && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        opts.body = bodyTemplate;
      }
      var resp = await fetch(baseUrl + path, opts);
      var ct = resp.headers.get('content-type') || '';
      var snippet = null;
      if (includeBodyStatuses.indexOf(resp.status) !== -1) {
        var text = await resp.text();
        if (!ct.includes('text/html') && !ct.includes('application/xml')) {
          snippet = text.length > maxSnippetLen ? text.slice(0, maxSnippetLen) + '...[truncated]' : text;
        } else {
          snippet = '[HTML/XML response suppressed]';
        }
      }
      results[path] = {status: resp.status, contentType: ct.split(';')[0].trim(), snippet: snippet};
    } catch(e) {
      results[path] = {status: -1, error: e.message};
    }
  }
  return {probed: paths.length, method: method, baseUrl: baseUrl, results: results};
})()`;

    try {
      const result = await this.deps.browserHandlers.handlePageEvaluate({ code: probeCode });
      return result;
    } catch (error) {
      logger.error('[api_probe_batch] Error:', error);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        }],
      };
    }
  }


  // ── web_api_capture_session ──────────────────────────────────────────────

  async handleWebApiCaptureSession(args: Record<string, unknown>) {
    const url = args.url as string;
    const waitUntil = (args.waitUntil as string) ?? 'domcontentloaded';
    const rawActions = args.actions;
    const actions: any[] = Array.isArray(rawActions)
      ? rawActions
      : typeof rawActions === 'string'
        ? (() => { try { return JSON.parse(rawActions); } catch { return []; } })()
        : [];
    const exportHar = (args.exportHar as boolean) ?? true;
    const exportReport = (args.exportReport as boolean) ?? true;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const harOutputPath =
      exportHar
        ? this.normalizeOutputPath(
            args.harOutputPath as string | undefined,
            `artifacts/har/jshhook-capture-${timestamp}.har`,
            'artifacts/har'
          )
        : undefined;
    const reportOutputPath =
      exportReport
        ? this.normalizeOutputPath(
            args.reportOutputPath as string | undefined,
            `artifacts/reports/web-api-capture-${timestamp}.md`,
            'artifacts/reports'
          )
        : undefined;
    const waitAfterActionsMs = (args.waitAfterActionsMs as number) ?? 1500;

    const steps: string[] = [];
    const warnings: string[] = [];

    try {
      // Step 1: Enable network monitoring + inject interceptors
      steps.push('network_enable');
      await this.deps.advancedHandlers.handleNetworkEnable({ enableExceptions: true });

      steps.push('console_inject_fetch_interceptor');
      await this.deps.advancedHandlers.handleConsoleInjectFetchInterceptor({});

      steps.push('console_inject_xhr_interceptor');
      await this.deps.advancedHandlers.handleConsoleInjectXhrInterceptor({});

      // Step 2: Navigate
      steps.push(`page_navigate(${url})`);
      await this.deps.browserHandlers.handlePageNavigate({
        url,
        waitUntil,
        enableNetworkMonitoring: true,
      });

      // Step 3: Perform actions
      for (const action of actions) {
        try {
          switch (action.type) {
            case 'click':
              steps.push(`page_click(${action.selector})`);
              await this.deps.browserHandlers.handlePageClick({ selector: action.selector });
              break;
            case 'type':
              steps.push(`page_type(${action.selector}, ...)`);
              await this.deps.browserHandlers.handlePageType({
                selector: action.selector,
                text: action.text,
                delay: action.delayMs ?? 20,
              });
              break;
            case 'wait':
              steps.push(`wait(${action.delayMs ?? 1000}ms)`);
              await new Promise((r) => setTimeout(r, action.delayMs ?? 1000));
              break;
            case 'evaluate':
              steps.push(`page_evaluate(...)`);
              await this.deps.browserHandlers.handlePageEvaluate({ code: action.expression });
              break;
          }
        } catch (actionErr) {
          warnings.push(`Action ${action.type}(${action.selector ?? ''}) failed: ${actionErr instanceof Error ? actionErr.message : String(actionErr)}`);
        }
      }

      // Step 4: Wait for async requests to settle
      if (waitAfterActionsMs > 0) {
        steps.push(`wait(${waitAfterActionsMs}ms)`);
        await new Promise((r) => setTimeout(r, waitAfterActionsMs));
      }

      // Step 5: Get network stats (lightweight, not subject to smartHandle)
      steps.push('network_get_stats');
      const statsResult = await this.deps.advancedHandlers.handleNetworkGetStats({});
      const statsData = JSON.parse(statsResult.content[0].text);
      const totalCaptured = statsData.stats?.totalRequests ?? 0;

      // Step 6: Collect requests (may be smartHandle'd for large payloads)
      steps.push('network_get_requests');
      const requestsResult = await this.deps.advancedHandlers.handleNetworkGetRequests({
        limit: 500,
        offset: 0,
      });
      const requestsData = JSON.parse(requestsResult.content[0].text);

      // Step 7: Extract auth
      steps.push('network_extract_auth');
      const authResult = await this.deps.advancedHandlers.handleNetworkExtractAuth({ minConfidence: 0.4 });
      const authData = JSON.parse(authResult.content[0].text);
      const authFindings = Array.isArray(authData.findings) ? authData.findings : [];

      // Step 8: HAR export (optional)
      let harResult: any = null;
      if (exportHar && harOutputPath) {
        await this.ensureParentDirectory(harOutputPath);
        steps.push('network_export_har');
        const harResponse = await this.deps.advancedHandlers.handleNetworkExportHar({
          outputPath: harOutputPath,
          includeBodies: false,
        });
        harResult = JSON.parse(harResponse.content[0].text);
      }

      let reportResult: { success: boolean; outputPath?: string; error?: string } | null = null;
      if (exportReport && reportOutputPath) {
        try {
          await this.ensureParentDirectory(reportOutputPath);
          const reportMarkdown = this.buildWebApiCaptureReportMarkdown({
            generatedAt: new Date().toISOString(),
            url,
            waitUntil,
            waitAfterActionsMs,
            steps,
            warnings,
            totalCaptured,
            authFindings,
            harExported: Boolean(harResult?.success),
            harOutputPath,
          });
          await writeFile(reportOutputPath, reportMarkdown, 'utf-8');
          reportResult = { success: true, outputPath: reportOutputPath };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(`Report export failed: ${message}`);
          reportResult = { success: false, outputPath: reportOutputPath, error: message };
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            steps,
            warnings: warnings.length > 0 ? warnings : undefined,
            summary: {
              capturedRequests: totalCaptured,
              authFindings: authData.found ?? 0,
              harExported: exportHar ? (harResult?.success ?? false) : 'skipped',
              harPath: harOutputPath,
              reportExported: exportReport ? (reportResult?.success ?? false) : 'skipped',
              reportPath: reportOutputPath,
            },
            authFindings,
            requestStats: requestsData.detailId
              ? { totalCaptured, detailId: requestsData.detailId, hint: 'Use get_detailed_data to retrieve full request list' }
              : requestsData.stats,
            har: exportHar && !harOutputPath ? harResult : undefined,
            report: reportResult,
          }, null, 2),
        }],
      };
    } catch (error) {
      logger.error('[web_api_capture_session] Error:', error);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            steps,
            error: error instanceof Error ? error.message : String(error),
          }, null, 2),
        }],
      };
    }
  }

  // ── register_account_flow ────────────────────────────────────────────────

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
      const authData = JSON.parse(authResult.content[0].text);

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

        const openData = JSON.parse(openResult.content[0].text);
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
              const linkData = JSON.parse(linkResult.content[0].text);
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
        if (cached && (Date.now() - cached.cachedAt) < WorkflowHandlers.BUNDLE_CACHE_TTL_MS) {
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
