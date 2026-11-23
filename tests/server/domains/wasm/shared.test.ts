/**
 * Regression tests for the wasm sub-handler shared utilities:
 *
 * 1. `validateOutputPath` must reject anything outside the project root /
 *    temp directory — including paths that resolve through a symlink planted
 *    inside a root but pointing outside it (the old `startsWith` check passed
 *    those), and parent-directory segments (previously relied on `resolve()`
 *    alone). It delegates to the shared symlink-aware `resolveSafeOutputPath`.
 * 2. `isRecord` must NOT admit arrays — an array misclassified as a record
 *    made `hasErrorResult([])` false and treated array payloads as success
 *    downstream.
 */
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { hasErrorResult, isRecord, validateOutputPath } from '@server/domains/wasm/handlers/shared';

describe('wasm shared — validateOutputPath', () => {
  it('rejects paths outside the project root and temp directory', async () => {
    await expect(validateOutputPath('/etc/passwd')).rejects.toThrow('Path traversal blocked');
  });

  it('rejects an absolute path outside every allowed root', async () => {
    const outside = join(homedir(), '.jshook-not-allowed', 'passwd');
    await expect(validateOutputPath(outside)).rejects.toThrow('Path traversal blocked');
  });

  it('rejects an empty output path', async () => {
    await expect(validateOutputPath('')).rejects.toThrow('Path traversal blocked');
  });

  it('accepts a path under the project root', async () => {
    const p = join(process.cwd(), 'test-output.wasm');
    await expect(validateOutputPath(p)).resolves.toBe(p);
  });

  it('accepts a path under the temp directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jshookmcp-shared-'));
    try {
      const p = join(dir, 'out.wasm');
      await expect(validateOutputPath(p)).resolves.toBe(p);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a path that resolves through a symlink escaping the roots', async () => {
    // Junction on win32 needs no privileges; 'dir' type elsewhere.
    const root = await mkdtemp(join(tmpdir(), 'jshookmcp-link-'));
    const escapeTarget =
      process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'Temp') : '/etc';
    try {
      const link = join(root, 'escape');
      try {
        await symlink(escapeTarget, link, process.platform === 'win32' ? 'junction' : 'dir');
      } catch {
        return; // symlinks unsupported in this environment — skip
      }
      // The string-level check passes (link is under tmpdir), but the real
      // path resolves outside both roots → must be rejected.
      await expect(validateOutputPath(join(link, 'pwn.wasm'))).rejects.toThrow(
        'Path traversal blocked',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('wasm shared — isRecord / hasErrorResult', () => {
  it('classifies arrays as non-record', () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
    expect(isRecord({})).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });

  it('classifies error results only when the value is a record with a string error', () => {
    expect(hasErrorResult({ error: 'boom' })).toBe(true);
    // Arrays must never be treated as error results (nor as success records).
    expect(hasErrorResult([])).toBe(false);
    expect(hasErrorResult([{ error: 'nested' }])).toBe(false);
    expect(hasErrorResult({ error: 42 })).toBe(false);
    expect(hasErrorResult({ exports: ['f'] })).toBe(false);
  });
});
