/**
 * API probe sub-handler.
 */

import { logger } from '@utils/logger';
import { argString, argBool, argNumber, argObject } from '@server/domains/shared/parse-args';
import { R, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import type { WorkflowSharedState } from './shared';
import { parseWorkflowNetworkPolicy, authorizeWorkflowUrl } from './network-policy';

export class ApiHandlers {
  private state: WorkflowSharedState;

  constructor(state: WorkflowSharedState) {
    this.state = state;
  }

  async handleApiProbeBatch(args: Record<string, unknown>): Promise<ToolResponse> {
    const rawBaseUrl = typeof args.baseUrl === 'string' ? args.baseUrl.trim() : '';
    if (rawBaseUrl.length === 0) {
      return R.fail('baseUrl is required and must be a non-empty string').json();
    }
    const policyResult = parseWorkflowNetworkPolicy(args);
    if (!policyResult.policy) return R.fail(policyResult.error).json();
    let normalizedBaseUrl: string;
    let authorizationHeaders: Record<string, string> = {};
    try {
      const authorization = await authorizeWorkflowUrl(rawBaseUrl, policyResult.policy, {
        label: 'baseUrl',
        rewriteHttpHostToResolvedIp: true,
      });
      normalizedBaseUrl = authorization.fetchUrl.replace(/\/$/, '');
      authorizationHeaders = authorization.headers;
    } catch (error) {
      return R.fail(error).json();
    }

    const baseUrl = normalizedBaseUrl;
    const rawPaths = args.paths;
    const paths: string[] = Array.isArray(rawPaths)
      ? rawPaths
      : typeof rawPaths === 'string'
        ? (() => {
            try {
              return JSON.parse(rawPaths);
            } catch {
              return [];
            }
          })()
        : [];
    const method = (argString(args, 'method') ?? 'GET').toUpperCase();
    const extraHeaders = (argObject(args, 'headers') ?? {}) as Record<string, string>;
    const bodyTemplate = argString(args, 'bodyTemplate') ?? null;
    const includeBodyStatuses = Array.isArray(args.includeBodyStatuses)
      ? (args.includeBodyStatuses as unknown[]).filter((v): v is number => typeof v === 'number')
      : [200, 201, 204];
    const maxBodySnippetLength = Math.max(
      0,
      Math.min(argNumber(args, 'maxBodySnippetLength', 500), 10000),
    );
    const autoInjectAuth = argBool(args, 'autoInjectAuth', true);

    if (!paths || paths.length === 0) {
      return R.fail('paths array is required and must not be empty').json();
    }

    const probeCode = `(async function() {
  var baseUrl = ${JSON.stringify(baseUrl)};
  var paths = ${JSON.stringify(paths)};
  var method = ${JSON.stringify(method)};
  var extraHeaders = ${JSON.stringify(extraHeaders)};
  var includeBodyStatuses = ${JSON.stringify(includeBodyStatuses)};
  var maxSnippetLen = ${JSON.stringify(maxBodySnippetLength)};
  var autoInjectAuth = ${JSON.stringify(autoInjectAuth)};
  var bodyTemplate = ${JSON.stringify(bodyTemplate)};
  var authHeaders = ${JSON.stringify(authorizationHeaders)};
  var headers = Object.assign({'Content-Type':'application/json'}, extraHeaders, authHeaders);
  if (autoInjectAuth) {
    var token = localStorage.getItem('token') || localStorage.getItem('active_token') || localStorage.getItem('access_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
  }
  var results = {};
  async function probePath(path) {
    try {
      var opts = {method: method, headers: headers, redirect: 'error'};
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
      return [path, {status: resp.status, contentType: ct.split(';')[0].trim(), snippet: snippet}];
    } catch(e) {
      return [path, {status: -1, error: e instanceof Error ? e.message : String(e)}];
    }
  }
  var nextIndex = 0;
  var maxConcurrency = Math.min(paths.length, 6);
  await Promise.all(Array.from({ length: maxConcurrency }, async function() {
    while (nextIndex < paths.length) {
      var currentIndex = nextIndex++;
      var currentPath = paths[currentIndex];
      var entry = await probePath(currentPath);
      results[entry[0]] = entry[1];
    }
  }));
  return {probed: paths.length, method: method, baseUrl: baseUrl, results: results};
})()`;

    try {
      const resp = await this.state.deps.browserHandlers.handlePageEvaluate({ code: probeCode });
      const data = R.parse<any>(resp);
      return R.ok().merge(data).json();
    } catch (error) {
      logger.error('[api_probe_batch] Error:', error);
      return R.fail(error).json();
    }
  }
}
