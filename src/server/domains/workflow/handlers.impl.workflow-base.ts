/**
 * Workflow Handlers — composite tools that orchestrate lower-level primitives.
 *
 * Each handler coordinates multiple browser/network operations to provide
 * an end-to-end workflow with a single tool call.
 */

import { logger } from '../../../utils/logger.js';
import { mkdir, writeFile, realpath } from 'node:fs/promises';
import { dirname, basename, resolve, relative } from 'node:path';
import { getProjectRoot } from '../../../utils/outputPaths.js';

export interface ToolContentItem {
  type: string;
  text: string;
  [key: string]: unknown;
}

export interface ToolHandlerResult {
  content: ToolContentItem[];
}

interface WorkflowBrowserHandlers {
  handlePageEvaluate(args: Record<string, unknown>): Promise<ToolHandlerResult>;
  handlePageNavigate(args: Record<string, unknown>): Promise<ToolHandlerResult>;
  handlePageType(args: Record<string, unknown>): Promise<ToolHandlerResult>;
  handlePageClick(args: Record<string, unknown>): Promise<ToolHandlerResult>;
  handleTabWorkflow(args: Record<string, unknown>): Promise<ToolHandlerResult>;
}

interface WorkflowAdvancedHandlers {
  handleNetworkEnable(args: Record<string, unknown>): Promise<ToolHandlerResult>;
  handleConsoleInjectFetchInterceptor(args: Record<string, unknown>): Promise<ToolHandlerResult>;
  handleConsoleInjectXhrInterceptor(args: Record<string, unknown>): Promise<ToolHandlerResult>;
  handleNetworkGetStats(args: Record<string, unknown>): Promise<ToolHandlerResult>;
  handleNetworkGetRequests(args: Record<string, unknown>): Promise<ToolHandlerResult>;
  handleNetworkExtractAuth(args: Record<string, unknown>): Promise<ToolHandlerResult>;
  handleNetworkExportHar(args: Record<string, unknown>): Promise<ToolHandlerResult>;
}

interface AuthFindingReportEntry {
  type?: string;
  location?: string;
  confidence?: number;
  maskedValue?: string;
  masked?: string;
  value?: string;
  token?: string;
}

export interface WorkflowHandlersDeps {
  browserHandlers: WorkflowBrowserHandlers;
  advancedHandlers: WorkflowAdvancedHandlers;
}

interface ScriptEntry {
  code: string;
  description: string;
}

interface BundleCacheEntry {
  text: string;
  cachedAt: number;
}

type ToolJsonPayload = Record<string, unknown>;

export class WorkflowHandlersBase {
  protected readonly scriptRegistry = new Map<string, ScriptEntry>();
  protected readonly bundleCache = new Map<string, BundleCacheEntry>();
  static readonly BUNDLE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  static readonly MAX_SCRIPTS = 100;
  static readonly MAX_BUNDLE_CACHE = 50;
  static readonly MAX_BUNDLE_CACHE_BYTES = 100 * 1024 * 1024; // 100 MB total byte cap
  protected bundleCacheBytes = 0;

  constructor(protected deps: WorkflowHandlersDeps) {
    this.initBuiltinScripts();
  }

  /** Evict expired or oldest entries when bundleCache exceeds capacity or byte limit. */
  protected evictBundleCache(): void {
    // First pass: remove expired entries
    const now = Date.now();
    for (const [k, v] of this.bundleCache) {
      if (now - v.cachedAt >= WorkflowHandlersBase.BUNDLE_CACHE_TTL_MS) {
        this.bundleCacheBytes -= v.text.length;
        this.bundleCache.delete(k);
      }
    }
    // Second pass: evict oldest if still over entry count or byte limit
    while (
      this.bundleCache.size >= WorkflowHandlersBase.MAX_BUNDLE_CACHE ||
      this.bundleCacheBytes > WorkflowHandlersBase.MAX_BUNDLE_CACHE_BYTES
    ) {
      const oldest = this.bundleCache.keys().next().value;
      if (oldest !== undefined) {
        const entry = this.bundleCache.get(oldest);
        if (entry) this.bundleCacheBytes -= entry.text.length;
        this.bundleCache.delete(oldest);
      } else break;
    }
  }

  protected normalizeOutputPath(inputPath: string | undefined, defaultPath: string, preferredDir: string): string {
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

  protected async ensureParentDirectory(filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
  }

  /**
   * Resolve the real path of the parent directory and verify it falls within
   * the project root.  This prevents symlink-based escapes: a symlink under
   * the output tree that points outside the project would be caught here.
   */
  protected async safeWriteFile(filePath: string, data: string): Promise<void> {
    const intendedPath = resolve(filePath);
    let existingParent = dirname(intendedPath);
    const pendingSegments: string[] = [];

    while (true) {
      try {
        existingParent = await realpath(existingParent);
        break;
      } catch (error) {
        const fsError = error as NodeJS.ErrnoException;
        if (fsError.code !== 'ENOENT') {
          throw error;
        }
        const nextParent = dirname(existingParent);
        if (nextParent === existingParent) {
          throw new Error(`Unable to validate output path: ${filePath}`);
        }
        pendingSegments.unshift(basename(existingParent));
        existingParent = nextParent;
      }
    }

    const safeParent = resolve(existingParent, ...pendingSegments);
    const safePath = resolve(safeParent, basename(intendedPath));
    const realProjectRoot = await realpath(getProjectRoot());
    const rel = relative(realProjectRoot, safePath);
    if (rel.startsWith('..') || resolve(rel) === rel) {
      throw new Error(`Output path escapes project root: ${filePath}`);
    }
    await this.ensureParentDirectory(safePath);
    await writeFile(safePath, data, 'utf-8');
  }

  protected buildWebApiCaptureReportMarkdown(args: {
    generatedAt: string;
    url: string;
    waitUntil: string;
    waitAfterActionsMs: number;
    steps: string[];
    warnings: string[];
    totalCaptured: number;
    authFindings: AuthFindingReportEntry[];
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

  protected initBuiltinScripts(): void {
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

  protected getOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  protected getOptionalRecord(value: unknown): Record<string, unknown> | undefined {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  protected jsonTextResult(payload: ToolJsonPayload): ToolHandlerResult {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(payload),
      }],
    };
  }

  // ── page_script_register ─────────────────────────────────────────────────


  async handlePageScriptRegister(args: Record<string, unknown>) {
    const name = this.getOptionalString(args.name);
    const code = this.getOptionalString(args.code);
    const description = this.getOptionalString(args.description) ?? '';

    if (!name || !code) {
      return this.jsonTextResult({ success: false, error: 'name and code are required' });
    }

    const isUpdate = this.scriptRegistry.has(name);
    if (!isUpdate && this.scriptRegistry.size >= WorkflowHandlersBase.MAX_SCRIPTS) {
      // Evict oldest non-builtin entry
      for (const k of this.scriptRegistry.keys()) {
        if (!['auth_extract', 'bundle_search', 'react_fill_form', 'dom_find_upgrade_buttons'].includes(k)) {
          this.scriptRegistry.delete(k);
          break;
        }
      }
    }
    this.scriptRegistry.set(name, { code, description });

    return this.jsonTextResult({
      success: true,
      action: isUpdate ? 'updated' : 'registered',
      name,
      description,
      totalScripts: this.scriptRegistry.size,
      available: Array.from(this.scriptRegistry.keys()),
    });
  }

  // ── page_script_run ──────────────────────────────────────────────────────

  async handlePageScriptRun(args: Record<string, unknown>) {
    const name = this.getOptionalString(args.name);
    const params = this.getOptionalRecord(args.params);

    const entry = name ? this.scriptRegistry.get(name) : undefined;
    if (!entry) {
      const available = Array.from(this.scriptRegistry.keys());
      return this.jsonTextResult({
        success: false,
        error: `Script "${name}" not found`,
        available,
      });
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
      return this.jsonTextResult({
        success: false,
        script: name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

}

