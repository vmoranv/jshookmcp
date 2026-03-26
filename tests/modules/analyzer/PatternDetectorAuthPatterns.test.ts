import { describe, it, expect, vi, beforeEach } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import type { NetworkRequest } from '@modules/monitor/ConsoleMonitor';
import {
  detectSignaturePatternsInternal,
  detectTokenPatternsInternal,
} from '@modules/analyzer/PatternDetectorAuthPatterns';

function request(overrides: Partial<NetworkRequest>): NetworkRequest {
  return {
    requestId: overrides.requestId ?? 'req-1',
    url: overrides.url ?? 'https://example.com/api',
    method: overrides.method ?? 'GET',
    headers: overrides.headers ?? {},
    postData: overrides.postData,
    timestamp: overrides.timestamp ?? Date.now(),
    type: overrides.type,
    initiator: overrides.initiator,
  };
}

describe('PatternDetectorAuthPatterns', () => {
  beforeEach(() => {
    Object.values(loggerState).forEach((fn) => fn.mockReset());
  });

  it('detects signature patterns in URL params, headers, JSON body and form data', () => {
    const patterns = detectSignaturePatternsInternal([
      request({
        url: 'https://example.com/api?signature=abc&payload=1',
        headers: {
          'x-signature': 'a'.repeat(64),
          'x-trace-id': 'trace',
        },
        postData: JSON.stringify({
          sign: 'b'.repeat(64),
          payload: 'ok',
        }),
      }),
      request({
        url: 'https://example.com/form',
        method: 'POST',
        postData: 'sig=custom123&foo=bar',
      }),
    ]);

    expect(patterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'Custom',
          location: expect.stringContaining('(URL params)'),
        }),
        expect.objectContaining({
          type: 'HMAC',
          location: expect.stringContaining('(header: x-signature)'),
          confidence: 0.88,
        }),
        expect.objectContaining({
          type: 'HMAC',
          location: expect.stringContaining('(POST body: sign)'),
        }),
        expect.objectContaining({
          type: 'Custom',
          location: expect.stringContaining('(POST body)'),
          parameters: ['form-urlencoded data'],
        }),
      ]),
    );
  });

  it('logs URL parsing failures during signature detection instead of throwing', () => {
    const patterns = detectSignaturePatternsInternal([
      request({
        url: 'http://[?signature=1',
      }),
    ]);

    expect(patterns).toEqual([]);
    expect(loggerState.debug).toHaveBeenCalledWith(
      expect.stringContaining('URL parse failed for signature detection'),
    );
  });

  it('detects token patterns in headers, query strings, JSON body and form data', () => {
    const jwt = 'aaaaaaaaaaaa.bbbbbbbbbbbb.cccccccccccc';
    const oauthToken = 'oauth_token_value_12345678901234567890';
    const customToken = 'Z'.repeat(24);

    const patterns = detectTokenPatternsInternal([
      request({
        url: `https://example.com/callback?access_token=${oauthToken}&session=${customToken}`,
        headers: {
          Authorization: `Bearer ${jwt}`,
          'x-api-key': customToken,
        },
        postData: JSON.stringify({
          auth: jwt,
          token: customToken,
        }),
      }),
      request({
        url: 'https://example.com/form',
        method: 'POST',
        postData: 'token=abc12345678901234567890',
      }),
    ]);

    expect(patterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'JWT',
          location: expect.stringContaining('(header: Authorization)'),
        }),
        expect.objectContaining({
          type: 'OAuth',
          location: expect.stringContaining('(param: access_token)'),
        }),
        expect.objectContaining({
          type: 'Custom',
          location: expect.stringContaining('(header: x-api-key)'),
        }),
        expect.objectContaining({
          type: 'JWT',
          location: expect.stringContaining('(POST body: auth)'),
        }),
        expect.objectContaining({
          type: 'Custom',
          location: expect.stringContaining('(POST body)'),
          format: expect.stringContaining('form-urlencoded'),
        }),
      ]),
    );
  });

  it('logs URL parsing failures during token detection instead of throwing', () => {
    const patterns = detectTokenPatternsInternal([
      request({
        url: 'http://[?access_token=1',
      }),
    ]);

    expect(patterns).toEqual([]);
    expect(loggerState.debug).toHaveBeenCalledWith(
      expect.stringContaining('URL parse failed for token detection'),
    );
  });
});
