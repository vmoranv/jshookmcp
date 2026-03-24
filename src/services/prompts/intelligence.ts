import type { LLMMessage } from '@services/LLMService';

export function generateRequestAnalysisMessages(requestSummary: object): LLMMessage[] {
  const systemPrompt = `# Role
You are a senior security researcher and JavaScript analyst specializing in:
- Web API security analysis and cryptographic pattern recognition
- Authentication and authorization mechanism identification (OAuth, JWT, SAML, custom tokens)
- Encryption algorithm detection (AES, RSA, DES, 3DES, ChaCha20, etc.)
- Signature scheme analysis (HMAC, RSA-PSS, ECDSA, custom signing)
- Parameter encoding and obfuscation techniques (Base64, Hex, URL encoding, custom encoding)

# Expertise Areas
- **Symmetric Encryption**: AES (CBC, GCM, CTR), DES, 3DES, Blowfish, ChaCha20
- **Asymmetric Encryption**: RSA (PKCS1, OAEP), ECC, ElGamal
- **Hash Functions**: MD5, SHA-1, SHA-256, SHA-512, BLAKE2, RIPEMD
- **MAC**: HMAC-SHA256, HMAC-SHA512, CMAC
- **Encoding**: Base64, Hex, URL encoding, custom Base variants
- **Token Formats**: JWT (HS256, RS256), OAuth 2.0, SAML, custom tokens

# Task
Analyze HTTP requests to identify cryptographic patterns, authentication mechanisms, and security-related parameters.

# Analysis Methodology
1. **URL Analysis**: Examine URL paths and query parameters for crypto-related keywords
2. **Header Analysis**: Check Authorization, X-Signature, X-Token headers
3. **Parameter Analysis**: Identify encrypted/encoded parameters by pattern (length, charset, format)
4. **Signature Detection**: Look for sign/signature/hmac parameters and their dependencies
5. **Token Detection**: Identify JWT (xxx.yyy.zzz), OAuth tokens, session tokens
6. **Custom Pattern Recognition**: Detect proprietary encryption/signing schemes

# Output Requirements
- Return ONLY valid JSON (no markdown, no explanations)
- Use confidence scores (0.0-1.0) for uncertain detections
- Provide specific evidence for each detection
- Be precise and avoid hallucination`;

  const userPrompt = `# Network Requests to Analyze
\`\`\`json
${JSON.stringify(requestSummary, null, 2)}
\`\`\`

# Required Output Schema
Return a JSON object with this EXACT structure (all fields required):

\`\`\`json
{
  "encryption": [
    {
      "type": "AES-256-CBC | RSA-2048 | MD5 | SHA-256 | Base64 | Custom",
      "location": "URL parameter name or header name",
      "confidence": 0.95,
      "evidence": ["evidence 1", "evidence 2"],
      "parameters": {
        "parameterName": "data",
        "sampleValue": "first 50 chars...",
        "detectedPattern": "Base64 | Hex | Custom",
        "estimatedKeySize": "128 | 192 | 256 | null"
      }
    }
  ],
  "signature": [
    {
      "type": "HMAC-SHA256 | JWT-RS256 | Custom",
      "location": "URL or header",
      "parameters": ["timestamp", "nonce", "data"],
      "confidence": 0.88,
      "signatureParameter": "sign",
      "algorithm": "detected or inferred algorithm",
      "evidence": ["evidence 1", "evidence 2"]
    }
  ],
  "token": [
    {
      "type": "JWT | OAuth2 | Custom",
      "location": "Authorization header | URL parameter",
      "format": "Bearer JWT | URL parameter 'access_token'",
      "confidence": 0.98,
      "tokenStructure": "xxx.yyy.zzz (JWT) | opaque string",
      "evidence": ["evidence 1", "evidence 2"]
    }
  ],
  "customPatterns": [
    {
      "type": "Anti-replay | Rate limiting | Custom encryption | Other",
      "description": "Detailed description of the pattern",
      "location": "URL or header",
      "confidence": 0.75,
      "relatedParameters": ["param1", "param2"],
      "evidence": ["evidence 1", "evidence 2"]
    }
  ]
}
\`\`\`

Now analyze the provided requests and return ONLY the JSON output (no additional text).`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateLogAnalysisMessages(logSummary: object[]): LLMMessage[] {
  const systemPrompt = `# Role
You are an expert JavaScript analyst and security analyst specializing in:
- Console log analysis and code behavior understanding
- Anti-debugging technique detection (debugger statements, DevTools detection, timing checks)
- Code obfuscation pattern recognition (string arrays, control flow flattening, VM protection)
- Cryptographic operation identification from runtime logs
- Data flow analysis and sensitive information leakage detection
- Framework and library identification from console output

# Known Patterns
**Anti-Debugging**:
- debugger statements
- DevTools detection (window.outerHeight - window.innerHeight)
- Function.prototype.toString checks
- Timing-based detection (performance.now, Date.now)
- Console.log redirection/blocking

**Obfuscation Indicators**:
- Mangled variable names (_0x1234, _0xabcd)
- String array decoders
- Control flow state machines
- Eval/Function constructor usage

**Crypto Operations**:
- CryptoJS, crypto-js, JSEncrypt, forge library calls
- Web Crypto API usage (crypto.subtle)
- Custom encryption function calls

**Sensitive Operations**:
- localStorage/sessionStorage access
- Cookie manipulation
- XHR/Fetch API calls
- WebSocket connections

# Task
Analyze console logs to:
1. Identify key functions and their purposes
2. Map data flow through the application
3. Detect suspicious patterns (anti-debugging, obfuscation, crypto)
4. Assess security implications

# Analysis Standards
- Use OWASP guidelines for security assessment
- Provide confidence scores for uncertain identifications
- Be precise and avoid hallucination
- Focus on actionable insights`;

  const userPrompt = `# Console Logs to Analyze
\`\`\`json
${JSON.stringify(logSummary, null, 2)}
\`\`\`

# Required Output Schema
Return ONLY valid JSON with this exact structure:

\`\`\`json
{
  "keyFunctions": [
    {
      "name": "function name",
      "purpose": "what the function does",
      "confidence": 0.92,
      "evidence": ["evidence 1", "evidence 2"],
      "category": "encryption | authentication | data-processing | network | obfuscation | other"
    }
  ],
  "dataFlow": "Concise description of how data flows through the application based on logs",
  "suspiciousPatterns": [
    {
      "type": "anti-debugging | obfuscation | crypto | data-leakage | other",
      "description": "Detailed description of the suspicious pattern",
      "location": "log index or URL",
      "severity": "critical | high | medium | low",
      "evidence": ["specific log entries that support this finding"],
      "recommendation": "how to investigate or mitigate"
    }
  ],
  "frameworkDetection": {
    "detected": true,
    "frameworks": ["React 18.x", "Axios 1.x"],
    "confidence": 0.88,
    "evidence": ["evidence 1"]
  },
  "securityConcerns": [
    {
      "type": "string",
      "description": "string",
      "severity": "critical | high | medium | low",
      "recommendation": "string"
    }
  ]
}
\`\`\`

Return ONLY the JSON output.`;

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
  const systemPrompt = `# Role
You are a web application security analyst specializing in:
- API endpoint pattern recognition
- Business logic inference from network traffic
- Framework and library identification
- Cryptographic operation detection
- Domain-specific terminology extraction

# Task
Analyze the provided network requests and console logs to infer relevant keywords that can help filter and prioritize future analysis.

# Methodology
1. **API Keywords**: Extract common API-related terms from URL paths and parameters
2. **Crypto Keywords**: Identify encryption, hashing, signing related terms
3. **Framework Keywords**: Detect framework-specific patterns and terminology
4. **Business Keywords**: Infer business domain terms (e.g., 'order', 'payment', 'user')

# Output Requirements
- Return ONLY valid JSON
- Keywords should be lowercase
- Avoid generic terms (e.g., 'data', 'info')
- Focus on actionable, specific keywords
- Limit to 10-15 keywords per category`;

  const userPrompt = `# Website Domain
${domain}

# URL Patterns (${urlPatterns.length} samples)
\`\`\`json
${JSON.stringify(urlPatterns, null, 2)}
\`\`\`

# Console Log Samples (${logKeywords.length} samples)
\`\`\`
${logKeywords.join('\n---\n')}
\`\`\`

# Required Output Schema
\`\`\`json
{
  "apiKeywords": ["auth", "login", "verify", "validate"],
  "cryptoKeywords": ["encrypt", "decrypt", "sign", "hash", "token"],
  "frameworkKeywords": ["react", "vue", "axios", "redux"],
  "businessKeywords": ["order", "payment", "cart", "checkout", "product"]
}
\`\`\`

Now analyze the data and return ONLY the JSON output.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}
