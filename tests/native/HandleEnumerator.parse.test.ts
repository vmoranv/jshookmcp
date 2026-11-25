/**
 * HandleEnumerator — pure buffer parsing tests.
 *
 * These cover the OBJECT_TYPE_INFORMATION layout: the type-name bytes live at
 * UNICODE_STRING.Buffer (an absolute pointer within the returned buffer), not
 * at a fixed offset 16 (which is TotalNumberOfObjects).
 */

import { describe, expect, it } from 'vitest';
import { parseObjectTypeName, parseHandleBufferForTest } from '@native/HandleEnumerator';

describe('parseObjectTypeName', () => {
  it('follows UNICODE_STRING.Buffer instead of reading offset 16', () => {
    const base = 0x1000n;
    const buf = Buffer.alloc(64);
    buf.writeUInt16LE(10, 0); // Length in bytes for "Token"
    buf.writeBigUInt64LE(base + 40n, 8); // TypeName.Buffer

    // Offset 16 is TotalNumberOfObjects, not string data. Put misleading bytes
    // there and the real name at the pointer target.
    buf.write('XXXXXXXX', 16, 'utf16le');
    buf.write('Token', 40, 'utf16le');

    expect(parseObjectTypeName(buf, base)).toBe('Token');
  });

  it('returns Unknown for a zero length or an out-of-buffer pointer', () => {
    const base = 0x2000n;
    const empty = Buffer.alloc(32);
    expect(parseObjectTypeName(empty, base)).toBe('Unknown');

    const bad = Buffer.alloc(32);
    bad.writeUInt16LE(4, 0);
    bad.writeBigUInt64LE(base + 4096n, 8);
    expect(parseObjectTypeName(bad, base)).toBe('Unknown');
  });
});

describe('parseHandleBufferForTest', () => {
  it('parses 40-byte SYSTEM_HANDLE_TABLE_ENTRY_INFO_EX entries at header 16', () => {
    const buf = Buffer.alloc(16 + 40);
    buf.writeBigUInt64LE(1n, 0); // NumberOfHandles
    const off = 16;
    buf.writeBigUInt64LE(0xffff8000n, off); // Object
    buf.writeBigUInt64LE(4242n, off + 8); // UniqueProcessId (owner)
    buf.writeBigUInt64LE(0x1c4n, off + 16); // HandleValue
    buf.writeUInt32LE(0x0010, off + 24); // GrantedAccess
    buf.writeUInt16LE(7, off + 28); // CreatorBackTraceIndex
    buf.writeUInt16LE(33, off + 30); // ObjectTypeIndex
    buf.writeUInt32LE(0x2, off + 32); // HandleAttributes

    const entries = parseHandleBufferForTest(buf, 4242);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      processId: 4242,
      handleValue: 0x1c4,
      grantedAccess: 0x0010,
      objectTypeIndex: 33,
      handleAttributes: 0x2,
    });
  });
});
