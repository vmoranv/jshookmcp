/**
 * Tests for DartInspectorHandlers — the domain handler that wraps
 * the {@link StringsExtractor} module behind the MCP tool surface.
 *
 * Covers validation, regex-rule compilation (ReDoS), rule modes,
 * offset truncation, and includeOffsets toggling.
 *
 * The handler returns a wrapped ToolResponse (`R.ok().merge(...).json()`),
 * so tests parse the response via {@link R.parse} before asserting.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';

import { DartInspectorHandlers } from '@server/domains/dart-inspector/handlers';
import { R } from '@server/domains/shared/ResponseBuilder';

const FIXTURE_PATH = resolve(__dirname, '../../../fixtures/dart-inspector/tiny-libapp.so');

describe('DartInspectorHandlers', () => {
  let handlers: DartInspectorHandlers;

  beforeAll(() => {
    handlers = new DartInspectorHandlers();
  });

  describe('handleDartStringsExtract — happy path', () => {
    it('returns wrapped success response with the 5 default categories', async () => {
      const response = await handlers.handleDartStringsExtract({ filePath: FIXTURE_PATH });
      const body = R.parse<{
        success: boolean;
        strings: Record<string, unknown[]>;
      }>(response);

      expect(body.success).toBe(true);
      expect(body.strings).toBeDefined();
      expect(body.strings.urls).toBeDefined();
      expect(body.strings.paths).toBeDefined();
      expect(body.strings.classNames).toBeDefined();
      expect(body.strings.packageRefs).toBeDefined();
      expect(body.strings.cryptoKeywords).toBeDefined();
    });
  });

  describe('handleDartStringsExtract — validation errors', () => {
    it('returns failure when filePath is missing', async () => {
      const response = await handlers.handleDartStringsExtract({});
      const body = R.parse<{ success: boolean; error: string }>(response);
      expect(body.success).toBe(false);
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
    });

    it('returns NOT_FOUND failure when file does not exist', async () => {
      const response = await handlers.handleDartStringsExtract({
        filePath: '/nonexistent/path/to/missing-libapp.so',
      });
      const body = R.parse<{ success: boolean; error: string }>(response);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/not found|ENOENT/i);
    });
  });

  describe('handleDartStringsExtract — customRules', () => {
    it('accepts a valid custom rule with flags', async () => {
      const response = await handlers.handleDartStringsExtract({
        filePath: FIXTURE_PATH,
        customRules: [{ pattern: '^FLAG_', flags: 'i', category: 'flags' }],
      });
      const body = R.parse<{ success: boolean; strings: Record<string, unknown> }>(response);
      expect(body.success).toBe(true);
      expect(body.strings).toHaveProperty('flags');
    });

    it('rejects an invalid regex with VALIDATION failure', async () => {
      const response = await handlers.handleDartStringsExtract({
        filePath: FIXTURE_PATH,
        customRules: [{ pattern: '(', category: 'evil' }],
      });
      const body = R.parse<{ success: boolean; error: string }>(response);
      expect(body.success).toBe(false);
      expect(body.error.toLowerCase()).toMatch(/compile|invalid|regex|syntax/);
    });

    it('rejects a catastrophic-backtracking pattern (ReDoS heuristic)', async () => {
      const response = await handlers.handleDartStringsExtract({
        filePath: FIXTURE_PATH,
        customRules: [{ pattern: '(a+)+', category: 'evil' }],
      });
      const body = R.parse<{ success: boolean; error: string }>(response);
      expect(body.success).toBe(false);
      expect(body.error.toLowerCase()).toContain('catastrophic');
    });
  });

  describe('handleDartStringsExtract — ruleMode', () => {
    const customRule = { pattern: '^https?://', flags: 'i', category: 'customUrls' };

    it('append mode keeps defaults and adds custom category', async () => {
      const response = await handlers.handleDartStringsExtract({
        filePath: FIXTURE_PATH,
        ruleMode: 'append',
        customRules: [customRule],
      });
      const body = R.parse<{ success: boolean; strings: Record<string, unknown> }>(response);
      expect(body.success).toBe(true);
      // urls (default) wins over customUrls because defaults come first in append.
      expect(body.strings).toHaveProperty('urls');
      expect(body.strings).toHaveProperty('customUrls');
    });

    it('prepend mode lets custom rules win over defaults', async () => {
      const response = await handlers.handleDartStringsExtract({
        filePath: FIXTURE_PATH,
        ruleMode: 'prepend',
        customRules: [customRule],
      });
      const body = R.parse<{
        success: boolean;
        strings: Record<string, Array<{ value: string }>>;
      }>(response);
      expect(body.success).toBe(true);
      expect(body.strings).toHaveProperty('customUrls');
      // In prepend mode, the URL strings land in `customUrls` rather than `urls`.
      const customUrls = body.strings.customUrls ?? [];
      const defaultUrls = body.strings.urls ?? [];
      expect(customUrls.length).toBeGreaterThan(defaultUrls.length);
    });

    it('replace mode removes default categories', async () => {
      const response = await handlers.handleDartStringsExtract({
        filePath: FIXTURE_PATH,
        ruleMode: 'replace',
        customRules: [customRule],
      });
      const body = R.parse<{ success: boolean; strings: Record<string, unknown> }>(response);
      expect(body.success).toBe(true);
      expect(body.strings).toHaveProperty('customUrls');
      // Default categories should NOT be present when replaced.
      expect(body.strings).not.toHaveProperty('classNames');
      expect(body.strings).not.toHaveProperty('packageRefs');
    });
  });

  describe('handleDartStringsExtract — option toggles', () => {
    it('omits offsets field when includeOffsets is false', async () => {
      const response = await handlers.handleDartStringsExtract({
        filePath: FIXTURE_PATH,
        includeOffsets: false,
      });
      const body = R.parse<{
        success: boolean;
        strings: Record<string, Array<Record<string, unknown>>>;
      }>(response);
      expect(body.success).toBe(true);

      for (const items of Object.values(body.strings)) {
        for (const item of items) {
          expect(item).not.toHaveProperty('offsets');
        }
      }
    });

    it('truncates offsets when maxOffsetsPerString is exceeded', async () => {
      // The fixture has `TRIPLE_TOKEN_VALUE_AA` at three offsets — cap to 2.
      const response = await handlers.handleDartStringsExtract({
        filePath: FIXTURE_PATH,
        maxOffsetsPerString: 2,
        includeRaw: true,
      });
      const body = R.parse<{
        success: boolean;
        strings: Record<string, Array<{ value: string; offsets: number[]; truncated?: boolean }>>;
      }>(response);
      expect(body.success).toBe(true);

      const raw = body.strings.raw ?? [];
      const triple = raw.find((item) => item.value === 'TRIPLE_TOKEN_VALUE_AA');
      expect(triple).toBeDefined();
      expect(triple!.offsets.length).toBe(2);
      expect(triple!.truncated).toBe(true);
    });
  });
});
