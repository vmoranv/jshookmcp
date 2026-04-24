import { describe, it, expect, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import {
  VMIntegration,
  JScramblerIntegration,
} from '@modules/deobfuscator/VMAndJScramblerIntegration';

describe('VMAndJScramblerIntegration', () => {
  describe('VMIntegration', () => {
    const vmIntegration = new VMIntegration();

    it('returns no detection for clean code', () => {
      const code = `function add(a, b) { return a + b; }`;
      const result = vmIntegration.detectVM(code);
      expect(result.detected).toBe(false);
      expect(result.type).toBe('none');
    });

    it('detects simple VM protection patterns', () => {
      const code = `
        var instructions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        while(true) { switch(pc++) { case 0: break; } }
      `;
      const result = vmIntegration.detectVM(code);
      expect(result.detected).toBe(true);
      expect(['simple-vm', 'custom-vm']).toContain(result.type);
    });

    it('detects custom VM with multiple patterns', () => {
      const code = `
        var instructions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        while(true) { switch(pc++) { case 0: break; } }
        stack.push(pc);
      `;
      const result = vmIntegration.detectVM(code);
      expect(result.detected).toBe(true);
      expect(result.type).toBe('custom-vm');
    });

    it('counts VM instructions in detected VM', () => {
      const code = `
        var instructions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        while(true) { switch(pc++) { case 0: break; } }
        stack.push(pc);
      `;
      const result = vmIntegration.detectVM(code);
      expect(result.detected).toBe(true);
      expect(result.instructionCount).toBe(1);
    });

    it('returns warnings for detected VM', () => {
      const code = `
        var instructions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        while(true) { switch(pc++) { case 0: break; } }
      `;
      const result = vmIntegration.detectVM(code);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('VM protection detected');
    });

    it('handles VM deobfuscation disabled option', async () => {
      const code = `
        var instructions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        while(true) { switch(pc++) { case 0: break; } }
      `;
      const result = await vmIntegration.deobfuscateVM(code, { enabled: false });
      expect(result.detected).toBe(true);
      expect(result.deobfuscated).toBe(false);
    });
  });

  describe('JScramblerIntegration', () => {
    const jscramblerIntegration = new JScramblerIntegration();

    it('returns no detection for clean code', async () => {
      const code = `function hello() { return "world"; }`;
      const result = await jscramblerIntegration.deobfuscateJScrambler(code);
      expect(result.detected).toBe(false);
    });

    it('detects JScrambler patterns', async () => {
      const code = `var $_jsxc = ["a", "b"]; jsxc_(1, 2);`;
      const result = await jscramblerIntegration.deobfuscateJScrambler(code);
      expect(result.detected).toBe(true);
    });

    it('detects JScrambler unicode patterns', async () => {
      const code = `var $⁠ = "test";`;
      const result = await jscramblerIntegration.deobfuscateJScrambler(code);
      expect(result.detected).toBe(true);
    });

    it('returns disabled result when option set', async () => {
      const code = `var $_jsxc = ["a", "b"];`;
      const result = await jscramblerIntegration.deobfuscateJScrambler(code, { enabled: false });
      expect(result.detected).toBe(true);
      expect(result.success).toBe(false);
      expect(result.warnings).toContain('JScrambler detected but deobfuscation disabled');
    });

    it('returns confidence score when detected', async () => {
      const code = `var $_jsxc = ["a", "b"];`;
      const result = await jscramblerIntegration.deobfuscateJScrambler(code);
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });
});
