import type { LLMMessage } from '@services/LLMService';

export function generateCryptoDetectionPrompt(code: string): LLMMessage[] {
  const systemPrompt = `# Role
You are a cryptography and security expert specializing in:
- Cryptographic algorithm identification (AES, RSA, DES, 3DES, Blowfish, etc.)
- JavaScript crypto library analysis (CryptoJS, JSEncrypt, Web Crypto API, crypto-js, forge, etc.)
- Security assessment based on NIST and OWASP standards
- Cryptographic parameter extraction (keys, IVs, modes, padding)
- Vulnerability detection in crypto implementations

# Task
Analyze the provided JavaScript code to:
1. Identify ALL cryptographic algorithms and their variants
2. Detect crypto libraries and their versions
3. Extract cryptographic parameters (keys, IVs, salts, modes, padding)
4. Assess security strength and identify vulnerabilities
5. Provide actionable security recommendations

# Analysis Standards
- Use NIST SP 800-175B for algorithm strength assessment
- Follow OWASP Cryptographic Storage Cheat Sheet
- Identify deprecated/weak algorithms (MD5, SHA-1, DES, RC4)
- Check for hardcoded keys and weak key generation`;

  const userPrompt = `# Code to Analyze
\`\`\`javascript
${code.length > 4000 ? code.substring(0, 4000) + '\n\n// ... (code truncated)' : code}
\`\`\`

# Required Output Schema
Return ONLY valid JSON:

\`\`\`json
{
  "algorithms": [
    {
      "name": "string (e.g., 'AES-256-CBC', 'RSA-2048', 'SHA-256')",
      "type": "symmetric | asymmetric | hash | encoding | kdf | mac",
      "variant": "string",
      "confidence": 0.95,
      "location": {
        "line": 42,
        "function": "encryptData",
        "codeSnippet": "CryptoJS.AES.encrypt(...)"
      },
      "parameters": {
        "keySize": "128 | 192 | 256 | null",
        "key": "hardcoded | derived | imported | unknown",
        "keyValue": "actual key if hardcoded (first 20 chars) or null",
        "iv": "present | absent | hardcoded | random",
        "mode": "CBC | GCM | ECB | CTR | null",
        "padding": "PKCS7 | NoPadding | null"
      },
      "usage": "encryption | decryption | hashing | signing | verification",
      "securityIssues": ["issue 1"]
    }
  ],
  "libraries": [
    {
      "name": "CryptoJS | crypto-js | JSEncrypt | forge | Web Crypto API",
      "version": "4.1.1 | unknown",
      "confidence": 0.92
    }
  ],
  "securityAssessment": {
    "overallStrength": "strong | medium | weak | critical",
    "score": 75,
    "weakAlgorithms": [
      {
        "algorithm": "MD5",
        "reason": "Cryptographically broken",
        "severity": "critical",
        "cwe": "CWE-327"
      }
    ],
    "hardcodedSecrets": [
      {
        "type": "encryption key",
        "location": "line 15",
        "value": "first 10 chars...",
        "severity": "critical"
      }
    ],
    "vulnerabilities": [
      {
        "type": "ECB mode usage",
        "description": "detailed description",
        "impact": "data leakage",
        "cvss": 7.5,
        "cwe": "CWE-326"
      }
    ],
    "recommendations": [
      {
        "priority": "critical | high | medium | low",
        "issue": "what's wrong",
        "solution": "how to fix it"
      }
    ]
  },
  "summary": "Brief summary of crypto usage and main security concerns"
}
\`\`\`

Return ONLY the JSON output.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}
