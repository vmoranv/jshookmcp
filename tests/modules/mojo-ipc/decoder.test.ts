import { beforeEach, describe, expect, it } from 'vitest';
import { MojoDecoder } from '@modules/mojo-ipc';

describe('MojoDecoder', () => {
  let decoder: MojoDecoder;

  beforeEach(() => {
    decoder = new MojoDecoder();
  });

  it('normalizes hex input', () => {
    expect(decoder.cleanHex('00 01 0')).toBe('000010');
  });

  it('decodes a short payload into header and raw summary', () => {
    const decoded = decoder.decodePayload('0001', 'test');
    expect(decoded.header.version).toBe(0);
    expect(decoded.raw).toBe('0001');
    expect(decoded._raw_summary).toBeDefined();
  });

  it('decodes boolean, integer and string fields', () => {
    const encoded = decoder.encodeMessage('network.mojom.NetworkService', '1', [true, 42, 'hello']);
    const decoded = decoder.decodePayload(encoded, 'network');
    expect(decoded.fields.field0).toBe(true);
    expect(decoded.fields.field1).toBe(42);
    expect(decoded.fields.field2).toBe('hello');
  });

  it('encodes handle fields and reports handle count', () => {
    const encoded = decoder.encodeMessage('network.mojom.NetworkService', '2', [{ handle: 5 }]);
    const decoded = decoder.decodePayload(encoded);
    expect(decoded.handles).toBe(1);
    expect(decoded.fields.field0).toEqual({ handle: 5 });
  });
});
