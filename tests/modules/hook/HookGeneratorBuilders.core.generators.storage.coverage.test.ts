/**
 * Additional coverage tests for HookGeneratorBuilders.core.generators.storage.
 *
 * Focuses on uncovered branches.
 */
import { describe, expect, it } from 'vitest';

import {
  generateCookieHook,
  generateLocalStorageHook,
  getInjectionInstructions,
} from '@modules/hook/HookGeneratorBuilders.core.generators.storage';

describe('HookGeneratorBuilders.core.generators.storage — additional coverage', () => {
  // ── generateLocalStorageHook ──────────────────────────────────

  describe('generateLocalStorageHook — additional branches', () => {
    it('generates log action hook without block or customCode', () => {
      const script = generateLocalStorageHook('log');

      // The non-block branches should still include all hooks
      expect(script).toContain('const originalSetItem = Storage.prototype.setItem;');
      expect(script).toContain('const originalGetItem = Storage.prototype.getItem;');
      expect(script).toContain('const originalRemoveItem = Storage.prototype.removeItem;');
      expect(script).toContain('const originalClear = Storage.prototype.clear;');
    });

    it('includes storage type detection (localStorage vs sessionStorage)', () => {
      const script = generateLocalStorageHook('log');

      expect(script).toContain("this === window.localStorage ? 'localStorage' : 'sessionStorage'");
    });

    it('includes stack trace capture in setItem', () => {
      const script = generateLocalStorageHook('log');

      expect(script).toContain("new Error().stack.split('\\n').slice(2, 4).join('\\n')");
    });

    it('includes value tracking in removeItem', () => {
      const script = generateLocalStorageHook('log');

      expect(script).toContain('const oldValue = this.getItem(key);');
    });

    it('includes item count tracking in clear', () => {
      const script = generateLocalStorageHook('log');

      expect(script).toContain('const itemCount = this.length;');
      expect(script).toContain('items: Object.keys(this)');
    });

    it('wraps output in strict-mode IIFE', () => {
      const script = generateLocalStorageHook('log');

      expect(script).toMatch(/^\(function\(\)/);
      expect(script).toContain("'use strict';");
    });
  });

  // ── generateCookieHook ───────────────────────────────────────

  describe('generateCookieHook — additional branches', () => {
    it('generates log action hook without block or customCode', () => {
      const script = generateCookieHook('log');

      expect(script).toContain("Object.defineProperty(document, 'cookie'");
      expect(script).not.toContain("'return;'");
    });

    it('includes parseCookie helper function', () => {
      const script = generateCookieHook('log');

      expect(script).toContain('function parseCookie(cookieString)');
      expect(script).toContain("cookieString.split(';')[0].split('=')");
      expect(script).toContain('parts[0]?.trim()');
      expect(script).toContain('parts[1]?.trim()');
    });

    it('includes cookie count tracking in getter', () => {
      const script = generateCookieHook('log');

      expect(script).toContain("cookieCount: value ? value.split(';').length : 0");
    });

    it('includes stack trace in setter', () => {
      const script = generateCookieHook('log');

      expect(script).toContain("new Error().stack.split('\\n').slice(2, 4).join('\\n')");
    });

    it('includes descriptor fallback for HTMLDocument', () => {
      const script = generateCookieHook('log');

      expect(script).toContain("Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie')");
    });

    it('includes error for missing cookie descriptor', () => {
      const script = generateCookieHook('log');

      expect(script).toContain("console.error('[Cookie Hook] Failed to get cookie descriptor')");
    });
  });

  // ── getInjectionInstructions ──────────────────────────────────

  describe('getInjectionInstructions — all types', () => {
    it('returns instructions for various hook types', () => {
      const types = [
        'function',
        'xhr',
        'fetch',
        'websocket',
        'localstorage',
        'cookie',
        'eval',
        'object-method',
      ] as const;

      for (const type of types) {
        const instructions = getInjectionInstructions(type);
        expect(instructions).toContain(type);
        expect(instructions).toContain('page_evaluate');
        expect(instructions).toContain('console_execute');
      }
    });
  });
});
