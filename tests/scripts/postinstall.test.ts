import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { shouldSkipPostinstall, isNpxTempDir } = require('../../scripts/dev/postinstall.cjs') as {
  shouldSkipPostinstall: (
    env: Record<string, string | undefined>,
    cwd: string,
    isDevRepo: boolean,
  ) => boolean;
  isNpxTempDir: (cwd: string) => boolean;
};

const EMPTY_ENV: Record<string, string | undefined> = {};

describe('postinstall shouldSkipPostinstall', () => {
  it('skips in CI', () => {
    expect(shouldSkipPostinstall({ CI: 'true' }, '/repo', true)).toBe(true);
    expect(shouldSkipPostinstall({ GITHUB_ACTIONS: 'true' }, '/repo', true)).toBe(true);
  });

  it('does not skip when CI env vars are present but not "true"', () => {
    expect(shouldSkipPostinstall({ CI: 'false' }, '/repo', true)).toBe(false);
  });

  it('skips on global installs', () => {
    expect(shouldSkipPostinstall({ npm_config_global: 'true' }, '/repo', true)).toBe(true);
  });

  it('skips inside an npx extraction directory even when it looks like a dev repo', () => {
    const cwd = path.join('home', '.npm', '_npx', 'abc123', 'node_modules', '@jshookmcp', 'jshook');
    expect(shouldSkipPostinstall(EMPTY_ENV, cwd, true)).toBe(true);
  });

  it('skips when not a dev repo (published package install)', () => {
    const cwd = path.join('somewhere', 'node_modules', '@jshookmcp', 'jshook');
    expect(shouldSkipPostinstall(EMPTY_ENV, cwd, false)).toBe(true);
  });

  it('does not skip in a dev repo with no special env', () => {
    expect(shouldSkipPostinstall(EMPTY_ENV, '/repo', true)).toBe(false);
  });
});

describe('postinstall isNpxTempDir', () => {
  it('detects _npx as a path segment', () => {
    const cwd = path.join('root', '.npm', '_npx', 'abc', 'node_modules', 'pkg');
    expect(isNpxTempDir(cwd)).toBe(true);
  });

  it('ignores _npx-like substrings within a single segment', () => {
    expect(isNpxTempDir(path.join('home', 'user', '_npx_backup'))).toBe(false);
  });

  it('returns false for ordinary paths', () => {
    expect(isNpxTempDir('/repo')).toBe(false);
    expect(isNpxTempDir(path.join('home', 'user', 'project'))).toBe(false);
  });
});
