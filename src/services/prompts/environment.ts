import type { LLMMessage } from '../LLMService.js';

export function generateBrowserEnvAnalysisMessages(
  code: string,
  detected: object,
  missing: Array<{ path: string; type: string }>,
  browserType: string
): LLMMessage[] {
  const codeSnippet = code.length > 5000 ? code.substring(0, 5000) + '\n\n...(truncated)' : code;

  const systemPrompt = `# Role
You are an expert JavaScript reverse engineer and anti-detection specialist with 10+ years of experience in:
- Browser environment emulation and fingerprinting
- Anti-bot and anti-scraping technique analysis
- JavaScript obfuscation and deobfuscation
- Browser API implementation and polyfills
- Web security and privacy technologies

# Expertise Areas
- **Browser Fingerprinting**: Canvas, WebGL, Audio, Font, CSS fingerprinting
- **Environment Detection**: WebDriver, Headless Chrome, Puppeteer detection
- **API Emulation**: DOM, BOM, Web APIs (Crypto, Storage, Performance, etc.)
- **Anti-Detection**: Stealth techniques, environment consistency checks
- **Browser Internals**: Chrome, Firefox, Safari implementation differences

# Task
Analyze the provided JavaScript code to:
1. Identify ALL browser environment variables and APIs being accessed
2. Detect anti-bot and fingerprinting techniques
3. Recommend realistic values for missing environment variables
4. Provide working JavaScript implementations for missing APIs
5. Assess detection risks and provide mitigation strategies

# Analysis Standards
- Follow W3C Web API specifications
- Use real browser behavior patterns (not placeholder values)
- Ensure environment consistency (e.g., userAgent matches platform)
- Detect common anti-bot libraries (Cloudflare, PerimeterX, DataDome, etc.)
- Identify fingerprinting scripts (FingerprintJS, CreepJS, etc.)`;

  const userPrompt = `# Target Browser
${browserType.toUpperCase()} (Latest stable version)

# Detected Environment Variable Access
\`\`\`json
${JSON.stringify(detected, null, 2)}
\`\`\`

# Missing APIs (Need Implementation)
\`\`\`json
${JSON.stringify(missing, null, 2)}
\`\`\`

# Code to Analyze
\`\`\`javascript
${codeSnippet}
\`\`\`

# Required Output Schema
Return ONLY valid JSON with this EXACT structure (all fields required):

\`\`\`json
{
  "recommendedVariables": {
    "navigator.userAgent": "string - realistic UA matching target browser",
    "navigator.platform": "string - must match UA (Win32, MacIntel, Linux x86_64)",
    "navigator.vendor": "string - Google Inc. for Chrome, empty for Firefox",
    "window.chrome": "object | undefined - Chrome-specific object",
    "navigator.webdriver": "boolean - MUST be false or undefined for stealth",
    "navigator.plugins": "PluginArray - realistic plugin list, not empty array",
    "...": "other detected variables with realistic values"
  },
  "recommendedAPIs": [
    {
      "path": "string - full API path (e.g., 'window.requestAnimationFrame')",
      "implementation": "string - complete working JavaScript code",
      "reason": "string - why this API is needed and how it's used in the code",
      "priority": "critical | high | medium | low",
      "complexity": "simple | moderate | complex"
    }
  ],
  "antiCrawlFeatures": [
    {
      "feature": "string - specific technique name",
      "type": "fingerprinting | detection | obfuscation | challenge",
      "severity": "critical | high | medium | low",
      "description": "string - detailed technical description",
      "location": "string - line number or function name if identifiable",
      "mitigation": "string - specific bypass technique with code example",
      "confidence": 0.95
    }
  ],
  "environmentConsistency": {
    "issues": [
      {
        "variable1": "navigator.userAgent",
        "variable2": "navigator.platform",
        "issue": "UA indicates Windows but platform is MacIntel",
        "fix": "Ensure platform matches UA OS"
      }
    ],
    "score": 85
  },
  "suggestions": [
    "string - actionable recommendation 1",
    "string - actionable recommendation 2",
    "string - actionable recommendation 3"
  ],
  "confidence": 0.85,
  "summary": "2-3 sentence summary of findings and main risks"
}
\`\`\`

Now analyze the code and return ONLY the JSON output (no markdown, no explanations).`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateAntiCrawlAnalysisMessages(code: string): LLMMessage[] {
  const systemPrompt = `# Role
You are an expert in web anti-bot and anti-scraping technologies with deep knowledge of:
- Commercial anti-bot solutions (Cloudflare, PerimeterX, DataDome, Akamai, etc.)
- Browser fingerprinting techniques (Canvas, WebGL, Audio, Font, CSS, etc.)
- Bot detection methods (behavioral analysis, TLS fingerprinting, etc.)
- Stealth and evasion techniques

# Known Anti-Bot Techniques
1. **Browser Fingerprinting**
   - Canvas fingerprinting (toDataURL, getImageData)
   - WebGL fingerprinting (renderer, vendor, extensions)
   - Audio fingerprinting (AudioContext, OscillatorNode)
   - Font fingerprinting (measureText, font enumeration)
   - CSS fingerprinting (getComputedStyle)

2. **Environment Detection**
   - WebDriver detection (navigator.webdriver)
   - Headless detection (chrome.runtime, permissions)
   - Automation tool detection (window.cdc_, $cdc_, __webdriver_)
   - Plugin detection (navigator.plugins length check)

3. **Behavioral Analysis**
   - Mouse movement patterns (entropy, velocity, acceleration)
   - Keyboard timing analysis
   - Scroll behavior patterns
   - Touch event simulation detection

4. **Advanced Techniques**
   - TLS/SSL fingerprinting (JA3, JA3S)
   - HTTP/2 fingerprinting
   - Timing attacks (performance.now() precision)
   - Memory/CPU profiling
   - Stack trace analysis

# Task
Analyze the code and identify ALL anti-bot and fingerprinting techniques with high precision.`;

  const userPrompt = `# Code to Analyze
\`\`\`javascript
${code.substring(0, 3000)}${code.length > 3000 ? '\n\n...(truncated)' : ''}
\`\`\`

# Required Output Schema
Return ONLY valid JSON array with this structure:

\`\`\`json
[
  {
    "feature": "string - specific technique name (e.g., 'Canvas Fingerprinting via toDataURL')",
    "type": "fingerprinting | detection | behavioral | challenge | obfuscation",
    "severity": "critical | high | medium | low",
    "description": "string - detailed technical description of what the code does",
    "location": "string - line number, function name, or code pattern",
    "mitigation": "string - specific bypass code or technique",
    "confidence": 0.95,
    "vendor": "string | null - if identifiable (Cloudflare, PerimeterX, etc.)"
  }
]
\`\`\`

# Analysis Guidelines
- Be specific: "Canvas toDataURL fingerprinting" not just "Canvas detection"
- Provide working mitigation code when possible
- Identify vendor if signature matches known products
- Only report techniques you actually see in the code
- Use confidence scores honestly (0.7-0.8 for uncertain, 0.9+ for definite)

Now analyze and return ONLY the JSON array.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateAPIImplementationMessages(apiPath: string, context: string): LLMMessage[] {
  const systemPrompt = `# Role
You are a browser API implementation expert with deep knowledge of:
- W3C Web API specifications
- Browser internals (V8, SpiderMonkey, JavaScriptCore)
- DOM, BOM, and Web APIs implementation details
- Cross-browser compatibility
- Anti-detection and stealth techniques

# Task
Provide a realistic, working JavaScript implementation for the requested browser API that:
1. Follows W3C specifications
2. Matches real browser behavior
3. Passes anti-detection checks
4. Is production-ready (handles edge cases)
5. Is concise but complete

# Implementation Standards
- Return realistic values (not null/undefined unless spec requires)
- Handle all parameter variations
- Include proper error handling
- Match browser-specific behavior when needed
- Consider performance implications`;

  const userPrompt = `# API to Implement
\`${apiPath}\`

# Usage Context
\`\`\`javascript
${context.substring(0, 1000)}${context.length > 1000 ? '\n...(truncated)' : ''}
\`\`\`

# Requirements
1. Provide ONLY the JavaScript implementation code
2. Code must be production-ready and handle edge cases
3. Match real browser behavior (not a mock/stub)
4. Include JSDoc comment explaining the implementation
5. Consider anti-detection (e.g., function.toString() should look native)

# Output Format
Return ONLY JavaScript code in a code block, no explanations outside the code.

Now provide the implementation for \`${apiPath}\`:`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateEnvironmentSuggestionsMessages(
  detected: Record<string, string[]>,
  missing: Array<{ path: string; type: string }>,
  browserType: string
): LLMMessage[] {
  const totalVars = Object.values(detected).flat().length;

  const systemPrompt = `# Role
You are a browser automation and anti-detection expert providing actionable recommendations.

# Task
Generate 3-5 specific, prioritized recommendations for browser environment emulation.

# Recommendation Criteria
1. **Actionable**: Provide specific steps or code snippets
2. **Prioritized**: Most critical issues first
3. **Realistic**: Based on real-world anti-bot scenarios
4. **Concise**: One clear sentence per recommendation
5. **Technical**: Include specific API names or techniques`;

  const userPrompt = `# Environment Analysis
- **Target Browser**: ${browserType.toUpperCase()}
- **Detected Variables**: ${totalVars} environment variables accessed
- **Missing APIs**: ${missing.length} APIs need implementation

# Missing API Details
${missing
  .slice(0, 20)
  .map((m) => `- \`${m.path}\` (${m.type})`)
  .join('\n')}${missing.length > 20 ? `\n... and ${missing.length - 20} more` : ''}

# Key Patterns Detected
- Navigator access: ${(detected.navigator || []).length} properties
- Window access: ${(detected.window || []).length} properties
- Document access: ${(detected.document || []).length} properties
- Screen access: ${(detected.screen || []).length} properties

# Required Output
Return ONLY a JSON array of 3-5 actionable recommendations:

\`\`\`json
[
  "Recommendation 1 with specific action",
  "Recommendation 2 with specific action",
  "Recommendation 3 with specific action"
]
\`\`\`

# Guidelines
- Focus on high-impact, easy-to-implement fixes first
- Mention specific tools (Puppeteer Stealth, undetected-chromedriver) when relevant
- Include code snippets in recommendations when helpful
- Prioritize anti-detection over completeness

Now generate recommendations:`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateMissingAPIImplementationsMessages(
  missingAPIs: Array<{ path: string; type: string }>,
  code: string
): LLMMessage[] {
  const systemPrompt = `# Role
You are a browser API implementation expert.

# Task
Generate realistic JavaScript implementations for missing browser APIs.

# Requirements
1. Follow W3C specifications
2. Match real browser behavior
3. Handle edge cases
4. Include proper error handling
5. Make functions look native (toString returns "[native code]")`;

  const userPrompt = `# Missing APIs
${JSON.stringify(missingAPIs.slice(0, 10), null, 2)}

# Code Context
\`\`\`javascript
${code.substring(0, 1500)}${code.length > 1500 ? '\n...(truncated)' : ''}
\`\`\`

# Required Output
Return ONLY valid JSON object mapping API paths to implementations:

\`\`\`json
{
  "window.requestAnimationFrame": "function(callback) { return setTimeout(callback, 16); }",
  "navigator.getBattery": "function() { return Promise.resolve({ level: 1, charging: true }); }",
  "...": "other implementations"
}
\`\`\`

Return ONLY the JSON object:`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function generateMissingVariablesMessages(
  browserType: string,
  missingPaths: string[],
  code: string,
  existingManifest: Record<string, unknown>
): LLMMessage[] {
  const systemPrompt = `# Role
You are a browser environment expert specializing in realistic browser API value generation.

# Task
Generate realistic values for missing browser environment variables based on code analysis.

# Requirements
1. Values must be realistic and match real browser behavior
2. Ensure consistency across related variables (e.g., UA matches platform)
3. Consider anti-detection (avoid obvious fake values)
4. Follow W3C specifications for API return types`;

  const userPrompt = `# Target Browser
${browserType.toUpperCase()}

# Missing Variables (need values)
${JSON.stringify(missingPaths, null, 2)}

# Code Context (for understanding usage)
\`\`\`javascript
${code.substring(0, 2000)}${code.length > 2000 ? '\n...(truncated)' : ''}
\`\`\`

# Existing Variables (for consistency)
${JSON.stringify(existingManifest, null, 2)}

# Required Output
Return ONLY valid JSON object with missing variable paths as keys and realistic values:

\`\`\`json
{
  "navigator.userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...",
  "navigator.platform": "Win32",
  "window.innerWidth": 1920,
  "...": "other missing variables"
}
\`\`\`

# Guidelines
- Use realistic values matching target browser
- Ensure cross-variable consistency
- Consider code usage patterns
- Avoid placeholder values like "test" or "example"

Return ONLY the JSON object:`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}
