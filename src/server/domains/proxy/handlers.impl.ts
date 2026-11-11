import { createPrivateKey } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@utils/logger';
import { R, handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { argNumber, argBool, argString, argObject } from '@server/domains/shared/parse-args';
import {
  PROXY_ADB_MAX_BUFFER_BYTES,
  PROXY_ADB_TIMEOUT_MS,
  PROXY_CAPTURE_BODY_PREVIEW_BYTES,
  PROXY_CAPTURE_BODY_SKIP_BYTES,
  PROXY_CAPTURE_BUFFER_MAX,
  PROXY_CAPTURE_RETURN_LIMIT,
} from '@src/constants';
import { ensureMockttpCaCompatibilityPatched } from '@server/domains/proxy/mockttp-ca-compat';
import { getToolRequestContext } from '@server/runtime/ToolRequestContext';

const ResponseBuilder = {
  success: (data: Record<string, unknown>) => R.ok().merge(data).json(),
  error: (msg: string) => R.fail(msg).mcpError().json(),
};

const PROXY_RULE_ACTIONS = new Set(['forward', 'mock_response', 'redirect', 'block'] as const);
const HTTP_METHOD_RE = /^[A-Z][A-Z0-9_-]*$|^\*$/;

type ProxyRuleAction = 'forward' | 'mock_response' | 'redirect' | 'block';
type ParsedValue<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: string;
    };

interface CaptureEntry {
  type: 'request' | 'response';
  id: string;
  method?: string;
  url?: string;
  status?: number;
  headers?: Record<string, string>;
  bodyTextPreview?: string;
  bodyBytes?: number;
  bodyPreviewBytes?: number;
  bodyTruncated?: boolean;
  bodyEncoding?: 'utf8';
  bodyUnavailable?: string;
  bodySkipped?: string;
  remoteIpAddress?: string;
  remotePort?: number;
  timing?: CaptureTiming;
  timestamp: number;
}

/** Header map where `undefined` means "remove this header" (mockttp convention). */
type HeaderMap = Record<string, string | undefined>;

/** A single [match, replacement] pair; match may be a string or a compiled RegExp. */
type MatchReplacePair = [string | RegExp, string];
type MatchReplacePairs = MatchReplacePair[];

interface ForwardTransformRequest {
  replaceMethod?: string;
  updateHeaders?: HeaderMap;
  replaceHeaders?: HeaderMap;
  replaceBody?: string;
  matchReplaceBody?: MatchReplacePairs;
  updateJsonBody?: Record<string, unknown>;
}

interface ForwardTransformResponse {
  replaceStatus?: number;
  updateHeaders?: HeaderMap;
  replaceHeaders?: HeaderMap;
  replaceBody?: string;
  matchReplaceBody?: MatchReplacePairs;
  updateJsonBody?: Record<string, unknown>;
}

/**
 * Declarative passthrough rewrite. A structural subset of mockttp's
 * `PassThroughStepOptions.transformRequest`/`transformResponse` — callback
 * modes (`beforeRequest`/`beforeResponse`) are intentionally not exposed
 * (MCP cannot transport functions; lesson #51 honest boundary).
 */
interface ChainUpstream {
  proxyUrl?: string;
  noProxy?: string[];
  trustedCAs?: Array<{ cert?: string; certPath?: string }>;
}

interface CallbackScript {
  path: string;
}

interface ForwardOptions {
  transformRequest?: ForwardTransformRequest;
  transformResponse?: ForwardTransformResponse;
  /** Upstream proxy to chain through (e.g., corporate proxy or SOCKS5 relay). */
  chainUpstream?: ChainUpstream;
  /** Path to a JS module exporting beforeRequest(req) and/or beforeResponse(res, req). Mutually exclusive with transformRequest/transformResponse. */
  callbackScript?: CallbackScript;
}

interface ProxyRuleRecord {
  ownerSessionId: string;
  endpointId: string;
  action: string;
  method: string;
  urlPattern: string;
  mockStatus?: number;
  mockBody?: string;
  forwardOptions?: ForwardOptions;
  targetUrl?: string;
  delayMs?: number;
  createdAt: string;
}

interface CaptureTiming {
  startedAt?: string;
  startTime?: number;
  bodyReceivedMs?: number;
  headersSentMs?: number;
  responseSentMs?: number;
  durationMs?: number;
}

interface CaptureBody {
  getText?: () => Promise<string | undefined>;
  asText?: () => Promise<string>;
  buffer?: Buffer;
}

interface CapturePayload {
  id: string;
  method?: string;
  url?: string;
  statusCode?: number;
  headers?: Record<string, unknown>;
  body?: CaptureBody;
  timingEvents?: {
    startTime?: number;
    startTimestamp?: number;
    bodyReceivedTimestamp?: number;
    headersSentTimestamp?: number;
    responseSentTimestamp?: number;
    abortedTimestamp?: number;
  };
  remoteIpAddress?: string;
  remotePort?: number;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

interface ProxyRuleBuilder {
  delay: (ms: number) => ProxyRuleBuilder;
  thenPassThrough: (options?: ForwardOptions) => Promise<{ id: string }>;
  thenForwardTo: (target: string, options?: ForwardOptions) => Promise<{ id: string }>;
  thenCloseConnection: () => Promise<{ id: string }>;
  thenReply: (status: number, body: string) => Promise<{ id: string }>;
}

interface ProxyRuleServer {
  forGet: (m: RegExp) => unknown;
  forPost: (m: RegExp) => unknown;
  forPut: (m: RegExp) => unknown;
  forDelete: (m: RegExp) => unknown;
  forMethod?: (method: string, m: RegExp) => unknown;
  forAnyRequest: () => unknown;
}

/** A rule builder exposes `thenCloseConnection`; an error response exposes `content`. */
function isProxyRuleBuilder(
  value: ProxyRuleBuilder | ReturnType<typeof ResponseBuilder.error>,
): value is ProxyRuleBuilder {
  return typeof (value as { thenCloseConnection?: unknown }).thenCloseConnection === 'function';
}

/** Pick the mockttp rule builder for the requested method, or an error response. */
function selectRuleBuilder(
  server: ProxyRuleServer,
  method: string,
  matcher: RegExp,
): ProxyRuleBuilder | ReturnType<typeof ResponseBuilder.error> {
  if (method === 'GET') return server.forGet(matcher) as ProxyRuleBuilder;
  if (method === 'POST') return server.forPost(matcher) as ProxyRuleBuilder;
  if (method === 'PUT') return server.forPut(matcher) as ProxyRuleBuilder;
  if (method === 'DELETE') return server.forDelete(matcher) as ProxyRuleBuilder;
  if (method === 'ANY' || method === '*' || method === 'ALL') {
    return server.forAnyRequest() as ProxyRuleBuilder;
  }
  if (typeof server.forMethod === 'function') {
    return server.forMethod(method, matcher) as ProxyRuleBuilder;
  }
  return ResponseBuilder.error(`Proxy server does not support method-specific rules for ${method}`);
}

/** Parse and validate the action-specific fields of a proxy_add_rule call. */
function parseProxyRulePayload(args: Record<string, unknown>):
  | {
      ok: true;
      action: ProxyRuleAction;
      method: string;
      urlPattern: string;
      mockStatus: number | undefined;
      mockBody: string | undefined;
      targetUrl: string | undefined;
      delayMs: number;
    }
  | { ok: false; response: ReturnType<typeof ResponseBuilder.error> } {
  const fail = (error: string) => ({ ok: false as const, response: ResponseBuilder.error(error) });

  const parsedAction = parseRuleAction(args['action']);
  if (!parsedAction.ok) return fail(parsedAction.error);
  const action = parsedAction.value;

  const parsedMethod = parseRuleMethod(args);
  if (!parsedMethod.ok) return fail(parsedMethod.error);

  const parsedUrlPattern = parseOptionalString(args, 'urlPattern', '.*');
  if (!parsedUrlPattern.ok) return fail(parsedUrlPattern.error);

  let mockStatus: number | undefined;
  let mockBody: string | undefined;
  if (action === 'mock_response') {
    const parsedMockStatus = parseMockStatus(args);
    if (!parsedMockStatus.ok) return fail(parsedMockStatus.error);
    mockStatus = parsedMockStatus.value;

    const parsedMockBody = parseOptionalString(args, 'mockBody', '');
    if (!parsedMockBody.ok) return fail(parsedMockBody.error);
    mockBody = parsedMockBody.value;
  }

  let targetUrl: string | undefined;
  if (action === 'redirect') {
    const parsedTargetUrl = parseOptionalString(args, 'targetUrl', '');
    if (!parsedTargetUrl.ok) return fail(parsedTargetUrl.error);
    const trimmed = parsedTargetUrl.value.trim();
    if (trimmed === '') return fail('targetUrl is required when action=redirect');
    // mockttp's thenForwardTo throws if the target includes a path; reject
    // path/query/fragment up front for a clearer message. Scheme is optional.
    const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    if (/[/?#]/.test(withoutScheme)) {
      return fail(
        'targetUrl must be a root URL with no path, query, or fragment (e.g. http://host:port); the original request path is preserved',
      );
    }
    targetUrl = trimmed;
  }

  const rawDelayMs = argNumber(args, 'delayMs') ?? 0;
  if (!Number.isFinite(rawDelayMs) || !Number.isInteger(rawDelayMs) || rawDelayMs < 0) {
    return fail('delayMs must be a non-negative integer when provided');
  }

  return {
    ok: true,
    action,
    method: parsedMethod.value,
    urlPattern: parsedUrlPattern.value,
    mockStatus,
    mockBody,
    targetUrl,
    delayMs: rawDelayMs,
  };
}

function compileUrlPattern(urlPattern: string): RegExp {
  const trimmed = urlPattern.trim();
  const regexLiteral = /^\/(.+)\/([a-z]*)$/.exec(trimmed);
  if (regexLiteral && regexLiteral[1] !== undefined) {
    const source = regexLiteral[1];
    const flags = regexLiteral[2] ?? '';
    return new RegExp(source, flags);
  }
  return new RegExp(trimmed);
}

function parseRuleAction(value: unknown): ParsedValue<ProxyRuleAction> {
  if (typeof value !== 'string' || !PROXY_RULE_ACTIONS.has(value as ProxyRuleAction)) {
    return {
      ok: false,
      error: 'action must be one of: forward, mock_response, redirect, block',
    };
  }
  return { ok: true, value: value as ProxyRuleAction };
}

function parseOptionalString(
  args: Record<string, unknown>,
  key: string,
  fallback: string,
): ParsedValue<string> {
  const value = args[key];
  if (value === undefined || value === null) {
    return { ok: true, value: fallback };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: `${key} must be a string when provided` };
  }
  return { ok: true, value };
}

function parseRuleMethod(args: Record<string, unknown>): ParsedValue<string> {
  const parsed = parseOptionalString(args, 'method', 'GET');
  if (!parsed.ok) return parsed;

  const method = parsed.value.trim().toUpperCase();
  if (!HTTP_METHOD_RE.test(method)) {
    return {
      ok: false,
      error: 'method must be a valid HTTP method token, ANY, ALL, or *',
    };
  }
  return { ok: true, value: method };
}

function parseMockStatus(args: Record<string, unknown>): ParsedValue<number> {
  const value = args['mockStatus'];
  if (value === undefined || value === null) {
    return { ok: true, value: 200 };
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 100 ||
    value > 599
  ) {
    return {
      ok: false,
      error: 'mockStatus must be an integer between 100 and 599 when provided',
    };
  }
  return { ok: true, value };
}

/**
 * Normalize a caller-supplied header map into mockttp's convention:
 * `null` (JSON) → `undefined` (remove), strings kept, anything else rejected.
 * Throws on invalid shapes so `handleSafe` surfaces a structured error.
 */
function normalizeForwardHeaderMap(raw: unknown, field: string): HeaderMap | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`forwardOptions.${field} must be an object of header name to string|null`);
  }
  const result: HeaderMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null) {
      result[key] = undefined; // mockttp: undefined removes the header
    } else if (typeof value === 'string') {
      result[key] = value;
    } else {
      throw new Error(`forwardOptions.${field}["${key}"] must be a string or null`);
    }
  }
  return result;
}

/**
 * Compile one caller-supplied match expression into mockttp's expected form:
 * a `/pattern/flags` regex literal becomes a `RegExp`, any other string is kept
 * as a literal string match. Throws on a malformed regex literal.
 */
function compileMatchExpression(expr: string, field: string): string | RegExp {
  const regexLiteral = /^\/(.+)\/([a-z]*)$/.exec(expr);
  if (regexLiteral && regexLiteral[1] !== undefined) {
    const source = regexLiteral[1];
    const flags = regexLiteral[2] ?? '';
    try {
      return new RegExp(source, flags);
    } catch (e) {
      throw new Error(
        `forwardOptions.${field} is not a valid regex literal: ${
          e instanceof Error ? e.message : String(e)
        }`,
        { cause: e },
      );
    }
  }
  return expr;
}

/**
 * Validate and compile caller-supplied `matchReplaceBody` pairs into mockttp's
 * `MatchReplacePairs`. Each pair is `[match, replacement]`; `match` is a plain
 * string or a `/pattern/flags` regex literal, `replacement` supports `$1`-style
 * placeholders (mockttp applies them via `String.prototype.replace`).
 */
function parseMatchReplacePairs(raw: unknown, field: string): MatchReplacePairs | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`forwardOptions.${field} must be an array of [match, replacement] pairs`);
  }
  const result: MatchReplacePairs = [];
  for (let i = 0; i < raw.length; i += 1) {
    const pair = raw[i];
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new Error(`forwardOptions.${field}[${i}] must be a [match, replacement] pair`);
    }
    const [match, replacement] = pair as [unknown, unknown];
    if (typeof match !== 'string') {
      throw new Error(
        `forwardOptions.${field}[${i}][0] must be a string (plain or /pattern/flags)`,
      );
    }
    if (typeof replacement !== 'string') {
      throw new Error(`forwardOptions.${field}[${i}][1] must be a string`);
    }
    result.push([compileMatchExpression(match, `${field}[${i}][0]`), replacement]);
  }
  return result;
}

function buildForwardTransformRequest(raw: Record<string, unknown>): ForwardTransformRequest {
  const result: ForwardTransformRequest = {};
  const replaceMethod = raw['replaceMethod'];
  if (replaceMethod !== undefined && replaceMethod !== null) {
    if (typeof replaceMethod !== 'string' || replaceMethod.trim() === '') {
      throw new Error('forwardOptions.transformRequest.replaceMethod must be a non-empty string');
    }
    result.replaceMethod = replaceMethod.toUpperCase();
  }
  const updateHeaders = normalizeForwardHeaderMap(
    raw['updateHeaders'],
    'transformRequest.updateHeaders',
  );
  if (updateHeaders) result.updateHeaders = updateHeaders;
  const replaceHeaders = normalizeForwardHeaderMap(
    raw['replaceHeaders'],
    'transformRequest.replaceHeaders',
  );
  if (replaceHeaders) result.replaceHeaders = replaceHeaders;
  const replaceBody = raw['replaceBody'];
  if (replaceBody !== undefined && replaceBody !== null) {
    if (typeof replaceBody !== 'string') {
      throw new Error('forwardOptions.transformRequest.replaceBody must be a string');
    }
    result.replaceBody = replaceBody;
  }
  const matchReplaceBody = parseMatchReplacePairs(
    raw['matchReplaceBody'],
    'transformRequest.matchReplaceBody',
  );
  if (matchReplaceBody) result.matchReplaceBody = matchReplaceBody;
  const updateJsonBody = raw['updateJsonBody'];
  if (updateJsonBody !== undefined && updateJsonBody !== null) {
    if (typeof updateJsonBody !== 'object' || Array.isArray(updateJsonBody)) {
      throw new Error('forwardOptions.transformRequest.updateJsonBody must be an object');
    }
    result.updateJsonBody = updateJsonBody as Record<string, unknown>;
  }
  return result;
}

function buildForwardTransformResponse(raw: Record<string, unknown>): ForwardTransformResponse {
  const result: ForwardTransformResponse = {};
  const replaceStatus = raw['replaceStatus'];
  if (replaceStatus !== undefined && replaceStatus !== null) {
    if (
      typeof replaceStatus !== 'number' ||
      !Number.isInteger(replaceStatus) ||
      replaceStatus < 100 ||
      replaceStatus > 599
    ) {
      throw new Error(
        'forwardOptions.transformResponse.replaceStatus must be an integer between 100 and 599',
      );
    }
    result.replaceStatus = replaceStatus;
  }
  const updateHeaders = normalizeForwardHeaderMap(
    raw['updateHeaders'],
    'transformResponse.updateHeaders',
  );
  if (updateHeaders) result.updateHeaders = updateHeaders;
  const replaceHeaders = normalizeForwardHeaderMap(
    raw['replaceHeaders'],
    'transformResponse.replaceHeaders',
  );
  if (replaceHeaders) result.replaceHeaders = replaceHeaders;
  const replaceBody = raw['replaceBody'];
  if (replaceBody !== undefined && replaceBody !== null) {
    if (typeof replaceBody !== 'string') {
      throw new Error('forwardOptions.transformResponse.replaceBody must be a string');
    }
    result.replaceBody = replaceBody;
  }
  const matchReplaceBody = parseMatchReplacePairs(
    raw['matchReplaceBody'],
    'transformResponse.matchReplaceBody',
  );
  if (matchReplaceBody) result.matchReplaceBody = matchReplaceBody;
  const updateJsonBody = raw['updateJsonBody'];
  if (updateJsonBody !== undefined && updateJsonBody !== null) {
    if (typeof updateJsonBody !== 'object' || Array.isArray(updateJsonBody)) {
      throw new Error('forwardOptions.transformResponse.updateJsonBody must be an object');
    }
    result.updateJsonBody = updateJsonBody as Record<string, unknown>;
  }
  return result;
}

/**
 * Build declarative passthrough rewrite options from raw args.
 * Returns `undefined` when `forwardOptions` is absent (plain passthrough,
 * byte-identical to prior behavior). Throws on malformed input.
 */
/** `chainUpstream`: an upstream proxy the forwarded request is chained through. */
function buildChainUpstream(value: unknown): ChainUpstream {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('forwardOptions.chainUpstream must be an object');
  }
  const cu = value as Record<string, unknown>;
  if (typeof cu['proxyUrl'] !== 'string') {
    throw new Error(
      cu['proxyUrl'] === undefined || cu['proxyUrl'] === null
        ? 'forwardOptions.chainUpstream.proxyUrl is required'
        : 'forwardOptions.chainUpstream.proxyUrl must be a string',
    );
  }
  const chainUpstream: ChainUpstream = { proxyUrl: cu['proxyUrl'] };

  const noProxy = cu['noProxy'];
  if (noProxy !== undefined && noProxy !== null) {
    if (!Array.isArray(noProxy) || noProxy.some((v) => typeof v !== 'string')) {
      throw new Error('forwardOptions.chainUpstream.noProxy must be an array of strings');
    }
    chainUpstream.noProxy = noProxy as string[];
  }
  const trustedCAs = cu['trustedCAs'];
  if (trustedCAs !== undefined && trustedCAs !== null) {
    if (!Array.isArray(trustedCAs)) {
      throw new Error('forwardOptions.chainUpstream.trustedCAs must be an array');
    }
    chainUpstream.trustedCAs = trustedCAs as Array<{ cert?: string; certPath?: string }>;
  }
  return chainUpstream;
}

/** `callbackScript` cannot be combined with a declarative transform. */
function buildCallbackScript(value: unknown, hasTransform: boolean): { path: string } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('forwardOptions.callbackScript must be an object with a path field');
  }
  const cb = value as Record<string, unknown>;
  if (typeof cb['path'] !== 'string' || cb['path'].trim() === '') {
    throw new Error('forwardOptions.callbackScript.path must be a non-empty string');
  }
  if (hasTransform) {
    throw new Error(
      'forwardOptions.callbackScript is mutually exclusive with transformRequest/transformResponse',
    );
  }
  return { path: cb['path'] };
}

function buildForwardOptions(args: Record<string, unknown>): ForwardOptions | undefined {
  const raw = argObject(args, 'forwardOptions');
  if (raw === undefined) return undefined;
  const result: ForwardOptions = {};
  const transformRequest = raw['transformRequest'];
  if (transformRequest !== undefined && transformRequest !== null) {
    if (typeof transformRequest !== 'object' || Array.isArray(transformRequest)) {
      throw new Error('forwardOptions.transformRequest must be an object');
    }
    result.transformRequest = buildForwardTransformRequest(
      transformRequest as Record<string, unknown>,
    );
  }
  const transformResponse = raw['transformResponse'];
  if (transformResponse !== undefined && transformResponse !== null) {
    if (typeof transformResponse !== 'object' || Array.isArray(transformResponse)) {
      throw new Error('forwardOptions.transformResponse must be an object');
    }
    result.transformResponse = buildForwardTransformResponse(
      transformResponse as Record<string, unknown>,
    );
  }

  const chainRaw = raw['chainUpstream'];
  if (chainRaw !== undefined && chainRaw !== null) {
    result.chainUpstream = buildChainUpstream(chainRaw);
  }

  const callbackScript = buildCallbackScript(
    raw['callbackScript'],
    Boolean(result.transformRequest || result.transformResponse),
  );
  if (callbackScript) {
    result.callbackScript = callbackScript;
  } else if (!result.transformRequest && !result.transformResponse && !result.chainUpstream) {
    // No options at all → undefined (plain passthrough).
    return undefined;
  }

  return result;
}

function normalizeHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (Array.isArray(value)) {
      normalized[key] = value.map((item) => String(item)).join(', ');
    } else if (value !== undefined) {
      normalized[key] = String(value);
    }
  }
  return normalized;
}

function millisFrom(base: number | undefined, value: number | undefined): number | undefined {
  if (typeof base !== 'number' || typeof value !== 'number') {
    return undefined;
  }
  return Math.max(0, Math.round((value - base) * 1000) / 1000);
}

function buildTiming(events: CapturePayload['timingEvents']): CaptureTiming | undefined {
  if (!events) {
    return undefined;
  }
  const base = events.startTimestamp;
  const bodyReceivedMs = millisFrom(base, events.bodyReceivedTimestamp);
  const headersSentMs = millisFrom(base, events.headersSentTimestamp);
  const responseSentMs = millisFrom(base, events.responseSentTimestamp);
  const abortedMs = millisFrom(base, events.abortedTimestamp);
  const durationMs = responseSentMs ?? headersSentMs ?? abortedMs ?? bodyReceivedMs;
  return {
    ...(typeof events.startTime === 'number'
      ? {
          startedAt: new Date(events.startTime).toISOString(),
          startTime: events.startTime,
        }
      : {}),
    ...(bodyReceivedMs !== undefined ? { bodyReceivedMs } : {}),
    ...(headersSentMs !== undefined ? { headersSentMs } : {}),
    ...(responseSentMs !== undefined ? { responseSentMs } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

function truncateUtf8(text: string): {
  bodyTextPreview: string;
  bodyBytes: number;
  bodyPreviewBytes: number;
  bodyTruncated: boolean;
  bodyEncoding: 'utf8';
} {
  const raw = Buffer.from(text, 'utf8');
  const preview = raw.subarray(0, PROXY_CAPTURE_BODY_PREVIEW_BYTES);
  return {
    bodyTextPreview: preview.toString('utf8'),
    bodyBytes: raw.length,
    bodyPreviewBytes: preview.length,
    bodyTruncated: raw.length > preview.length,
    bodyEncoding: 'utf8',
  };
}

/** Extract a numeric content-length from a (possibly multi-valued) header map. */
function getContentLength(headers: Record<string, unknown> | undefined): number | undefined {
  if (!headers) return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== 'content-length') continue;
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === 'string') {
      const n = Number(raw.trim());
      if (Number.isFinite(n) && n >= 0) return n;
    } else if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
      return raw;
    }
  }
  return undefined;
}

export async function readBodyPreview(
  body: CaptureBody | undefined,
  sizeHint?: number,
): Promise<Partial<CaptureEntry>> {
  if (!body) {
    return {};
  }
  // Precheck: skip decoding bodies already known to be oversized, so the proxy
  // never materializes a multi-MB request/response string on the hot path.
  // Take the larger of the (attacker/transfer-encoding-controlled) Content-Length
  // hint and the actual buffered size, so a small fake hint can't bypass the skip.
  const knownSize = Math.max(sizeHint ?? 0, Buffer.isBuffer(body.buffer) ? body.buffer.length : 0);
  if (knownSize > PROXY_CAPTURE_BODY_SKIP_BYTES) {
    return {
      bodyBytes: knownSize,
      bodySkipped: `body exceeds ${PROXY_CAPTURE_BODY_SKIP_BYTES} bytes; preview not captured`,
    };
  }
  try {
    let text: string | undefined;
    if (typeof body.getText === 'function') {
      text = await body.getText();
    } else if (typeof body.asText === 'function') {
      text = await body.asText();
    } else if (Buffer.isBuffer(body.buffer)) {
      text = body.buffer.toString('utf8');
    }

    if (text === undefined) {
      return { bodyUnavailable: 'body could not be decoded as text' };
    }

    return truncateUtf8(text);
  } catch (error) {
    return { bodyUnavailable: error instanceof Error ? error.message : String(error) };
  }
}

export class ProxyHandlers {
  private server: unknown = null;
  private readonly caPathDir: string;
  private currentPort: number | null = null;
  private captureBuffer: CaptureEntry[] = [];
  private ruleRecords: ProxyRuleRecord[] = [];
  private ruleEndpoints = new Map<
    string,
    { id: string; rule?: unknown; dispose?: () => Promise<void> }
  >();
  private mockttpModule: typeof import('mockttp') | null = null;
  private caReady = false;
  private readonly owners = new Set<string>();
  private readonly captureClearWatermarks = new Map<string, number>();
  private currentUseHttps: boolean | null = null;
  private captureEnabled = true;

  constructor() {
    // Resolve CA dir without touching disk — actual mkdir happens lazily in ensureCa().
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
    this.caPathDir = path.join(home, '.jshookmcp', 'ca');
  }

  private currentSessionId(): string {
    const sessionId = getToolRequestContext()?.sessionId;
    return typeof sessionId === 'string' && sessionId.trim().length > 0
      ? sessionId.trim()
      : 'default';
  }

  private isOwner(sessionId = this.currentSessionId()): boolean {
    return (
      this.owners.has(sessionId) ||
      (sessionId === 'default' && this.owners.size === 0 && this.server !== null)
    );
  }

  async handleProxyStartTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyStart(args));
  }

  async handleProxyStopTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyStop(args));
  }

  async handleProxyStatusTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyStatus(args));
  }

  async handleProxyExportCaTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyExportCa(args));
  }

  async handleProxyAddRuleTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyAddRule(args));
  }

  async handleProxyListRulesTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyListRules(args));
  }

  async handleProxyRemoveRuleTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyRemoveRule(args));
  }

  async handleProxyClearRulesTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyClearRules(args));
  }

  async handleProxyGetRequestsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyGetRequests(args));
  }

  async handleProxyClearLogsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxyClearLogs(args));
  }

  async handleProxySetupAdbDeviceTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProxySetupAdbDevice(args));
  }

  /** Push capture entry with bounded buffer (FIFO). */
  private appendCapture(entry: CaptureEntry): void {
    this.captureBuffer.push(entry);
    if (this.captureBuffer.length > PROXY_CAPTURE_BUFFER_MAX) {
      this.captureBuffer.shift();
    }
  }

  private updateCapture(
    type: CaptureEntry['type'],
    id: string,
    patch: Partial<CaptureEntry>,
  ): void {
    const entry = this.captureBuffer.find((item) => item.type === type && item.id === id);
    if (entry) {
      Object.assign(entry, patch);
    }
  }

  /** Lazily ensure CA dir + key/cert exist. Idempotent, async. */
  private async ensureCa(
    mockttp: typeof import('mockttp'),
  ): Promise<{ key: string; cert: string; certPath: string }> {
    const keyPath = path.join(this.caPathDir, 'ca.key');
    const certPath = path.join(this.caPathDir, 'ca.pem');

    if (!this.caReady) {
      await mkdir(this.caPathDir, { recursive: true });
      this.caReady = true;
    }

    const hasKey = await pathExists(keyPath);
    const hasCert = await pathExists(certPath);

    if (!hasKey || !hasCert) {
      logger.info('[proxy] generating new CA certificates');
      const ca = await mockttp.generateCACertificate();

      // Normalize to PKCS#8 for cross-platform compatibility (asn1.js schema
      // resolution can fail on some Linux CI environments).
      try {
        const keyObj = createPrivateKey(ca.key);
        ca.key = keyObj.export({ type: 'pkcs8', format: 'pem' }).toString();
      } catch {
        // Keep the original PEM if Node crypto can't parse it.
      }

      await writeFile(keyPath, ca.key, { mode: 0o600 });
      await writeFile(certPath, ca.cert);
    }

    const key = await readFile(keyPath, 'utf8');
    const cert = await readFile(certPath, 'utf8');
    return { key, cert, certPath };
  }

  async handleProxyStart(args: Record<string, unknown>) {
    const port = argNumber(args, 'port') || 8080;
    const useHttps = argBool(args, 'useHttps') ?? true;
    const capture = argBool(args, 'capture') ?? true;

    if (this.server) {
      if (
        port !== this.currentPort ||
        useHttps !== this.currentUseHttps ||
        capture !== this.captureEnabled
      ) {
        return ResponseBuilder.error(
          `Proxy is already running on port ${this.currentPort} with useHttps=${this.currentUseHttps} and capture=${this.captureEnabled}. ` +
            'Use the same configuration or stop all current leases first.',
        );
      }
      this.owners.add(this.currentSessionId());
      return ResponseBuilder.success({
        message: 'Reused running proxy.',
        reused: true,
        port: this.currentPort,
        totalOwners: this.owners.size,
      });
    }

    try {
      const mockttp = this.mockttpModule ?? (await import('mockttp'));
      this.mockttpModule = mockttp;

      let caCertPath: string | null = null;
      let server: ReturnType<typeof mockttp.getLocal>;
      if (useHttps) {
        await ensureMockttpCaCompatibilityPatched();
        const { key, cert, certPath } = await this.ensureCa(mockttp);
        caCertPath = certPath;
        server = mockttp.getLocal({ https: { key, cert }, cors: true });
      } else {
        server = mockttp.getLocal();
      }

      // mockttp types only declare 'rule-event' for .on(); 'request'/'response' are
      // actually emitted at runtime but missing from the .d.ts. Cast to a wider event API.
      const eventEmitter = server as unknown as {
        on(event: string, handler: (payload: unknown) => void): void;
      };
      this.captureEnabled = capture;
      if (this.captureEnabled) {
        eventEmitter.on('request', (raw) => {
          const req = raw as CapturePayload;
          this.appendCapture({
            type: 'request',
            id: req.id,
            method: req.method,
            url: req.url,
            headers: normalizeHeaders(req.headers),
            remoteIpAddress: req.remoteIpAddress,
            remotePort: req.remotePort,
            timing: buildTiming(req.timingEvents),
            timestamp: Date.now(),
          });
          void readBodyPreview(req.body, getContentLength(req.headers)).then((body) =>
            this.updateCapture('request', req.id, body),
          );
        });
        eventEmitter.on('response', (raw) => {
          const res = raw as CapturePayload;
          const matchingRequest = this.captureBuffer.find(
            (entry) => entry.type === 'request' && entry.id === res.id,
          );
          this.appendCapture({
            type: 'response',
            id: res.id,
            method: matchingRequest?.method,
            url: matchingRequest?.url,
            status: res.statusCode,
            headers: normalizeHeaders(res.headers),
            remoteIpAddress: res.remoteIpAddress,
            remotePort: res.remotePort,
            timing: buildTiming(res.timingEvents),
            timestamp: Date.now(),
          });
          void readBodyPreview(res.body, getContentLength(res.headers)).then((body) =>
            this.updateCapture('response', res.id, body),
          );
        });
      } else {
        // A prior capture=true session may have left stale traffic in the buffer.
        // Clear it so a capture:false start never leaks another session's capture.
        this.captureBuffer = [];
      }

      await server.start(port);
      this.server = server;
      this.currentPort = port;
      this.currentUseHttps = useHttps;
      this.owners.add(this.currentSessionId());

      return ResponseBuilder.success({
        message: 'Proxy started.',
        port: this.currentPort,
        caCertPath,
        reused: false,
        totalOwners: this.owners.size,
      });
    } catch (e) {
      this.server = null;
      const message = e instanceof Error ? e.message : String(e);
      return ResponseBuilder.error(`Failed to start proxy: ${message}`);
    }
  }

  async handleProxyStop(_args: Record<string, unknown>) {
    if (!this.server) {
      return ResponseBuilder.error('Proxy is not running.');
    }
    const sessionId = this.currentSessionId();
    const implicitDefaultOwner = this.owners.size === 0 && sessionId === 'default';
    if (!implicitDefaultOwner && !this.owners.delete(sessionId)) {
      return ResponseBuilder.error('Current MCP session does not own a proxy lease.');
    }
    this.captureClearWatermarks.delete(sessionId);
    if (this.owners.size > 0) {
      await this.disposeRulesForSession(sessionId);
      return ResponseBuilder.success({
        message: 'Proxy lease released; proxy remains active for other MCP sessions.',
        stopped: false,
        remainingOwners: this.owners.size,
      });
    }
    await (this.server as { stop: () => Promise<void> }).stop();
    this.server = null;
    this.currentPort = null;
    this.currentUseHttps = null;
    this.ruleRecords = [];
    this.ruleEndpoints.clear();
    return ResponseBuilder.success({
      message: 'Proxy stopped successfully',
      stopped: true,
      remainingOwners: 0,
    });
  }

  async handleProxyStatus(_args: Record<string, unknown>) {
    const sessionId = this.currentSessionId();
    return ResponseBuilder.success({
      running: !!this.server,
      port: this.currentPort,
      caDir: this.caPathDir,
      caCertPath: path.join(this.caPathDir, 'ca.pem'),
      ruleCount: this.ruleRecords.filter((rule) => rule.ownerSessionId === sessionId).length,
      owned: this.isOwner(sessionId),
      totalOwners: this.owners.size,
      capture: this.captureEnabled,
    });
  }

  async handleProxyExportCa(_args: Record<string, unknown>) {
    const certPath = path.join(this.caPathDir, 'ca.pem');
    if (!(await pathExists(certPath))) {
      return ResponseBuilder.error(
        'CA certificate not found. Start the proxy with HTTPS enabled first.',
      );
    }
    const certContent = await readFile(certPath, 'utf8');
    return ResponseBuilder.success({
      path: certPath,
      content: certContent,
    });
  }

  async handleProxyAddRule(args: Record<string, unknown>) {
    if (!this.server) {
      return ResponseBuilder.error('Proxy must be running to add rules.');
    }
    if (!this.isOwner()) {
      return ResponseBuilder.error('Call proxy_start to acquire a lease before adding rules.');
    }

    const payload = parseProxyRulePayload(args);
    if (!payload.ok) return payload.response;
    const { action, method, urlPattern, mockStatus, mockBody, targetUrl, delayMs } = payload;

    try {
      const matcher = compileUrlPattern(urlPattern);
      const selected = selectRuleBuilder(this.server as ProxyRuleServer, method, matcher);
      if (!isProxyRuleBuilder(selected)) return selected;
      let builder = selected;

      // Apply optional latency injection before the terminal step. `builder.delay`
      // is a non-terminal mockttp step that returns the builder chain.
      if (delayMs > 0) {
        builder = builder.delay(delayMs);
      }

      let endpoint: { id: string };
      let forwardOptions: ForwardOptions | undefined;
      switch (action) {
        case 'forward':
          forwardOptions = buildForwardOptions(args);
          endpoint = await builder.thenPassThrough(
            await this.resolveMockttpOptions(forwardOptions ?? {}),
          );
          break;
        case 'redirect':
          forwardOptions = buildForwardOptions(args);
          endpoint = await builder.thenForwardTo(
            targetUrl ?? '',
            await this.resolveMockttpOptions(forwardOptions ?? {}),
          );
          break;
        case 'block':
          endpoint = await builder.thenCloseConnection();
          break;
        case 'mock_response':
          endpoint = await builder.thenReply(mockStatus ?? 200, mockBody ?? '');
          break;
      }

      this.ruleEndpoints.set(
        endpoint.id,
        endpoint as unknown as { id: string; rule?: unknown; dispose?: () => Promise<void> },
      );

      return ResponseBuilder.success({
        message: 'Rule added successfully',
        endpointId: endpoint.id,
        rule: this.recordRule({
          ownerSessionId: this.currentSessionId(),
          endpointId: endpoint.id,
          action,
          method,
          urlPattern,
          ...(action === 'mock_response' ? { mockStatus: mockStatus ?? 200 } : {}),
          ...(action === 'mock_response' ? { mockBody: mockBody ?? '' } : {}),
          ...(targetUrl ? { targetUrl } : {}),
          ...(delayMs > 0 ? { delayMs } : {}),
          ...(forwardOptions ? { forwardOptions } : {}),
        }),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return ResponseBuilder.error(`Failed to add rule: ${message}`);
    }
  }

  async handleProxyRemoveRule(args: Record<string, unknown>) {
    if (!this.server) {
      return ResponseBuilder.error('Proxy must be running to remove rules.');
    }

    const endpointId = argString(args, 'endpointId');
    if (!endpointId) {
      return ResponseBuilder.error('endpointId is required');
    }

    const sessionId = this.currentSessionId();
    const idx = this.ruleRecords.findIndex(
      (rule) => rule.endpointId === endpointId && rule.ownerSessionId === sessionId,
    );
    if (idx === -1) {
      return ResponseBuilder.error(
        `Rule not found: ${endpointId}. Use proxy_list_rules to see active rules.`,
      );
    }

    const removed = this.ruleRecords[idx]!;
    const endpoint = this.ruleEndpoints.get(endpointId);

    try {
      if (endpoint?.dispose) {
        await endpoint.dispose();
      } else {
        const reapplied = await this.removeRulesFromMockttp(new Set([endpointId]));
        if (!reapplied) {
          return ResponseBuilder.error(`Rule endpoint cannot be disposed: ${endpointId}`);
        }
      }
      this.ruleEndpoints.delete(endpointId);
      this.ruleRecords.splice(idx, 1);

      return ResponseBuilder.success({
        message: 'Rule removed successfully.',
        endpointId,
        removedRule: {
          action: removed.action,
          method: removed.method,
          urlPattern: removed.urlPattern,
          createdAt: removed.createdAt,
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return ResponseBuilder.error(`Failed to remove rule: ${message}`);
    }
  }

  async handleProxyListRules(_args: Record<string, unknown>) {
    const sessionId = this.currentSessionId();
    const rules = this.ruleRecords.filter((rule) => rule.ownerSessionId === sessionId);
    return ResponseBuilder.success({
      count: rules.length,
      rules: rules.map((rule) => ({ ...rule })),
    });
  }

  async handleProxyClearRules(_args: Record<string, unknown>) {
    if (!this.server) {
      return ResponseBuilder.error('Proxy must be running to clear rules.');
    }

    const cleared = await this.disposeRulesForSession(this.currentSessionId());
    return ResponseBuilder.success({
      message: 'Proxy rules cleared.',
      cleared,
    });
  }

  async handleProxyGetRequests(args: Record<string, unknown>) {
    if (!this.captureEnabled) {
      return ResponseBuilder.success({
        count: 0,
        logs: [],
        captureEnabled: false,
        note: 'Request capture is disabled for the running proxy; no captured traffic is available.',
      });
    }
    const urlFilter = argString(args, 'urlFilter');
    const clearedAt = this.captureClearWatermarks.get(this.currentSessionId()) ?? 0;
    let results: CaptureEntry[] = this.captureBuffer.filter((entry) => entry.timestamp > clearedAt);
    if (urlFilter) {
      results = results.filter((r) => r.url !== undefined && r.url.includes(urlFilter));
    }
    return ResponseBuilder.success({
      count: results.length,
      logs: results.slice(-PROXY_CAPTURE_RETURN_LIMIT),
    });
  }

  async handleProxyClearLogs(_args: Record<string, unknown>) {
    this.captureClearWatermarks.set(this.currentSessionId(), Date.now());
    return ResponseBuilder.success({ message: 'Captured proxy logs cleared.' });
  }

  async dropSessionState(sessionId: string): Promise<void> {
    const normalized = sessionId.trim() || 'default';
    if (!this.owners.has(normalized)) {
      this.captureClearWatermarks.delete(normalized);
      return;
    }
    this.owners.delete(normalized);
    this.captureClearWatermarks.delete(normalized);
    if (this.owners.size > 0) {
      await this.disposeRulesForSession(normalized);
    } else if (this.server) {
      await (this.server as { stop: () => Promise<void> }).stop();
      this.server = null;
      this.currentPort = null;
      this.currentUseHttps = null;
      this.ruleRecords = [];
      this.ruleEndpoints.clear();
    }
  }

  async close(): Promise<void> {
    if (this.server) await (this.server as { stop: () => Promise<void> }).stop();
    this.server = null;
    this.currentPort = null;
    this.currentUseHttps = null;
    this.owners.clear();
    this.ruleRecords = [];
    this.ruleEndpoints.clear();
    this.captureBuffer = [];
    this.captureClearWatermarks.clear();
  }

  /**
   * Real `mockttp` `MockedEndpoint` instances do not expose `.dispose()`; remove
   * rules by re-applying only the surviving `RequestRuleData` entries via
   * `server.setRequestRules(...)` (preserving event listeners and remaining IDs).
   */
  private async removeRulesFromMockttp(removedIds: ReadonlySet<string>): Promise<boolean> {
    const srv = this.server as {
      getMockedEndpoints?: () => Promise<Array<{ id: string; rule?: unknown }>>;
      setRequestRules?: (
        ...rules: unknown[]
      ) => Promise<Array<{ id: string; rule?: unknown; dispose?: () => Promise<void> }>>;
    } | null;
    if (typeof srv?.setRequestRules !== 'function') return false;

    let remainingRules: unknown[] = [];
    if (typeof srv.getMockedEndpoints === 'function') {
      const endpoints = await srv.getMockedEndpoints();
      remainingRules = endpoints
        .filter((e) => !removedIds.has(e.id) && e.rule !== undefined)
        .map((e) => e.rule);
    } else {
      for (const [id, ep] of this.ruleEndpoints) {
        if (!removedIds.has(id) && ep.rule !== undefined) remainingRules.push(ep.rule);
      }
    }
    const updated = await srv.setRequestRules(...remainingRules);
    for (const ep of updated) {
      this.ruleEndpoints.set(ep.id, ep);
    }
    return true;
  }

  private async disposeRulesForSession(sessionId: string): Promise<number> {
    const ownedRules = this.ruleRecords.filter((rule) => rule.ownerSessionId === sessionId);
    const removedIds = new Set<string>();
    let needsMockttpReapply = false;
    for (const rule of ownedRules) {
      const endpoint = this.ruleEndpoints.get(rule.endpointId);
      if (endpoint?.dispose) {
        await endpoint.dispose();
      } else {
        needsMockttpReapply = true;
      }
      removedIds.add(rule.endpointId);
      this.ruleEndpoints.delete(rule.endpointId);
    }
    if (needsMockttpReapply && removedIds.size > 0) {
      await this.removeRulesFromMockttp(removedIds);
    }
    this.ruleRecords = this.ruleRecords.filter((rule) => rule.ownerSessionId !== sessionId);
    return ownedRules.length;
  }

  async handleProxySetupAdbDevice(args: Record<string, unknown>) {
    const port = this.currentPort;
    if (!port) {
      return ResponseBuilder.error(
        'Proxy must be running locally to setup ADB device reverse tethering.',
      );
    }
    const certPath = path.join(this.caPathDir, 'ca.pem');
    if (!(await pathExists(certPath))) {
      return ResponseBuilder.error(
        'CA certificate not found. Start the proxy with HTTPS enabled first.',
      );
    }

    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    const deviceSerial = argString(args, 'deviceSerial');
    const deviceArgs = deviceSerial ? ['-s', deviceSerial] : [];
    const runAdb = async (extraArgs: string[]) =>
      execFileAsync('adb', [...deviceArgs, ...extraArgs], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: PROXY_ADB_TIMEOUT_MS,
        maxBuffer: PROXY_ADB_MAX_BUFFER_BYTES,
      });

    try {
      try {
        await execFileAsync('adb', ['version'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: PROXY_ADB_TIMEOUT_MS,
          maxBuffer: PROXY_ADB_MAX_BUFFER_BYTES,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return R.fail(`ADB binary not available: ${message}`)
          .merge({
            available: false,
            capability: 'adb_binary',
            status: 'unavailable',
            fix: 'Install Android Platform Tools and ensure `adb` is available on PATH.',
          })
          .json();
      }

      // 1. Verify adb is available
      await runAdb(['get-state']);

      // 2. Push CA Certificate
      await runAdb(['push', certPath, '/data/local/tmp/ca.pem']);

      // 3. Reverse tether port so device can reach localhost proxy
      await runAdb(['reverse', `tcp:${port}`, `tcp:${port}`]);

      // 4. Set global HTTP proxy on the device
      await runAdb(['shell', 'settings', 'put', 'global', 'http_proxy', `127.0.0.1:${port}`]);

      const instructions =
        `ADB Configuration Applied Automatically:\n- Verified device connection.\n- Pushed CA to ` +
        `/data/local/tmp/ca.pem\n- Reversed forwarded tcp:${port} -> tcp:${port}\n- Set global http_proxy ` +
        `to 127.0.0.1:` +
        `${port}\n\nNote: For HTTPS decryption, manually install the CA cert from ` +
        `/data/local/tmp/ca.pem in Android Settings. Android does not allow system CA ` +
        `installation through normal ADB permissions.`;

      return ResponseBuilder.success({
        message: 'ADB device successfully configured.',
        deviceId: deviceSerial || 'default',
        instructions,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return ResponseBuilder.error(`Failed to configure ADB device: ${message}`);
    }
  }

  /**
   * Translate our ForwardOptions into mockttp-compatible PassThroughStepOptions.
   * - chainUpstream → proxyConfig
   * - callbackScript → beforeRequest / beforeResponse (dynamic import)
   */
  private async resolveMockttpOptions(
    forwardOptions: ForwardOptions,
  ): Promise<Record<string, unknown>> {
    const opts: Record<string, unknown> = {};

    // Pass declarative transforms through directly
    if (forwardOptions.transformRequest) {
      opts['transformRequest'] = forwardOptions.transformRequest;
    }
    if (forwardOptions.transformResponse) {
      opts['transformResponse'] = forwardOptions.transformResponse;
    }

    // Translate chainUpstream → mockttp proxyConfig
    if (forwardOptions.chainUpstream) {
      const cu = forwardOptions.chainUpstream;
      const proxySetting: Record<string, unknown> = {};
      if (cu.proxyUrl) proxySetting['proxyUrl'] = cu.proxyUrl;
      if (cu.noProxy) proxySetting['noProxy'] = cu.noProxy;
      if (cu.trustedCAs) {
        proxySetting['trustedCAs'] = cu.trustedCAs.map((ca: Record<string, unknown>) => {
          if (ca.cert) return { cert: ca.cert };
          if (ca.certPath) return { certPath: ca.certPath };
          return {};
        });
      }
      opts['proxyConfig'] = proxySetting;
    }

    // Translate callbackScript → beforeRequest / beforeResponse (dynamic import)
    if (forwardOptions.callbackScript) {
      try {
        const scriptPath = forwardOptions.callbackScript.path;
        const mod = await import(scriptPath);
        if (typeof mod.beforeRequest === 'function') {
          opts['beforeRequest'] = mod.beforeRequest;
        }
        if (typeof mod.beforeResponse === 'function') {
          opts['beforeResponse'] = mod.beforeResponse;
        }
        if (!mod.beforeRequest && !mod.beforeResponse) {
          throw new Error(
            `Callback script ${scriptPath} must export beforeRequest and/or beforeResponse`,
          );
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('must export')) throw e;
        const message = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to load callback script: ${message}`, { cause: e });
      }
    }

    return opts;
  }

  private recordRule(rule: Omit<ProxyRuleRecord, 'createdAt'>): ProxyRuleRecord {
    const record: ProxyRuleRecord = {
      ...rule,
      createdAt: new Date().toISOString(),
    };
    this.ruleRecords.push(record);
    return { ...record };
  }
}
