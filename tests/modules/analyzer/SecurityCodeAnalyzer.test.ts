import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as parser from '@babel/parser';
import * as t from '@babel/types';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

import {
  checkSanitizer,
  getMemberExpressionName,
  identifySecurityRisks,
} from '../../../src/modules/analyzer/SecurityCodeAnalyzer.js';

describe('SecurityCodeAnalyzer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
  });

  it('builds full member-expression name', () => {
    const expr = parser.parseExpression('window.security.escapeHtml') as t.MemberExpression;
    const name = getMemberExpressionName(expr);

    expect(name).toBe('window.security.escapeHtml');
  });

  it('checks sanitizers for identifier and member-expression calls', () => {
    const idCall = parser.parseExpression('sanitize(input)') as t.CallExpression;
    const memberCall = parser.parseExpression('DOMPurify.sanitize(input)') as t.CallExpression;
    const sanitizers = new Set(['sanitize', 'DOMPurify.sanitize']);

    expect(checkSanitizer(idCall, sanitizers)).toBe(true);
    expect(checkSanitizer(memberCall, sanitizers)).toBe(true);
  });

  it('merges AI-reported risks into final result', () => {
    const risks = identifySecurityRisks('const a = 1;', {
      securityRisks: [
        {
          type: 'xss',
          severity: 'high',
          location: { line: 8 },
          description: 'ai',
          recommendation: 'fix',
        },
      ],
    });

    expect(risks.some((r) => r.type === 'xss' && r.location.line === 8)).toBe(true);
  });

  it('detects key static vulnerabilities from source', () => {
    const code = `
      element.innerHTML = userInput;
      eval(payload);
      db.query("SELECT * FROM users WHERE id=" + userId);
      const apiKey = "1234567890abcdef";
      const n = Math.random();
    `;
    const risks = identifySecurityRisks(code, {});

    expect(risks.some((r) => r.type === 'xss')).toBe(true);
    expect(risks.some((r) => r.type === 'sql-injection')).toBe(true);
    expect(risks.some((r) => r.description.includes('eval'))).toBe(true);
    expect(risks.some((r) => r.description.includes('Hardcoded'))).toBe(true);
    expect(risks.some((r) => r.description.includes('Math.random'))).toBe(true);
  });

  it('deduplicates same type+line risks from AI and static analysis', () => {
    const code = 'x.innerHTML = input;';
    const risks = identifySecurityRisks(code, {
      securityRisks: [
        {
          type: 'xss',
          severity: 'high',
          location: { line: 1 },
          description: 'duplicate',
          recommendation: 'dup',
        },
      ],
    });

    const xssLine1 = risks.filter((r) => r.type === 'xss' && r.location.line === 1);
    expect(xssLine1).toHaveLength(1);
  });

  it('keeps AI risks even when static parse fails', () => {
    const risks = identifySecurityRisks('function bad( {', {
      securityRisks: [{ type: 'other', severity: 'low', location: { line: 99 } }],
    });

    expect(risks.some((r) => r.location.line === 99)).toBe(true);
    expect(loggerState.warn).toHaveBeenCalled();
  });
});

