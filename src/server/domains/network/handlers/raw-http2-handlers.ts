import type { EventBus, ServerEventMap } from '@server/EventBus';
import { R } from '@server/domains/shared/ResponseBuilder';
import {
  parseOptionalString,
  parseRawString,
  parseHeaderRecord,
  parseNetworkAuthorization,
  normalizeHttp2Headers,
  toHttp2RequestHeaders,
  resolveAuthorizedTransportTarget,
  performHttp2ProbeInternal,
  HTTP_TOKEN_RE,
  parseStringArray as parseStringArrayHelper,
  parseOptionalBoolean as parseOptionalBooleanHelper,
} from './raw-helpers';
import { buildHttp2Frame } from '@server/domains/network/http2-raw';
import type { Http2FrameBuildInput, Http2SettingsEntry } from '@server/domains/network/http2-raw';
import { emitEvent, parseNumberArg } from './shared';
import { isLikelyTextHttpBody } from '@server/domains/network/http-raw';

export class RawHttp2Handlers {
  constructor(private readonly eventBus?: EventBus<ServerEventMap>) {}

  async handleHttp2Probe(args: Record<string, unknown>) {
    const rawUrl = parseOptionalString(args.url, 'url');
    let eventUrl = rawUrl ?? '';
    let eventStatusCode: number | null = null;
    let eventAlpnProtocol: string | null = null;
    let eventSuccess = false;

    try {
      if (!rawUrl) throw new Error('url is required');

      const method = (parseOptionalString(args.method, 'method') ?? 'GET').toUpperCase();
      if (!HTTP_TOKEN_RE.test(method)) throw new Error('method must be a valid HTTP token');

      const timeoutMs = parseNumberArg(args.timeoutMs, {
        defaultValue: 30_000,
        min: 1,
        max: 120_000,
        integer: true,
      });
      const maxBodyBytes = parseNumberArg(args.maxBodyBytes, {
        defaultValue: 32_768,
        min: 128,
        max: 1_048_576,
        integer: true,
      });
      const bodyBuffer = Buffer.from(
        parseRawString(args.body, 'body', { allowEmpty: true }) ?? '',
        'utf8',
      );
      const alpnProtocols = parseStringArrayHelper(args.alpnProtocols, 'alpnProtocols');
      const requestHeaders = toHttp2RequestHeaders(parseHeaderRecord(args.headers, 'headers'));
      const authorization = parseNetworkAuthorization(args.authorization);

      const { url, target } = await resolveAuthorizedTransportTarget(
        rawUrl,
        authorization,
        'HTTP/2 probe',
      );
      eventUrl = url.toString();

      if (!('content-length' in requestHeaders) && bodyBuffer.length > 0) {
        requestHeaders['content-length'] = String(bodyBuffer.length);
      }

      const effectivePort = Number.parseInt(
        url.port || (url.protocol === 'https:' ? '443' : '80'),
        10,
      );
      const requestedAlpnProtocols = alpnProtocols.length > 0 ? alpnProtocols : ['h2', 'http/1.1'];

      const {
        responseHeaders,
        bodyBuffer: capturedBody,
        truncated,
        alpnProtocol,
      } = await performHttp2ProbeInternal({
        url,
        target,
        method,
        requestHeaders,
        bodyBuffer,
        timeoutMs,
        maxBodyBytes,
        effectivePort,
        requestedAlpnProtocols,
      });

      const normalizedHeaders = normalizeHttp2Headers(responseHeaders);
      const rawStatus = responseHeaders[':status'];
      const statusCode =
        typeof rawStatus === 'number'
          ? rawStatus
          : typeof rawStatus === 'string'
            ? Number.parseInt(rawStatus, 10)
            : null;
      const contentType =
        typeof normalizedHeaders['content-type'] === 'string'
          ? normalizedHeaders['content-type']
          : Array.isArray(normalizedHeaders['content-type'])
            ? (normalizedHeaders['content-type'][0] ?? null)
            : null;
      const bodyIsText = isLikelyTextHttpBody(contentType, capturedBody);

      eventStatusCode = Number.isFinite(statusCode ?? Number.NaN) ? statusCode : null;
      eventAlpnProtocol = alpnProtocol;
      eventSuccess = true;

      return R.ok()
        .merge({
          url: eventUrl,
          statusCode: eventStatusCode,
          alpnProtocol: eventAlpnProtocol,
          headers: normalizedHeaders,
          bodyBytes: capturedBody.length,
          truncated,
          bodyText: bodyIsText ? capturedBody.toString('utf8') : undefined,
          bodyBase64: bodyIsText ? undefined : capturedBody.toString('base64'),
        })
        .json();
    } catch (error) {
      return R.fail(error instanceof Error ? error.message : String(error)).json();
    } finally {
      emitEvent(this.eventBus, 'network:http2_probed', {
        url: eventUrl,
        success: eventSuccess,
        statusCode: eventStatusCode,
        alpnProtocol: eventAlpnProtocol,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async handleHttp2FrameBuild(args: Record<string, unknown>) {
    const frameTypeRaw = parseOptionalString(args.frameType, 'frameType');
    if (!frameTypeRaw) {
      throw new Error('frameType is required');
    }

    const validFrameTypes = [
      'DATA',
      'SETTINGS',
      'PING',
      'WINDOW_UPDATE',
      'RST_STREAM',
      'GOAWAY',
      'RAW',
    ];
    const frameType = frameTypeRaw.toUpperCase();
    if (!validFrameTypes.includes(frameType)) {
      throw new Error(`frameType must be one of: ${validFrameTypes.join(', ')}`);
    }

    const streamId =
      args.streamId !== undefined
        ? parseNumberArg(args.streamId, { defaultValue: 0, min: 0, integer: true })
        : undefined;
    const flags =
      args.flags !== undefined
        ? parseNumberArg(args.flags, { defaultValue: 0, min: 0, max: 255, integer: true })
        : undefined;
    const frameTypeCode =
      args.frameTypeCode !== undefined
        ? parseNumberArg(args.frameTypeCode, { defaultValue: 0, min: 0, max: 255, integer: true })
        : undefined;
    const windowSizeIncrement =
      args.windowSizeIncrement !== undefined
        ? parseNumberArg(args.windowSizeIncrement, { defaultValue: 1, min: 1, integer: true })
        : undefined;
    const errorCode =
      args.errorCode !== undefined
        ? parseNumberArg(args.errorCode, { defaultValue: 0, min: 0, integer: true })
        : undefined;
    const lastStreamId =
      args.lastStreamId !== undefined
        ? parseNumberArg(args.lastStreamId, { defaultValue: 0, min: 0, integer: true })
        : undefined;

    const payloadHex = parseOptionalString(args.payloadHex, 'payloadHex');
    const payloadText = parseRawString(args.payloadText, 'payloadText', { allowEmpty: true });
    const payloadEncoding = parseOptionalString(args.payloadEncoding, 'payloadEncoding') as
      | 'utf8'
      | 'ascii'
      | undefined;
    const ack = parseOptionalBooleanHelper(args.ack, 'ack');
    const pingOpaqueDataHex = parseOptionalString(args.pingOpaqueDataHex, 'pingOpaqueDataHex');
    const debugDataText = parseRawString(args.debugDataText, 'debugDataText', { allowEmpty: true });
    const debugDataEncoding = parseOptionalString(args.debugDataEncoding, 'debugDataEncoding') as
      | 'utf8'
      | 'ascii'
      | undefined;

    let settings: Http2SettingsEntry[] | undefined;
    if (args.settings !== undefined) {
      if (!Array.isArray(args.settings)) {
        throw new Error('settings must be an array');
      }

      settings = (args.settings as Array<Record<string, unknown>>).map((entry, index) => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          throw new Error(`settings[${String(index)}] must be an object with id and value`);
        }

        const id =
          typeof entry.id === 'number'
            ? entry.id
            : (() => {
                throw new Error(`settings[${String(index)}].id must be a number`);
              })();
        const value =
          typeof entry.value === 'number'
            ? entry.value
            : (() => {
                throw new Error(`settings[${String(index)}].value must be a number`);
              })();

        return { id, value };
      });
    }

    const input: Http2FrameBuildInput = {
      frameType: frameType as Http2FrameBuildInput['frameType'],
      ...(streamId !== undefined && { streamId }),
      ...(flags !== undefined && { flags }),
      ...(frameTypeCode !== undefined && { frameTypeCode }),
      ...(payloadHex !== undefined && { payloadHex }),
      ...(payloadText !== undefined && { payloadText }),
      ...(payloadEncoding !== undefined && { payloadEncoding }),
      ...(settings !== undefined && { settings }),
      ...(ack !== undefined && { ack }),
      ...(pingOpaqueDataHex !== undefined && { pingOpaqueDataHex }),
      ...(windowSizeIncrement !== undefined && { windowSizeIncrement }),
      ...(errorCode !== undefined && { errorCode }),
      ...(lastStreamId !== undefined && { lastStreamId }),
      ...(debugDataText !== undefined && { debugDataText }),
      ...(debugDataEncoding !== undefined && { debugDataEncoding }),
    };

    const result = buildHttp2Frame(input);

    emitEvent(this.eventBus, 'network:http2_frame_build_completed', {
      frameType: result.frameType,
      typeCode: result.typeCode,
      streamId: result.streamId,
      flags: result.flags,
      payloadBytes: result.payloadBytes,
      timestamp: new Date().toISOString(),
    });

    return R.ok()
      .merge(result as unknown as Record<string, unknown>)
      .json();
  }
}
