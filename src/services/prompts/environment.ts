import type { LLMMessage } from '@services/LLMService';

export function generateBrowserEnvAnalysisMessages(
  code: string,
  detected: object,
  missing: Array<{ path: string; type: string }>,
  browserType: string,
): LLMMessage[] {
  const codeSnippet = code.length > 5000 ? code.substring(0, 5000) + '\n...(truncated)' : code;

  const systemPrompt = `You are a browser anti-detection expert. Analyze JavaScript code to identify environment checks, fingerprinting techniques, and recommend realistic API implementations.

Rules:
- Return ONLY valid JSON
- Follow W3C specs for API implementations
- Ensure environment consistency (UA matches platform)
- Identify anti-bot vendors (Cloudflare, PerimeterX, DataDome)`;

  const userPrompt = `Target: ${browserType.toUpperCase()}

Detected access:
${JSON.stringify(detected, null, 2)}

Missing APIs:
${JSON.stringify(missing, null, 2)}

\`\`\`javascript
${codeSnippet}
\`\`\`

JSON schema:
{
  "recommendedVariables": { "path": "realistic value" },
  "recommendedAPIs": [{ "path": "", "implementation": "JS code", "reason": "", "priority": "critical|high|medium|low", "complexity": "simple|moderate|complex" }],
  "antiCrawlFeatures": [{ "feature": "", "type": "fingerprinting|detection|behavioral|challenge", "severity": "critical|high|medium|low", "description": "", "location": "", "mitigation": "", "confidence": 0.95 }],
  "environmentConsistency": { "issues": [{ "variable1": "", "variable2": "", "issue": "", "fix": "" }], "score": 85 },
  "suggestions": [],
  "confidence": 0.85,
  "summary": ""
}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateAntiCrawlAnalysisMessages(code: string): LLMMessage[] {
  const systemPrompt = `You are a web anti-bot expert. Analyze JavaScript code to identify ALL fingerprinting and anti-bot techniques.

Rules:
- Return ONLY valid JSON array
- Be specific: "Canvas toDataURL fingerprinting" not just "Canvas detection"
- Identify vendor when possible
- Use confidence scores honestly`;

  const userPrompt = `\`\`\`javascript
${code.substring(0, 3000)}${code.length > 3000 ? '\n...(truncated)' : ''}
\`\`\`

Return JSON array:
[{ "feature": "", "type": "fingerprinting|detection|behavioral|challenge|obfuscation", "severity": "critical|high|medium|low", "description": "", "location": "", "mitigation": "", "confidence": 0.95, "vendor": "string|null" }]`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateAPIImplementationMessages(apiPath: string, context: string): LLMMessage[] {
  const systemPrompt = `You are a browser API implementation expert. Provide realistic, W3C-compliant JavaScript implementations that pass anti-detection checks.

Return ONLY JavaScript code.`;

  const userPrompt = `Implement: \`${apiPath}\`

Context:
\`\`\`javascript
${context.substring(0, 1000)}${context.length > 1000 ? '\n...(truncated)' : ''}
\`\`\`

Requirements: production-ready, real browser behavior (not mock/stub), function.toString() should look native.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateEnvironmentSuggestionsMessages(
  detected: Record<string, string[]>,
  missing: Array<{ path: string; type: string }>,
  browserType: string,
): LLMMessage[] {
  const totalVars = Object.values(detected).flat().length;

  const systemPrompt = `You are a browser automation anti-detection expert. Generate 3-5 specific, prioritized recommendations.`;

  const userPrompt = `Target: ${browserType.toUpperCase()} | ${totalVars} vars detected | ${missing.length} APIs missing

Missing:
${missing.slice(0, 20).map((m) => `- \`${m.path}\` (${m.type})`).join('\n')}${missing.length > 20 ? `\n... +${missing.length - 20} more` : ''}

Patterns: Navigator ${(detected.navigator || []).length}, Window ${(detected.window || []).length}, Document ${(detected.document || []).length}, Screen ${(detected.screen || []).length}

Return JSON array of 3-5 actionable recommendations. Focus on high-impact fixes first.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateMissingAPIImplementationsMessages(
  missingAPIs: Array<{ path: string; type: string }>,
  code: string,
): LLMMessage[] {
  const systemPrompt = `You are a browser API implementation expert. Generate realistic JavaScript implementations following W3C specs.`;

  const userPrompt = `Missing:
${JSON.stringify(missingAPIs.slice(0, 10), null, 2)}

Context:
\`\`\`javascript
${code.substring(0, 1500)}${code.length > 1500 ? '\n...(truncated)' : ''}
\`\`\`

Return JSON mapping API paths to implementation strings: { "window.requestAnimationFrame": "function(cb) { ... }" }`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateMissingVariablesMessages(
  browserType: string,
  missingPaths: string[],
  code: string,
  existingManifest: Record<string, unknown>,
): LLMMessage[] {
  const systemPrompt = `You are a browser environment expert. Generate realistic values for missing browser variables. Ensure cross-variable consistency and anti-detection compliance.`;

  const userPrompt = `Target: ${browserType.toUpperCase()}

Missing: ${JSON.stringify(missingPaths, null, 2)}

Context:
\`\`\`javascript
${code.substring(0, 2000)}${code.length > 2000 ? '\n...(truncated)' : ''}
\`\`\`

Existing: ${JSON.stringify(existingManifest, null, 2)}

Return JSON mapping paths to realistic values.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}
