import { describe, expect, it } from 'vitest';

import {
  attachToolRequestMeta,
  readToolRequestMeta,
  readToolSessionId,
} from '@server/runtime/tool-request-meta';

describe('tool-request-meta helpers', () => {
  it('returns null when _meta is not a plain object', () => {
    expect(readToolRequestMeta({})).toBeNull();
    expect(readToolRequestMeta({ _meta: null })).toBeNull();
    expect(readToolRequestMeta({ _meta: ['bad'] as any })).toBeNull();
  });

  it('reads only non-empty string session ids', () => {
    expect(readToolSessionId({ _meta: { sessionId: ' session-1 ' } })).toBe(' session-1 ');
    expect(readToolSessionId({ _meta: { sessionId: '' } })).toBeNull();
    expect(readToolSessionId({ _meta: { sessionId: 42 } })).toBeNull();
  });

  it('merges existing meta, ignores invalid extra meta, and preserves original args', () => {
    const args = {
      tool: 'example',
      _meta: {
        progressToken: 'p1',
      },
    };

    const merged = attachToolRequestMeta(args, {
      mcpReq: { _meta: ['invalid-meta'] },
      sessionId: 'session-2',
    });

    expect(merged).toEqual({
      tool: 'example',
      _meta: {
        progressToken: 'p1',
        sessionId: 'session-2',
      },
    });
    expect(args).toEqual({
      tool: 'example',
      _meta: {
        progressToken: 'p1',
      },
    });
  });

  it('omits _meta entirely when neither source contributes usable values', () => {
    expect(attachToolRequestMeta({ tool: 'example' }, { sessionId: '   ' })).toEqual({
      tool: 'example',
    });
  });

  it('accepts extra _meta object fields when provided', () => {
    expect(
      attachToolRequestMeta(
        { tool: 'example' },
        {
          mcpReq: {
            _meta: {
              requestId: 'r1',
            },
          },
        },
      ),
    ).toEqual({
      tool: 'example',
      _meta: {
        requestId: 'r1',
      },
    });
  });

  it('derives the session id from Streamable HTTP request headers', () => {
    expect(
      attachToolRequestMeta(
        { tool: 'example' },
        {
          http: {
            req: {
              headers: {
                get: (n: string) => (n.toLowerCase() === 'mcp-session-id' ? 'http-session' : null),
              },
            },
          },
        },
      ),
    ).toEqual({
      tool: 'example',
      _meta: { sessionId: 'http-session' },
    });
  });
});
