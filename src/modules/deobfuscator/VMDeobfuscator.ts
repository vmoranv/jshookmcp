import { logger } from '@utils/logger';
import { escapeRegexStr } from '@utils/escapeForRegex';
import * as parser from '@babel/parser';
import { BABEL_PARSE_PLUGINS } from '@utils/babel-plugins';
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
        plugins: BABEL_PARSE_PLUGINS,
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
        simplified = this.removeInterpreterFunction(simplified, vmComponents.interpreterFunction);
      }

      if (vmComponents.instructionArray) {
        simplified = this.removeInstructionArray(simplified, vmComponents.instructionArray);
      }

      return simplified;
    } catch (error) {
      logger.debug('Failed to simplify VM code:', error);
      return code;
    }
  }

  /**
   * Replace `function NAME(...) { ... }` — the body is scanned to the matching
   * brace, so nested blocks (if/for/switch/try) are removed whole instead of
   * being cut at the first `}`. Returns the code unchanged when no match.
   */
  private removeInterpreterFunction(code: string, name: string): string {
    // Consume any `export`/`async` prefix so removal does not leave a dangling
    // `export` (or `async`) keyword behind.
    const match = new RegExp(
      `(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function\\s+${escapeRegexStr(name)}\\s*\\(`,
    ).exec(code);
    if (!match) {
      return code;
    }
    const openIdx = code.indexOf('{', match.index + match[0].length);
    if (openIdx === -1) {
      return code;
    }
    const endIdx = VMDeobfuscator.scanToMatching(code, openIdx, '{', '}');
    if (endIdx === -1) {
      return code;
    }
    return (
      code.slice(0, match.index) +
      '/* vm interpreter removed */' +
      trimTrailingSemicolon(code.slice(endIdx + 1))
    );
  }

  /**
   * Replace `(var|let|const) NAME = [...];` — scanned to the matching bracket,
   * so nested arrays are removed whole. Returns the code unchanged when no
   * match (mirrors the old regex fallback of leaving the code untouched).
   */
  private removeInstructionArray(code: string, name: string): string {
    // Consume a leading `export` so the declaration is removed whole rather
    // than leaving `export /* ... */`.
    const match = new RegExp(
      `(?:export\\s+(?:default\\s+)?)?(?:var|let|const)\\s+${escapeRegexStr(name)}\\s*=\\s*\\[`,
    ).exec(code);
    if (!match) {
      return code;
    }
    const endIdx = VMDeobfuscator.scanToMatching(code, match.index + match[0].length - 1, '[', ']');
    if (endIdx === -1) {
      return code;
    }
    return (
      code.slice(0, match.index) +
      '/* vm instruction array removed */' +
      trimTrailingSemicolon(code.slice(endIdx + 1))
    );
  }

  /**
   * Scan forward from an opening delimiter to its matching close, skipping
   * string literals (single/double quote and backtick, with backslash escapes).
   * Returns -1 when the construct is unterminated.
   */
  private static scanToMatching(
    text: string,
    openIdx: number,
    open: string,
    close: string,
  ): number {
    let depth = 0;
    let quote: string | null = null;
    for (let i = openIdx; i < text.length; i++) {
      const ch = text[i];
      if (quote !== null) {
        if (ch === '\\') {
          i++;
        } else if (ch === quote) {
          quote = null;
        }
      } else if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (ch === '/' && text[i + 1] === '/') {
        // Skip line comments so braces in comments do not affect depth.
        while (i < text.length && text[i] !== '\n') i++;
      } else if (ch === '/' && text[i + 1] === '*') {
        i += 2;
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
        i++;
      } else if (ch === open) {
        depth++;
      } else if (ch === close) {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
    }
    return -1;
  }
}

/** Drop a single trailing `;` left over from a removed declaration. */
function trimTrailingSemicolon(tail: string): string {
  return tail.startsWith(';') ? tail.slice(1) : tail;
}
