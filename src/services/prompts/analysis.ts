import type { LLMMessage } from '@services/LLMService';

export function generateCodeAnalysisPrompt(code: string, focus: string): LLMMessage[] {
  const systemPrompt = `You are an expert JavaScript analyst. Analyze code for technical stack, structure, business logic, security vulnerabilities, and quality.

Rules:
- Return ONLY valid JSON matching the schema below
- Use confidence scores (0.0-1.0)
- Include line numbers for security risks
- Be precise, no hallucination`;

  const userPrompt = `Focus: ${focus}

\`\`\`javascript
${code.length > 5000 ? code.substring(0, 5000) + '\n// ... (truncated)' : code}
\`\`\`

JSON schema:
{
  "techStack": { "framework": "string|null", "bundler": "string|null", "libraries": ["string"], "confidence": 0.95 },
  "structure": {
    "functions": [{ "name": "", "type": "arrow|declaration|expression|async", "purpose": "", "complexity": "low|medium|high", "lineNumber": 0 }],
    "classes": [{ "name": "", "purpose": "", "methods": [], "lineNumber": 0 }],
    "imports": [], "exports": []
  },
  "businessLogic": { "mainFeatures": [], "dataFlow": "", "apiEndpoints": [], "stateManagement": "" },
  "securityRisks": [{ "type": "", "severity": "critical|high|medium|low", "description": "", "location": "", "cwe": "", "recommendation": "" }],
  "qualityScore": 85,
  "qualityMetrics": { "maintainability": 0, "readability": 0, "testability": 0, "performance": 0 },
  "summary": ""
}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateProjectSummaryMessages(
  files: Array<{ url: string; size: number; type: string; content: string }>,
): LLMMessage[] {
  const fileInfos = files.map((f) => ({
    url: f.url,
    size: f.size,
    type: f.type,
    preview: f.content.substring(0, 200),
  }));

  return [
    { role: 'system', content: 'You are an expert software architect and security analyst.' },
    {
      role: 'user',
      content: `Analyze this JavaScript project:\n\n${JSON.stringify(fileInfos, null, 2)}\n\nProvide JSON summary: purpose, architecture, technologies, security concerns, recommendations.`,
    },
  ];
}

export function generateFileSummaryMessages(url: string, code: string): LLMMessage[] {
  return [
    { role: 'system', content: 'You are an expert software architect and security analyst.' },
    {
      role: 'user',
      content: `Analyze **${url}**:
\`\`\`javascript
${code}
\`\`\`
Return JSON: { "summary", "purpose", "keyFunctions", "dependencies", "hasEncryption", "encryptionMethods", "hasAPI", "apiEndpoints", "hasObfuscation", "obfuscationType", "securityIssues", "suspiciousPatterns", "complexity": "low|medium|high", "recommendations" }`,
    },
  ];
}
