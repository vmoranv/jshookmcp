import { logger } from '@utils/logger';
import { VMDeobfuscator } from '@modules/deobfuscator/VMDeobfuscator';
import { JScramberDeobfuscator } from '@modules/deobfuscator/JScramblerDeobfuscator';

export interface VMIntegrationResult {
  detected: boolean;
  type: 'none' | 'simple-vm' | 'custom-vm';
  instructionCount: number;
  deobfuscated: boolean;
  warnings: string[];
}

export interface JScramblerIntegrationResult {
  detected: boolean;
  success: boolean;
  transformations: string[];
  warnings: string[];
  confidence: number;
}

export interface VMIntegrationOptions {
  enabled?: boolean;
}

export interface JScramblerIntegrationOptions {
  enabled?: boolean;
  removeDeadCode?: boolean;
  restoreControlFlow?: boolean;
  decryptStrings?: boolean;
  simplifyExpressions?: boolean;
}

export class VMIntegration {
  private readonly vm = new VMDeobfuscator();

  public detectVM(code: string): VMIntegrationResult {
    const result = this.vm.detectVMProtection(code);

    if (!result.detected) {
      return {
        detected: false,
        type: 'none',
        instructionCount: 0,
        deobfuscated: false,
        warnings: [],
      };
    }

    const warnings = [
      `VM protection detected: ${result.type} (${result.instructionCount} instructions)`,
      'VM deobfuscation is experimental — results may vary',
    ];

    return {
      detected: true,
      type: result.type as 'simple-vm' | 'custom-vm',
      instructionCount: result.instructionCount,
      deobfuscated: false,
      warnings,
    };
  }

  public async deobfuscateVM(code: string, options?: VMIntegrationOptions): Promise<VMIntegrationResult> {
    const detection = this.detectVM(code);

    if (!detection.detected) {
      return detection;
    }

    if (options?.enabled === false) {
      return detection;
    }

    try {
      logger.info(`Attempting VM deobfuscation: ${detection.type}`);

      const result = await this.vm.deobfuscateVM(code, {
        type: detection.type,
        instructionCount: detection.instructionCount,
      });

      return {
        detected: true,
        type: detection.type,
        instructionCount: detection.instructionCount,
        deobfuscated: result.success,
        warnings: result.success
          ? []
          : ['VM deobfuscation completed but code was not simplified'],
      };
    } catch (error) {
      logger.warn('VM deobfuscation failed', error);
      return {
        ...detection,
        deobfuscated: false,
        warnings: [
          ...detection.warnings,
          `VM deobfuscation error: ${error instanceof Error ? error.message : String(error)}`,
        ],
      };
    }
  }
}

export class JScramblerIntegration {
  private readonly jscrambler = new JScramberDeobfuscator();

  public detectJScrambler(code: string): boolean {
    const patterns = [
      /jscrambler/i,
      /\$⁠|‌|‍|‎|‏/,
      /_0x[a-f0-9]{4,}/i,
      /\$_jsxc|_jsxc_/,
    ];

    return patterns.some((p) => p.test(code));
  }

  public async deobfuscateJScrambler(
    code: string,
    options?: JScramblerIntegrationOptions,
  ): Promise<JScramblerIntegrationResult> {
    if (!this.detectJScrambler(code)) {
      return {
        detected: false,
        success: false,
        transformations: [],
        warnings: [],
        confidence: 0,
      };
    }

    if (options?.enabled === false) {
      return {
        detected: true,
        success: false,
        transformations: [],
        warnings: ['JScrambler detected but deobfuscation disabled'],
        confidence: 0.5,
      };
    }

    try {
      logger.info('JScrambler pattern detected, attempting deobfuscation...');

      const result = await this.jscrambler.deobfuscate({
        code,
        removeDeadCode: options?.removeDeadCode ?? true,
        restoreControlFlow: options?.restoreControlFlow ?? true,
        decryptStrings: options?.decryptStrings ?? true,
        simplifyExpressions: options?.simplifyExpressions ?? true,
      });

      return {
        detected: true,
        success: result.success,
        transformations: result.transformations,
        warnings: result.warnings,
        confidence: result.confidence,
      };
    } catch (error) {
      logger.warn('JScrambler deobfuscation failed', error);
      return {
        detected: true,
        success: false,
        transformations: [],
        warnings: [`JScrambler error: ${error instanceof Error ? error.message : String(error)}`],
        confidence: 0.1,
      };
    }
  }
}
