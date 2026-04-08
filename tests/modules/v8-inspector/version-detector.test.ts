import { describe, it, expect } from 'vitest';
import { detectV8Version } from '@modules/v8-inspector/V8VersionDetector';

describe('V8VersionDetector', () => {
  describe('detectV8Version', () => {
    it('should detect feature flags via evaluate', async () => {
      const evaluateFn = async (expr: string) => {
        if (expr.includes('WebAssembly')) return true;
        if (expr.includes('BigInt')) return true;
        if (expr.includes('globalThis')) return true;
        if (expr.includes('toSorted')) return false;
        if (expr.includes('Temporal')) return false;
        if (expr.includes('Array.prototype.at')) return true;
        return false;
      };

      const result = await detectV8Version(evaluateFn);
      expect(result.v8Version).toBeDefined();
      expect(result.featureFlags.WebAssembly).toBe(true);
      expect(result.featureFlags.BigInt).toBe(true);
      expect(result.featureFlags['Array.prototype.at']).toBe(true);
      expect(result.featureFlags['Array.prototype.toSorted']).toBe(false);
      expect(result.compatibilityNotes.length).toBeGreaterThan(0);
    });

    it('should return unknown version when getVersion is not available', async () => {
      const evaluateFn = async () => false;
      const result = await detectV8Version(evaluateFn);
      expect(result.v8Version).toBe('unknown');
    });

    it('should extract V8 version from getVersion string', async () => {
      const evaluateFn = async () => false;
      const getVersionFn = async () => 'Chrome/120.0.0.0 V8/12.0.226.10';
      const result = await detectV8Version(evaluateFn, getVersionFn);
      expect(result.v8Version).toBe('12.0.226.10');
    });

    it('should handle evaluate failures gracefully', async () => {
      const evaluateFn = async () => {
        throw new Error('CDP error');
      };
      const result = await detectV8Version(evaluateFn);
      expect(result.featureFlags.WebAssembly).toBe(false);
      expect(result.featureFlags.BigInt).toBe(false);
    });

    it('should note missing features in compatibility notes', async () => {
      const evaluateFn = async () => false;
      const result = await detectV8Version(evaluateFn);
      const notes = result.compatibilityNotes;
      expect(notes.some((n) => n.includes('WebAssembly'))).toBe(true);
      expect(notes.some((n) => n.includes('BigInt'))).toBe(true);
    });

    it('should return positive note when all features available', async () => {
      const evaluateFn = async () => true;
      const result = await detectV8Version(evaluateFn);
      expect(result.compatibilityNotes).toContain('All probed features are available.');
    });

    it('should estimate version from highest available feature', async () => {
      const evaluateFn = async (expr: string) => {
        if (expr.includes('WebAssembly')) return true;
        if (expr.includes('BigInt')) return true;
        if (expr.includes('globalThis')) return true;
        if (expr.includes('toSorted')) return false;
        if (expr.includes('Temporal')) return false;
        if (expr.includes('Array.prototype.at')) return true;
        return false;
      };
      const result = await detectV8Version(evaluateFn);
      expect(result.v8Version).toBe('9.2');
    });
  });
});
