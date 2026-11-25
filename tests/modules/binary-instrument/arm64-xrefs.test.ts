import { describe, expect, it } from 'vitest';
import { findArm64Xrefs } from '@modules/binary-instrument/arm64-xrefs';

describe('findArm64Xrefs', () => {
  it('finds ADRP+ADD pairs resolving to the target', () => {
    const buf = Buffer.alloc(16);
    buf.writeUInt32LE(0x90000080, 0); // adrp x0, 0x10000
    buf.writeUInt32LE(0x91159000, 4); // add x0, x0, #0x564
    expect(findArm64Xrefs(new Uint8Array(buf), 0x10564)).toEqual([{ at: 4, kind: 'adrp-add' }]);
  });

  it('finds single-instruction ADR references', () => {
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE(0x10000100, 0); // adr x0, +0x20
    expect(findArm64Xrefs(new Uint8Array(buf), 0x20)).toEqual([{ at: 0, kind: 'adr' }]);
  });

  it('finds direct BL branches to the target', () => {
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE(0x94000008, 0); // bl +0x20
    expect(findArm64Xrefs(new Uint8Array(buf), 0x20)).toEqual([{ at: 0, kind: 'bl' }]);
  });

  it('returns no matches for a different target', () => {
    const buf = Buffer.alloc(16);
    buf.writeUInt32LE(0x90000080, 0);
    buf.writeUInt32LE(0x91159000, 4);
    expect(findArm64Xrefs(new Uint8Array(buf), 0x99999)).toEqual([]);
  });
});
