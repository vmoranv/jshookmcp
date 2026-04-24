import type { PoisonedIdentifier, PoisonedIdentifierResult, StringTablePoisoning, LlmDeobfuscationRisk } from '@internal-types/index';
import { DEOBFUSCATION_CONFIG, validateInputSize, withTimeout, escapeRegExp } from '@modules/deobfuscator/DeobfuscationConfig';

export interface PoisonedIdentifier {
  name: string;
  score: number;
  type: 'variable' | 'function' | 'parameter' | 'string_table';
  context: string;
}

export interface PoisonedIdentifierResult {
  detected: boolean;
  poisonedCount: number;
  poisonedIdentifiers: PoisonedIdentifier[];
  recommendations: string[];
}

export interface StringTablePoisoning {
  hasPoisonedNames: boolean;
  poisonedEntries: string[];
  coherenceScore: number;
  recommendations: string[];
}

export interface LlmDeobfuscationRisk {
  severity: 'low' | 'medium' | 'high';
  factors: string[];
  recommendations: string[];
}

// Safer patterns with boundaries to prevent catastrophic backtracking
const POISONED_IDENTIFIER_PATTERNS = [
  { name: 'poisoned', score: 0.95, type: 'variable', pattern: /(?<![a-zA-Z0-9_])poisoned(?![a-zA-Z0-9_])/gi },
  { name: 'malicious', score: 0.92, type: 'variable', pattern: /(?<![a-zA-Z0-9_])malicious(?![a-zA-Z0-9_])/gi },
  { name: 'suspicious', score: 0.90, type: 'variable', pattern: /(?<![a-zA-Z0-9_])suspicious(?![a-zA-Z0-9_])/gi },
  { name: 'injected', score: 0.88, type: 'variable', pattern: /(?<![a-zA-Z0-9_])injected(?![a-zA-Z0-9_])/gi },
  { name: 'encoded', score: 0.85, type: 'variable', pattern: /(?<![a-zA-Z0-9_])encoded(?![a-zA-Z0-9_])/gi },
  { name: 'obfuscated', score: 0.80, type: 'variable', pattern: /(?<![a-zA-Z0-9_])obfuscated(?![a-zA-Z0-9_])/gi },
  { name: 'debug', score: 0.75, type: 'variable', pattern: /(?<![a-zA-Z0-9_])debug(?![a-zA-Z0-9_])/gi },
  { name: 'protection', score: 0.70, type: 'variable', pattern: /(?<![a-zA-Z0-9_])protection(?![a-zA-Z0-9_])/gi },
];

// Safer patterns with boundaries and atomic groups
const SEMANTICALLY_INCONSISTENT_PATTERNS = [
  /(?<![a-zA-Z0-9_])_0x[a-f0-9]{4,}(?![a-f0-9])/i,
  /\$(?:[a-z]{4,})\$(?:[a-z]{4,})/i,
  /__(?:POISONED|MALICIOUS|SUSPICIOUS)__[a-z0-9]+/i,
];

// Safe regex matching with timeout protection
async function safeMatch(pattern: RegExp, text: string, timeoutMs: number = DEOBFUSCATION_CONFIG.PATTERN_TIMEOUT_MS): Promise<RegExpMatchArray | null> {
  return withTimeout(
    new Promise<RegExpMatchArray | null>((resolve) => {
      try {
        const matches = text.match(pattern);
        resolve(matches);
      } catch (error) {
        resolve(null);
      }
    }),
    timeoutMs,
    `Pattern matching timeout (${pattern})`
  );
}

// Safe string validation helper
function safeSubstring(str: string, maxLength: number = DEOBFUSCATION_CONFIG.MAX_IDENTIFIER_LENGTH): string {
  return str.length > maxLength ? str.substring(0, maxLength) : str;
}

export function detectPoisonedIdentifiers(code: string): PoisonedIdentifierResult {
  // Validate input size first
  validateInputSize(code);
  
  const poisoned: PoisonedIdentifier[] = [];
  const poisonedNames = new Set<string>();
  let totalMatches = 0;

  // Process each pattern with timeout protection
  for (const pattern of POISONED_IDENTIFIER_PATTERNS) {
    if (totalMatches >= DEOBFUSCATION_CONFIG.MAX_PATTERN_MATCHES) break;
    
    try {
      const matches = code.match(pattern.pattern);
      if (matches) {
        for (const match of matches) {
          if (totalMatches >= DEOBFUSCATION_CONFIG.MAX_PATTERN_MATCHES) break;
          
          const poisonedName = safeSubstring(match);
          if (!poisonedNames.has(poisonedName)) {
            poisoned.push({
              name: poisonedName,
              score: pattern.score,
              type: 'variable',
              context: `Found in: [...${safeSubstring(code, 100)}...]`,
            });
            poisonedNames.add(poisonedName);
            totalMatches++;
          }
        }
      }
    } catch (error) {
      // Silently continue on regex errors to prevent DoS
      continue;
    }
  }

  const poisonedCount = poisoned.length;
  
  const recommendations: string[] = [];
  if (poisonedCount > 0) {
    recommendations.push('Consider implementing string table poisoning detection');
    recommendations.push('Add verification prompts for LLM-based deobfuscation');
    recommendations.push('Review task framing for deobfuscation workflows');
  }

  return {
    detected: poisonedCount > 0,
    poisonedCount: Math.min(poisonedCount, DEOBFUSCATION_CONFIG.MAX_PATTERN_MATCHES),
    poisonedIdentifiers: poisoned.slice(0, DEOBFUSCATION_CONFIG.MAX_PATTERN_MATCHES),
    recommendations: poisonedCount > 0 ? recommendations : ['No poisoning detected - standard deobfuscation safe'],
  };
}

export function analyzeStringTablePoisoning(code: string): StringTablePoisoning {
  // Validate input size first
  validateInputSize(code);
  
  const poisonedEntries: string[] = [];
  let coherenceScore = 100;
  let totalProcessed = 0;

  if (code.includes('.split') && code.includes('|')) {
    try {
      const splitMatch = code.match(/\.split\(['|"]([^'|"]+)['|"]\)/);
      if (splitMatch) {
        // Use safer pattern matching with timeout
        const potentialEntries = code.match(/['"][^'"]*?['"]/g);
        
        if (potentialEntries) {
          let poisonedEntriesCount = 0;
          for (const entry of potentialEntries) {
            if (totalProcessed >= DEOBFUSCATION_CONFIG.MAX_PATTERN_MATCHES) break;
            
            const cleanEntry = entry.substring(1, entry.length - 1);
            // Safer pattern testing with boundaries
            for (const pattern of SEMANTICALLY_INCONSISTENT_PATTERNS) {
              if (pattern.test(cleanEntry)) {
                poisonedEntries.push(safeSubstring(cleanEntry));
                poisonedEntriesCount++;
                break;
              }
            }
            totalProcessed++;
          }

          coherenceScore = poisonedEntriesCount > 0 
            ? Math.max(10, 100 - poisonedEntriesCount * 5)
            : 100;
        }
      }
    } catch (error) {
      // Silently continue on regex errors
    }
  }

  const hasPoisonedNames = poisonedEntries.length > 0;

  return {
    hasPoisonedNames,
    poisonedEntries: poisonedEntries.slice(0, DEOBFUSCATION_CONFIG.MAX_PATTERN_MATCHES),
    coherenceScore,
    recommendations: hasPoisonedNames 
      ? [
          'Detected potential poisoned entries in string table',
          'Consider anti-LLM deobfuscation techniques',
          'Add semantic verification for LLM reconstructions',
        ]
      : ['String table appears clean - standard deobfuscation safe'],
  };
}

export function assessLlmDeobfuscationRisk(code: string): LlmDeobfuscationRisk {
  // Validate input size first
  validateInputSize(code);
  
  const factors: string[] = [];
  let severity: 'low' | 'medium' | 'high' = 'low';

  // Safer pattern checking with boundaries
  if (/_0x[a-f0-9]{4,}(?![a-f0-9])/.test(code)) {
    factors.push('Identifiable obfuscator pattern detected');
  }

  if (code.includes('.split') && code.includes('|')) {
    factors.push('String array pattern present');
  }

  if (/while\s*\(\s*true\s*\)\s*\{\s*switch/.test(code)) {
    factors.push('Control flow flattening present');
  }

  if (code.includes('eval') || /new\s+Function/.test(code)) {
    factors.push('Dynamic code execution detected');
  }

  if (factors.length >= 3) {
    severity = 'high';
    factors.push('Multiple deobfuscation-resistant patterns detected');
  } else if (factors.length > 1) {
    severity = 'medium';
  }

  const recommendations: string[] = [];
  if (severity !== 'low') {
    recommendations.push('Implement poisoning detection for LLM reconstructions');
    recommendations.push('Add semantic verification steps');
    recommendations.push('Consider task framing optimization');
  }

  return {
    severity,
    factors,
    recommendations,
  };
}

export function verifyLlmDeobfuscation(code: string, result: string): { 
  consistencyScore: number;
  verificationPassed: boolean;
  issues: string[];
} {
  // Validate input sizes
  validateInputSize(code);
  validateInputSize(result);
  
  const issues: string[] = [];
  let consistencyScore = 100;

  // Safer poisoned identifier detection in result
  const poisonedResult = detectPoisonedIdentifiers(result);
  if (poisonedResult.detected) {
    issues.push('LLM reproduced poisoned identifiers');
    consistencyScore = Math.max(0, consistencyScore - 50);
  }

  // Safer semantic consistency checking
  if (/(?<![a-zA-Z0-9_])_0x[a-f0-9]{4,}/.test(code) && !/(?<![a-zA-Z0-9_])_0x[a-f0-9]{4,}/.test(result)) {
    consistencyScore = Math.max(0, consistencyScore - 10);
  }

  // Safer control flow checking
  const originalCff = /while\s*\(\s*true\s*\)\s*\{\s*switch/.test(code);
  const resultCff = /while\s*\(\s*true\s*\)\s*\{\s*switch/.test(result);
  if (originalCff !== resultCff) {
    issues.push('Control flow structure changed unexpectedly');
    consistencyScore = Math.max(0, consistencyScore - 20);
  }

  return {
    consistencyScore,
    verificationPassed: consistencyScore >= 70,
    issues,
  };
}

export default {
  detectPoisonedIdentifiers,
  analyzeStringTablePoisoning,
  assessLlmDeobfuscationRisk,
  verifyLlmDeobfuscation,
};
