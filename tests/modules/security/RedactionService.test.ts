import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { RedactionService } from '../../../src/modules/security/RedactionService.js';

describe('RedactionService', () => {
  const envBackup = process.env.JSHHOOK_REDACTION_LEVEL;

  afterEach(() => {
    process.env.JSHHOOK_REDACTION_LEVEL = envBackup;
  });

  it('redacts bearer/jwt/api keys in standard mode', () => {
    const service = new RedactionService('standard');
    const input =
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz ' +
      'jwt eyJ1234567890abc.DEF1234567890ghi.JKL1234567890mno ' +
      'sk-123456789012345678901234567890';

    const out = service.redactString(input);
    expect(out).toContain('Bearer [REDACTED]');
    expect(out).toContain('[REDACTED_JWT]');
    expect(out).toContain('[REDACTED_API_KEY]');
  });

  it('strict mode additionally redacts emails and filesystem paths', () => {
    const service = new RedactionService('strict');
    const input = 'mail me at user@example.com path C:\\Users\\alice\\secret.txt /home/bob/key.pem';

    const out = service.redactString(input);
    expect(out).toContain('[REDACTED_EMAIL]');
    expect(out).toContain('[REDACTED_PATH]');
  });

  it('none mode leaves content and object references unchanged', () => {
    const service = new RedactionService('none');
    const obj = { token: 'Bearer secret', nested: { email: 'a@b.com' } };

    expect(service.redactString('Bearer abc')).toBe('Bearer abc');
    expect(service.redactObject(obj)).toBe(obj);
  });

  it('redactObject returns original object when serialization fails', () => {
    const service = new RedactionService('standard');
    const circular: any = { token: 'Bearer abc' };
    circular.self = circular;

    const result = service.redactObject(circular);
    expect(result).toBe(circular);
  });

  it('setLevel updates active pattern stats', () => {
    const service = new RedactionService('standard');
    const standardStats = service.getStats();
    service.setLevel('strict');
    const strictStats = service.getStats();

    expect(service.getLevel()).toBe('strict');
    expect(strictStats.activePatterns).toBeGreaterThan(standardStats.activePatterns);
    expect(strictStats.patternNames).toContain('email');
  });
});

