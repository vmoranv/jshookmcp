import { describe, expect, it, beforeEach } from 'vitest';
import {
  MojoMessageDecoder,
  resolveInterface,
  listKnownInterfaces,
  decodeMojoPayload,
} from '@modules/mojo-ipc/MojoMessageDecoder';

describe('MojoMessageDecoder', () => {
  let decoder: MojoMessageDecoder;

  beforeEach(() => {
    decoder = new MojoMessageDecoder();
  });

  describe('decodeMessage', () => {
    it('decodes a valid hex message', async () => {
      const result = await decoder.decodeMessage(
        '000100020000000300000000',
        'network.mojom.NetworkService',
      );
      expect(result.interface).toBe('network.mojom.NetworkService');
      expect(result.rawHex).toBe('000100020000000300000000');
      expect(result.parameters).toBeDefined();
      expect(result.parameters._mojo_handles).toBeDefined();
    });

    it('handles short hex gracefully', async () => {
      const result = await decoder.decodeMessage('0001', 'test');
      expect(result.interface).toBe('test');
      expect(result.parameters._mojo_header).toBeDefined();
    });

    it('resolves method by ordinal', async () => {
      // Method ordinal 0 in header
      const result = await decoder.decodeMessage('000100000000000000000000', 'url.mojom.Url');
      expect(result.method).toBe('Init');
    });

    it('uses ordinal notation for out-of-range methods', async () => {
      const result = await decoder.decodeMessage('000100ff0000000000000000', 'url.mojom.Url');
      expect(result.method).toMatch(/^ordinal_\d+$/);
    });

    it('handles unknown interface', async () => {
      const result = await decoder.decodeMessage(
        '000100000000000000000000',
        'unknown.mojom.Something',
      );
      expect(result.interface).toBe('unknown.mojom.Something');
      expect(result.method).toBe('unknown');
    });
  });

  describe('listInterfaces', () => {
    it('lists all interfaces without filter', async () => {
      const interfaces = await decoder.listInterfaces();
      expect(interfaces.length).toBeGreaterThan(0);
    });

    it('filters by interface name', async () => {
      const interfaces = await decoder.listInterfaces('network');
      expect(interfaces.length).toBeGreaterThan(0);
      for (const iface of interfaces) {
        expect(iface.name.toLowerCase()).toContain('network');
      }
    });

    it('filters by method name', async () => {
      const interfaces = await decoder.listInterfaces('CreateLoaderAndStart');
      expect(interfaces.length).toBeGreaterThan(0);
    });

    it('returns empty for no match', async () => {
      const interfaces = await decoder.listInterfaces('xyz_nonexistent');
      expect(interfaces).toEqual([]);
    });
  });
});

describe('resolveInterface', () => {
  it('finds network.mojom.NetworkService', () => {
    const iface = resolveInterface('network.mojom.NetworkService');
    expect(iface).toBeDefined();
    expect(iface?.name).toBe('network.mojom.NetworkService');
  });

  it('finds by partial name', () => {
    const iface = resolveInterface('NetworkService');
    expect(iface).toBeDefined();
    expect(iface?.name).toBe('network.mojom.NetworkService');
  });

  it('returns undefined for unknown interface', () => {
    const iface = resolveInterface('unknown.mojom.Fake');
    expect(iface).toBeUndefined();
  });
});

describe('listKnownInterfaces', () => {
  it('returns all interfaces without filter', () => {
    const interfaces = listKnownInterfaces();
    expect(interfaces.length).toBeGreaterThan(5);
  });

  it('filters by name', () => {
    const interfaces = listKnownInterfaces('network.mojom');
    expect(interfaces.length).toBeGreaterThanOrEqual(3);
  });

  it('filters by description', () => {
    const interfaces = listKnownInterfaces('factory');
    expect(interfaces.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by method', () => {
    const interfaces = listKnownInterfaces('ClearCache');
    expect(interfaces.length).toBeGreaterThanOrEqual(1);
  });
});

describe('decodeMojoPayload', () => {
  it('parses message header from valid hex', () => {
    // Hex: 00 01 00 02 00 00 00 03
    // byte 0-1: version = 0x0001 = 1
    // byte 2: flags = 0x00 = 0
    // byte 3: messageType = 0x02 = 2
    // byte 4-7: numFields = 0x00000003 = 3
    const hex = '00010002000000030000000000000000';
    const result = decodeMojoPayload(hex, 'network.mojom.NetworkService');
    expect(result.header.version).toBe(1);
    expect(result.header.flags).toBe(0);
    expect(result.header.messageType as number).toBe(2);
    expect(result.header.numFields).toBe(3);
  });

  it('returns error for too-short payload', () => {
    const result = decodeMojoPayload('0001', 'test');
    expect(result.header.error).toBe('payload too short for header');
    expect(result.fields).toEqual({});
    expect(result.handles).toBe(0);
  });

  it('decodes numeric fields from payload', () => {
    // Header: version=0x0001, flags=0x00, type=0x00, num_fields=1
    // Handles: 0x00000000
    // Field: type=0x06 (int32), value=0x0000002A (42)
    const hex = '000100000000000100000000060000002a';
    const result = decodeMojoPayload(hex, 'test');
    expect(result.fields.field_0).toBe(42);
  });

  it('decodes boolean field', () => {
    // Header: version=0x0001, flags=0x00, type=0x00, num_fields=1
    // Handles: 0
    // Field: type=0x01 (bool), value=0x01 (true)
    const hex = '0001000000000001000000000101';
    const result = decodeMojoPayload(hex, 'test');
    expect(result.fields.field_0).toBe(true);
  });

  it('decodes string field', () => {
    // Header: version=0x0001, flags=0x00, type=0x00, num_fields=1
    // Handles: 0
    // Field: type=0x0c (string), length=0x00000004, value="test"
    const strHex = Buffer.from('test').toString('hex');
    const hex = '0001000000000001000000000c00000004' + strHex;
    const result = decodeMojoPayload(hex, 'test');
    expect(result.fields.field_0).toBe('test');
  });

  it('decodes handle field', () => {
    // Header: version=0x0001, flags=0x00, type=0x00, num_fields=1
    // Handles: 0
    // Field: type=0x10 (handle), id=0x00000005
    const hex = '0001000000000001000000001000000005';
    const result = decodeMojoPayload(hex, 'test');
    expect(result.fields.field_0).toBe('{handle:5}');
  });

  it('handles cleans hex with spaces', () => {
    const hex = '00 01 00 00 00 00 00 01 00 00 00 00';
    const result = decodeMojoPayload(hex, 'test');
    expect(result.header.version).toBe(1);
  });

  it('provides raw summary when no fields decoded', () => {
    // Header with num_fields=0
    const hex = '000100000000000000000000deadbeef';
    const result = decodeMojoPayload(hex, 'test');
    expect(result.fields._raw_summary).toBeDefined();
    expect(result.handles).toBe(0);
  });
});
