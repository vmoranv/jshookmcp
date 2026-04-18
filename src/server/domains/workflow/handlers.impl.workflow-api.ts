import { logger } from '@utils/logger';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { isLoopbackHost, isPrivateHost } from '@server/domains/network/ssrf-policy';
import { WorkflowHandlersBase } from '@server/domains/workflow/handlers.impl.workflow-base';
import {
  argString,
  argStringRequired,
  argBool,
  argNumber,
  argObject,
} from '@server/domains/shared/parse-args';

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

interface WorkflowNetworkHostPattern {
  scope: 'host' | 'hostname';
  value: string;
}

interface WorkflowNetworkPolicy {
  allowPrivateNetwork: boolean;
  allowInsecureHttp: boolean;
  allowedHosts: WorkflowNetworkHostPattern[];
  allowedRedirectHosts: WorkflowNetworkHostPattern[];
  allowedCidrs: string[];
  allowedCidrBlockList: BlockList;
}

interface WorkflowNetworkAuthorization {
  parsedUrl: URL;
  resolvedIp: string | null;
  fetchUrl: string;
  headers: Record<string, string>;
}

function normalizeWorkflowHostname(host: string): string {
  return host
    .trim()
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
}

function parseWorkflowStringArray(raw: unknown): string[] | null {
  if (raw === undefined) {
    return [];
  }
  const parsed: unknown =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;

  if (!Array.isArray(parsed)) {
    return null;
  }
  const values = parsed.filter((entry): entry is string => typeof entry === 'string');
  if (values.length !== parsed.length) {
    return null;
  }
  return values.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function normalizeWorkflowHostPattern(raw: string): WorkflowNetworkHostPattern {
  const trimmed = raw.trim();
  const candidate = trimmed.includes('://') ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.port.length > 0) {
      return { scope: 'host', value: parsed.host.toLowerCase() };
    }
    return { scope: 'hostname', value: normalizeWorkflowHostname(parsed.hostname) };
  } catch {
    return { scope: 'hostname', value: normalizeWorkflowHostname(trimmed) };
  }
}

function parseWorkflowBoolean(
  raw: unknown,
  fieldName: string,
):
  | {
      ok: true;
      value: boolean;
    }
  | {
      ok: false;
      error: string;
    } {
  if (raw === undefined) {
    return { ok: true, value: false };
  }
  if (typeof raw !== 'boolean') {
    return { ok: false, error: `${fieldName} must be a boolean when provided` };
  }
  return { ok: true, value: raw };
}

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
      ? (() => {
          try {
            return JSON.parse(rawActions);
          } catch {
            return [];
          }
        })()
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
  protected parseWorkflowNetworkPolicy(args: Record<string, unknown>): {
    policy?: WorkflowNetworkPolicy;
    error?: string;
  } {
    const rawNetworkPolicy = args.networkPolicy;
    if (rawNetworkPolicy === undefined) {
      return {
        policy: {
          allowPrivateNetwork: false,
          allowInsecureHttp: false,
          allowedHosts: [],
          allowedRedirectHosts: [],
          allowedCidrs: [],
          allowedCidrBlockList: new BlockList(),
        },
      };
    }

    const parsedInput: unknown =
      typeof rawNetworkPolicy === 'string'
        ? (() => {
            try {
              return JSON.parse(rawNetworkPolicy);
            } catch {
              return null;
            }
          })()
        : rawNetworkPolicy;

    if (!parsedInput || typeof parsedInput !== 'object' || Array.isArray(parsedInput)) {
      return { error: 'networkPolicy must be an object or valid JSON object string' };
    }

    const record = parsedInput as Record<string, unknown>;
    const allowPrivateNetwork = parseWorkflowBoolean(
      record.allowPrivateNetwork,
      'networkPolicy.allowPrivateNetwork',
    );
    if (!allowPrivateNetwork.ok) {
      return { error: allowPrivateNetwork.error };
    }

    const allowInsecureHttp = parseWorkflowBoolean(
      record.allowInsecureHttp,
      'networkPolicy.allowInsecureHttp',
    );
    if (!allowInsecureHttp.ok) {
      return { error: allowInsecureHttp.error };
    }

    const allowedHosts = parseWorkflowStringArray(record.allowedHosts);
    if (allowedHosts === null) {
      return { error: 'networkPolicy.allowedHosts must be an array of strings' };
    }

    const allowedRedirectHosts = parseWorkflowStringArray(record.allowedRedirectHosts);
    if (allowedRedirectHosts === null) {
      return { error: 'networkPolicy.allowedRedirectHosts must be an array of strings' };
    }

    const allowedCidrs = parseWorkflowStringArray(record.allowedCidrs);
    if (allowedCidrs === null) {
      return { error: 'networkPolicy.allowedCidrs must be an array of strings' };
    }

    const allowedCidrBlockList = new BlockList();
    for (const cidr of allowedCidrs) {
      const [address, prefixRaw] = cidr.split('/');
      if (!address || !prefixRaw) {
        return { error: `Invalid CIDR in networkPolicy.allowedCidrs: "${cidr}"` };
      }
      const family = isIP(address);
      if (family === 0) {
        return { error: `Invalid CIDR base address in networkPolicy.allowedCidrs: "${cidr}"` };
      }
      const prefix = Number(prefixRaw);
      const maxPrefix = family === 4 ? 32 : 128;
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
        return { error: `Invalid CIDR prefix in networkPolicy.allowedCidrs: "${cidr}"` };
      }
      allowedCidrBlockList.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
    }

    return {
      policy: {
        allowPrivateNetwork: allowPrivateNetwork.value,
        allowInsecureHttp: allowInsecureHttp.value,
        allowedHosts: allowedHosts.map(normalizeWorkflowHostPattern),
        allowedRedirectHosts: allowedRedirectHosts.map(normalizeWorkflowHostPattern),
        allowedCidrs,
        allowedCidrBlockList,
      },
    };
  }

  protected async authorizeWorkflowUrl(
    targetUrl: string,
    policy: WorkflowNetworkPolicy,
    options: {
      label: string;
      allowRedirectHosts?: boolean;
      rewriteHttpHostToResolvedIp?: boolean;
    },
  ): Promise<WorkflowNetworkAuthorization> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      throw new Error(`Invalid ${options.label}: ${targetUrl}`);
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(
        `Unsupported protocol for ${options.label}: ${parsedUrl.protocol} — only http/https allowed`,
      );
    }

    const normalizedHostname = normalizeWorkflowHostname(parsedUrl.hostname);
    const parsedHost = parsedUrl.host.toLowerCase();
    const ipFamily = isIP(normalizedHostname);
    const resolvedIp =
      ipFamily !== 0
        ? normalizedHostname
        : await lookup(normalizedHostname)
            .then((result) => result.address)
            .catch((error) => {
              throw new Error(`DNS resolution failed for "${targetUrl}"`, { cause: error });
            });

    const resolvedFamily = isIP(resolvedIp);
    const matchesAllowedCidr =
      resolvedFamily !== 0 &&
      policy.allowedCidrs.length > 0 &&
      policy.allowedCidrBlockList.check(resolvedIp, resolvedFamily === 4 ? 'ipv4' : 'ipv6');
    const hostPatterns =
      options.allowRedirectHosts && policy.allowedRedirectHosts.length > 0
        ? policy.allowedRedirectHosts
        : policy.allowedHosts;
    const matchesAllowedHost = hostPatterns.some((pattern) =>
      pattern.scope === 'host'
        ? pattern.value === parsedHost
        : pattern.value === normalizedHostname,
    );
    const hasHostOrCidrRules = hostPatterns.length > 0 || policy.allowedCidrs.length > 0;
    const isAuthorizedTarget = !hasHostOrCidrRules || matchesAllowedHost || matchesAllowedCidr;

    const privateTarget = isPrivateHost(normalizedHostname) || isPrivateHost(resolvedIp);
    if (privateTarget) {
      if (!policy.allowPrivateNetwork) {
        throw new Error(
          `Blocked: ${options.label} "${targetUrl}" resolves to a private/reserved address`,
        );
      }
      if (!hasHostOrCidrRules || !isAuthorizedTarget) {
        throw new Error(
          `Blocked: ${options.label} "${targetUrl}" requires an explicit networkPolicy host or CIDR allow rule`,
        );
      }
    } else if (hasHostOrCidrRules && !isAuthorizedTarget) {
      throw new Error(
        `Blocked: ${options.label} "${targetUrl}" is not authorized by networkPolicy`,
      );
    }

    const loopbackTarget = isLoopbackHost(normalizedHostname) || isLoopbackHost(resolvedIp);
    if (parsedUrl.protocol === 'http:' && !loopbackTarget) {
      if (!policy.allowInsecureHttp) {
        throw new Error(
          `Blocked: insecure HTTP requires networkPolicy.allowInsecureHttp for "${targetUrl}"`,
        );
      }
      if (!hasHostOrCidrRules || !isAuthorizedTarget) {
        throw new Error(
          `Blocked: insecure HTTP target "${targetUrl}" requires an explicit networkPolicy host or CIDR allow rule`,
        );
      }
    }

    const fetchHeaders: Record<string, string> = {};
    let fetchUrl = parsedUrl.toString();
    if (options.rewriteHttpHostToResolvedIp && parsedUrl.protocol === 'http:' && ipFamily === 0) {
      const originalHost = parsedUrl.host;
      const pinnedUrl = new URL(parsedUrl.toString());
      pinnedUrl.hostname = resolvedIp.includes(':') ? `[${resolvedIp}]` : resolvedIp;
      fetchUrl = pinnedUrl.toString();
      fetchHeaders.Host = originalHost;
    }

    return {
      parsedUrl,
      resolvedIp,
      fetchUrl,
      headers: fetchHeaders,
    };
  }

  async handleApiProbeBatch(args: Record<string, unknown>) {
    const rawBaseUrl = typeof args.baseUrl === 'string' ? args.baseUrl.trim() : '';
    if (rawBaseUrl.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: 'baseUrl is required and must be a non-empty string',
            }),
          },
        ],
      };
    }
    const policyResult = this.parseWorkflowNetworkPolicy(args);
    if (!policyResult.policy) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: policyResult.error,
            }),
          },
        ],
      };
    }
    let normalizedBaseUrl: string;
    let authorizationHeaders: Record<string, string> = {};
    try {
      const authorization = await this.authorizeWorkflowUrl(rawBaseUrl, policyResult.policy, {
        label: 'baseUrl',
        rewriteHttpHostToResolvedIp: true,
      });
      normalizedBaseUrl = authorization.fetchUrl.replace(/\/$/, '');
      authorizationHeaders = authorization.headers;
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          },
        ],
      };
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
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: 'paths array is required and must not be empty',
            }),
          },
        ],
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
      const result = await this.deps.browserHandlers.handlePageEvaluate({ code: probeCode });
      return result;
    } catch (error) {
      logger.error('[api_probe_batch] Error:', error);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          },
        ],
      };
    }
  }

  // ── web_api_capture_session ──────────────────────────────────────────────

  async handleWebApiCaptureSession(args: Record<string, unknown>) {
    const url = argStringRequired(args, 'url');
    const waitUntil = argString(args, 'waitUntil', 'domcontentloaded');
    const actions = parseCaptureActions(args.actions);
    const exportHar = argBool(args, 'exportHar', true);
    const exportReport = argBool(args, 'exportReport', true);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const harOutputPath = exportHar
      ? this.normalizeOutputPath(
          argString(args, 'harOutputPath'),
          `artifacts/har/jshook-capture-${timestamp}.har`,
          'artifacts/har',
        )
      : undefined;
    const reportOutputPath = exportReport
      ? this.normalizeOutputPath(
          argString(args, 'reportOutputPath'),
          `artifacts/reports/web-api-capture-${timestamp}.md`,
          'artifacts/reports',
        )
      : undefined;
    const waitAfterActionsMs = argNumber(args, 'waitAfterActionsMs', 1500);

    const steps: string[] = [];
    const warnings: string[] = [];

    try {
      // Enable network monitoring + inject interceptors
      steps.push('network_enable');
      await this.deps.advancedHandlers.handleNetworkEnable({ enableExceptions: true });

      steps.push('console_inject_fetch_interceptor');
      await this.deps.advancedHandlers.handleConsoleInjectFetchInterceptor({ persistent: true });

      steps.push('console_inject_xhr_interceptor');
      await this.deps.advancedHandlers.handleConsoleInjectXhrInterceptor({ persistent: true });

      steps.push(`page_navigate(${url})`);
      await this.deps.browserHandlers.handlePageNavigate({
        url,
        waitUntil,
        enableNetworkMonitoring: true,
      });

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
          warnings.push(
            `Action ${action.type}(${action.selector ?? ''}) failed: ${actionErr instanceof Error ? actionErr.message : String(actionErr)}`,
          );
        }
      }

      // Wait for async requests to settle
      if (waitAfterActionsMs > 0) {
        steps.push(`wait(${waitAfterActionsMs}ms)`);
        await new Promise((r) => setTimeout(r, waitAfterActionsMs));
      }

      // Get network stats (lightweight, not subject to smartHandle)
      steps.push('network_get_stats');
      const statsResult = await this.deps.advancedHandlers.handleNetworkGetStats({});
      const statsText = statsResult.content[0]?.text;
      if (typeof statsText !== 'string') {
        throw new Error('network_get_stats returned invalid payload');
      }
      const statsData = JSON.parse(statsText) as NetworkStatsPayload;
      const totalCaptured = statsData.stats?.totalRequests ?? 0;

      // Collect requests (may be smartHandle'd for large payloads)
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

      steps.push('network_extract_auth');
      const authResult = await this.deps.advancedHandlers.handleNetworkExtractAuth({
        minConfidence: 0.4,
      });
      const authText = authResult.content[0]?.text;
      if (typeof authText !== 'string') {
        throw new Error('network_extract_auth returned invalid payload');
      }
      const authData = JSON.parse(authText) as AuthPayload;
      const authFindings = Array.isArray(authData.findings)
        ? authData.findings.filter(isReportAuthFinding)
        : [];

      // HAR export
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
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
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
                  ? {
                      totalCaptured,
                      detailId: requestsData.detailId,
                      hint: 'Use get_detailed_data to retrieve full request list',
                    }
                  : requestsData.stats,
                har: exportHar && !harOutputPath ? harResult : undefined,
                report: reportResult,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('[web_api_capture_session] Error:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                steps,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }
}
