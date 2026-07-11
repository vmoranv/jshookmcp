import { writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveArtifactPath } from '@utils/artifacts';
import { StreamingToolHandlers } from '@server/domains/streaming/handlers';
import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { TEST_URLS, TEST_WS_URLS, withPath } from '@tests/shared/test-urls';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@utils/artifacts', () => ({
  resolveArtifactPath: vi.fn(async ({ toolName, ext }: { toolName: string; ext: string }) => ({
    absolutePath: `D:/project/artifacts/captures/${toolName}.${ext}`,
    displayPath: `artifacts/captures/${toolName}.${ext}`,
  })),
}));

describe('streaming capture exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports websocket frames with full payloads to an artifact', async () => {
    const handlers = new StreamingToolHandlers({ getActivePage: vi.fn() } as any);
    (handlers as any).wsConnections.set('r1', {
      requestId: 'r1',
      url: withPath(TEST_WS_URLS.api, 'ws'),
      status: 'open',
      framesCount: 1,
      createdTimestamp: 1,
      handshakeStatus: 101,
    });
    (handlers as any).wsFrameOrder.push({
      requestId: 'r1',
      frame: {
        requestId: 'r1',
        timestamp: 2,
        direction: 'sent',
        opcode: 1,
        payloadLength: 11,
        payloadPreview: 'hello-secret',
        payloadSample: 'hello-secret',
        payload: 'hello-secret',
        isBinary: false,
      },
    });

    const body = parseJson<any>(
      await handlers.handleWsExportCapture({ direction: 'sent', format: 'ndjson' }),
    );

    expect(resolveArtifactPath).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'captures',
        toolName: 'ws-capture',
        target: 'sent',
        ext: 'ndjson',
      }),
    );
    expect(writeFile).toHaveBeenCalledWith(
      'D:/project/artifacts/captures/ws-capture.ndjson',
      expect.stringContaining('"payload":"hello-secret"'),
      'utf8',
    );
    expect(body).toMatchObject({
      success: true,
      artifactPath: 'artifacts/captures/ws-capture.ndjson',
      format: 'ndjson',
      recordCount: 1,
    });
  });

  it('exports sse events with captured data to an artifact', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({
        success: true,
        monitor: {
          enabled: true,
          patched: true,
          maxEvents: 2000,
          urlFilter: null,
          sourceCount: 1,
        },
        filters: { sourceUrl: null, eventType: 'message', includeData: true },
        events: [
          {
            sourceUrl: withPath(TEST_URLS.api, 'events'),
            eventType: 'message',
            dataPreview: 'chunk',
            data: 'chunk-data',
            dataLength: 10,
            lastEventId: 'evt-1',
            timestamp: 123,
          },
        ],
      }),
    };
    const handlers = new StreamingToolHandlers({
      getActivePage: vi.fn().mockResolvedValue(page),
    } as any);

    const body = parseJson<any>(
      await handlers.handleSseExportCapture({ eventType: 'message', format: 'json' }),
    );

    expect(resolveArtifactPath).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'captures',
        toolName: 'sse-capture',
        target: 'message',
        ext: 'json',
      }),
    );
    expect(writeFile).toHaveBeenCalledWith(
      'D:/project/artifacts/captures/sse-capture.json',
      expect.stringContaining('"data": "chunk-data"'),
      'utf8',
    );
    expect(body).toMatchObject({
      success: true,
      artifactPath: 'artifacts/captures/sse-capture.json',
      format: 'json',
      recordCount: 1,
    });
  });

  it('exports grpc calls with parsed messages to an artifact', async () => {
    const handlers = new StreamingToolHandlers({ getActivePage: vi.fn() } as any);
    (handlers as any).grpcCalls.set('req-1', {
      requestId: 'req-1',
      url: withPath(TEST_URLS.api, 'helloworld.Greeter/SayHello'),
      method: 'POST',
      status: 200,
      requestContentType: 'application/grpc',
      responseContentType: 'application/grpc',
      createdTimestamp: 1,
      finishedTimestamp: 2,
      requestBodyBytes: 5,
      responseBodyBytes: 5,
      responseMessages: [
        {
          payloadHex: '48656c6c6f',
          payloadBase64: 'SGVsbG8=',
          compressed: false,
          isTrailer: false,
        },
      ],
      requestMessages: [],
      warnings: [],
      bodyError: null,
    });
    (handlers as any).grpcCallOrder.push('req-1');

    const body = parseJson<any>(await handlers.handleGrpcExportCapture({ format: 'ndjson' }));

    expect(resolveArtifactPath).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'captures',
        toolName: 'grpc-capture',
        target: 'all',
        ext: 'ndjson',
      }),
    );
    expect(writeFile).toHaveBeenCalledWith(
      'D:/project/artifacts/captures/grpc-capture.ndjson',
      expect.stringContaining('"payloadBase64":"SGVsbG8="'),
      'utf8',
    );
    expect(body).toMatchObject({
      success: true,
      artifactPath: 'artifacts/captures/grpc-capture.ndjson',
      format: 'ndjson',
      recordCount: 1,
    });
  });

  it('omits grpc message payloads when includeMessages=false', async () => {
    const handlers = new StreamingToolHandlers({ getActivePage: vi.fn() } as any);
    (handlers as any).grpcCalls.set('req-2', {
      requestId: 'req-2',
      url: withPath(TEST_URLS.api, 'other.Foo/Bar'),
      method: 'POST',
      status: 0,
      requestContentType: null,
      responseContentType: 'application/grpc',
      createdTimestamp: 3,
      finishedTimestamp: null,
      requestBodyBytes: 0,
      responseBodyBytes: 0,
      responseMessages: [
        { payloadHex: '0a', payloadBase64: 'Cg==', compressed: false, isTrailer: false },
      ],
      requestMessages: [],
      warnings: ['warn'],
      bodyError: 'boom',
    });
    (handlers as any).grpcCallOrder.push('req-2');

    const body = parseJson<any>(
      await handlers.handleGrpcExportCapture({ includeMessages: false, format: 'json' }),
    );

    expect(body.success).toBe(true);
    expect(body.recordCount).toBe(1);
    const written = (writeFile as any).mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.calls[0].responseMessages).toBeUndefined();
    expect(parsed.calls[0].responseMessageCount).toBe(1);
    expect(parsed.calls[0].bodyError).toBe('boom');
    expect(parsed.calls[0].warningCount).toBe(1);
  });

  it('rejects an invalid urlFilter for grpc export', async () => {
    const handlers = new StreamingToolHandlers({ getActivePage: vi.fn() } as any);
    const body = parseJson<any>(await handlers.handleGrpcExportCapture({ urlFilter: '(' }));
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/Invalid urlFilter regex/);
  });

  it('exports fetch-stream events with captured data to an artifact', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({
        success: true,
        monitor: {
          enabled: true,
          patched: true,
          maxEvents: 2000,
          urlFilter: null,
          sourceCount: 1,
        },
        filters: { sourceUrl: null, eventType: null, includeData: true },
        events: [
          {
            sourceUrl: withPath(TEST_URLS.api, 'stream'),
            eventType: 'message',
            dataPreview: 'chunk',
            data: 'chunk-data',
            dataLength: 10,
            lastEventId: null,
            timestamp: 123,
          },
        ],
      }),
    };
    const handlers = new StreamingToolHandlers({
      getActivePage: vi.fn().mockResolvedValue(page),
    } as any);

    const body = parseJson<any>(
      await handlers.handleFetchStreamExportCapture({ format: 'ndjson' }),
    );

    expect(resolveArtifactPath).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'captures',
        toolName: 'fetch-stream-capture',
        target: 'all',
        ext: 'ndjson',
      }),
    );
    expect(writeFile).toHaveBeenCalledWith(
      'D:/project/artifacts/captures/fetch-stream-capture.ndjson',
      expect.stringContaining('"data":"chunk-data"'),
      'utf8',
    );
    expect(body).toMatchObject({
      success: true,
      artifactPath: 'artifacts/captures/fetch-stream-capture.ndjson',
      format: 'ndjson',
      recordCount: 1,
    });
  });

  it('exports webrtc messages with captured data to an artifact', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({
        success: true,
        monitor: {
          enabled: true,
          patched: true,
          maxEvents: 2000,
          urlFilter: null,
          peerConnectionsSeen: 1,
          dataChannels: 1,
        },
        filters: { label: null, direction: null, includeData: true },
        events: [
          {
            pcId: 1,
            label: 'chat',
            direction: 'sent',
            dataPreview: 'hi',
            data: 'hi',
            dataLength: 2,
            isBinary: false,
            timestamp: 456,
          },
        ],
      }),
    };
    const handlers = new StreamingToolHandlers({
      getActivePage: vi.fn().mockResolvedValue(page),
    } as any);

    const body = parseJson<any>(await handlers.handleWebRtcExportCapture({ format: 'json' }));

    expect(resolveArtifactPath).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'captures',
        toolName: 'webrtc-capture',
        target: 'all',
        ext: 'json',
      }),
    );
    expect(writeFile).toHaveBeenCalledWith(
      'D:/project/artifacts/captures/webrtc-capture.json',
      expect.stringContaining('"data": "hi"'),
      'utf8',
    );
    expect(body).toMatchObject({
      success: true,
      artifactPath: 'artifacts/captures/webrtc-capture.json',
      format: 'json',
      recordCount: 1,
    });
  });

  it('returns a soft failure when the webrtc monitor is not enabled', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({
        success: false,
        message: 'WebRTC monitor is not enabled. Call webrtc_monitor first.',
      }),
    };
    const handlers = new StreamingToolHandlers({
      getActivePage: vi.fn().mockResolvedValue(page),
    } as any);

    const body = parseJson<any>(await handlers.handleWebRtcExportCapture({}));

    expect(body.success).toBe(false);
    expect(body.message).toMatch(/not enabled/);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
