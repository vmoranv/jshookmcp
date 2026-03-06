import type { LLMMessage } from '@services/LLMService';

export function generateCodeCleanupMessages(code: string, techniques: string[]): LLMMessage[] {
  const codeSnippet = code.length > 2000 ? code.slice(0, 2000) + '\n...(truncated)' : code;

  const systemPrompt = `# Role
You are an expert JavaScript code reviewer and refactoring specialist with expertise in:
- Code readability and maintainability improvement
- Semantic variable naming based on usage context
- Code smell detection and refactoring
- JavaScript best practices (ES6+, clean code principles)
- Preserving exact program functionality during refactoring

# Task
Clean up and improve deobfuscated JavaScript code while preserving 100% of its functionality.

# Refactoring Principles
1. **Semantic Naming**: Infer variable purpose from usage patterns
   - API calls -> apiClient, fetchData, apiResponse
   - DOM elements -> userInput, submitButton, errorMessage
   - Crypto operations -> encryptedData, decryptionKey, hashValue
   - Loops/counters -> index, itemCount, currentPage

2. **Code Simplification**: Remove obfuscation artifacts
   - Unnecessary IIFEs and closures
   - Redundant variable assignments
   - Complex ternary chains -> if-else
   - Magic numbers -> named constants

3. **Structure Improvement**: Enhance readability
   - Extract repeated code to functions
   - Group related operations
   - Consistent indentation and spacing
   - Logical code organization

# Critical Constraints
- **NEVER** change program logic or behavior
- **NEVER** remove functional code (even if it looks redundant)
- **NEVER** add new functionality
- **ONLY** improve naming, structure, and readability
- Output must be syntactically valid JavaScript
- Preserve all side effects and edge cases

# Output Format
Return ONLY the cleaned JavaScript code (no markdown, no explanations).`;

  const userPrompt = `# Code Cleanup Task

## Detected Obfuscation Techniques
${techniques.map((t) => `- ${t}`).join('\n')}

## Deobfuscated Code (needs cleanup)
\`\`\`javascript
${codeSnippet}
\`\`\`

## Your Task
Clean up and improve this deobfuscated JavaScript code:

1. **Variable Naming**: Rename variables to meaningful names based on their usage
   - Avoid generic names like 'a', 'b', 'temp'
   - Use descriptive names like 'userConfig', 'apiEndpoint', 'responseData'

2. **Code Structure**: Improve readability
   - Remove unnecessary parentheses and brackets
   - Simplify complex expressions
   - Extract magic numbers to named constants

3. **Comments**: Add brief comments for:
   - Complex logic or algorithms
   - Non-obvious functionality
   - Important data structures

4. **Consistency**: Ensure consistent code style
   - Use consistent indentation
   - Follow JavaScript best practices

## Important Rules
- Preserve ALL original functionality
- Do NOT remove any functional code
- Do NOT change the program logic
- Output ONLY valid JavaScript code
- Do NOT add explanations outside the code

## Output Format
Return only the cleaned JavaScript code without markdown formatting.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateVMAnalysisMessages(code: string): LLMMessage[] {
  const codeSnippet = code.substring(0, 5000);

  const userPrompt = `Analyze this JavaScript code protected by JSVMP (JavaScript Virtual Machine Protection).

JSVMP-protected JavaScript code:

\`\`\`javascript
${codeSnippet}
\`\`\`

Please analyze:

1. **VM Type**: What type of VM protection is this? (obfuscator.io / custom VM / other)

2. **VM Structure**:
   - Is there a Program Counter (PC)?
   - Is there a Stack?
   - Are there Registers?
   - What is the bytecode format?

3. **Key Components**:
   - VM interpreter function (main loop)
   - Dispatcher (switch statement)
   - Bytecode array

4. **Restoration Strategy**:
   - How to extract bytecode?
   - How to map opcodes?
   - Recommended restoration steps?

Return JSON:
{
  "vmType": "VM type description",
  "programCounter": "PC variable description",
  "stack": "stack description",
  "registers": "registers description",
  "bytecodeArray": "bytecode array description",
  "interpreterFunction": "interpreter function description",
  "restorationSteps": ["step 1", "step 2", ...],
  "warnings": ["warning 1", "warning 2", ...]
}`;

  return [{ role: 'user', content: userPrompt }];
}

export function generateDeobfuscationPrompt(code: string): LLMMessage[] {
  const systemPrompt = `# Role
You are an expert JavaScript reverse engineer specializing in:
- Code deobfuscation and obfuscation pattern recognition
- Obfuscator tool identification (javascript-obfuscator, UglifyJS, Terser, Webpack, etc.)
- Control flow analysis and simplification
- Semantic code understanding and variable naming
- AST manipulation and code transformation

# Known Obfuscation Techniques
1. String Array Obfuscation: Strings stored in arrays with index-based access
2. Control Flow Flattening: Switch-case state machines replacing normal control flow
3. Dead Code Injection: Unreachable code blocks
4. Opaque Predicates: Always-true/false conditions
5. Variable Name Mangling: _0x1234, _0xabcd style names
6. Encoding: Hex, Unicode, Base64 encoded strings
7. VM Protection: Custom virtual machine interpreters

# Task
Analyze the obfuscated code to:
1. Identify the obfuscation type and tool used
2. Understand the actual program logic
3. Suggest meaningful variable and function names
4. Provide deobfuscated code if possible
5. Explain the deobfuscation process step-by-step`;

  const userPrompt = `# Obfuscated Code
\`\`\`javascript
${code.length > 3000 ? code.substring(0, 3000) + '\n\n// ... (code truncated)' : code}
\`\`\`

# Required Output Schema
Return ONLY valid JSON:

\`\`\`json
{
  "obfuscationType": {
    "primary": "string-array | control-flow-flattening | vm-protection | mixed | unknown",
    "techniques": ["technique 1"],
    "tool": "javascript-obfuscator | webpack | uglify | terser | custom | unknown",
    "toolVersion": "string or null",
    "confidence": 0.85
  },
  "analysis": {
    "codeStructure": "description of overall structure",
    "mainLogic": "what the code actually does",
    "keyFunctions": [
      {
        "obfuscatedName": "_0x1234",
        "purpose": "what it does",
        "confidence": 0.9
      }
    ],
    "dataFlow": "how data flows through the code"
  },
  "suggestions": {
    "variableRenames": {
      "_0x1234": {"suggested": "userId", "reason": "stores user ID from API", "confidence": 0.95}
    },
    "functionRenames": {
      "_0xabcd": {"suggested": "encryptPassword", "reason": "calls CryptoJS.AES.encrypt", "confidence": 0.92}
    },
    "simplifications": [
      {
        "type": "remove dead code | unflatten control flow | decode strings",
        "description": "what to simplify",
        "impact": "high | medium | low"
      }
    ]
  },
  "deobfuscationSteps": [
    "Step 1: Extract string array at line 1-5"
  ],
  "deobfuscatedCode": "string or null",
  "limitations": ["what couldn't be deobfuscated and why"],
  "summary": "Brief summary of obfuscation and deobfuscation results"
}
\`\`\`

Return ONLY the JSON output.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateVMDeobfuscationMessages(userPrompt: string): LLMMessage[] {
  const systemPrompt = `# Role
You are a world-class expert in JavaScript VM deobfuscation and reverse engineering with expertise in:
- Virtual machine architecture and instruction set design
- Bytecode interpretation and JIT compilation
- Control flow reconstruction from VM instructions
- Stack-based and register-based VM analysis
- Obfuscation techniques used by TikTok, Shopee, and commercial protectors

# Task
Analyze VM-protected JavaScript code and reconstruct the original, readable JavaScript.

# Methodology
1. **Identify VM Components**: Locate instruction array, interpreter loop, stack/registers
2. **Decode Instructions**: Map VM opcodes to JavaScript operations
3. **Reconstruct Control Flow**: Convert VM jumps/branches to if/while/for
4. **Simplify**: Remove VM overhead and restore natural code structure
5. **Validate**: Ensure output is syntactically valid and functionally equivalent

# Critical Requirements
- Output ONLY valid, executable JavaScript (no markdown, no explanations)
- Preserve exact program logic and side effects
- Use meaningful variable names based on context
- Add brief comments for complex patterns
- Do NOT hallucinate or guess functionality
- If uncertain, preserve original code structure

# Output Format
Return clean JavaScript code without any wrapper or formatting.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateControlFlowUnflatteningMessages(codeSnippet: string): LLMMessage[] {
  const systemPrompt = `# Role
You are an expert in JavaScript control flow deobfuscation specializing in:
- Control flow flattening detection and removal
- Switch-case state machine analysis
- Dispatcher loop identification
- Control flow graph (CFG) reconstruction

# Task
Analyze control flow flattened JavaScript and reconstruct the original, natural control flow.

# Control Flow Flattening Pattern
Obfuscators replace normal if/while/for with a dispatcher loop:
\`\`\`javascript
var state = '0';
while (true) {
  switch (state) {
    case '0': console.log('a'); state = '1'; break;
    case '1': console.log('b'); state = '2'; break;
    case '2': return;
  }
}

console.log('a');
console.log('b');
return;
\`\`\`

# Requirements
- Output ONLY valid JavaScript code
- Preserve exact program logic
- Remove dispatcher loops and state variables
- Restore natural if/while/for structures
- Use meaningful variable names`;

  const userPrompt = `# Control Flow Flattened Code
\`\`\`javascript
${codeSnippet}
\`\`\`

# Instructions
1. Identify the dispatcher loop (while/for with switch-case)
2. Trace state transitions to determine execution order
3. Reconstruct original control flow (if/while/for)
4. Remove state variables and dispatcher overhead
5. Return ONLY the deobfuscated code (no explanations)

Output the deobfuscated JavaScript code:`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}
