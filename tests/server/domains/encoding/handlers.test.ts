import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EncodingToolHandlers } from '../../../../src/server/domains/encoding/handlers.js';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('EncodingToolHandlers', () => {
  const collector = {
    getActivePage: vi.fn(),
  } as any;

  let handlers: EncodingToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new EncodingToolHandlers(collector);
  });

  it('returns error when binary_decode lacks data', async () => {
    const body = parseJson(await handlers.handleBinaryDecode({ encoding: 'base64' }));
    expect(body.success).toBe(false);
    expect(body.tool).toBe('binary_decode');
    expect(body.error).toContain('data is required');
  });

  it('returns error for invalid decode encoding', async () => {
    const body = parseJson(await handlers.handleBinaryDecode({ data: 'aaa', encoding: 'bad' }));
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid encoding');
  });

  it('decodes url input to json output', async () => {
    const body = parseJson(
      await handlers.handleBinaryDecode({
        data: '%7B%22ok%22%3Atrue%7D',
        encoding: 'url',
        outputFormat: 'json',
      })
    );
    expect(body.success).toBe(true);
    expect(body.outputFormat).toBe('json');
    expect(body.result).toEqual({ ok: true });
  });

  it('encodes utf8 to base64', async () => {
    const body = parseJson(
      await handlers.handleBinaryEncode({
        data: 'hello',
        inputFormat: 'utf8',
        outputEncoding: 'base64',
      })
    );
    expect(body.success).toBe(true);
    expect(body.output).toBe(Buffer.from('hello', 'utf8').toString('base64'));
  });

  it('returns error for invalid entropy source', async () => {
    const body = parseJson(await handlers.handleBinaryEntropyAnalysis({ source: 'oops' }));
    expect(body.success).toBe(false);
    expect(body.tool).toBe('binary_entropy_analysis');
  });

  it('returns error when protobuf raw decode has no data', async () => {
    const body = parseJson(await handlers.handleProtobufDecodeRaw({}));
    expect(body.success).toBe(false);
    expect(body.tool).toBe('protobuf_decode_raw');
    expect(body.error).toContain('data is required');
  });
});

