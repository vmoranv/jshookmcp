import { logger } from '@utils/logger';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';

type VMStructure = {
  hasInterpreter: boolean;
  instructionTypes: string[];
  hasStack: boolean;
  hasRegisters: boolean;
};

type VMComponents = {
  instructionArray?: string;
  dataArray?: string;
  interpreterFunction?: string;
};

export class VMDeobfuscator {
  constructor(legacyDependency?: unknown) {
    void legacyDependency;
  }

  public detectVMProtection(code: string): {
    detected: boolean;
    type: string;
    instructionCount: number;
  } {
    const vmPatterns = [
      /while\s*\(\s*true\s*\)\s*\{[\s\S]*?switch\s*\(/i,
      /var\s+\w+\s*=\s*\[\s*\d+(?:\s*,\s*\d+){10,}\s*\]/i,
      /\w+\[pc\+\+\]/i,
      /stack\.push|stack\.pop/i,
    ];

    const matchCount = vmPatterns.filter((pattern) => pattern.test(code)).length;

    if (matchCount >= 2) {
      return {
        detected: true,
        type: matchCount >= 3 ? 'custom-vm' : 'simple-vm',
        instructionCount: this.countVMInstructions(code),
      };
    }

    return { detected: false, type: 'none', instructionCount: 0 };
  }

  public countVMInstructions(code: string): number {
    const match = code.match(/case\s+\d+:/g);
    return match ? match.length : 0;
  }

  public async deobfuscateVM(
    code: string,
    _vmInfo: { type: string; instructionCount: number },
  ): Promise<{ success: boolean; code: string }> {
    logger.warn('VM deobfuscation is experimental and may fail');

    try {
      const vmStructure = this.analyzeVMStructure(code);

      if (vmStructure.hasInterpreter) {
        logger.info(
          `Detected VM interpreter with ${vmStructure.instructionTypes.length} instruction types`,
        );
      }

      const vmComponents = this.extractVMComponents(code);

      const simplifiedCode = this.simplifyVMCode(code, vmComponents);

      return {
        success: simplifiedCode !== code,
        code: simplifiedCode,
      };
    } catch (error) {
      logger.error('VM deobfuscation failed', error);
      return { success: false, code };
    }
  }

  public analyzeVMStructure(code: string): VMStructure {
    const structure: VMStructure = {
      hasInterpreter: false,
      instructionTypes: [],
      hasStack: false,
      hasRegisters: false,
    };

    if (/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/.test(code)) {
      structure.hasInterpreter = true;
    }

    const switchMatches = code.match(/case\s+0x[0-9a-f]+:/gi);
    if (switchMatches && switchMatches.length > 10) {
      structure.hasInterpreter = true;
      structure.instructionTypes = switchMatches.map((m) =>
        m.replace(/case\s+/i, '').replace(/:/, ''),
      );
    }

    if (/\.push\(|\.pop\(/.test(code)) {
      structure.hasStack = true;
    }

    if (/r\d+\s*=|reg\[\d+\]/.test(code)) {
      structure.hasRegisters = true;
    }

    return structure;
  }

  public extractVMComponents(code: string): VMComponents {
    const components: VMComponents = {};

    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      traverse(ast, {
        VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
          if (t.isArrayExpression(path.node.init)) {
            const arrayLength = path.node.init.elements.length;

            if (arrayLength > 50) {
              const arrayName = t.isIdentifier(path.node.id) ? path.node.id.name : 'unknown';

              const firstElement = path.node.init.elements[0];
              if (t.isNumericLiteral(firstElement)) {
                components.instructionArray = arrayName;
              } else if (t.isStringLiteral(firstElement)) {
                components.dataArray = arrayName;
              }
            }
          }
        },

        FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
          let hasBigSwitch = false;

          traverse(
            path.node,
            {
              SwitchStatement(switchPath: NodePath<t.SwitchStatement>) {
                if (switchPath.node.cases.length > 10) {
                  hasBigSwitch = true;
                }
              },
            },
            path.scope,
            path,
          );

          if (hasBigSwitch && t.isIdentifier(path.node.id)) {
            components.interpreterFunction = path.node.id.name;
          }
        },
      });
    } catch (error) {
      logger.debug('Failed to extract VM components:', error);
    }

    return components;
  }

  public simplifyVMCode(code: string, vmComponents: VMComponents): string {
    try {
      let simplified = code;

      if (vmComponents.interpreterFunction) {
        const regex = new RegExp(
          `function\\s+${vmComponents.interpreterFunction}\\s*\\([^)]*\\)\\s*\\{[^}]*\\}`,
          'g',
        );
        simplified = simplified.replace(regex, '/* vm interpreter removed */');
      }

      if (vmComponents.instructionArray) {
        const regex = new RegExp(
          `var\\s+${vmComponents.instructionArray}\\s*=\\s*\\[[^\\]]*\\];`,
          'g',
        );
        simplified = simplified.replace(regex, '/* vm instruction array removed */');
      }

      return simplified;
    } catch (error) {
      logger.debug('Failed to simplify VM code:', error);
      return code;
    }
  }
}
