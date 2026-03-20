/**
 * Win32Debug API bindings — unit tests.
 *
 * Tests parseContext, writeContext, encodeDR7, and buildAbsoluteJump helpers.
 * Win32 API calls themselves are integration tests (require Windows runtime).
 */

import { describe, it, expect } from 'vitest';
import {
  parseContext,
  writeContext,
  encodeDR7,
  CONTEXT_SIZE,
  CONTEXT_FLAGS,
  DR7,
} from '@native/Win32Debug';

describe('Win32Debug', () => {
  describe('parseContext', () => {
    it('should parse ContextFlags from offset 0x30', () => {
      const buf = Buffer.alloc(CONTEXT_SIZE);
      buf.writeUInt32LE(CONTEXT_FLAGS.ALL, 0x30);
      const ctx = parseContext(buf);
      expect(ctx.contextFlags).toBe(CONTEXT_FLAGS.ALL);
    });

    it('should parse debug registers DR0-DR3, DR6, DR7', () => {
      const buf = Buffer.alloc(CONTEXT_SIZE);
      buf.writeBigUInt64LE(0x7FFE0000n, 0x48); // DR0
      buf.writeBigUInt64LE(0x7FFE1000n, 0x50); // DR1
      buf.writeBigUInt64LE(0x7FFE2000n, 0x58); // DR2
      buf.writeBigUInt64LE(0x7FFE3000n, 0x60); // DR3
      buf.writeBigUInt64LE(0xABCDn, 0x68);     // DR6
      buf.writeBigUInt64LE(0x1234n, 0x70);     // DR7

      const ctx = parseContext(buf);
      expect(ctx.dr0).toBe(0x7FFE0000n);
      expect(ctx.dr1).toBe(0x7FFE1000n);
      expect(ctx.dr2).toBe(0x7FFE2000n);
      expect(ctx.dr3).toBe(0x7FFE3000n);
      expect(ctx.dr6).toBe(0xABCDn);
      expect(ctx.dr7).toBe(0x1234n);
    });

    it('should parse general-purpose registers RAX-R15 and RIP', () => {
      const buf = Buffer.alloc(CONTEXT_SIZE);
      buf.writeBigUInt64LE(0x100n, 0x78);  // RAX
      buf.writeBigUInt64LE(0x200n, 0x80);  // RCX
      buf.writeBigUInt64LE(0xDEADBEEFn, 0xF8); // RIP
      buf.writeUInt32LE(0x246, 0x44);       // EFLAGS

      const ctx = parseContext(buf);
      expect(ctx.rax).toBe(0x100n);
      expect(ctx.rcx).toBe(0x200n);
      expect(ctx.rip).toBe(0xDEADBEEFn);
      expect(ctx.eflags).toBe(0x246);
    });
  });

  describe('writeContext', () => {
    it('should write DR registers into buffer', () => {
      const buf = Buffer.alloc(CONTEXT_SIZE);
      writeContext(buf, {
        dr0: 0xAAAAn,
        dr7: 0xBBBBn,
        rip: 0xCCCCn,
        contextFlags: CONTEXT_FLAGS.ALL,
      });

      expect(buf.readBigUInt64LE(0x48)).toBe(0xAAAAn);
      expect(buf.readBigUInt64LE(0x70)).toBe(0xBBBBn);
      expect(buf.readBigUInt64LE(0xF8)).toBe(0xCCCCn);
      expect(buf.readUInt32LE(0x30)).toBe(CONTEXT_FLAGS.ALL);
    });

    it('should not touch unspecified fields', () => {
      const buf = Buffer.alloc(CONTEXT_SIZE);
      buf.writeBigUInt64LE(0x9999n, 0x50); // DR1
      writeContext(buf, { dr0: 0x1111n });
      expect(buf.readBigUInt64LE(0x50)).toBe(0x9999n); // Unchanged
    });
  });

  describe('encodeDR7', () => {
    it('should encode local enable for DR0 execute breakpoint', () => {
      const dr7 = encodeDR7([{
        drIndex: 0,
        enabled: true,
        access: 'execute',
        size: 1,
      }]);
      // Bit 0 (local enable DR0) = 1
      // Bits 16-17 (condition) = 00 (execute)
      // Bits 18-19 (size) = 00 (1 byte)
      expect(dr7 & 1n).toBe(1n); // Local enable
      expect((dr7 >> 16n) & 3n).toBe(0n); // Execute
      expect((dr7 >> 18n) & 3n).toBe(0n); // 1 byte
    });

    it('should encode DR1 write breakpoint of 4 bytes', () => {
      const dr7 = encodeDR7([{
        drIndex: 1,
        enabled: true,
        access: 'write',
        size: 4,
      }]);
      expect((dr7 >> 2n) & 1n).toBe(1n); // Local enable DR1
      expect((dr7 >> 20n) & 3n).toBe(1n); // Write = 01
      expect((dr7 >> 22n) & 3n).toBe(3n); // 4 bytes = 11
    });

    it('should encode DR2 readwrite breakpoint of 8 bytes', () => {
      const dr7 = encodeDR7([{
        drIndex: 2,
        enabled: true,
        access: 'readwrite',
        size: 8,
      }]);
      expect((dr7 >> 4n) & 1n).toBe(1n); // Local enable DR2
      expect((dr7 >> 24n) & 3n).toBe(3n); // Readwrite = 11
      expect((dr7 >> 26n) & 3n).toBe(2n); // 8 bytes = 10
    });

    it('should handle multiple breakpoints simultaneously', () => {
      const dr7 = encodeDR7([
        { drIndex: 0, enabled: true, access: 'execute', size: 1 },
        { drIndex: 3, enabled: true, access: 'write', size: 2 },
      ]);
      expect(dr7 & 1n).toBe(1n);          // DR0 enabled
      expect((dr7 >> 6n) & 1n).toBe(1n);   // DR3 enabled
      expect((dr7 >> 2n) & 1n).toBe(0n);   // DR1 not enabled
    });

    it('should skip disabled entries', () => {
      const dr7 = encodeDR7([{
        drIndex: 0,
        enabled: false,
        access: 'write',
        size: 4,
      }]);
      expect(dr7).toBe(0n);
    });
  });

  describe('DR7 helpers', () => {
    it('should compute correct local enable bit shifts', () => {
      expect(DR7.localEnable(0)).toBe(1n);
      expect(DR7.localEnable(1)).toBe(4n);
      expect(DR7.localEnable(2)).toBe(16n);
      expect(DR7.localEnable(3)).toBe(64n);
    });

    it('should compute correct condition and size shifts', () => {
      expect(DR7.conditionShift(0)).toBe(16);
      expect(DR7.conditionShift(1)).toBe(20);
      expect(DR7.sizeShift(0)).toBe(18);
      expect(DR7.sizeShift(1)).toBe(22);
    });
  });
});
