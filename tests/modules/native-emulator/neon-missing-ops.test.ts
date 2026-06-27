/**
 * E4: NEON missing instructions — SABAL, UABAL, SABDL, UABDL, PMULL
 *
 * These are the 3 TODO gaps in simd.ts execNeonThreeDifferent():
 *   - case 0b0101: SABAL / UABAL (signed/unsigned absolute diff accumulate long)
 *   - case 0b1101: SABDL / UABDL (signed/unsigned absolute diff long)
 *   - case 0b1110: PMULL (polynomial multiply long)
 *
 * Coverage:
 *   - SABAL/UABAL: 8→16, 16→32, 32→64; signed + unsigned; acc + fresh Vd
 *   - SABDL/UABDL: same width variants; edge cases (max diff, zero)
 *   - PMULL: polynomial multiply for GCM/CRC-style GF(2^n) arithmetic
 */

import { describe, expect, it } from 'vitest';
import { CpuEngine } from '@modules/native-emulator/CpuEngine';

const le = (w: number): number[] => [
  w & 0xff,
  (w >>> 8) & 0xff,
  (w >>> 16) & 0xff,
  (w >>> 24) & 0xff,
];

function runOne(setup: (e: CpuEngine) => void, insn: number): CpuEngine {
  const engine = new CpuEngine();
  setup(engine);
  const bytes = le(insn);
  const code = 0x4000;
  engine.mapMemory(code, bytes.length + 8);
  engine.writeCode(code, Uint8Array.from(bytes));
  engine.start(code, code + bytes.length);
  return engine;
}

const v = (...bytes: number[]): Uint8Array => {
  const o = new Uint8Array(16);
  o.set(bytes);
  return o;
};

// ── Instruction Encoders ─────────────────────────────────────────────────────

/**
 * SABAL/UABAL: 0 Q U 01110 size 1 Rm 0101 00 Rn Rd
 * Signed/Unsigned Absolute difference Accumulate Long.
 * Vd = Vd + |Vn - Vm| (lane-wise, widened result)
 */
function encodeABAL(
  Vd: number,
  Vn: number,
  Vm: number,
  size: number,
  U: number,
  Q: number,
): number {
  return (
    (0x0e205000 |
      (Q << 30) |
      (U << 29) |
      (size << 22) |
      (Vm << 16) |
      (0b0101_00 << 10) |
      (Vn << 5) |
      Vd) >>>
    0
  );
}

/**
 * SABDL/UABDL: 0 Q U 01110 size 1 Rm 1101 00 Rn Rd
 * Signed/Unsigned Absolute difference Long (no accumulate).
 * Vd = |Vn - Vm| (lane-wise, widened result)
 */
function encodeABDL(
  Vd: number,
  Vn: number,
  Vm: number,
  size: number,
  U: number,
  Q: number,
): number {
  return (
    (0x0e20d000 |
      (Q << 30) |
      (U << 29) |
      (size << 22) |
      (Vm << 16) |
      (0b1101_00 << 10) |
      (Vn << 5) |
      Vd) >>>
    0
  );
}

/**
 * PMULL/PMULL2: 0 Q 1 01110 size 1 Rm 1110 00 Rn Rd
 * Polynomial multiply long over GF(2). size=00 for .8B→.8H, size=11 for .1Q→.1Q.
 * Bits[31]=1 selects the high-half (PMULL2).
 * ARM ARM C4.1: high8=0x0E/0x4E, size=00 or size=11, bit21=1,
 * opcode[15:10]=111000
 */
function encodePMULL(Vd: number, Vn: number, Vm: number, size: number, Q: number): number {
  return (
    (0x0e20e000 |
      (Q << 30) |
      (1 << 29) | // U=1
      (size << 22) |
      (Vm << 16) |
      (0b1110_00 << 10) |
      (Vn << 5) |
      Vd) >>>
    0
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('E4: NEON Absolute Difference (SABAL/UABAL)', () => {
  describe('SABAL — Signed Absolute difference Accumulate Long', () => {
    it('SABAL: 8→16, Vd starts at zero', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(0, new Uint8Array(16)); // Vd=0
          e.writeVReg(1, v(10, 50, 200, 100)); // [10,50,-56,100]
          e.writeVReg(2, v(30, 20, 240, 50)); // [30,20,-16,50]
        },
        encodeABAL(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(20); // |10-30|
      expect(view.getInt16(2, true)).toBe(30); // |50-20|
      expect(view.getInt16(4, true)).toBe(40); // |-56 - (-16)|
      expect(view.getInt16(6, true)).toBe(50); // |100-50|
    });

    it('SABAL: accumulate into existing Vd', () => {
      const vd = new Uint8Array(16);
      new DataView(vd.buffer).setInt16(0, 100, true);
      new DataView(vd.buffer).setInt16(2, 200, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(0, vd);
          e.writeVReg(1, v(10, 20));
          e.writeVReg(2, v(5, 5));
        },
        encodeABAL(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(105); // 100 + |10-5|
      expect(view.getInt16(2, true)).toBe(215); // 200 + |20-5|
    });

    it('SABAL: negative with large absolute diff', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(0, new Uint8Array(16));
          e.writeVReg(1, v(128, 1)); // [-128, 1]
          e.writeVReg(2, v(127, 2)); // [127, 2]
        },
        encodeABAL(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(255); // |-128 - 127|
      expect(view.getInt16(2, true)).toBe(1); // |1 - 2|
    });

    it('SABAL: 16→32', () => {
      const v1 = new Uint8Array(16);
      const v2 = new Uint8Array(16);
      new DataView(v1.buffer).setInt16(0, -1000, true);
      new DataView(v1.buffer).setInt16(2, 2000, true);
      new DataView(v2.buffer).setInt16(0, 500, true);
      new DataView(v2.buffer).setInt16(2, -300, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(0, new Uint8Array(16));
          e.writeVReg(1, v1);
          e.writeVReg(2, v2);
        },
        encodeABAL(0, 1, 2, 1, 0, 0),
      ); // size=1

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt32(0, true)).toBe(1500); // |-1000-500|
      expect(view.getInt32(4, true)).toBe(2300); // |2000-(-300)|
    });
  });

  describe('UABAL — Unsigned Absolute difference Accumulate Long', () => {
    it('UABAL: unsigned lanes, widened result', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(0, new Uint8Array(16));
          e.writeVReg(1, v(10, 200, 50, 100));
          e.writeVReg(2, v(30, 20, 40, 250));
        },
        encodeABAL(0, 1, 2, 0, 1, 0),
      ); // U=1

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getUint16(0, true)).toBe(20); // |10-30|
      expect(view.getUint16(2, true)).toBe(180); // |200-20|
      expect(view.getUint16(4, true)).toBe(10); // |50-40|
      expect(view.getUint16(6, true)).toBe(150); // |100-250| = 150 (unsigned wrap diff)
    });

    it('UABAL: large unsigned diff with wrap-around', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(0, new Uint8Array(16));
          e.writeVReg(1, v(255, 0));
          e.writeVReg(2, v(0, 255));
        },
        encodeABAL(0, 1, 2, 0, 1, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getUint16(0, true)).toBe(255);
      expect(view.getUint16(2, true)).toBe(255);
    });
  });
});

describe('E4: NEON Absolute Difference (SABDL/UABDL)', () => {
  describe('SABDL — Signed Absolute difference Long', () => {
    it('SABDL: 8→16', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(100, 50, 200, 100)); // [100,50,-56,100]
          e.writeVReg(2, v(30, 80, 150, 80)); // [30,80,-106,80]
        },
        encodeABDL(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(70); // |100-30|
      expect(view.getInt16(2, true)).toBe(30); // |50-80|
      expect(view.getInt16(4, true)).toBe(50); // |-56-(-106)|
      expect(view.getInt16(6, true)).toBe(20); // |100-80|
    });

    it('SABDL: min/max signed values', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(128, 127)); // [-128, 127]
          e.writeVReg(2, v(127, 128)); // [127, -128]
        },
        encodeABDL(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(255); // |-128-127| = 255
      expect(view.getInt16(2, true)).toBe(255); // |127-(-128)| = 255
    });

    it('SABDL: 16→32', () => {
      const v1 = new Uint8Array(16);
      const v2 = new Uint8Array(16);
      new DataView(v1.buffer).setInt16(0, -32768, true);
      new DataView(v1.buffer).setInt16(2, 32767, true);
      new DataView(v2.buffer).setInt16(0, 32767, true);
      new DataView(v2.buffer).setInt16(2, -32768, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
          e.writeVReg(2, v2);
        },
        encodeABDL(0, 1, 2, 1, 0, 0),
      ); // size=1 for 16→32

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt32(0, true)).toBe(65535); // |-32768-32767|
      expect(view.getInt32(4, true)).toBe(65535); // |32767-(-32768)|
    });

    it('SABDL2: high half', () => {
      const v1 = new Uint8Array(16);
      const v2 = new Uint8Array(16);
      // Place data in the high half (bytes 8+)
      new DataView(v1.buffer).setInt16(8, 100, true);
      new DataView(v1.buffer).setInt16(10, 200, true);
      new DataView(v2.buffer).setInt16(8, 50, true);
      new DataView(v2.buffer).setInt16(10, 100, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
          e.writeVReg(2, v2);
        },
        encodeABDL(0, 1, 2, 1, 0, 1),
      ); // Q=1 for high half

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt32(0, true)).toBe(50); // |100-50|
      expect(view.getInt32(4, true)).toBe(100); // |200-100|
    });
  });

  describe('UABDL — Unsigned Absolute difference Long', () => {
    it('UABDL: basic', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(200, 50, 10, 255));
          e.writeVReg(2, v(50, 100, 200, 0));
        },
        encodeABDL(0, 1, 2, 0, 1, 0),
      ); // U=1

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getUint16(0, true)).toBe(150); // |200-50|
      expect(view.getUint16(2, true)).toBe(50); // |50-100|
      expect(view.getUint16(4, true)).toBe(190); // |10-200| = 190
      expect(view.getUint16(6, true)).toBe(255); // |255-0|
    });
  });
});

describe('E4: NEON Polynomial Multiply Long (PMULL)', () => {
  describe('PMULL — GF(2) polynomial multiply', () => {
    it('PMULL: simple poly multiply (x+a)*(x+b)', () => {
      // In GF(2): (x+2)*(x+3) where coefficient arithmetic is XOR (no carry).
      // Represent as polynomials over GF(2): each byte = 8-bit poly.
      // 0x03 * 0x05: binary 0011 * 0101 = poly (x+1)*(x^2+1) = x^3+x^2+x+1 = 0x0F
      // Implementation: poly_mul(0x03, 0x05) = 0x0F
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(0x03, 0x05, 0x0f, 0x00));
          e.writeVReg(2, v(0x05, 0x02, 0x01, 0x01));
        },
        encodePMULL(0, 1, 2, 0, 0),
      ); // size=00 for .8B→.8H

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getUint16(0, true)).toBe(0x0f); // 0x03 poly* 0x05 = 0x0f
      expect(view.getUint16(2, true)).toBe(0x0a); // 0x05 poly* 0x02 = 0x0a (0101*0010)
    });

    it('PMULL: GCM-like pattern', () => {
      // 0xFF * 0xFF in GF(2): both operands have all 8 bits set.
      // poly_mul: sum(0xFF << i, i=0..7) = 0xFF + 0x1FE + 0x3FC + ... + 0x7F80
      // Each shift-and-XOR: 0xFF * (2^8 - 1) polynomial style
      // 0xFF * 0xFF = 0x5555 (binary 01010101 01010101)
      // Let's verify: 0xFF << 0 = 0x0FF, << 1 = 0x1FE, XOR = 0x1F1
      // << 2 = 0x3FC, XOR = 0x2D2 + carryless...
      // Actually in GF(2) poly multiply, result bits are the XOR of
      // operand_b shifted by each set bit of operand_a.
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(0xff));
          e.writeVReg(2, v(0xff));
        },
        encodePMULL(0, 1, 2, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      const poly = view.getUint16(0, true);
      // poly_mul(0xFF, 0xFF) = XOR(0xFF<<0, 0xFF<<1, ..., 0xFF<<7)
      // = 0x5555
      expect(poly).toBe(0x5555);
    });

    it('PMULL: multiply by 1 (identity)', () => {
      // poly_mul(x, 1) where 1 is polynomial x^0 — each bit of x shifts 1 by 0, XOR-ed.
      // This is x * 1 = x in GF(2) polynomial multiplication. So result = input.
      // But the current decoder routes PMULL through execPmull which calls the existing
      // clmul64 function — 64-bit only. size=00 (.8B→.8H) maps to high8=0x2E with
      // the three-different encoding. The test expectations will depend on which code path
      // is taken.
      //
      // For now, verify the opcode is at least recognized (no Unsupported opcode error).
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(0xab, 0xcd, 0xef));
          e.writeVReg(2, v(0x01, 0x01, 0x01));
        },
        encodePMULL(0, 1, 2, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      // .8B→.8H path: 16-bit results in even byte offsets
      const v0 = view.getUint16(0, true);
      const v1 = view.getUint16(2, true);
      const v2 = view.getUint16(4, true);
      // poly_mul(x, 1) = x (identity): each input byte as a poly times x^0
      expect(v0).toBe(0xab);
      expect(v1).toBe(0xcd);
      expect(v2).toBe(0xef);
    });

    it('PMULL: multiply by 0', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(0x55, 0xaa));
          e.writeVReg(2, v(0x00, 0x00));
        },
        encodePMULL(0, 1, 2, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getUint16(0, true)).toBe(0x00);
      expect(view.getUint16(2, true)).toBe(0x00);
    });

    it('PMULL: AES-style irreducible poly relationship', () => {
      // x^8 + x^4 + x^3 + x + 1 = 0x11b (AES irreducible polynomial)
      // 0x02 * 0x87 in GF(2^8): standard xtime * 0x87
      // In GF(2) polynomial multiplication (no reduction): 0x02 * 0x87 = 0x10e
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(0x87));
          e.writeVReg(2, v(0x02));
        },
        encodePMULL(0, 1, 2, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      const product = view.getUint16(0, true);
      // poly_mul(0x87, 0x02): shift left 1 bit, 0x87<<1 = 0x10e
      expect(product).toBe(0x10e);
    });
  });
});

describe('E4: Boundary and edge cases', () => {
  it('SABAL: all same values (diff=0, accumulate unchanged)', () => {
    const vd = new Uint8Array(16);
    new DataView(vd.buffer).setInt16(0, 999, true);
    new DataView(vd.buffer).setInt16(2, 888, true);

    const engine = runOne(
      (e) => {
        e.writeVReg(0, vd);
        e.writeVReg(1, v(42, 42));
        e.writeVReg(2, v(42, 42));
      },
      encodeABAL(0, 1, 2, 0, 0, 0),
    );

    const result = engine.readVReg(0);
    const view = new DataView(result.buffer, result.byteOffset);
    expect(view.getInt16(0, true)).toBe(999);
    expect(view.getInt16(2, true)).toBe(888);
  });

  it('UABDL: zero diff across all lanes', () => {
    const engine = runOne(
      (e) => {
        e.writeVReg(1, v(100, 200, 50, 150));
        e.writeVReg(2, v(100, 200, 50, 150));
      },
      encodeABDL(0, 1, 2, 0, 1, 0),
    );

    const result = engine.readVReg(0);
    const view = new DataView(result.buffer, result.byteOffset);
    for (let i = 0; i < 4; i++) {
      expect(view.getUint16(i * 2, true)).toBe(0);
    }
  });

  it('PMULL with XOR pattern symmetry', () => {
    // (a+b) * c = a*c + b*c (polynomial addition = XOR)
    // (0x03 XOR 0x05)=0x06 * 0x07 should equal (0x03*0x07) XOR (0x05*0x07)
    // 0x06*0x07: poly_mul
    const engine = runOne(
      (e) => {
        e.writeVReg(1, v(0x06)); // 0x03 XOR 0x05
        e.writeVReg(2, v(0x07));
      },
      encodePMULL(0, 1, 2, 0, 0),
    );

    const result = engine.readVReg(0);
    const view = new DataView(result.buffer, result.byteOffset);
    const combined = view.getUint16(0, true);

    // Now compute individual: 0x03*0x07 XOR 0x05*0x07
    const e1 = runOne(
      (e) => {
        e.writeVReg(1, v(0x03));
        e.writeVReg(2, v(0x07));
      },
      encodePMULL(0, 1, 2, 0, 0),
    );
    const e2 = runOne(
      (e) => {
        e.writeVReg(1, v(0x05));
        e.writeVReg(2, v(0x07));
      },
      encodePMULL(0, 1, 2, 0, 0),
    );
    const v1 = new DataView(e1.readVReg(0).buffer).getUint16(0, true);
    const v2 = new DataView(e2.readVReg(0).buffer).getUint16(0, true);
    expect(combined).toBe(v1 ^ v2);
  });
});
