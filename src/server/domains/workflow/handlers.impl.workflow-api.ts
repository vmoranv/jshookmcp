import { logger } from '../../../utils/logger.js';
import { isSsrfTarget } from '../network/replay.js';
import { WorkflowHandlersBase } from './handlers.impl.workflow-base.js';

interface CaptureSessionAction {
  type: 'click' | 'type' | 'wait' | 'evaluate';
  selector?: string;
  text?: string;
  expression?: string;
  delayMs?: number;
}

interface NetworkStatsPayload {
  stats?: {
    totalRequests?: number;
    [key: string]: unknown;
  };
}

interface RequestsPayload {
  detailId?: string;
  stats?: unknown;
}

interface AuthPayload {
  found?: number;
  findings?: unknown[];
}

interface GenericPayload extends Record<string, unknown> {}

interface ReportAuthFinding {
  type?: string;
  location?: string;
  confidence?: number;
  maskedValue?: string;
  masked?: string;
  value?: string;
  token?: string;
}

function isReportAuthFinding(value: unknown): value is ReportAuthFinding {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return true;
}

function parseCaptureActions(rawActions: unknown): CaptureSessionAction[] {
  const parsed: unknown = Array.isArray(rawActions)
    ? rawActions
    : typeof rawActions === 'string'
      ? (() => { try { return JSON.parse(rawActions); } catch { return []; } })()
      : [];

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item): item is CaptureSessionAction => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const type = (item as { type?: unknown }).type;
    return type === 'click' || type === 'type' || type === 'wait' || type === 'evaluate';
  });
}

export class WorkflowHandlersApi extends WorkflowHandlersBase {
  async handleApiProbeBatch(args: Record<string, unknown>) {
    const rawBaseUrl = typeof args.baseUrl === 'string' ? args.baseUrl.trim() : '';
    if (rawBaseUrl.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: false, error: 'baseUrl is required and must be a non-empty string' }),
        }],
      };
    }
    // Protocol whitelist — only allow http/https to prevent arbitrary scheme SSRF
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawBaseUrl);
    } catch {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: false, error: `Invalid baseUrl: ${rawBaseUrl}` }),
        }],
      };
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ success: false, error: `Unsupported protocol: ${parsedUrl.protocol} — only http/https allowed` }),
        }],
      };
    }
    const normalizedBaseUrl = parsedUrl.toString().replace(/\/$/, '');
    if (await isSsrfTarget(normalizedBaseUrl)) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            error: `Blocked: baseUrl "${rawBaseUrl}" resolves to a private/reserved address`,
          }),
        }],
      };
    }
    const baseUrl = normalizedBaseUrl;
    const rawPaths = args.paths;
    const paths: string[] = Array.isArray(rawPaths)
      ? rawPaths
      : typeof rawPaths === 'string'
        ? (() => { try { return JSON.parse(rawPaths); } catch { return []; } })()
        : [];
    const method = ((args.method as string | undefined) ?? 'GET').toUpperCase();
    const extraHeaders = (args.headers as Record<string, string> | undefined) ?? {};
    const bodyTemplate = (args.bodyTemplate as string | undefined) ?? null;
    const includeBodyStatuses = Array.isArray(args.includeBodyStatuses)
      ? (args.includeBodyStatuses as unknown[]).filter((v): v is number => typeof v === 'number')
      : [200, 201, 204];
    const maxBodySnippetLength = typeof args.maxBodySnippetLength === 'number'
      ? Math.max(0, Math.min(args.maxBodySnippetLength, 10000))
      : 500;
    const autoInjectAuth = typeof args.autoInjectAuth === 'boolean' ? args.autoInjectAuth : true;

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
  var maxSnippetLen = ${JSON.stringify(maxBodySnippetLength)};
  var autoInjectAuth = ${JSON.stringify(autoInjectAuth)};
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
    const actions = parseCaptureActions(args.actions);
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
      const statsText = statsResult.content[0]?.text;
      if (typeof statsText !== 'string') {
        throw new Error('network_get_stats returned invalid payload');
      }
      const statsData = JSON.parse(statsText) as NetworkStatsPayload;
      const totalCaptured = statsData.stats?.totalRequests ?? 0;

      // Step 6: Collect requests (may be smartHandle'd for large payloads)
      steps.push('network_get_requests');
      const requestsResult = await this.deps.advancedHandlers.handleNetworkGetRequests({
        limit: 500,
        offset: 0,
      });
      const requestsText = requestsResult.content[0]?.text;
      if (typeof requestsText !== 'string') {
        throw new Error('network_get_requests returned invalid payload');
      }
      const requestsData = JSON.parse(requestsText) as RequestsPayload;

      // Step 7: Extract auth
      steps.push('network_extract_auth');
      const authResult = await this.deps.advancedHandlers.handleNetworkExtractAuth({ minConfidence: 0.4 });
      const authText = authResult.content[0]?.text;
      if (typeof authText !== 'string') {
        throw new Error('network_extract_auth returned invalid payload');
      }
      const authData = JSON.parse(authText) as AuthPayload;
      const authFindings = Array.isArray(authData.findings)
        ? authData.findings.filter(isReportAuthFinding)
        : [];

      // Step 8: HAR export (optional)
      let harResult: GenericPayload | null = null;
      if (exportHar && harOutputPath) {
        await this.ensureParentDirectory(harOutputPath);
        steps.push('network_export_har');
        const harResponse = await this.deps.advancedHandlers.handleNetworkExportHar({
          outputPath: harOutputPath,
          includeBodies: false,
        });
        const harText = harResponse.content[0]?.text;
        if (typeof harText !== 'string') {
          throw new Error('network_export_har returned invalid payload');
        }
        harResult = JSON.parse(harText) as GenericPayload;
      }

      let reportResult: { success: boolean; outputPath?: string; error?: string } | null = null;
      if (exportReport && reportOutputPath) {
        try {
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
          await this.safeWriteFile(reportOutputPath, reportMarkdown);
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

}
