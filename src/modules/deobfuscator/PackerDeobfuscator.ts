import { logger } from '../../utils/logger.js';
import { ExecutionSandbox } from '../security/ExecutionSandbox.js';

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
  private readonly sandbox = new ExecutionSandbox();

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
      /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*{([\s\S]*?)}\s*\((.*?)\)\s*\)/
    );

    if (!match || !match[2]) {
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
      const sandboxResult = await this.sandbox.execute({ code: `return [${argsString}];`, timeoutMs: 3000 });
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

    let result = p;

    while (c--) {
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

  beautify(code: string): string {
    let result = code;

    result = result.replace(/;/g, ';\n');
    result = result.replace(/{/g, '{\n');
    result = result.replace(/}/g, '\n}\n');

    result = result.replace(/\n\n+/g, '\n\n');

    return result.trim();
  }
}

export class AAEncodeDeobfuscator {
  private readonly sandbox = new ExecutionSandbox();

  static detect(code: string): boolean {
    return code.includes('゜-゜') || code.includes('ω゜') || code.includes('o゜)');
  }

  async deobfuscate(code: string): Promise<string> {
    logger.info(' AAEncode...');

    try {
      const sandboxResult = await this.sandbox.execute({ code: `return (${code})`, timeoutMs: 5000 });
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
      logger.error('URLEncode', error);
      return code;
    }
  }
}

export class UniversalUnpacker {
  private packerDeobfuscator = new PackerDeobfuscator();
  private aaencodeDeobfuscator = new AAEncodeDeobfuscator();
  private urlencodeDeobfuscator = new URLEncodeDeobfuscator();

  async deobfuscate(code: string): Promise<{
    code: string;
    type: string;
    success: boolean;
  }> {
    logger.info(' ...');

    if (PackerDeobfuscator.detect(code)) {
      logger.info(': Packer');
      const result = await this.packerDeobfuscator.deobfuscate({ code });
      return {
        code: result.code,
        type: 'Packer',
        success: result.success,
      };
    }

    if (AAEncodeDeobfuscator.detect(code)) {
      logger.info(': AAEncode');
      const decoded = await this.aaencodeDeobfuscator.deobfuscate(code);
      return {
        code: decoded,
        type: 'AAEncode',
        success: decoded !== code,
      };
    }

    if (URLEncodeDeobfuscator.detect(code)) {
      logger.info(': URLEncode');
      const decoded = await this.urlencodeDeobfuscator.deobfuscate(code);
      return {
        code: decoded,
        type: 'URLEncode',
        success: decoded !== code,
      };
    }

    logger.info('');
    return {
      code,
      type: 'Unknown',
      success: false,
    };
  }
}
