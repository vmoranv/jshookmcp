import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as parser from '@babel/parser';

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@src/utils/browserExecutable', () => ({
  findBrowserExecutable: vi.fn(() => undefined),
}));

const puppeteerState = vi.hoisted(() => ({
  launch: vi.fn(),
}));

vi.mock('rebrowser-puppeteer-core', () => ({
  default: {
    launch: puppeteerState.launch,
  },
  launch: puppeteerState.launch,
}));

import { EnvironmentEmulator } from '@modules/emulator/EnvironmentEmulator';

describe('EnvironmentEmulator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('analyzes code and builds manifest from template without autoFetch', async () => {
    const emulator = new EnvironmentEmulator();
    const result = await emulator.analyze({
      code: 'window.innerWidth; navigator.userAgent;',
      autoFetch: false,
      targetRuntime: 'nodejs',
      includeComments: false,
    });

    expect(result.detectedVariables.window).toContain('window.innerWidth');
    expect(result.detectedVariables.navigator).toContain('navigator.userAgent');
    expect(result.variableManifest['window.innerWidth']).toBe(1920);
    expect(result.missingAPIs).toHaveLength(0);
    expect(result.emulationCode.nodejs).toContain('window.innerWidth');
  });

  it('falls back to regex detection when parser throws', async () => {
    const parseSpy = vi.spyOn(parser, 'parse').mockImplementation(() => {
      throw new Error('parse-failed');
    });
    const emulator = new EnvironmentEmulator();
    const result = await emulator.analyze({
      code: 'document.title; window.outerWidth;',
      autoFetch: false,
      includeComments: false,
    });

    expect(result.detectedVariables.document).toContain('document.title');
    expect(result.detectedVariables.window).toContain('window.outerWidth');
    parseSpy.mockRestore();
  });

  it('ignores legacy dependencies and leaves unknown variables unresolved', async () => {
    const legacy = {
      chat: vi.fn().mockResolvedValue({
        content: '{"window.customThing":"hello","window.missingFn":"function() { return 1; }"}',
      }),
    };
    const emulator = new EnvironmentEmulator(legacy as any);

    const result = await emulator.analyze({
      code: 'window.customThing; window.missingFn;',
      autoFetch: false,
      includeComments: false,
    });

    expect(legacy.chat).not.toHaveBeenCalled();
    expect(result.variableManifest['window.customThing']).toBeUndefined();
    expect(result.variableManifest['window.missingFn']).toBeUndefined();
    expect(result.missingAPIs.some((api) => api.path === 'window.customThing')).toBe(true);
    expect(result.missingAPIs.some((api) => api.path === 'window.missingFn')).toBe(true);
  });

  it('cleanup closes browser instance and clears internal reference', async () => {
    const emulator = new EnvironmentEmulator() as any;
    const close = vi.fn().mockResolvedValue(undefined);
    emulator.browser = { close };

    await emulator.cleanup();

    expect(close).toHaveBeenCalledOnce();
    expect(emulator.browser).toBeUndefined();
  });

  it('throws when configured executable path does not exist', () => {
    const emulator = new EnvironmentEmulator() as any;
    const old = process.env.CHROME_PATH;
    process.env.CHROME_PATH = '/definitely/not/exist/browser-bin';

    expect(() => emulator.resolveExecutablePath()).toThrow(
      'Configured browser executable was not found',
    );

    process.env.CHROME_PATH = old;
  });
});
