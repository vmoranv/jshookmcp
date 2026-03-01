import { logger } from '../../utils/logger.js';
import { LLMService } from '../../services/LLMService.js';
import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { generateVMDeobfuscationMessages } from '../../services/prompts/deobfuscation.js';

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
  private llm?: LLMService;

  constructor(llm?: LLMService) {
    this.llm = llm;
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
    vmInfo: { type: string; instructionCount: number }
  ): Promise<{ success: boolean; code: string }> {
    logger.warn('VM deobfuscation is experimental and may fail');

    try {
      const vmStructure = this.analyzeVMStructure(code);

      if (vmStructure.hasInterpreter) {
        logger.info(
          `Detected VM interpreter with ${vmStructure.instructionTypes.length} instruction types`
        );
      }

      const vmComponents = this.extractVMComponents(code);

      if (this.llm) {
        const prompt = this.buildVMDeobfuscationPrompt(code, vmInfo, vmStructure, vmComponents);

        const response = await this.llm.chat(generateVMDeobfuscationMessages(prompt), {
          temperature: 0.05,
          maxTokens: 4000,
        });

        const deobfuscatedCode = this.extractCodeFromLLMResponse(response.content);

        if (this.isValidJavaScript(deobfuscatedCode)) {
          logger.success('VM deobfuscation succeeded via LLM');
          return {
            success: true,
            code: deobfuscatedCode,
          };
        } else {
          logger.warn('LLM output is not valid JavaScript, falling back to original');
        }
      }

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
        m.replace(/case\s+/i, '').replace(/:/, '')
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
            path
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

  public buildVMDeobfuscationPrompt(
    code: string,
    vmInfo: { type: string; instructionCount: number },
    vmStructure: VMStructure,
    vmComponents: VMComponents
  ): string {
    const codeSnippet = code.length > 2000 ? code.slice(0, 2000) + '\n...(truncated)' : code;
    return `# VM Deobfuscation Analysis

## VM Profile
- **Architecture**: ${vmInfo.type}
- **Instruction Count**: ${vmInfo.instructionCount}
- **Interpreter Loop**: ${vmStructure.hasInterpreter ? 'Detected' : 'Not detected'}
- **Stack Operations**: ${vmStructure.hasStack ? 'Present' : 'Absent'}
- **Register Usage**: ${vmStructure.hasRegisters ? 'Present' : 'Absent'}
- **Instruction Variety**: ${vmStructure.instructionTypes.length} distinct types

## Identified Components
${vmComponents.instructionArray ? ` Instruction Array: Found at ${vmComponents.instructionArray}` : ' Instruction Array: Not found'}
${vmComponents.dataArray ? ` Data Array: Found at ${vmComponents.dataArray}` : ' Data Array: Not found'}
${vmComponents.interpreterFunction ? ` Interpreter Function: Found at ${vmComponents.interpreterFunction}` : ' Interpreter Function: Not found'}

## VM-Protected Code
\`\`\`javascript
${codeSnippet}
\`\`\`

## Deobfuscation Instructions (Chain-of-Thought)

### Step 1: VM Structure Analysis
Examine the code to identify:
- Instruction array (usually a large array of numbers/strings)
- Interpreter loop (while/for loop processing instructions)
- Stack/register variables
- Opcode handlers (switch-case or if-else chains)

### Step 2: Instruction Decoding
For each instruction type, determine:
- What JavaScript operation it represents (e.g., opcode 0x01 = addition)
- How it manipulates the stack/registers
- What side effects it has (function calls, property access, etc.)

### Step 3: Control Flow Reconstruction
- Map VM jumps/branches to JavaScript if/while/for statements
- Identify function calls and returns
- Reconstruct try-catch blocks if present

### Step 4: Code Generation
- Replace VM instruction sequences with equivalent JavaScript
- Use meaningful variable names based on usage context
- Remove VM overhead (interpreter loop, stack management)
- Preserve all side effects and program behavior

### Step 5: Validation
- Ensure output is syntactically valid JavaScript
- Verify no functionality is lost
- Add comments for complex patterns

## Example Transformation (Few-shot Learning)

**VM Code (Before)**:
\`\`\`javascript
var vm = [0x01, 0x05, 0x02, 0x03, 0x10];
var stack = [];
for(var i=0; i<vm.length; i++) {
  switch(vm[i]) {
    case 0x01: stack.push(5); break;
    case 0x02: stack.push(3); break;
    case 0x10: var b=stack.pop(), a=stack.pop(); stack.push(a+b); break;
  }
}
console.log(stack[0]);
\`\`\`

**Deobfuscated Code (After)**:
\`\`\`javascript
var result = 5 + 3;
console.log(result);
\`\`\`

## Critical Requirements
1. Output ONLY the deobfuscated JavaScript code
2. NO markdown code blocks, NO explanations, NO comments outside the code
3. Code must be syntactically valid and executable
4. Preserve exact program logic and side effects
5. If full deobfuscation is impossible, return the best partial result

## Output Format
Return clean JavaScript code starting immediately (no preamble).`;
  }

  public simplifyVMCode(code: string, vmComponents: VMComponents): string {
    try {
      let simplified = code;

      if (vmComponents.interpreterFunction) {
        const regex = new RegExp(
          `function\\s+${vmComponents.interpreterFunction}\\s*\\([^)]*\\)\\s*\\{[^}]*\\}`,
          'g'
        );
        simplified = simplified.replace(regex, '/* vm interpreter removed */');
      }

      if (vmComponents.instructionArray) {
        const regex = new RegExp(
          `var\\s+${vmComponents.instructionArray}\\s*=\\s*\\[[^\\]]*\\];`,
          'g'
        );
        simplified = simplified.replace(regex, '/* vm instruction array removed */');
      }

      return simplified;
    } catch (error) {
      logger.debug('Failed to simplify VM code:', error);
      return code;
    }
  }

  public extractCodeFromLLMResponse(response: string): string {
    let code = response.trim();

    code = code.replace(/^```(?:javascript|js)?\s*\n/i, '');
    code = code.replace(/\n```\s*$/i, '');

    return code.trim();
  }

  public isValidJavaScript(code: string): boolean {
    try {
      parser.parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });
      return true;
    } catch {
      return false;
    }
  }
}
