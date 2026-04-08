import { BytecodeExtractor } from '@modules/v8-inspector/BytecodeExtractor';
import { VersionDetector } from '@modules/v8-inspector/VersionDetector';

interface CDPSessionLike {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  detach(): Promise<void>;
}

interface CDPPageLike {
  createCDPSession(): Promise<CDPSessionLike>;
}

interface RuntimeEvaluateResponse {
  result?: unknown;
}

export interface JITInfo {
  functionName: string;
  optimized: boolean;
  tier: string;
  address?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCDPPageLike(value: unknown): value is CDPPageLike {
  return isRecord(value) && typeof value['createCDPSession'] === 'function';
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (isRecord(value) && typeof value['value'] === 'number') {
    const nested = value['value'];
    return typeof nested === 'number' && Number.isFinite(nested) ? nested : null;
  }
  return null;
}

function mapOptimizationTier(status: number | null): { optimized: boolean; tier: string } {
  if (status === null) {
    return { optimized: false, tier: 'unknown' };
  }
  if ((status & 128) !== 0) {
    return { optimized: true, tier: 'maglev' };
  }
  if ((status & 64) !== 0) {
    return { optimized: true, tier: 'turbofan' };
  }
  if ((status & 16) !== 0 || (status & 32) !== 0) {
    return { optimized: true, tier: 'optimized' };
  }
  return { optimized: false, tier: 'interpreted' };
}

export class JITInspector {
  private readonly bytecodeExtractor: BytecodeExtractor;
  private readonly versionDetector: VersionDetector;
  private optimizedFunctionsCache: JITInfo[] = [];

  constructor(private readonly getPage?: () => Promise<unknown>) {
    this.bytecodeExtractor = new BytecodeExtractor(getPage);
    this.versionDetector = new VersionDetector(getPage);
  }

  async inspectJIT(scriptId: string): Promise<JITInfo[]> {
    const hiddenClasses = await this.bytecodeExtractor.findHiddenClasses(scriptId);
    const extraction = await this.bytecodeExtractor.extractBytecode(scriptId);
    const functionNames = new Set<string>();

    if (extraction) {
      functionNames.add(extraction.functionName);
    }

    for (const hiddenClass of hiddenClasses) {
      const candidate = hiddenClass.properties[0];
      if (candidate) {
        functionNames.add(candidate);
      }
    }

    if (functionNames.size === 0) {
      functionNames.add('anonymous');
    }

    const supportsNativesSyntax = await this.versionDetector.supportsNativesSyntax();
    const results: JITInfo[] = [];

    for (const functionName of functionNames) {
      const status = supportsNativesSyntax ? await this.getOptimizationStatus(functionName) : null;
      const { optimized, tier } = mapOptimizationTier(status);

      results.push({
        functionName,
        optimized,
        tier,
      });
    }

    this.optimizedFunctionsCache = results;
    return results;
  }

  async forceDeoptimization(functionRef: string): Promise<void> {
    const supportsNativesSyntax = await this.versionDetector.supportsNativesSyntax();
    if (!supportsNativesSyntax) {
      return;
    }

    const session = await this.createSession();
    if (!session) {
      return;
    }

    try {
      await session.send('Runtime.evaluate', {
        expression: `
          (() => {
            try {
              const candidate = eval(${JSON.stringify(functionRef)});
              if (typeof candidate === 'function') {
                %DeoptimizeFunction(candidate);
              }
            } catch (error) {
              return undefined;
            }
            return undefined;
          })()
        `,
        returnByValue: true,
        awaitPromise: false,
      });
    } finally {
      await session.detach().catch(() => undefined);
    }
  }

  async getOptimizedFunctions(): Promise<JITInfo[]> {
    return [...this.optimizedFunctionsCache];
  }

  private async getOptimizationStatus(functionName: string): Promise<number | null> {
    const session = await this.createSession();
    if (!session) {
      return null;
    }

    try {
      const response = await session.send<RuntimeEvaluateResponse>('Runtime.evaluate', {
        expression: `
          (() => {
            try {
              const candidate = globalThis[${JSON.stringify(functionName)}];
              if (typeof candidate !== 'function') {
                return null;
              }
              return %GetOptimizationStatus(candidate);
            } catch (error) {
              return null;
            }
          })()
        `,
        returnByValue: true,
        awaitPromise: false,
      });

      if (!isRecord(response)) {
        return null;
      }

      return readNumber(response['result']);
    } catch {
      return null;
    } finally {
      await session.detach().catch(() => undefined);
    }
  }

  private async createSession(): Promise<CDPSessionLike | null> {
    if (!this.getPage) {
      return null;
    }

    try {
      const page = await this.getPage();
      if (!isCDPPageLike(page)) {
        return null;
      }
      return await page.createCDPSession();
    } catch {
      return null;
    }
  }
}
