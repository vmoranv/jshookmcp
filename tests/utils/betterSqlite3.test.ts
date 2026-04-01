import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  isBetterSqlite3RelatedError,
  classifyBetterSqlite3Issue,
  formatBetterSqlite3Error,
} from '@utils/betterSqlite3';

describe('betterSqlite3 utilities', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('identifies better-sqlite3 related errors', () => {
    expect(isBetterSqlite3RelatedError(new Error('Cannot find module "better-sqlite3"'))).toBe(
      true,
    );
    expect(isBetterSqlite3RelatedError(new Error('NODE_MODULE_VERSION mismatch'))).toBe(true);
    expect(isBetterSqlite3RelatedError(new Error('Random unrelated error'))).toBe(false);
    expect(isBetterSqlite3RelatedError('String error better_sqlite3.node')).toBe(true);
  });

  it('classifies sqlite3 issues correctly', () => {
    expect(
      classifyBetterSqlite3Issue(
        new Error('better-sqlite3 module was compiled against a different Node.js version'),
      ),
    ).toBe('abi-mismatch');
    expect(
      classifyBetterSqlite3Issue(new Error('better-sqlite3 Random initialization failed')),
    ).toBe('load-failed');
  });

  it('formats errors gracefully mapped to hints', () => {
    const missing = formatBetterSqlite3Error(new Error("Cannot find package 'better-sqlite3'"));
    expect(missing).toContain('is not installed');
    expect(missing).toContain('pnpm add');

    const abi = formatBetterSqlite3Error(
      new Error('better-sqlite3 compiled against a different Node.js version'),
    );
    expect(abi).toContain('ABI');
    expect(abi).toContain('npm rebuild better');

    const load = formatBetterSqlite3Error(new Error('better-sqlite3 Segment fault'));
    expect(load).toContain('failed to initialize');
    expect(load).toContain('Segment fault');
  });
});
