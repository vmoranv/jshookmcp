import { beforeEach, describe, expect, it } from 'vitest';
import {
  compareVersion,
  isCompatibleVersion,
  parseVersionParts,
} from '@server/extensions/ExtensionManager.version';

describe('ExtensionManager.version', () => {
  beforeEach(() => {
    // Keep test structure aligned with the repository pattern.
  });

  it('parses normal and metadata versions', () => {
    expect(parseVersionParts('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersionParts('1.2.3-beta+build')).toEqual([1, 2, 3]);
  });

  it('rejects invalid version strings', () => {
    expect(parseVersionParts('1.2')).toBeNull();
    expect(parseVersionParts('v1.2.3')).toBeNull();
    expect(parseVersionParts('')).toBeNull();
  });

  it('compares versions correctly', () => {
    expect(compareVersion('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersion('1.3.0', '1.2.9')).toBe(1);
    expect(compareVersion('1.2.3', '1.3.0')).toBe(-1); // tests aMinor < bMinor
    expect(compareVersion('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersion('1.9.9', '2.0.0')).toBe(-1); // tests aMajor < bMajor
    expect(compareVersion('1.2.2', '1.2.3')).toBe(-1);
    expect(compareVersion('bad', '1.2.3')).toBeNull();
  });

  it('supports wildcard, exact, and >= ranges', () => {
    expect(isCompatibleVersion('*', '9.9.9')).toBe(true);
    expect(isCompatibleVersion('', '9.9.9')).toBe(true);
    expect(isCompatibleVersion('1.2.3', '1.2.3')).toBe(true);
    expect(isCompatibleVersion('>=1.2.3', '1.2.4')).toBe(true);
    expect(isCompatibleVersion('>=1.2.3', '1.2.2')).toBe(false);
  });

  it('supports caret and tilde ranges', () => {
    expect(isCompatibleVersion('^1.2.3', '1.9.0')).toBe(true);
    expect(isCompatibleVersion('^1.2.3', '2.0.0')).toBe(false);
    expect(isCompatibleVersion('~1.2.3', '1.2.9')).toBe(true);
    expect(isCompatibleVersion('~1.2.3', '1.3.0')).toBe(false);
    expect(isCompatibleVersion('^bad', '1.2.3')).toBe(false);
    expect(isCompatibleVersion('~bad', '1.2.3')).toBe(false);
    expect(isCompatibleVersion('~1.2.3', 'bad')).toBe(false);
  });
});
