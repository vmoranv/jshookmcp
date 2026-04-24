import { logger } from '@utils/logger';
import { type ExecutionSandbox } from '@modules/security/ExecutionSandbox';

export interface EncodeDecodeResult {
  code: string;
  success: boolean;
  confidence: number;
  warnings: string[];
}

const JSFUCK_CHARS = '[]()+!';

export function detectJSFuck(code: string): boolean {
  const jsfuckPatterns = [
    /^\s*[\[\]()+!]{20,}\s*$/m,
    /\(\s*\[\s*\]\s*\+\s*\[\s*\]\s*\)/,
    /!\s*\[\s*\]\s*\+\s*!\s*\[\s*\]/,
    /\[\s*\]\s*\[\s*\]\s*===\s*\[\s*\]/,
    /_*\[\s*\]\s*\+\s*_*\[\s*\]\s*\+\s*_*\[\s*\]/,
  ];

  const hasJSFuckChars = JSFUCK_CHARS.split('').every((c) => code.includes(c));
  const hasPattern = jsfuckPatterns.some((p) => p.test(code));

  return hasJSFuckChars && hasPattern && code.length > 50;
}

export function detectAAEncode(code: string): boolean {
  return /ﾟωﾟ|ﾟΘﾟ|ﾟｰﾟ|ﾟ-ﾟ|´ω´|´Θ´/.test(code) || /\$_ﾟωﾟ_ \$_ﾟ-ﾟ_\$_/.test(code);
}

export function detectURLEncode(code: string): boolean {
  const urlEncodedPatterns = [
    /%[0-9A-F]{2}%[0-9A-F]{2}%[0-9A-F]{2}/,
    /\\x[0-9a-fA-F]{2}\\x[0-9a-fA-F]{2}\\x[0-9a-fA-F]{2}/,
    /&#x[0-9a-fA-F]+;?/,
  ];
  return urlEncodedPatterns.some((p) => p.test(code));
}

export function detectHexEscape(code: string): boolean {
  const matches = code.match(/\\x[0-9a-fA-F]{2}/g);
  return matches !== null && matches.length >= 5;
}

export function detectUnicodeEscape(code: string): boolean {
  const matches = code.match(/\\u[0-9a-fA-F]{4}/g);
  return matches !== null && matches.length >= 3;
}

export function detectOctalEscape(code: string): boolean {
  const matches = code.match(/\\[0-7]{1,3}/g);
  return matches !== null && matches.length >= 3;
}

export function detectTemplateLiteralObfuscation(code: string): boolean {
  return /\$\{[^}]+\}/.test(code) && code.includes('\\');
}

export function detectHTMLEntityObfuscation(code: string): boolean {
  const patterns = [/&#x[0-9a-fA-F]+;/i, /&#\d+;/, /&[a-z]+;/i];
  return patterns.some((p) => p.test(code));
}

export function detectMixedEscapeObfuscation(code: string): boolean {
  const hexCount = (code.match(/\\x[0-9a-fA-F]{2}/g) ?? []).length;
  const unicodeCount = (code.match(/\\u[0-9a-fA-F]{4}/g) ?? []).length;
  const octalCount = (code.match(/\\[0-7]{1,3}/g) ?? []).length;
  return hexCount >= 3 && unicodeCount >= 2 && octalCount >= 2;
}

export function detectNumericObfuscation(code: string): boolean {
  const patterns = [
    /\(\d+\)\.toString\(\s*\(\d+\)\s*\)/,
    /String\.fromCharCode\(\d+[+\-*/]\d+\)/,
    /\[\d+(?:\s*,\s*\d+)+\]\.map\(\s*String\.fromCharCode\s*\)/,
  ];
  return patterns.some((p) => p.test(code));
}

export function detectJJEncode(code: string): boolean {
  return (
    /\$=~\[\]/.test(code) || /_\$\[/.test(code) || /\(\$_\[/.test(code) || /\$\$\$\$_/.test(code)
  );
}

export async function decodeJSFuck(
  code: string,
  sandbox: ExecutionSandbox,
  timeoutMs = 5000,
): Promise<EncodeDecodeResult> {
  const warnings: string[] = [];

  if (!detectJSFuck(code)) {
    return { code, success: false, confidence: 0, warnings };
  }

  if (code.length > 100000) {
    warnings.push('JSFuck code too large for sandbox execution (>100KB)');
    return { code, success: false, confidence: 0.1, warnings };
  }

  logger.info('JSFuck pattern detected, attempting sandbox evaluation...');

  try {
    const result = await sandbox.execute({
      code: `return (${code});`,
      timeoutMs,
    });

    if (result.ok && typeof result.output === 'string' && result.output.length > 0) {
      logger.info(`JSFuck decoded successfully (${result.output.length} chars)`);
      return {
        code: result.output,
        success: true,
        confidence: 0.9,
        warnings,
      };
    }

    warnings.push('JSFuck sandbox evaluation returned no output');
    return { code, success: false, confidence: 0.2, warnings };
  } catch (error) {
    warnings.push(
      `JSFuck evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { code, success: false, confidence: 0.1, warnings };
  }
}

export async function decodeJJEncode(
  code: string,
  sandbox: ExecutionSandbox,
  timeoutMs = 5000,
): Promise<EncodeDecodeResult> {
  const warnings: string[] = [];

  if (!detectJJEncode(code)) {
    return { code, success: false, confidence: 0, warnings };
  }

  logger.info('JJEncode pattern detected, attempting sandbox evaluation...');

  try {
    const lines = code.split('\n').filter((l) => l.trim());
    const lastLine = lines[lines.length - 1] ?? '';

    let evalCode = code;
    if (lastLine.includes('$$$$')) {
      evalCode = `${code}; return $$$$();`;
    }

    const result = await sandbox.execute({
      code: evalCode,
      timeoutMs,
    });

    if (result.ok && typeof result.output === 'string' && result.output.length > 0) {
      logger.info(`JJEncode decoded successfully (${result.output.length} chars)`);
      return {
        code: result.output,
        success: true,
        confidence: 0.85,
        warnings,
      };
    }

    warnings.push('JJEncode sandbox evaluation returned no output');
    return { code, success: false, confidence: 0.2, warnings };
  } catch (error) {
    warnings.push(
      `JJEncode evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { code, success: false, confidence: 0.1, warnings };
  }
}

export async function decodeAAEncode(
  code: string,
  sandbox: ExecutionSandbox,
  timeoutMs = 5000,
): Promise<EncodeDecodeResult> {
  const warnings: string[] = [];

  if (!detectAAEncode(code)) {
    return { code, success: false, confidence: 0, warnings };
  }

  if (code.length > 100000) {
    warnings.push('AAEncode code too large for sandbox execution (>100KB)');
    return { code, success: false, confidence: 0.1, warnings };
  }

  logger.info('AAEncode pattern detected, attempting sandbox evaluation...');

  try {
    const result = await sandbox.execute({
      code: `return (${code});`,
      timeoutMs,
    });

    if (result.ok && typeof result.output === 'string' && result.output.length > 0) {
      logger.info(`AAEncode decoded successfully (${result.output.length} chars)`);
      return {
        code: result.output,
        success: true,
        confidence: 0.85,
        warnings,
      };
    }

    warnings.push('AAEncode sandbox evaluation returned no output');
    return { code, success: false, confidence: 0.2, warnings };
  } catch (error) {
    warnings.push(
      `AAEncode evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { code, success: false, confidence: 0.1, warnings };
  }
}

export function decodeHexEscapeSequences(code: string): EncodeDecodeResult {
  const warnings: string[] = [];

  if (!detectHexEscape(code)) {
    return { code, success: false, confidence: 0, warnings };
  }

  try {
    const decoded = code.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
    if (decoded !== code) {
      logger.info(`Hex escape sequences decoded successfully`);
      return { code: decoded, success: true, confidence: 0.85, warnings };
    }
  } catch (error) {
    warnings.push(
      `Hex escape decoding failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { code, success: false, confidence: 0.1, warnings };
}

export function decodeUnicodeEscapeSequences(code: string): EncodeDecodeResult {
  const warnings: string[] = [];

  if (!detectUnicodeEscape(code)) {
    return { code, success: false, confidence: 0, warnings };
  }

  try {
    const decoded = code.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
    if (decoded !== code) {
      logger.info(`Unicode escape sequences decoded successfully`);
      return { code: decoded, success: true, confidence: 0.85, warnings };
    }
  } catch (error) {
    warnings.push(
      `Unicode escape decoding failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { code, success: false, confidence: 0.1, warnings };
}

export function decodeOctalEscapeSequences(code: string): EncodeDecodeResult {
  const warnings: string[] = [];

  if (!detectOctalEscape(code)) {
    return { code, success: false, confidence: 0, warnings };
  }

  try {
    const decoded = code.replace(/\\[0-7]{1,3}/g, (_, octal) => {
      const codePoint = parseInt(octal.slice(1), 8);
      if (codePoint > 0 && codePoint <= 255) {
        return String.fromCharCode(codePoint);
      }
      return _;
    });
    if (decoded !== code) {
      logger.info(`Octal escape sequences decoded successfully`);
      return { code: decoded, success: true, confidence: 0.8, warnings };
    }
  } catch (error) {
    warnings.push(
      `Octal escape decoding failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { code, success: false, confidence: 0.1, warnings };
}

export function decodeHTMLEntityObfuscation(code: string): EncodeDecodeResult {
  const warnings: string[] = [];

  if (!detectHTMLEntityObfuscation(code)) {
    return { code, success: false, confidence: 0, warnings };
  }

  try {
    const entityMap: Record<string, string> = {
      '&lt;': '<',
      '&gt;': '>',
      '&amp;': '&',
      '&quot;': '"',
      '&#x27;': "'",
      '&#x60;': '`',
      '&nbsp;': ' ',
    };

    let decoded = code;
    for (const [entity, char] of Object.entries(entityMap)) {
      decoded = decoded.replace(new RegExp(entity, 'gi'), char);
    }

    decoded = decoded.replace(/&#(\d+);/g, (_, dec) => {
      const codePoint = parseInt(dec, 10);
      if (codePoint > 0 && codePoint <= 65535) {
        return String.fromCharCode(codePoint);
      }
      return _;
    });

    decoded = decoded.replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) => {
      const codePoint = parseInt(hex, 16);
      if (codePoint > 0 && codePoint <= 65535) {
        return String.fromCharCode(codePoint);
      }
      return _;
    });

    if (decoded !== code) {
      logger.info(`HTML entity obfuscation decoded successfully`);
      return { code: decoded, success: true, confidence: 0.75, warnings };
    }
  } catch (error) {
    warnings.push(
      `HTML entity decoding failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { code, success: false, confidence: 0.1, warnings };
}

export async function decodeNumericObfuscation(
  code: string,
  sandbox: ExecutionSandbox,
  timeoutMs = 5000,
): Promise<EncodeDecodeResult> {
  const warnings: string[] = [];

  if (!detectNumericObfuscation(code)) {
    return { code, success: false, confidence: 0, warnings };
  }

  if (code.length > 100000) {
    warnings.push('Numeric obfuscation code too large for sandbox execution (>100KB)');
    return { code, success: false, confidence: 0.1, warnings };
  }

  logger.info('Numeric obfuscation pattern detected, attempting sandbox evaluation...');

  try {
    const result = await sandbox.execute({
      code: `return (${code});`,
      timeoutMs,
    });

    if (result.ok && typeof result.output === 'string' && result.output.length > 0) {
      logger.info(`Numeric obfuscation decoded successfully (${result.output.length} chars)`);
      return {
        code: result.output,
        success: true,
        confidence: 0.8,
        warnings,
      };
    }

    warnings.push('Numeric obfuscation sandbox evaluation returned no output');
    return { code, success: false, confidence: 0.2, warnings };
  } catch (error) {
    warnings.push(
      `Numeric obfuscation evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { code, success: false, confidence: 0.1, warnings };
  }
}

export async function autoDecodeExotic(
  code: string,
  sandbox: ExecutionSandbox,
  timeoutMs = 5000,
): Promise<EncodeDecodeResult> {
  const results: EncodeDecodeResult[] = [];

  const asyncDecoders: Array<() => Promise<EncodeDecodeResult | null> | null> = [
    () => (detectJSFuck(code) ? decodeJSFuck(code, sandbox, timeoutMs) : null),
    () => (detectJJEncode(code) ? decodeJJEncode(code, sandbox, timeoutMs) : null),
    () => (detectAAEncode(code) ? decodeAAEncode(code, sandbox, timeoutMs) : null),
    () =>
      detectNumericObfuscation(code) ? decodeNumericObfuscation(code, sandbox, timeoutMs) : null,
  ];

  const safeDecode = async (
    decoder: () => Promise<EncodeDecodeResult | null> | null,
  ): Promise<EncodeDecodeResult | null> => {
    try {
      if (!decoder) return null;
      return (await decoder()) ?? null;
    } catch (error) {
      logger.debug(
        `autoDecodeExotic: decoder threw error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  };

  const decoderResults = await Promise.all(asyncDecoders.map((d) => safeDecode(d)));
  for (const result of decoderResults) {
    if (result) {
      results.push(result);
    }
  }

  const syncDecoders: Array<() => EncodeDecodeResult> = [
    () => decodeHexEscapeSequences(code),
    () => decodeUnicodeEscapeSequences(code),
    () => decodeOctalEscapeSequences(code),
    () => decodeHTMLEntityObfuscation(code),
  ];

  for (const decoder of syncDecoders) {
    try {
      const result = decoder();
      if (result.success) {
        results.push(result);
      }
    } catch (error) {
      logger.debug(
        `autoDecodeExotic: sync decoder threw error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (results.length === 0) {
    return { code, success: false, confidence: 0, warnings: [] };
  }

  const best = results.reduce((a, b) => (a.confidence > b.confidence ? a : b));
  return best;
}
