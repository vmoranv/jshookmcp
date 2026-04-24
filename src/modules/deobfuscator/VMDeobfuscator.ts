import { logger } from '@utils/logger';
import * as parser from '@babel/parser';
import generate from '@babel/generator';
import traverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';

type VMStructure = {
  hasInterpreter: boolean;
  instructionTypes: string[];
  hasStack: boolean;
  hasRegisters: boolean;
  hasDispatcher: boolean;
  hasStateVariable: boolean;
};

type VMComponents = {
  instructionArray?: string;
  dataArray?: string;
  interpreterFunction?: string;
  stateVariable?: string;
  dispatcherVariable?: string;
};

type VMInstruction = {
  opCode: string;
  handler: string;
  operands: string[];
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
      /dispatcher|interpreter/i,
      /\bpc\s*\+\+|pc\s*=\s*\w+/i,
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
      const instructions = this.extractVMInstructions(code);
      const simplifiedCode = this.simplifyVMCode(code, vmComponents, instructions);

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
      hasDispatcher: false,
      hasStateVariable: false,
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

    if (/\.push\(|\.pop\(/.test(code) || /var\s+\w+\s*=\s*\[\s*\]\s*;?/.test(code)) {
      structure.hasStack = true;
    }

    if (/r\d+\s*=|(?:reg|state)\[\d+\]/i.test(code)) {
      structure.hasRegisters = true;
    }

    if (/dispatcher|case\s+\w+\s*:/i.test(code)) {
      structure.hasDispatcher = true;
    }

    if (/\b(pc|ip|sp|fp)\s*[=+]/.test(code)) {
      structure.hasStateVariable = true;
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

          if (t.isIdentifier(path.node.id)) {
            const name = path.node.id.name;
            if (/^(pc|ip|sp|fp|state|ctx)$/i.test(name)) {
              components.stateVariable = name;
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

        AssignmentExpression(assignPath: NodePath<t.AssignmentExpression>) {
          const left = assignPath.node.left;
          const right = assignPath.node.right;

          if (t.isIdentifier(left) && /^(dispatcher|dispatch)$/i.test(left.name)) {
            components.dispatcherVariable = left.name;
          }

          if (
            t.isMemberExpression(right) &&
            t.isIdentifier(right.object) &&
            right.object.name === 'dispatcher'
          ) {
            components.dispatcherVariable = t.isIdentifier(left)
              ? left.name
              : components.dispatcherVariable;
          }
        },
      });
    } catch (error) {
      logger.debug('Failed to extract VM components:', error);
    }

    return components;
  }

  public extractVMInstructions(code: string): VMInstruction[] {
    const instructions: VMInstruction[] = [];

    // Try Babel AST extraction first
    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      traverse(ast, {
        SwitchStatement(switchPath: NodePath<t.SwitchStatement>) {
          if (switchPath.node.cases.length >= 2) {
            for (const switchCase of switchPath.node.cases) {
              let opCode = '';
              let handler = '';
              const operands: string[] = [];

              if (t.isNumericLiteral(switchCase.test)) {
                opCode = String(switchCase.test.value);
              } else if (t.isIdentifier(switchCase.test)) {
                opCode = switchCase.test.name;
              } else if (t.isStringLiteral(switchCase.test)) {
                opCode = switchCase.test.value;
              }

              for (const consequent of switchCase.consequent) {
                const stmtCode = generate(consequent).code;

                if (!handler) {
                  if (/push\s*\(|pop\s*\(/.test(stmtCode)) {
                    handler = 'stack';
                  } else if (/charCodeAt|String\.fromCharCode/.test(stmtCode)) {
                    handler = 'string';
                  } else if (/\[.*\]\s*=/.test(stmtCode)) {
                    handler = 'memory';
                  } else if (/console\.log|return/.test(stmtCode)) {
                    handler = 'io';
                  }
                }

                const varMatches = stmtCode.match(/\b(var|let|const)\s+(\w+)/g);
                if (varMatches) {
                  for (const match of varMatches) {
                    const varName = match.replace(/^(var|let|const)\s+/, '');
                    if (!operands.includes(varName)) {
                      operands.push(varName);
                    }
                  }
                }
              }

              if (opCode) {
                instructions.push({ opCode, handler, operands });
              }
            }
          }
        },
      });
    } catch (error) {
      logger.debug('Failed to extract VM instructions via AST, falling back to regex:', error);
    }

    // Fallback: regex-based extraction if AST failed or returned empty
    if (instructions.length === 0) {
      const casePattern = /case\s+(\S+?)\s*:\s*([^}]+?)(?=\bcase\b|$)/g;
      let match;

      while ((match = casePattern.exec(code)) !== null) {
        const opCode = (match[1] ?? '').replace(/['"`]/g, '');
        const body = match[2] ?? '';
        let handler = '';

        if (!handler) {
          if (/push\s*\(|pop\s*\(/.test(body)) {
            handler = 'stack';
          } else if (/charCodeAt|String\.fromCharCode/.test(body)) {
            handler = 'string';
          } else if (/\[.*\]\s*=/.test(body)) {
            handler = 'memory';
          } else if (/console\.log|return/.test(body)) {
            handler = 'io';
          }
        }

        const operands: string[] = [];
        const varMatches = body.match(/\b(var|let|const)\s+(\w+)/g);
        if (varMatches) {
          for (const v of varMatches) {
            const varName = v.replace(/^(var|let|const)\s+/, '');
            if (!operands.includes(varName)) {
              operands.push(varName);
            }
          }
        }

        if (opCode) {
          instructions.push({ opCode, handler, operands });
        }
      }
    }

    return instructions;
  }

  public simplifyVMCode(
    code: string,
    vmComponents: VMComponents,
    instructions: VMInstruction[] = [],
  ): string {
    try {
      let simplified = code;

      if (vmComponents.interpreterFunction) {
        const regex = new RegExp(
          `function\\s+${vmComponents.interpreterFunction}\\s*\\([^)]*\\)\\s*\\{[^}]*(?:\\{[^}]*\\}[^}]*)*\\}`,
          'g',
        );
        simplified = simplified.replace(regex, '/* vm interpreter removed */');
      }

      if (vmComponents.instructionArray) {
        const regex = new RegExp(
          `var\\s+${vmComponents.instructionArray}\\s*=\\s*\\[[^\\]]*\\];?`,
          'g',
        );
        simplified = simplified.replace(regex, '/* vm instruction array removed */');
      }

      if (vmComponents.dataArray) {
        const regex = new RegExp(`var\\s+${vmComponents.dataArray}\\s*=\\s*\\[[^\\]]*\\];?`, 'g');
        simplified = simplified.replace(regex, '/* vm data array removed */');
      }

      if (vmComponents.stateVariable) {
        const regex = new RegExp(`var\\s+${vmComponents.stateVariable}\\s*=\\s*[^;]+;`, 'g');
        simplified = simplified.replace(regex, `/* vm state removed */`);
      }

      if (instructions.length > 0) {
        simplified = this.simplifyOpaquePredicates(simplified);
      }

      simplified = this.removeVMGuards(simplified);

      return simplified;
    } catch (error) {
      logger.debug('Failed to simplify VM code:', error);
      return code;
    }
  }

  private simplifyOpaquePredicates(code: string): string {
    try {
      const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });

      traverse(ast, {
        IfStatement(ifPath: NodePath<t.IfStatement>) {
          const test = ifPath.node.test;

          if (
            t.isBinaryExpression(test) &&
            t.isNumericLiteral(test.left) &&
            t.isNumericLiteral(test.right)
          ) {
            const result =
              test.operator === '==='
                ? test.left.value === test.right.value
                : test.operator === '!=='
                  ? test.left.value !== test.right.value
                  : null;

            if (result === true) {
              ifPath.replaceWithMultiple(ifPath.node.consequent);
            } else if (result === false && ifPath.node.alternate) {
              ifPath.replaceWithMultiple(ifPath.node.alternate);
            } else if (result === false) {
              ifPath.remove();
            }
          }
        },
      });

      return generate(ast, { comments: false, compact: false }).code;
    } catch {
      return code;
    }
  }

  private removeVMGuards(code: string): string {
    let simplified = code;

    simplified = simplified.replace(
      /if\s*\(\s*['"`]\w+['"`]\s*===\s*['"`]\w+['"`]\s*\)\s*\{[\s\S]*?debugger[\s\S]*?\}\s*/gi,
      '',
    );

    simplified = simplified.replace(/try\s*\{[\s\S]*?\}\s*catch\s*\(\s*\w+\s*\)\s*\{\s*\}/g, '');

    return simplified;
  }
}
