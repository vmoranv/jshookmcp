/**
 * Shared types, state, and utilities for workflow domain sub-handlers.
 */

import { WORKFLOW_BUNDLE_CACHE_TTL_MS, WORKFLOW_BUNDLE_CACHE_MAX_BYTES } from '@src/constants';
import type { MCPServerContext } from '@server/MCPServer.context';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';

export interface WorkflowBrowserHandlers {
  handlePageEvaluate(args: Record<string, unknown>): Promise<ToolResponse>;
  handlePageNavigate(args: Record<string, unknown>): Promise<ToolResponse>;
  handlePageType(args: Record<string, unknown>): Promise<ToolResponse>;
  handlePageClick(args: Record<string, unknown>): Promise<ToolResponse>;
  handleTabWorkflow(args: Record<string, unknown>): Promise<ToolResponse>;
}

export interface WorkflowAdvancedHandlers {
  handleNetworkMonitor(args: Record<string, unknown>): Promise<ToolResponse>;
  handleConsoleInjectFetchInterceptor(args: Record<string, unknown>): Promise<ToolResponse>;
  handleConsoleInjectXhrInterceptor(args: Record<string, unknown>): Promise<ToolResponse>;
  handleNetworkGetStats(args: Record<string, unknown>): Promise<ToolResponse>;
  handleNetworkGetRequests(args: Record<string, unknown>): Promise<ToolResponse>;
  handleNetworkExtractAuth(args: Record<string, unknown>): Promise<ToolResponse>;
  handleNetworkExportHar(args: Record<string, unknown>): Promise<ToolResponse>;
}

export interface WorkflowHandlersDeps {
  browserHandlers: WorkflowBrowserHandlers;
  advancedHandlers: WorkflowAdvancedHandlers;
  serverContext?: MCPServerContext;
}

export interface ScriptEntry {
  code: string;
  description: string;
  source: 'core' | 'user' | 'plugin';
  protectedFromEviction: boolean;
}

interface BundleCacheEntry {
  text: string;
  cachedAt: number;
}

export const BUILTIN_SCRIPT_ENTRIES = [
  {
    name: 'auth_extract',
    description: 'Extract auth tokens from localStorage and cookies',
    code: `(function(){
  var keys=['token','active_token','access_token','jwt','auth_token','userRole','id_token','refresh_token'];
  var r={};
  for(var i=0;i<keys.length;i++){var v=localStorage.getItem(keys[i]);if(v)r[keys[i]]=v;}
  r._cookies=document.cookie;
  return r;
})()`,
  },
  {
    name: 'bundle_search',
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
  },
  {
    name: 'react_fill_form',
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
  },
  {
    name: 'dom_find_upgrade_buttons',
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
  },
] as const satisfies ReadonlyArray<{
  name: string;
  description: string;
  code: string;
}>;

export interface WorkflowSharedState {
  deps: WorkflowHandlersDeps;
  scriptRegistry: Map<string, ScriptEntry>;
  bundleCache: Map<string, BundleCacheEntry>;
  bundleCacheBytes: number;
}

export function createWorkflowSharedState(deps: WorkflowHandlersDeps): WorkflowSharedState {
  const state: WorkflowSharedState = {
    deps,
    scriptRegistry: new Map(),
    bundleCache: new Map(),
    bundleCacheBytes: 0,
  };
  initBuiltinScripts(state.scriptRegistry);
  return state;
}

export const WORKFLOW_CONSTANTS = {
  BUNDLE_CACHE_TTL_MS: WORKFLOW_BUNDLE_CACHE_TTL_MS,
  MAX_SCRIPTS: 100,
  MAX_BUNDLE_CACHE: 50,
  MAX_BUNDLE_CACHE_BYTES: WORKFLOW_BUNDLE_CACHE_MAX_BYTES,
} as const;

function initBuiltinScripts(registry: Map<string, ScriptEntry>): void {
  for (const entry of BUILTIN_SCRIPT_ENTRIES) {
    registry.set(entry.name, {
      code: entry.code,
      description: entry.description,
      source: 'core',
      protectedFromEviction: true,
    });
  }
}

export function evictBundleCache(state: WorkflowSharedState): void {
  const now = Date.now();
  for (const [k, v] of state.bundleCache) {
    if (now - v.cachedAt >= WORKFLOW_CONSTANTS.BUNDLE_CACHE_TTL_MS) {
      state.bundleCacheBytes -= v.text.length;
      state.bundleCache.delete(k);
    }
  }
  while (
    state.bundleCache.size >= WORKFLOW_CONSTANTS.MAX_BUNDLE_CACHE ||
    state.bundleCacheBytes > WORKFLOW_CONSTANTS.MAX_BUNDLE_CACHE_BYTES
  ) {
    const oldest = state.bundleCache.keys().next().value;
    if (oldest !== undefined) {
      const entry = state.bundleCache.get(oldest);
      if (entry) state.bundleCacheBytes -= entry.text.length;
      state.bundleCache.delete(oldest);
    } else break;
  }
}

export function escapeInlineScriptLiteral(value: string): string {
  return value.replace(/[<>/\u2028\u2029]/g, (char) => {
    switch (char) {
      case '<':
        return '\\u003C';
      case '>':
        return '\\u003E';
      case '/':
        return '\\u002F';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default:
        return char;
    }
  });
}

export function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function getOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function jsonTextResult(payload: Record<string, unknown>): ToolResponse {
  return R.raw(payload);
}
