import { logger } from '@utils/logger';
import { PACKER_SANDBOX_TIMEOUT_MS } from '@src/constants';
import { ExecutionSandbox } from '@modules/security/ExecutionSandbox';

export interface PackerDeobfuscatorOptions {
  code: string;
  maxIterations?: number;
}

export interface PackerDeobfuscatorResult {
  code: string;
  success: boolean;
  iterations: number;
  warnings: string[];
}

export class PackerDeobfuscator {
  private readonly sandbox: ExecutionSandbox;

  constructor(sandbox?: ExecutionSandbox) {
    this.sandbox = sandbox ?? new ExecutionSandbox();
  }

  static detect(code: string): boolean {
    const packerPattern =
      /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/;
    return packerPattern.test(code);
  }

  async deobfuscate(options: PackerDeobfuscatorOptions): Promise<PackerDeobfuscatorResult> {
    const { code, maxIterations = 5 } = options;

    logger.info(' Packer...');

    const warnings: string[] = [];
    let currentCode = code;
    let iterations = 0;

    try {
      while (PackerDeobfuscator.detect(currentCode) && iterations < maxIterations) {
        const unpacked = await this.unpack(currentCode);

        if (!unpacked || unpacked === currentCode) {
          warnings.push('');
          break;
        }

        currentCode = unpacked;
        iterations++;
        logger.info(`  ${iterations} `);
      }

      logger.info(`Packer deobfuscation complete in ${iterations} iterations`);

      return {
        code: currentCode,
        success: true,
        iterations,
        warnings,
      };
    } catch (error) {
      logger.error('Packer', error);
      return {
        code: currentCode,
        success: false,
        iterations,
        warnings: [...warnings, String(error)],
      };
    }
  }

  private async unpack(code: string): Promise<string> {
    const match = code.match(
      /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*{([\s\S]*?)}\s*\((.*?)\)\s*\)/,
    );

    if (!match?.[2]) {
      return code;
    }

    const args = match[2];

    const params = await this.parsePackerParams(args);
    if (!params) {
      return code;
    }

    try {
      const unpacked = this.executeUnpacker(params);
      return unpacked || code;
    } catch (error) {
      logger.warn('', error);
      return code;
    }
  }

  private async parsePackerParams(argsString: string): Promise<{
    p: string;
    a: number;
    c: number;
    k: string[];
    e: Function;
    d: Function;
  } | null> {
    try {
      const sandboxResult = await this.sandbox.execute({
        code: `return [${argsString}];`,
        timeoutMs: PACKER_SANDBOX_TIMEOUT_MS,
      });
      if (!sandboxResult.ok) return null;
      const params = sandboxResult.output as unknown[];

      if (!Array.isArray(params) || params.length < 4) {
        return null;
      }

      return {
        p: (params[0] as string) || '',
        a: (params[1] as number) || 0,
        c: (params[2] as number) || 0,
        k: (typeof params[3] === 'string' ? params[3] : '').split('|'),
        e:
          (params[4] as Function) ||
          function (c: unknown) {
            return c;
          },
        d:
          (params[5] as Function) ||
          function () {
            return '';
          },
      };
    } catch {
      return null;
    }
  }

  private executeUnpacker(params: {
    p: string;
    a: number;
    c: number;
    k: string[];
    e: Function;
    d: Function;
  }): string {
    const { p, a, k } = params;
    let { c } = params;

    if (c <= 0 || k.length === 0) {
      return p;
    }

    let result = p;

    while (--c >= 0) {
      const replacement = k[c];
      if (replacement) {
        const pattern = new RegExp('\\b' + this.base(c, a) + '\\b', 'g');
        result = result.replace(pattern, replacement);
      }
    }

    return result;
  }

  private base(num: number, radix: number): string {
    const digits = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

    if (num === 0) {
      return '0';
    }

    let result = '';
    while (num > 0) {
      result = digits[num % radix] + result;
      num = Math.floor(num / radix);
    }

    return result || '0';
  }
}

export class Base64Decoder {
  static detect(code: string): boolean {
    return (
      /(?:atob|btoa)\s*\(|eval\s*\(\s*atob\s*\(/.test(code) ||
      /["'`][A-Za-z0-9+/]{40,}={0,2}["'`]/.test(code)
    );
  }

  static decodeInlineAtob(code: string): string {
    return code.replace(/atob\s*\(\s*["'`]([A-Za-z0-9+/\s]+={0,2})["'`]\s*\)/g, (_match, b64) => {
      try {
        return JSON.stringify(Buffer.from(b64.replace(/\s/g, ''), 'base64').toString('utf8'));
      } catch {
        return _match;
      }
    });
  }

  async deobfuscate(code: string): Promise<string> {
    logger.info('Base64: decoding inline atob() calls...');
    try {
      const decoded = Base64Decoder.decodeInlineAtob(code);
      logger.info('Base64 decode complete');
      return decoded;
    } catch (error) {
      logger.error('Base64 decode failed', error);
      return code;
    }
  }
}

export class HexStringDecoder {
  static detect(code: string): boolean {
    const hexEscapeCount = (code.match(/\\x[0-9a-fA-F]{1,2}/g) ?? []).length;
    return hexEscapeCount >= 6;
  }

  static decode(code: string): string {
    return code
      .replace(/\\x([0-9a-fA-F]{1,2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\u([0-9a-fA-F]{1,4})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  async deobfuscate(code: string): Promise<string> {
    logger.info('HexString: decoding escape sequences...');
    try {
      const decoded = HexStringDecoder.decode(code);
      logger.info('HexString decode complete');
      return decoded;
    } catch (error) {
      logger.error('HexString decode failed', error);
      return code;
    }
  }
}

export class AAEncodeDeobfuscator {
  private readonly sandbox: ExecutionSandbox;

  constructor(sandbox?: ExecutionSandbox) {
    this.sandbox = sandbox ?? new ExecutionSandbox();
  }

  static detect(code: string): boolean {
    return code.includes('゜-゜') || code.includes('ω゜') || code.includes('o゜)');
  }

  async deobfuscate(code: string): Promise<string> {
    logger.info(' AAEncode...');

    try {
      const sandboxResult = await this.sandbox.execute({
        code: `return (${code})`,
        timeoutMs: 5000,
      });
      const decoded = sandboxResult.ok ? sandboxResult.output : undefined;

      if (typeof decoded === 'string') {
        logger.info(' AAEncode');
        return decoded;
      }
      return code;
    } catch (error) {
      logger.error('AAEncode', error);
      return code;
    }
  }
}

export class URLEncodeDeobfuscator {
  static detect(code: string): boolean {
    const percentCount = (code.match(/%[0-9A-Fa-f]{2}/g) || []).length;
    return percentCount > 10;
  }

  async deobfuscate(code: string): Promise<string> {
    logger.info(' URLEncode...');

    try {
      const decoded = decodeURIComponent(code);
      logger.info(' URLEncode');
      return decoded;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('URIError') || message.includes(' malformed URI')) {
        logger.warn(`URLEncode: skipped — code contains malformed percent-encoding (${message})`);
      } else {
        logger.error('URLEncode', error);
      }
      return code;
    }
  }
}

export class UniversalUnpacker {
  private readonly sandbox = new ExecutionSandbox();
  private readonly packerDeobfuscator: PackerDeobfuscator;
  private readonly aaencodeDeobfuscator: AAEncodeDeobfuscator;
  private readonly urlencodeDeobfuscator = new URLEncodeDeobfuscator();
  private readonly base64Decoder = new Base64Decoder();
  private readonly hexStringDecoder = new HexStringDecoder();

  constructor() {
    this.packerDeobfuscator = new PackerDeobfuscator(this.sandbox);
    this.aaencodeDeobfuscator = new AAEncodeDeobfuscator(this.sandbox);
  }

  async deobfuscate(code: string): Promise<{
    code: string;
    type: string;
    success: boolean;
  }> {
    logger.info('UniversalUnpacker: detecting encoding...');

    let currentCode = code;
    let detectedType = 'Unknown';
    let success = false;

    if (PackerDeobfuscator.detect(currentCode)) {
      logger.info('UniversalUnpacker: detected Packer');
      const result = await this.packerDeobfuscator.deobfuscate({ code: currentCode });
      if (result.success) {
        currentCode = result.code;
        detectedType = 'Packer';
        success = true;
      }
    }

    if (AAEncodeDeobfuscator.detect(currentCode)) {
      logger.info('UniversalUnpacker: detected AAEncode');
      const decoded = await this.aaencodeDeobfuscator.deobfuscate(currentCode);
      if (decoded !== currentCode) {
        currentCode = decoded;
        detectedType = detectedType === 'Unknown' ? 'AAEncode' : `${detectedType}+AAEncode`;
        success = true;
      }
    }

    if (URLEncodeDeobfuscator.detect(currentCode)) {
      logger.info('UniversalUnpacker: detected URLEncode');
      const decoded = await this.urlencodeDeobfuscator.deobfuscate(currentCode);
      if (decoded !== currentCode) {
        currentCode = decoded;
        detectedType = detectedType === 'Unknown' ? 'URLEncode' : `${detectedType}+URLEncode`;
        success = true;
      }
    }

    if (HexStringDecoder.detect(currentCode)) {
      logger.info('UniversalUnpacker: detected hex escape sequences');
      const decoded = await this.hexStringDecoder.deobfuscate(currentCode);
      if (decoded !== currentCode) {
        currentCode = decoded;
        detectedType = detectedType === 'Unknown' ? 'HexString' : `${detectedType}+HexString`;
        success = true;
      }
    }

    if (Base64Decoder.detect(currentCode)) {
      logger.info('UniversalUnpacker: detected inline base64 (atob)');
      const decoded = await this.base64Decoder.deobfuscate(currentCode);
      if (decoded !== currentCode) {
        currentCode = decoded;
        detectedType = detectedType === 'Unknown' ? 'Base64' : `${detectedType}+Base64`;
        success = true;
      }
    }

    if (!success) {
      logger.info('UniversalUnpacker: no recognized encoding detected');
    }

    return { code: currentCode, type: detectedType, success };
  }
}
