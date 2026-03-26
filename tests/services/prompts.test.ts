import { describe, it, expect } from 'vitest';
import type { LLMMessage } from '@services/LLMService';

// --- crypto ---
import { generateCryptoDetectionPrompt } from '@services/prompts/crypto';
// --- analysis ---
import {
  generateCodeAnalysisPrompt,
  generateProjectSummaryMessages,
  generateFileSummaryMessages,
} from '@services/prompts/analysis';
// --- deobfuscation ---
import {
  generateCodeCleanupMessages,
  generateVMAnalysisMessages,
  generateDeobfuscationPrompt,
  generateVMDeobfuscationMessages,
  generateControlFlowUnflatteningMessages,
} from '@services/prompts/deobfuscation';
// --- environment ---
import {
  generateBrowserEnvAnalysisMessages,
  generateAntiCrawlAnalysisMessages,
  generateAPIImplementationMessages,
  generateEnvironmentSuggestionsMessages,
  generateMissingAPIImplementationsMessages,
  generateMissingVariablesMessages,
} from '@services/prompts/environment';
// --- intelligence ---
import {
  generateRequestAnalysisMessages,
  generateLogAnalysisMessages,
  generateKeywordExpansionMessages,
} from '@services/prompts/intelligence';
// --- taint ---
import { generateTaintAnalysisPrompt } from '@services/prompts/taint';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Validates that every element in the array is a well-formed LLMMessage. */
function assertValidMessages(msgs: LLMMessage[]) {
  expect(Array.isArray(msgs)).toBe(true);
  expect(msgs.length).toBeGreaterThan(0);
  for (const msg of msgs) {
    expect(msg).toHaveProperty('role');
    expect(msg).toHaveProperty('content');
    expect(['system', 'user', 'assistant']).toContain(msg.role);
    expect(typeof msg.content).toBe('string');
    expect(msg.content.length).toBeGreaterThan(0);
  }
}

const SHORT_CODE = 'const x = 1;';
const LONG_CODE = 'a'.repeat(10_000);
const SPECIAL_CHARS_CODE = 'const s = "hello\\nworld"; // <script>alert(1)</script> `${x}` $&';

// ---------------------------------------------------------------------------
// crypto.ts
// ---------------------------------------------------------------------------

describe('generateCryptoDetectionPrompt', () => {
  it('returns system + user messages with correct roles', () => {
    const msgs = generateCryptoDetectionPrompt(SHORT_CODE);
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]!.role).toBe('user');
  });

  it('embeds the code in the user message', () => {
    const msgs = generateCryptoDetectionPrompt(SHORT_CODE);
    expect(msgs[1]!.content).toContain(SHORT_CODE);
  });

  it('truncates code longer than 4000 chars', () => {
    const msgs = generateCryptoDetectionPrompt(LONG_CODE);
    expect(msgs[1]!.content).toContain('// ... (truncated)');
    expect(msgs[1]!.content).not.toContain('a'.repeat(5000));
  });

  it('does not truncate code at exactly 4000 chars', () => {
    const exact = 'b'.repeat(4000);
    const msgs = generateCryptoDetectionPrompt(exact);
    expect(msgs[1]!.content).not.toContain('truncated');
    expect(msgs[1]!.content).toContain(exact);
  });

  it('handles special characters in code', () => {
    const msgs = generateCryptoDetectionPrompt(SPECIAL_CHARS_CODE);
    expect(msgs[1]!.content).toContain(SPECIAL_CHARS_CODE);
  });
});

// ---------------------------------------------------------------------------
// analysis.ts  -- generateCodeAnalysisPrompt
// ---------------------------------------------------------------------------

describe('generateCodeAnalysisPrompt', () => {
  it('returns system + user messages and embeds focus', () => {
    const msgs = generateCodeAnalysisPrompt(SHORT_CODE, 'security');
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]!.role).toBe('user');
    expect(msgs[1]!.content).toContain('security');
  });

  it('embeds the code in the user message', () => {
    const msgs = generateCodeAnalysisPrompt('const y = 2;', 'performance');
    expect(msgs[1]!.content).toContain('const y = 2;');
  });

  it('truncates code longer than 5000 chars', () => {
    const msgs = generateCodeAnalysisPrompt(LONG_CODE, 'general');
    expect(msgs[1]!.content).toContain('// ... (truncated)');
  });

  it('preserves code at exactly 5000 chars without truncation', () => {
    const exact = 'c'.repeat(5000);
    const msgs = generateCodeAnalysisPrompt(exact, 'general');
    expect(msgs[1]!.content).not.toContain('truncated');
    expect(msgs[1]!.content).toContain(exact);
  });
});

// ---------------------------------------------------------------------------
// analysis.ts  -- generateProjectSummaryMessages
// ---------------------------------------------------------------------------

describe('generateProjectSummaryMessages', () => {
  const files = [
    { url: 'https://example.com/app.js', size: 1234, type: 'script', content: 'console.log("hi")' },
    {
      url: 'https://example.com/util.js',
      size: 500,
      type: 'script',
      content: 'export function util(){}',
    },
  ];

  it('returns system + user messages', () => {
    const msgs = generateProjectSummaryMessages(files);
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]!.role).toBe('user');
  });

  it('includes file URLs in the user message', () => {
    const msgs = generateProjectSummaryMessages(files);
    expect(msgs[1]!.content).toContain('app.js');
    expect(msgs[1]!.content).toContain('util.js');
  });

  it('truncates file content previews to 200 chars', () => {
    const longContent = 'x'.repeat(500);
    const msgs = generateProjectSummaryMessages([
      { url: 'https://example.com/big.js', size: 9999, type: 'script', content: longContent },
    ]);
    // The preview is at most 200 chars; the full 500-char string should not appear
    expect(msgs[1]!.content).not.toContain(longContent);
    expect(msgs[1]!.content).toContain('x'.repeat(200));
  });

  it('handles empty files array', () => {
    const msgs = generateProjectSummaryMessages([]);
    assertValidMessages(msgs);
  });
});

// ---------------------------------------------------------------------------
// analysis.ts  -- generateFileSummaryMessages
// ---------------------------------------------------------------------------

describe('generateFileSummaryMessages', () => {
  it('returns system + user messages with url and code embedded', () => {
    const msgs = generateFileSummaryMessages('https://example.com/main.js', SHORT_CODE);
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.content).toContain('https://example.com/main.js');
    expect(msgs[1]!.content).toContain(SHORT_CODE);
  });

  it('handles empty code', () => {
    const msgs = generateFileSummaryMessages('test.js', '');
    assertValidMessages(msgs);
    expect(msgs[1]!.content).toContain('test.js');
  });
});

// ---------------------------------------------------------------------------
// deobfuscation.ts  -- generateCodeCleanupMessages
// ---------------------------------------------------------------------------

describe('generateCodeCleanupMessages', () => {
  it('returns system + user with techniques listed', () => {
    const msgs = generateCodeCleanupMessages(SHORT_CODE, ['string-array', 'dead-code']);
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]!.role).toBe('user');
    expect(msgs[1]!.content).toContain('string-array');
    expect(msgs[1]!.content).toContain('dead-code');
  });

  it('truncates code longer than 2000 chars', () => {
    const msgs = generateCodeCleanupMessages('z'.repeat(3000), ['minify']);
    expect(msgs[1]!.content).toContain('...(truncated)');
  });

  it('does not truncate code at exactly 2000 chars', () => {
    const exact = 'q'.repeat(2000);
    const msgs = generateCodeCleanupMessages(exact, []);
    expect(msgs[1]!.content).not.toContain('truncated');
    expect(msgs[1]!.content).toContain(exact);
  });

  it('handles empty techniques array', () => {
    const msgs = generateCodeCleanupMessages(SHORT_CODE, []);
    assertValidMessages(msgs);
  });
});

// ---------------------------------------------------------------------------
// deobfuscation.ts  -- generateVMAnalysisMessages
// ---------------------------------------------------------------------------

describe('generateVMAnalysisMessages', () => {
  it('returns only a user message (no system)', () => {
    const msgs = generateVMAnalysisMessages(SHORT_CODE);
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe('user');
  });

  it('embeds code and truncates at 5000 chars', () => {
    const msgs = generateVMAnalysisMessages(LONG_CODE);
    // substring(0, 5000) is used but no truncation marker is appended
    expect(msgs[0]!.content).toContain('a'.repeat(5000));
    expect(msgs[0]!.content).not.toContain('a'.repeat(5001));
  });

  it('handles special characters', () => {
    const msgs = generateVMAnalysisMessages(SPECIAL_CHARS_CODE);
    expect(msgs[0]!.content).toContain(SPECIAL_CHARS_CODE);
  });
});

// ---------------------------------------------------------------------------
// deobfuscation.ts  -- generateDeobfuscationPrompt
// ---------------------------------------------------------------------------

describe('generateDeobfuscationPrompt', () => {
  it('returns system + user messages', () => {
    const msgs = generateDeobfuscationPrompt(SHORT_CODE);
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]!.role).toBe('user');
  });

  it('truncates code longer than 3000 chars', () => {
    const msgs = generateDeobfuscationPrompt(LONG_CODE);
    expect(msgs[1]!.content).toContain('// ... (truncated)');
  });

  it('does not truncate code at exactly 3000 chars', () => {
    const exact = 'd'.repeat(3000);
    const msgs = generateDeobfuscationPrompt(exact);
    expect(msgs[1]!.content).not.toContain('truncated');
    expect(msgs[1]!.content).toContain(exact);
  });

  it('embeds code in the user message', () => {
    const msgs = generateDeobfuscationPrompt(SHORT_CODE);
    expect(msgs[1]!.content).toContain(SHORT_CODE);
  });
});

// ---------------------------------------------------------------------------
// deobfuscation.ts  -- generateVMDeobfuscationMessages
// ---------------------------------------------------------------------------

describe('generateVMDeobfuscationMessages', () => {
  it('returns system + user messages with the prompt as user content', () => {
    const msgs = generateVMDeobfuscationMessages('Deobfuscate this VM code');
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]!.role).toBe('user');
    expect(msgs[1]!.content).toBe('Deobfuscate this VM code');
  });

  it('passes the user prompt through unchanged', () => {
    const prompt = 'Some very specific instructions with special chars: <>&"\'';
    const msgs = generateVMDeobfuscationMessages(prompt);
    expect(msgs[1]!.content).toBe(prompt);
  });
});

// ---------------------------------------------------------------------------
// deobfuscation.ts  -- generateControlFlowUnflatteningMessages
// ---------------------------------------------------------------------------

describe('generateControlFlowUnflatteningMessages', () => {
  it('returns system + user messages with code embedded', () => {
    const msgs = generateControlFlowUnflatteningMessages(SHORT_CODE);
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]!.role).toBe('user');
    expect(msgs[1]!.content).toContain(SHORT_CODE);
  });

  it('system prompt mentions control flow flattening', () => {
    const msgs = generateControlFlowUnflatteningMessages(SHORT_CODE);
    expect(msgs[0]!.content).toContain('control flow');
  });
});

// ---------------------------------------------------------------------------
// environment.ts  -- generateBrowserEnvAnalysisMessages
// ---------------------------------------------------------------------------

describe('generateBrowserEnvAnalysisMessages', () => {
  const detected = { navigator: ['userAgent', 'platform'] };
  const missing = [{ path: 'window.chrome', type: 'object' }];

  it('returns system + user messages with all inputs embedded', () => {
    const msgs = generateBrowserEnvAnalysisMessages(SHORT_CODE, detected, missing, 'chrome');
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]!.role).toBe('user');
    expect(msgs[1]!.content).toContain('CHROME');
    expect(msgs[1]!.content).toContain('window.chrome');
    expect(msgs[1]!.content).toContain('userAgent');
  });

  it('truncates code longer than 5000 chars', () => {
    const msgs = generateBrowserEnvAnalysisMessages(LONG_CODE, detected, missing, 'firefox');
    expect(msgs[1]!.content).toContain('...(truncated)');
  });

  it('does not truncate code at exactly 5000 chars', () => {
    const exact = 'e'.repeat(5000);
    const msgs = generateBrowserEnvAnalysisMessages(exact, detected, missing, 'chrome');
    expect(msgs[1]!.content).not.toContain('truncated');
    expect(msgs[1]!.content).toContain(exact);
  });
});

// ---------------------------------------------------------------------------
// environment.ts  -- generateAntiCrawlAnalysisMessages
// ---------------------------------------------------------------------------

describe('generateAntiCrawlAnalysisMessages', () => {
  it('returns system + user messages with code embedded', () => {
    const msgs = generateAntiCrawlAnalysisMessages(SHORT_CODE);
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]!.role).toBe('user');
    expect(msgs[1]!.content).toContain(SHORT_CODE);
  });

  it('truncates code after 3000 chars and appends marker', () => {
    const msgs = generateAntiCrawlAnalysisMessages(LONG_CODE);
    expect(msgs[1]!.content).toContain('...(truncated)');
  });

  it('does not add truncation marker for short code', () => {
    const msgs = generateAntiCrawlAnalysisMessages('var x = 1;');
    expect(msgs[1]!.content).not.toContain('truncated');
  });
});

// ---------------------------------------------------------------------------
// environment.ts  -- generateAPIImplementationMessages
// ---------------------------------------------------------------------------

describe('generateAPIImplementationMessages', () => {
  it('returns system + user messages with apiPath and context', () => {
    const msgs = generateAPIImplementationMessages(
      'navigator.getBattery',
      'getBattery().then(b => b.level)',
    );
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.content).toContain('navigator.getBattery');
    expect(msgs[1]!.content).toContain('getBattery().then');
  });

  it('truncates context longer than 1000 chars', () => {
    const longCtx = 'ctx'.repeat(500);
    const msgs = generateAPIImplementationMessages('window.foo', longCtx);
    expect(msgs[1]!.content).toContain('...(truncated)');
  });
});

// ---------------------------------------------------------------------------
// environment.ts  -- generateEnvironmentSuggestionsMessages
// ---------------------------------------------------------------------------

describe('generateEnvironmentSuggestionsMessages', () => {
  it('returns system + user messages with stats', () => {
    const detected = { navigator: ['userAgent'], window: ['innerWidth'] };
    const missing = [{ path: 'navigator.plugins', type: 'array' }];
    const msgs = generateEnvironmentSuggestionsMessages(detected, missing, 'chrome');
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.content).toContain('CHROME');
    expect(msgs[1]!.content).toContain('navigator.plugins');
    expect(msgs[1]!.content).toContain('2 vars detected');
  });

  it('limits missing API display to 20 entries', () => {
    const missing = Array.from({ length: 30 }, (_, i) => ({
      path: `api.path${i}`,
      type: 'function',
    }));
    const msgs = generateEnvironmentSuggestionsMessages({}, missing, 'firefox');
    expect(msgs[1]!.content).toContain('+10 more');
  });

  it('handles empty detected and missing', () => {
    const msgs = generateEnvironmentSuggestionsMessages({}, [], 'safari');
    assertValidMessages(msgs);
    expect(msgs[1]!.content).toContain('0 vars detected');
    expect(msgs[1]!.content).toContain('0 APIs missing');
  });
});

// ---------------------------------------------------------------------------
// environment.ts  -- generateMissingAPIImplementationsMessages
// ---------------------------------------------------------------------------

describe('generateMissingAPIImplementationsMessages', () => {
  it('returns system + user messages with APIs and code context', () => {
    const apis = [{ path: 'window.requestAnimationFrame', type: 'function' }];
    const msgs = generateMissingAPIImplementationsMessages(apis, SHORT_CODE);
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.content).toContain('requestAnimationFrame');
    expect(msgs[1]!.content).toContain(SHORT_CODE);
  });

  it('truncates code context after 1500 chars', () => {
    const apis = [{ path: 'foo', type: 'function' }];
    const msgs = generateMissingAPIImplementationsMessages(apis, LONG_CODE);
    expect(msgs[1]!.content).toContain('...(truncated)');
  });

  it('limits APIs to first 10 entries', () => {
    const apis = Array.from({ length: 20 }, (_, i) => ({ path: `api${i}`, type: 'function' }));
    const msgs = generateMissingAPIImplementationsMessages(apis, SHORT_CODE);
    expect(msgs[1]!.content).toContain('api9');
    expect(msgs[1]!.content).not.toContain('api10');
  });
});

// ---------------------------------------------------------------------------
// environment.ts  -- generateMissingVariablesMessages
// ---------------------------------------------------------------------------

describe('generateMissingVariablesMessages', () => {
  it('returns system + user messages with all parameters embedded', () => {
    const msgs = generateMissingVariablesMessages(
      'chrome',
      ['navigator.userAgent', 'navigator.platform'],
      SHORT_CODE,
      { 'window.innerWidth': 1920 },
    );
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.content).toContain('CHROME');
    expect(msgs[1]!.content).toContain('navigator.userAgent');
    expect(msgs[1]!.content).toContain('1920');
  });

  it('truncates code after 2000 chars', () => {
    const msgs = generateMissingVariablesMessages('firefox', ['a'], LONG_CODE, {});
    expect(msgs[1]!.content).toContain('...(truncated)');
  });
});

// ---------------------------------------------------------------------------
// intelligence.ts  -- generateRequestAnalysisMessages
// ---------------------------------------------------------------------------

describe('generateRequestAnalysisMessages', () => {
  const summary = {
    url: 'https://api.example.com/auth',
    method: 'POST',
    headers: { Authorization: 'Bearer xyz' },
  };

  it('returns system + user messages', () => {
    const msgs = generateRequestAnalysisMessages(summary);
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]!.role).toBe('user');
  });

  it('serialises the request summary into user message', () => {
    const msgs = generateRequestAnalysisMessages(summary);
    expect(msgs[1]!.content).toContain('api.example.com');
    expect(msgs[1]!.content).toContain('Bearer xyz');
  });

  it('handles empty object', () => {
    const msgs = generateRequestAnalysisMessages({});
    assertValidMessages(msgs);
  });
});

// ---------------------------------------------------------------------------
// intelligence.ts  -- generateLogAnalysisMessages
// ---------------------------------------------------------------------------

describe('generateLogAnalysisMessages', () => {
  const logs = [
    { type: 'log', text: 'User logged in', url: 'app.js' },
    { type: 'error', text: 'Token expired', url: 'auth.js' },
  ];

  it('returns system + user messages', () => {
    const msgs = generateLogAnalysisMessages(logs);
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
  });

  it('includes log data in user message', () => {
    const msgs = generateLogAnalysisMessages(logs);
    expect(msgs[1]!.content).toContain('User logged in');
    expect(msgs[1]!.content).toContain('Token expired');
  });

  it('handles empty log array', () => {
    const msgs = generateLogAnalysisMessages([]);
    assertValidMessages(msgs);
  });
});

// ---------------------------------------------------------------------------
// intelligence.ts  -- generateKeywordExpansionMessages
// ---------------------------------------------------------------------------

describe('generateKeywordExpansionMessages', () => {
  it('returns system + user messages with all params', () => {
    const msgs = generateKeywordExpansionMessages(
      'example.com',
      [{ path: '/api/auth', method: 'POST' }],
      ['CryptoJS', 'token'],
    );
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.content).toContain('example.com');
    expect(msgs[1]!.content).toContain('/api/auth');
    expect(msgs[1]!.content).toContain('CryptoJS');
    expect(msgs[1]!.content).toContain('token');
  });

  it('handles empty url patterns and keywords', () => {
    const msgs = generateKeywordExpansionMessages('site.com', [], []);
    assertValidMessages(msgs);
  });
});

// ---------------------------------------------------------------------------
// taint.ts  -- generateTaintAnalysisPrompt
// ---------------------------------------------------------------------------

describe('generateTaintAnalysisPrompt', () => {
  it('returns system + user messages with sources and sinks', () => {
    const msgs = generateTaintAnalysisPrompt(SHORT_CODE, ['document.location'], ['eval']);
    assertValidMessages(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]!.role).toBe('user');
    expect(msgs[1]!.content).toContain('document.location');
    expect(msgs[1]!.content).toContain('eval');
  });

  it('embeds code in the user message', () => {
    const msgs = generateTaintAnalysisPrompt('fetch(url)', ['url'], ['fetch']);
    expect(msgs[1]!.content).toContain('fetch(url)');
  });

  it('truncates code longer than 4000 chars', () => {
    const msgs = generateTaintAnalysisPrompt(LONG_CODE, ['src'], ['sink']);
    expect(msgs[1]!.content).toContain('// ... (truncated)');
  });

  it('does not truncate code at exactly 4000 chars', () => {
    const exact = 'f'.repeat(4000);
    const msgs = generateTaintAnalysisPrompt(exact, [], []);
    expect(msgs[1]!.content).not.toContain('truncated');
    expect(msgs[1]!.content).toContain(exact);
  });

  it('handles empty sources and sinks', () => {
    const msgs = generateTaintAnalysisPrompt(SHORT_CODE, [], []);
    assertValidMessages(msgs);
  });
});
