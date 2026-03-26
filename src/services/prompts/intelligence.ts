import type { LLMMessage } from '@services/LLMService';

export function generateRequestAnalysisMessages(requestSummary: object): LLMMessage[] {
  const systemPrompt = `You are a web security researcher. Analyze HTTP requests to identify cryptographic patterns, authentication mechanisms, and signature schemes.

Rules:
- Return ONLY valid JSON
- Use confidence scores (0.0-1.0)
- Provide specific evidence for each detection`;

  const userPrompt = `\`\`\`json
${JSON.stringify(requestSummary, null, 2)}
\`\`\`

JSON schema:
{
  "encryption": [{ "type": "AES-256-CBC|RSA-2048|...", "location": "", "confidence": 0.95, "evidence": [], "parameters": { "parameterName": "", "sampleValue": "", "detectedPattern": "Base64|Hex|Custom", "estimatedKeySize": "128|256|null" } }],
  "signature": [{ "type": "HMAC-SHA256|JWT-RS256|Custom", "location": "", "parameters": [], "confidence": 0.88, "signatureParameter": "", "algorithm": "", "evidence": [] }],
  "token": [{ "type": "JWT|OAuth2|Custom", "location": "", "format": "", "confidence": 0.98, "tokenStructure": "", "evidence": [] }],
  "customPatterns": [{ "type": "Anti-replay|Rate limiting|Custom encryption", "description": "", "location": "", "confidence": 0.75, "relatedParameters": [], "evidence": [] }]
}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateLogAnalysisMessages(logSummary: object[]): LLMMessage[] {
  const systemPrompt = `You are a JavaScript runtime analyst. Analyze console logs to identify key functions, data flow, anti-debugging, obfuscation, crypto operations, and security concerns.

Return ONLY valid JSON.`;

  const userPrompt = `\`\`\`json
${JSON.stringify(logSummary, null, 2)}
\`\`\`

JSON schema:
{
  "keyFunctions": [{ "name": "", "purpose": "", "confidence": 0.92, "evidence": [], "category": "encryption|authentication|data-processing|network|obfuscation|other" }],
  "dataFlow": "",
  "suspiciousPatterns": [{ "type": "anti-debugging|obfuscation|crypto|data-leakage", "description": "", "location": "", "severity": "critical|high|medium|low", "evidence": [], "recommendation": "" }],
  "frameworkDetection": { "detected": false, "frameworks": [], "confidence": 0.88, "evidence": [] },
  "securityConcerns": [{ "type": "", "description": "", "severity": "critical|high|medium|low", "recommendation": "" }]
}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateKeywordExpansionMessages(
  domain: string,
  urlPatterns: object[],
  logKeywords: string[],
): LLMMessage[] {
  const systemPrompt = `You are a web application analyst. Extract actionable keywords from network requests and console logs for filtering and prioritization.

Rules:
- Keywords must be lowercase
- Avoid generic terms (data, info)
- Limit to 10-15 per category
- Return ONLY valid JSON`;

  const userPrompt = `Domain: ${domain}

URL Patterns (${urlPatterns.length}):
${JSON.stringify(urlPatterns, null, 2)}

Console Samples (${logKeywords.length}):
${logKeywords.join('\n---\n')}

Return JSON: { "apiKeywords": [], "cryptoKeywords": [], "frameworkKeywords": [], "businessKeywords": [] }`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}
