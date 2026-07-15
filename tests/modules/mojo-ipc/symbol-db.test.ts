import { describe, it, expect } from 'vitest';
import { runInNewContext } from 'node:vm';
import {
  buildVerifyLiveScript,
  getKnownSymbols,
  formatProbeEntry,
} from '@modules/mojo-ipc/symbol-db';

describe('getKnownSymbols', () => {
  it('returns symbols for win32', () => {
    const symbols = getKnownSymbols('win32');
    expect(symbols.length).toBeGreaterThan(0);
    // Should include chrome.dll entries
    const chromeDll = symbols.filter((s) => s.module === 'chrome.dll');
    expect(chromeDll.length).toBeGreaterThan(0);
  });

  it('returns symbols for linux', () => {
    const symbols = getKnownSymbols('linux');
    expect(symbols.length).toBeGreaterThan(0);
    const chromeLinux = symbols.filter(
      (s) => s.module === 'chrome' || s.module === 'libcontent.so',
    );
    expect(chromeLinux.length).toBeGreaterThan(0);
  });

  it('returns symbols for darwin', () => {
    const symbols = getKnownSymbols('darwin');
    expect(symbols.length).toBeGreaterThan(0);
    const framework = symbols.filter((s) => s.module === 'Chromium Framework');
    expect(framework.length).toBeGreaterThan(0);
  });

  it('filters by version', () => {
    const oldSymbols = getKnownSymbols('win32', 100);
    const newSymbols = getKnownSymbols('win32', 130);
    // M100 should include MojoWriteMessage, M130 should include MojoWriteMessageNew
    const oldHasWrite = oldSymbols.some((s) => s.symbol === 'MojoWriteMessage');
    const newHasWriteNew = newSymbols.some((s) => s.symbol === 'MojoWriteMessageNew');
    expect(oldHasWrite).toBe(true);
    expect(newHasWriteNew).toBe(true);
  });
});

describe('buildVerifyLiveScript', () => {
  it('generates a valid Frida script for Windows', () => {
    const result = buildVerifyLiveScript({
      platform: 'win32',
      chromiumVersion: 120,
      channel: 'stable',
    });

    expect(result.fridaScript).toBeTruthy();
    expect(result.fridaScript).toContain("'use strict'");
    expect(result.fridaScript).toContain('MojoWriteMessage');
    expect(result.runCommand).toContain('frida');
    expect(result.probedSymbols.length).toBeGreaterThan(0);
    expect(result.verified).toBe(false);
    expect(result.note).toBeTruthy();
  });

  it('generates a script for Linux', () => {
    const result = buildVerifyLiveScript({
      platform: 'linux',
      chromiumVersion: 125,
    });

    expect(result.fridaScript).toContain('linux');
    expect(result.fridaScript).toContain('MojoWriteMessageNew');
  });

  it('generates a script for macOS', () => {
    const result = buildVerifyLiveScript({
      platform: 'darwin',
      targetProcess: 'Google Chrome',
    });

    expect(result.fridaScript).toContain('darwin');
    expect(result.fridaScript).toContain('_MojoWriteMessage');
    expect(result.runCommand).toContain('Google Chrome');
  });

  it('includes wildcard fallback entries in the script', () => {
    const result = buildVerifyLiveScript({
      platform: 'win32',
    });

    // Wildcard entries are in the generated script even though probedSymbols is deduplicated
    expect(result.fridaScript).toContain('module: "*"');
  });

  it('all fields are populated', () => {
    const result = buildVerifyLiveScript({
      platform: 'linux',
      chromiumVersion: 115,
    });

    expect(result.fridaScript.length).toBeGreaterThan(100);
    expect(result.runCommand.length).toBeGreaterThan(0);
    expect(result.probedSymbols.length).toBeGreaterThan(0);
    expect(result.moduleCount).toBeGreaterThan(0);
    expect(result.verified).toBe(false);
    expect(result.note).toContain('B-class');
  });

  it('deduplicates specific-module entries by symbol name', () => {
    const result = buildVerifyLiveScript({
      platform: 'win32',
      chromiumVersion: 120,
    });

    // Non-wildcard entries should have unique symbols
    const nonWildcard = result.probedSymbols.filter((s) => s.module !== '*');
    const symbols = nonWildcard.map((s) => s.symbol);
    const uniqueSymbols = new Set(symbols);
    expect(symbols.length).toBe(uniqueSymbols.size);
  });
});

describe('formatProbeEntry', () => {
  const base = { symbol: 'MojoWriteMessage', module: 'chrome.dll', versionMin: 100, notes: '' };

  it('round-trips a plain entry through JS evaluation', () => {
    const literal = formatProbeEntry({ ...base, notes: 'x64-only' });
    const parsed = runInNewContext(`(${literal})`) as typeof base;
    expect(parsed).toEqual({ ...base, notes: 'x64-only' });
  });

  it('fully escapes backslashes, quotes, newlines and tabs in notes (alert 88)', () => {
    const notes = 'C:\\path\\\'x"line\none\ttwo';
    const literal = formatProbeEntry({ ...base, notes });
    const parsed = runInNewContext(`(${literal})`) as { notes: string };
    expect(parsed.notes).toBe(notes);
    // No raw newline leaks into the generated Frida script body
    expect(literal).not.toContain('\n');
  });

  it('escapes quotes in symbol/module and defaults missing notes + versionMin', () => {
    const literal = formatProbeEntry({
      symbol: "sy'm",
      module: 'mo"d',
      versionMin: undefined,
      notes: undefined,
    });
    const parsed = runInNewContext(`(${literal})`) as {
      symbol: string;
      module: string;
      notes: string;
      versionMin: number;
    };
    expect(parsed.symbol).toBe("sy'm");
    expect(parsed.module).toBe('mo"d');
    expect(parsed.notes).toBe('');
    expect(parsed.versionMin).toBe(0);
  });

  it('emits JSON double-quoted string literals (no raw single-quote escape hack)', () => {
    const literal = formatProbeEntry({ ...base, notes: "it's fine" });
    expect(literal).toContain('notes: "it\'s fine"');
    expect(literal).not.toContain("notes: '");
  });
});
