import { describe, expect, it } from 'vitest';
import { resolveCliFastPath } from '@utils/cliFastPath';

describe('resolveCliFastPath', () => {
  const moduleUrl = new URL('../../src/index.ts', import.meta.url).href;

  it('returns help text for --help', () => {
    const result = resolveCliFastPath(['--help'], moduleUrl);

    expect(result.handled).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Usage:');
    expect(result.output).toContain('jshook [--help] [--version]');
  });

  it('returns help text for subcommand-style help', () => {
    const result = resolveCliFastPath(['debug', '--help'], moduleUrl);

    expect(result.handled).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('@jshookmcp/jshook');
  });

  it('returns version text for --version', () => {
    const result = resolveCliFastPath(['--version'], moduleUrl);

    expect(result.handled).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output?.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('does not intercept normal startup args', () => {
    const result = resolveCliFastPath([], moduleUrl);

    expect(result.handled).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.output).toBeUndefined();
  });

  it('fallback version if file cannot be read and no env var', () => {
    const original = process.env.npm_package_version;
    delete process.env.npm_package_version;
    const result = resolveCliFastPath(['--version'], 'file:///nonexistent/foo.js');
    expect(result.output?.trim()).toBe('0.0.0');
    process.env.npm_package_version = original;
  });
});
