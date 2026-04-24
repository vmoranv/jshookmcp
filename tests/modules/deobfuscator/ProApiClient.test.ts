/**
 * Tests for ProApiClient - Obfuscator.io Pro API integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ProApiClient,
  deobfuscateWithProApi,
  hasProFeatures,
  hasValidProApiToken,
} from '@modules/deobfuscator/ProApiClient';

// Mock the logger
const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@utils/logger', () => ({ logger: loggerState }));

describe('ProApiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OBFUSCATOR_IO_API_TOKEN;
    delete process.env.OBFUSCATOR_IO_VERSION;
  });

  describe('hasValidProApiToken', () => {
    it('returns false when API token is not set', () => {
      expect(hasValidProApiToken()).toBe(false);
    });

    it('returns true when API token is set and valid length', () => {
      process.env.OBFUSCATOR_IO_API_TOKEN = 'valid-token-here-123';
      expect(hasValidProApiToken()).toBe(true);
    });

    it('returns false when API token is too short', () => {
      process.env.OBFUSCATOR_IO_API_TOKEN = 'short';
      expect(hasValidProApiToken()).toBe(false);
    });

    it('returns false when API token is empty', () => {
      process.env.OBFUSCATOR_IO_API_TOKEN = '';
      expect(hasValidProApiToken()).toBe(false);
    });
  });

  describe('hasProFeatures', () => {
    it('returns true when proApiToken is provided', () => {
      const options = {
        code: 'test',
        proApiToken: 'token123',
      } as any;
      expect(hasProFeatures(options)).toBe(true);
    });

    it('returns true when vmObfuscation is true', () => {
      const options = {
        code: 'test',
        vmObfuscation: true,
      } as any;
      expect(hasProFeatures(options)).toBe(true);
    });

    it('returns true when parseHtml is true', () => {
      const options = {
        code: 'test',
        parseHtml: true,
      } as any;
      expect(hasProFeatures(options)).toBe(true);
    });

    it('returns false when no Pro features enabled', () => {
      const options = {
        code: 'test',
        unpack: true,
        unminify: true,
      } as any;
      expect(hasProFeatures(options)).toBe(false);
    });

    it('returns true when multiple Pro features enabled', () => {
      const options = {
        code: 'test',
        proApiToken: 'token123',
        vmObfuscation: true,
        parseHtml: true,
      } as any;
      expect(hasProFeatures(options)).toBe(true);
    });
  });

  describe('loadClient', () => {
    it('should attempt to load the obfuscator client', async () => {
      const client = await ProApiClient.loadClient();
      // The client may or may not be loaded depending on if the module exists
      expect(typeof client?.obfuscatePro).toBe('function');
    });

    it('caches the client after first load', async () => {
      const client1 = await ProApiClient.loadClient();
      const client2 = await ProApiClient.loadClient();
      expect(client1).toBe(client2);
    });
  });

  describe('deobfuscateWithProApi', () => {
    it('returns null when no API token is set', async () => {
      process.env.OBFUSCATOR_IO_API_TOKEN = '';
      const options = {
        code: 'test code here',
      } as any;
      const result = await deobfuscateWithProApi(options);
      expect(result).toBeNull();
    });

    it('returns null when API token is too short', async () => {
      process.env.OBFUSCATOR_IO_API_TOKEN = 'short';
      const options = {
        code: 'test code here',
      } as any;
      const result = await deobfuscateWithProApi(options);
      expect(result).toBeNull();
    });

    it('returns null when client fails to load', async () => {
      process.env.OBFUSCATOR_IO_API_TOKEN = 'valid-token-123';
      const options = {
        code: 'test code here',
      } as any;
      const result = await deobfuscateWithProApi(options);
      expect(result).toBeNull();
    });
  });

  describe('obfuscatePro', () => {
    it('handles missing client gracefully', async () => {
      const result = await ProApiClient.obfuscatePro(
        'test code',
        { vmObfuscation: true },
        { apiToken: 'token123' },
      );
      expect(result).toBeNull();
    });
  });
});
