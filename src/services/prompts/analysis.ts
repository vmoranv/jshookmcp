import type { LLMMessage } from '@services/LLMService';

export function generateCodeAnalysisPrompt(code: string, focus: string): LLMMessage[] {
  const systemPrompt = `# Role
You are an expert JavaScript/TypeScript analyst and security analyst with 10+ years of experience in:
- Static code analysis and AST manipulation
- Security vulnerability detection (OWASP Top 10)
- Framework and library identification (React, Vue, Angular, etc.)
- Code obfuscation and deobfuscation techniques
- Software architecture and design patterns

# Task
Perform deep static analysis on the provided JavaScript code to extract:
1. Technical stack (frameworks, bundlers, libraries)
2. Code structure (functions, classes, modules)
3. Business logic and data flow
4. Security vulnerabilities and risks
5. Code quality metrics

# Output Requirements
- Return ONLY valid JSON (no markdown, no explanations outside JSON)
- Follow the exact schema provided in the user message
- Use confidence scores (0.0-1.0) for uncertain detections
- Provide specific line numbers for security risks when possible
- Be precise and avoid hallucination

# Analysis Methodology
1. First, identify the code's purpose and main functionality
2. Then, detect frameworks and libraries by analyzing imports and API usage
3. Next, map out the code structure and call graph
4. Finally, perform security analysis using OWASP guidelines`;

  const userPrompt = `# Analysis Focus
Primary focus: ${focus}

# Code to Analyze
\`\`\`javascript
${code.length > 5000 ? code.substring(0, 5000) + '\n\n// ... (code truncated for analysis)' : code}
\`\`\`

# Required Output Schema
Return a JSON object with this EXACT structure (all fields are required):

\`\`\`json
{
  "techStack": {
    "framework": "string | null",
    "bundler": "string | null",
    "libraries": ["array of library names with versions if detectable"],
    "confidence": 0.95
  },
  "structure": {
    "functions": [
      {
        "name": "function name",
        "type": "arrow | declaration | expression | async",
        "purpose": "brief description",
        "complexity": "low | medium | high",
        "lineNumber": 42
      }
    ],
    "classes": [
      {
        "name": "class name",
        "purpose": "brief description",
        "methods": ["method1", "method2"],
        "lineNumber": 100
      }
    ],
    "imports": ["list of imported modules"],
    "exports": ["list of exported symbols"]
  },
  "businessLogic": {
    "mainFeatures": ["feature 1", "feature 2"],
    "dataFlow": "description of how data flows through the code",
    "apiEndpoints": ["list of API endpoints if any"],
    "stateManagement": "Redux | Vuex | Context API | none | unknown"
  },
  "securityRisks": [
    {
      "type": "XSS | SQL Injection | CSRF | etc.",
      "severity": "critical | high | medium | low",
      "description": "detailed description",
      "location": "line 123 or function name",
      "cwe": "CWE-79",
      "recommendation": "how to fix it"
    }
  ],
  "qualityScore": 85,
  "qualityMetrics": {
    "maintainability": 80,
    "readability": 75,
    "testability": 70,
    "performance": 90
  },
  "summary": "2-3 sentence summary of the code's purpose and quality"
}
\`\`\`

Return ONLY the JSON output (no additional text).`;

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

  const userPrompt = `Analyze this JavaScript project based on the following files:

${JSON.stringify(fileInfos, null, 2)}

Provide a high-level summary including:
1. Main purpose of the project
2. Architecture pattern (MVC, SPA, etc.)
3. Key technologies used
4. Security concerns
5. Recommendations for further analysis

Format your response as JSON.`;

  return [
    { role: 'system', content: 'You are an expert software architect and security analyst.' },
    { role: 'user', content: userPrompt },
  ];
}

export function generateFileSummaryMessages(url: string, code: string): LLMMessage[] {
  const userPrompt = `Analyze this JavaScript file and provide a structured summary:

**File**: ${url}

**Code**:
\`\`\`javascript
${code}
\`\`\`

Provide analysis in JSON format with the following structure:
{
  "summary": "Brief description of what this code does",
  "purpose": "Main purpose of this file",
  "keyFunctions": ["function1", "function2"],
  "dependencies": ["dependency1", "dependency2"],
  "hasEncryption": true/false,
  "encryptionMethods": ["AES", "RSA"] (if applicable),
  "hasAPI": true/false,
  "apiEndpoints": ["/api/endpoint1"] (if applicable),
  "hasObfuscation": true/false,
  "obfuscationType": "type" (if applicable),
  "securityIssues": ["issue1", "issue2"],
  "suspiciousPatterns": ["pattern1"],
  "complexity": "low/medium/high",
  "recommendations": ["recommendation1"]
}`;

  return [
    { role: 'system', content: 'You are an expert software architect and security analyst.' },
    { role: 'user', content: userPrompt },
  ];
}
