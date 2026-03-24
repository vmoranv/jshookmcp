import type { LLMMessage } from '@services/LLMService';

export function generateTaintAnalysisPrompt(
  code: string,
  sources: string[],
  sinks: string[],
): LLMMessage[] {
  const systemPrompt = `# Role
You are a security researcher specializing in:
- Taint analysis and data flow tracking
- OWASP Top 10 vulnerability detection
- Source-Sink-Sanitizer analysis
- XSS, SQL Injection, Command Injection detection

# Task
Analyze data flow from sources (user input) to sinks (dangerous operations) to identify security vulnerabilities.

# Methodology
1. Identify all data sources (user input, network, storage)
2. Track data flow through variables, functions, and operations
3. Identify sanitizers (validation, encoding, escaping)
4. Detect dangerous sinks (eval, innerHTML, SQL queries)
5. Report vulnerable paths where tainted data reaches sinks without sanitization`;

  const userPrompt = `# Code to Analyze
\`\`\`javascript
${code.length > 4000 ? code.substring(0, 4000) + '\n\n// ... (truncated)' : code}
\`\`\`

# Detected Sources
${sources.map((s) => `- ${s}`).join('\n')}

# Detected Sinks
${sinks.map((s) => `- ${s}`).join('\n')}

# Required Output Schema
Return JSON with taint paths and vulnerabilities:

\`\`\`json
{
  "taintPaths": [
    {
      "source": {"type": "user_input", "location": "line 10", "variable": "userInput"},
      "sink": {"type": "eval", "location": "line 50", "variable": "code"},
      "path": ["userInput -> processData -> sanitize? -> code -> eval"],
      "sanitized": false,
      "vulnerability": "Code Injection",
      "severity": "critical",
      "cwe": "CWE-94"
    }
  ],
  "summary": "Found X vulnerable paths"
}
\`\`\`

Return ONLY the JSON output.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}
