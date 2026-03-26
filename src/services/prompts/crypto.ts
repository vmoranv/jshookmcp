import type { LLMMessage } from '@services/LLMService';

export function generateCryptoDetectionPrompt(code: string): LLMMessage[] {
  const systemPrompt = `You are a cryptography expert. Analyze JavaScript code to identify algorithms, libraries, parameters, and security vulnerabilities.

Rules:
- Return ONLY valid JSON
- Use confidence scores (0.0-1.0)
- Flag deprecated algorithms (MD5, SHA-1, DES, RC4)
- Check for hardcoded keys and weak key generation`;

  const userPrompt = `\`\`\`javascript
${code.length > 4000 ? code.substring(0, 4000) + '\n// ... (truncated)' : code}
\`\`\`

JSON schema:
{
  "algorithms": [{
    "name": "AES-256-CBC|RSA-2048|SHA-256|...",
    "type": "symmetric|asymmetric|hash|encoding|kdf|mac",
    "variant": "", "confidence": 0.95,
    "location": { "line": 0, "function": "", "codeSnippet": "" },
    "parameters": { "keySize": "128|192|256|null", "key": "hardcoded|derived|imported|unknown", "keyValue": "string|null", "iv": "present|absent|hardcoded|random", "mode": "CBC|GCM|ECB|CTR|null", "padding": "PKCS7|NoPadding|null" },
    "usage": "encryption|decryption|hashing|signing|verification",
    "securityIssues": []
  }],
  "libraries": [{ "name": "", "version": "unknown", "confidence": 0.92 }],
  "securityAssessment": {
    "overallStrength": "strong|medium|weak|critical", "score": 75,
    "weakAlgorithms": [{ "algorithm": "", "reason": "", "severity": "critical", "cwe": "" }],
    "hardcodedSecrets": [{ "type": "", "location": "", "value": "", "severity": "critical" }],
    "vulnerabilities": [{ "type": "", "description": "", "impact": "", "cvss": 0, "cwe": "" }],
    "recommendations": [{ "priority": "critical|high|medium|low", "issue": "", "solution": "" }]
  },
  "summary": ""
}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}
