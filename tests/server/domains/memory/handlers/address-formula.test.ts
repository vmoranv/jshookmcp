import { describe, it, expect } from 'vitest';
import { parseAddressFormula } from '@server/domains/memory/handlers/address-formula';

describe('parseAddressFormula', () => {
  describe('pure hex', () => {
    it('should pass through 0x-prefixed hex', () => {
      const r = parseAddressFormula('0x7FF612340000');
      expect(r.address).toBe('0x7FF612340000');
      expect(r.error).toBeNull();
    });

    it('should prepend 0x for bare hex', () => {
      const r = parseAddressFormula('7FF612340000');
      expect(r.address).toBe('0x7FF612340000');
    });

    it('should handle lowercase hex', () => {
      const r = parseAddressFormula('0x7ff6');
      expect(r.address).toBe('0x7ff6');
    });

    it('should return error for empty input', () => {
      const r = parseAddressFormula('');
      expect(r.address).toBeNull();
      expect(r.error).toMatch(/empty/i);
    });
  });

  describe('arithmetic (ReClass.NET AddressParser style)', () => {
    it('should add a hex offset', () => {
      const r = parseAddressFormula('0x7FF612340000 + 0x20');
      expect(r.address).toBe('0x7ff612340020');
    });

    it('should subtract a hex offset', () => {
      const r = parseAddressFormula('0x7FF612340000 - 0x10');
      expect(r.address).toBe('0x7ff61233fff0');
    });

    it('should chain multiple additions and subtractions (left-to-right)', () => {
      const r = parseAddressFormula('0x1000 + 0x20 - 0x10 + 16');
      // 0x1000 + 0x20 = 0x1020; 0x1020 - 0x10 = 0x1010; 0x1010 + 16 = 0x1020
      expect(r.address).toBe('0x1020');
    });

    it('should accept decimal offsets', () => {
      const r = parseAddressFormula('0x1000 + 256');
      expect(r.address).toBe('0x1100');
    });

    it('should accept decimal base', () => {
      const r = parseAddressFormula('65536 + 16');
      expect(r.address).toBe('0x10010');
    });

    it('should report error for negative result', () => {
      const r = parseAddressFormula('0x10 - 0x20 - 0x100');
      expect(r.address).toBeNull();
      expect(r.error).toMatch(/negative/i);
    });
  });

  describe('module references', () => {
    it('should report unsupported for module references', () => {
      const r = parseAddressFormula('<Module.exe> + 0x10');
      expect(r.address).toBeNull();
      expect(r.error).toMatch(/module reference/i);
      expect(r.error).toContain('Module.exe');
    });

    it('should report unsupported for dll references', () => {
      const r = parseAddressFormula('<game.dll> + 0x20 - 0x4');
      expect(r.address).toBeNull();
      expect(r.error).toMatch(/module reference/i);
    });

    it('should guide user to replace with actual base', () => {
      const r = parseAddressFormula('<Module.exe>');
      expect(r.error).toMatch(/memory_pe_headers/);
    });
  });

  describe('error handling', () => {
    it('should reject garbage input', () => {
      const r = parseAddressFormula('garbage!!!');
      expect(r.address).toBeNull();
      expect(r.error).toMatch(/cannot parse/);
    });

    it('should reject missing operator (no whitespace concatenation)', () => {
      const r = parseAddressFormula('0x1000 0x20');
      expect(r.address).toBeNull();
      expect(r.error).toMatch(/expected/i);
    });

    it('should reject trailing junk', () => {
      const r = parseAddressFormula('0x1000 + 0x20 +');
      expect(r.address).toBeNull();
      expect(r.error).toMatch(/expected number/i);
    });
  });
});
