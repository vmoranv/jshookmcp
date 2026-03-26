import type { LLMMessage } from '@services/LLMService';

export function generateCodeCleanupMessages(code: string, techniques: string[]): LLMMessage[] {
  const codeSnippet = code.length > 2000 ? code.slice(0, 2000) + '\n...(truncated)' : code;

  const systemPrompt = `You are a JavaScript refactoring specialist. Clean up deobfuscated code while preserving 100% functionality.

Rules:
- NEVER change program logic or behavior
- NEVER remove functional code
- ONLY improve naming, structure, readability
- Output must be syntactically valid JavaScript
- Return ONLY the cleaned code (no markdown, no explanations)`;

  const userPrompt = `Detected techniques: ${techniques.join(', ')}

\`\`\`javascript
${codeSnippet}
\`\`\`

Tasks:
1. Rename variables to meaningful names based on usage context
2. Remove unnecessary IIFEs, redundant assignments, complex ternaries
3. Extract magic numbers to named constants
4. Add brief comments for complex logic only

Return ONLY the cleaned JavaScript code.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateVMAnalysisMessages(code: string): LLMMessage[] {
  const codeSnippet = code.substring(0, 5000);

  return [{
    role: 'user',
    content: `Analyze this JSVMP-protected JavaScript:

\`\`\`javascript
${codeSnippet}
\`\`\`

Return JSON: { "vmType", "programCounter", "stack", "registers", "bytecodeArray", "interpreterFunction", "restorationSteps": [], "warnings": [] }`,
  }];
}

export function generateDeobfuscationPrompt(code: string): LLMMessage[] {
  const systemPrompt = `You are a JavaScript deobfuscation expert. Identify obfuscation type/tool, understand actual logic, suggest renames, and provide deobfuscated code.

Return ONLY valid JSON.`;

  const userPrompt = `\`\`\`javascript
${code.length > 3000 ? code.substring(0, 3000) + '\n// ... (truncated)' : code}
\`\`\`

JSON schema:
{
  "obfuscationType": { "primary": "string-array|control-flow-flattening|vm-protection|mixed|unknown", "techniques": [], "tool": "javascript-obfuscator|webpack|uglify|terser|custom|unknown", "toolVersion": "string|null", "confidence": 0.85 },
  "analysis": { "codeStructure": "", "mainLogic": "", "keyFunctions": [{ "obfuscatedName": "", "purpose": "", "confidence": 0.9 }], "dataFlow": "" },
  "suggestions": {
    "variableRenames": { "_0x1234": { "suggested": "", "reason": "", "confidence": 0.95 } },
    "functionRenames": { "_0xabcd": { "suggested": "", "reason": "", "confidence": 0.92 } },
    "simplifications": [{ "type": "", "description": "", "impact": "high|medium|low" }]
  },
  "deobfuscationSteps": [],
  "deobfuscatedCode": "string|null",
  "limitations": [],
  "summary": ""
}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateVMDeobfuscationMessages(userPrompt: string): LLMMessage[] {
  const systemPrompt = `You are a JavaScript VM deobfuscation expert. Reconstruct readable JavaScript from VM-protected code.

Rules:
- Output ONLY valid, executable JavaScript (no markdown)
- Preserve exact program logic and side effects
- Use meaningful variable names
- If uncertain, preserve original structure`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateControlFlowUnflatteningMessages(codeSnippet: string): LLMMessage[] {
  const systemPrompt = `You are a control flow deobfuscation expert. Reconstruct natural control flow from switch-case state machine dispatchers.

Rules:
- Output ONLY valid JavaScript code
- Preserve exact program logic
- Remove dispatcher loops and state variables
- Restore natural if/while/for structures`;

  const userPrompt = `\`\`\`javascript
${codeSnippet}
\`\`\`

Trace state transitions, reconstruct original control flow, output ONLY deobfuscated code.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}
