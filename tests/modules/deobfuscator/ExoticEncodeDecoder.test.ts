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
  detectJSFuck,
  detectJJEncode,
  detectAAEncode,
  detectURLEncode,
  detectHexEscape,
  detectUnicodeEscape,
  detectNumericObfuscation,
  detectOctalEscape,
  detectTemplateLiteralObfuscation,
  detectHTMLEntityObfuscation,
  detectMixedEscapeObfuscation,
  decodeHexEscapeSequences,
  decodeUnicodeEscapeSequences,
  decodeOctalEscapeSequences,
  decodeHTMLEntityObfuscation,
} from '@modules/deobfuscator/ExoticEncodeDecoder';

describe('ExoticEncodeDecoder', () => {
  describe('detectJSFuck', () => {
    it('detects minimal JSFuck pattern', () => {
      const code = `[]+![]`;
      expect(detectJSFuck(code)).toBe(false);
    });

    it('returns false for plain code', () => {
      const code = `function hello(){ return "world"; }`;
      expect(detectJSFuck(code)).toBe(false);
    });

    it('returns false for very short JSFuck-like strings', () => {
      const code = `[]+[]`;
      expect(detectJSFuck(code)).toBe(false);
    });
  });

  describe('detectJJEncode', () => {
    it('detects jjencode pattern', () => {
      const code = `$=~[];`;
      expect(detectJJEncode(code)).toBe(true);
    });

    it('detects alternate jjencode pattern', () => {
      const code = `$~[]+_$[1];`;
      expect(detectJJEncode(code)).toBe(true);
    });

    it('returns false for plain code', () => {
      const code = `function test(){ return true; }`;
      expect(detectJJEncode(code)).toBe(false);
    });
  });

  describe('detectAAEncode', () => {
    it('detects aaencode pattern', () => {
      const code = `ﾟωﾟﾟ Θﾟ = ﾟｰﾟ - ﾟ`;
      expect(detectAAEncode(code)).toBe(true);
    });

    it('detects aaencode alternate pattern', () => {
      const code = `$_ﾟωﾟ_ $_ﾟ-ﾟ_$_`;
      expect(detectAAEncode(code)).toBe(true);
    });

    it('returns false for plain code', () => {
      const code = `function test(){ return "hello"; }`;
      expect(detectAAEncode(code)).toBe(false);
    });
  });

  describe('detectURLEncode', () => {
    it('detects URL encoded pattern', () => {
      const code = `%48%65%6C%6C%6F%20%57%6F%72%6C%64`;
      expect(detectURLEncode(code)).toBe(true);
    });

    it('detects hex escape URL encoding', () => {
      const code = `\\x48\\x65\\x6C\\x6C\\x6F`;
      expect(detectURLEncode(code)).toBe(true);
    });

    it('detects HTML hex entity pattern', () => {
      const code = `&#x48;&#x65;&#x6C;&#x6C;&#x6F;`;
      expect(detectURLEncode(code)).toBe(true);
    });

    it('returns false for plain code', () => {
      const code = `function test(){ return "hello"; }`;
      expect(detectURLEncode(code)).toBe(false);
    });
  });

  describe('detectHexEscape', () => {
    it('detects hex escape sequences', () => {
      const code = `\\x48\\x65\\x6C\\x6C\\x6F`;
      expect(detectHexEscape(code)).toBe(true);
    });

    it('returns false for code with fewer than 5 hex escapes', () => {
      const code = `\\x48\\x65\\x6C`;
      expect(detectHexEscape(code)).toBe(false);
    });

    it('returns false for plain code', () => {
      const code = `function test(){ return "hello"; }`;
      expect(detectHexEscape(code)).toBe(false);
    });
  });

  describe('detectUnicodeEscape', () => {
    it('detects unicode escape sequences', () => {
      const code = `\\u0048\\u0065\\u006C\\u006C\\u006F`;
      expect(detectUnicodeEscape(code)).toBe(true);
    });

    it('returns false for code with fewer than 3 unicode escapes', () => {
      const code = `\\u0048\\u0065`;
      expect(detectUnicodeEscape(code)).toBe(false);
    });

    it('returns false for plain code', () => {
      const code = `function test(){ return "hello"; }`;
      expect(detectUnicodeEscape(code)).toBe(false);
    });
  });

  describe('detectNumericObfuscation', () => {
    it('detects toString pattern', () => {
      const code = `(65).toString((36))`;
      expect(detectNumericObfuscation(code)).toBe(true);
    });

    it('detects String.fromCharCode with expressions', () => {
      const code = `String.fromCharCode(65+65)`;
      expect(detectNumericObfuscation(code)).toBe(true);
    });

    it('detects array map with String.fromCharCode', () => {
      const code = `[72,101,108,108,111].map(String.fromCharCode)`;
      expect(detectNumericObfuscation(code)).toBe(true);
    });

    it('returns false for plain code', () => {
      const code = `function test(){ return 42; }`;
      expect(detectNumericObfuscation(code)).toBe(false);
    });
  });

  describe('decodeHexEscapeSequences', () => {
    it('decodes hex escape sequences', () => {
      const code = `\\x48\\x65\\x6C\\x6C\\x6F`;
      const result = decodeHexEscapeSequences(code);
      expect(result.success).toBe(true);
      expect(result.code).toBe('Hello');
    });

    it('returns original code when no hex escapes found', () => {
      const code = `function test(){ return "hello"; }`;
      const result = decodeHexEscapeSequences(code);
      expect(result.success).toBe(false);
      expect(result.code).toBe(code);
    });
  });

  describe('decodeUnicodeEscapeSequences', () => {
    it('decodes unicode escape sequences', () => {
      const code = `\\u0048\\u0065\\u006C\\u006C\\u006F`;
      const result = decodeUnicodeEscapeSequences(code);
      expect(result.success).toBe(true);
      expect(result.code).toBe('Hello');
    });

    it('returns original code when no unicode escapes found', () => {
      const code = `function test(){ return "hello"; }`;
      const result = decodeUnicodeEscapeSequences(code);
      expect(result.success).toBe(false);
      expect(result.code).toBe(code);
    });
  });

  describe('detectOctalEscape', () => {
    it('detects octal escape sequences', () => {
      const code = `\\101\\102\\103`; // ABC
      expect(detectOctalEscape(code)).toBe(true);
    });

    it('returns false for fewer than 3 octal escapes', () => {
      const code = `\\101\\102`;
      expect(detectOctalEscape(code)).toBe(false);
    });

    it('returns false for plain code', () => {
      const code = `function test(){ return "hello"; }`;
      expect(detectOctalEscape(code)).toBe(false);
    });
  });

  describe('detectTemplateLiteralObfuscation', () => {
    it('detects template literal with backslash', () => {
      const code = `\`hello \${x}\\` + `world\``;
      expect(detectTemplateLiteralObfuscation(code)).toBe(true);
    });

    it('returns false for plain code', () => {
      const code = `function test(){ return "hello"; }`;
      expect(detectTemplateLiteralObfuscation(code)).toBe(false);
    });
  });

  describe('detectHTMLEntityObfuscation', () => {
    it('detects HTML hex entity pattern', () => {
      const code = `&#x48;&#x65;&#x6C;&#x6C;&#x6F;`;
      expect(detectHTMLEntityObfuscation(code)).toBe(true);
    });

    it('detects HTML numeric entity pattern', () => {
      const code = `&#72;&#101;&#108;&#108;&#111;`;
      expect(detectHTMLEntityObfuscation(code)).toBe(true);
    });

    it('detects HTML named entity pattern', () => {
      const code = `&lt;script&gt;`;
      expect(detectHTMLEntityObfuscation(code)).toBe(true);
    });

    it('returns false for plain code', () => {
      const code = `function test(){ return "hello"; }`;
      expect(detectHTMLEntityObfuscation(code)).toBe(false);
    });
  });

  describe('detectMixedEscapeObfuscation', () => {
    it('detects mixed hex and unicode escapes', () => {
      const code = `\\x48\\x65\\u0048\\u0065\\101\\102`;
      expect(detectMixedEscapeObfuscation(code)).toBe(true);
    });

    it('returns false when only one escape type present', () => {
      const code = `\\x48\\x65\\x6C\\x6C\\x6F`;
      expect(detectMixedEscapeObfuscation(code)).toBe(false);
    });
  });

  describe('decodeOctalEscapeSequences', () => {
    it('decodes octal escape sequences', () => {
      const code = `\\101\\102\\103`;
      const result = decodeOctalEscapeSequences(code);
      expect(result.success).toBe(true);
      expect(result.code).toContain('A');
      expect(result.code).toContain('B');
      expect(result.code).toContain('C');
    });

    it('returns original code when no octal escapes found', () => {
      const code = `function test(){ return "hello"; }`;
      const result = decodeOctalEscapeSequences(code);
      expect(result.success).toBe(false);
      expect(result.code).toBe(code);
    });
  });

  describe('decodeHTMLEntityObfuscation', () => {
    it('decodes HTML hex entity obfuscation', () => {
      const code = `&#x48;&#x65;&#x6C;&#x6C;&#x6F;`;
      const result = decodeHTMLEntityObfuscation(code);
      expect(result.success).toBe(true);
      expect(result.code).toBe('Hello');
    });

    it('decodes HTML numeric entity obfuscation', () => {
      const code = `&#72;&#101;&#108;&#108;&#111;`;
      const result = decodeHTMLEntityObfuscation(code);
      expect(result.success).toBe(true);
      expect(result.code).toBe('Hello');
    });

    it('decodes HTML named entity obfuscation', () => {
      const code = `&lt;script&gt;`;
      const result = decodeHTMLEntityObfuscation(code);
      expect(result.success).toBe(true);
      expect(result.code).toContain('<');
      expect(result.code).toContain('>');
    });

    it('returns original code when no HTML entities found', () => {
      const code = `function test(){ return "hello"; }`;
      const result = decodeHTMLEntityObfuscation(code);
      expect(result.success).toBe(false);
      expect(result.code).toBe(code);
    });
  });
});
