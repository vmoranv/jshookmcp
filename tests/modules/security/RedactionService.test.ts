import { describe, expect, it } from 'vitest';
import {
  redactSensitiveData,
  redactSensitiveString,
  sensitiveJsonReplacer,
} from '@modules/security/RedactionService';

describe('RedactionService', () => {
  it('redacts sensitive keys recursively', () => {
    const value = redactSensitiveData({
      token: 'plain-token-value',
      nested: {
        password: 'secret-password',
        safe: 'visible',
      },
    });

    expect(value).toEqual({
      token: '[REDACTED]',
      nested: {
        password: '[REDACTED]',
        safe: 'visible',
      },
    });
  });

  it('redacts secret-like substrings while preserving surrounding text', () => {
    const redacted = redactSensitiveString(
      'headers Authorization: Bearer very-secret-token and key sk_123456789012345678901',
    );

    expect(redacted).toContain('headers Authorization:');
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).not.toContain('very-secret-token');
    expect(redacted).not.toContain('sk_123456789012345678901');
  });

  it('works as a JSON.stringify replacer', () => {
    const serialized = JSON.stringify(
      [{ access_token: 'plain-token-value', value: 'safe' }],
      sensitiveJsonReplacer,
    );

    expect(serialized).toContain('[REDACTED]');
    expect(serialized).toContain('safe');
    expect(serialized).not.toContain('plain-token-value');
  });
});
