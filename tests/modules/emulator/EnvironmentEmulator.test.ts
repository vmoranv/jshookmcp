import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as parser from '@babel/parser';

const promptState = vi.hoisted(() => ({
  generateMissingAPIImplementationsMessages: vi.fn(() => [{ role: 'user', content: 'api' }]),
  generateMissingVariablesMessages: vi.fn(() => [{ role: 'user', content: 'vars' }]),
}));

vi.mock('../../../src/services/prompts/environment.js', () => ({
  generateMissingAPIImplementationsMessages: promptState.generateMissingAPIImplementationsMessages,
  generateMissingVariablesMessages: promptState.generateMissingVariablesMessages,
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../src/utils/browserExecutable.js', () => ({
  findBrowserExecutable: vi.fn(() => undefined),
}));

const puppeteerState = vi.hoisted(() => ({
  launch: vi.fn(),
}));

vi.mock('rebrowser-puppeteer-core', () => ({
  default: {
    launch: puppeteerState.launch,
  },
}));

import { EnvironmentEmulator } from '../../../src/modules/emulator/EnvironmentEmulator.js';

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

  it('applies AI-inferred variables into manifest', async () => {
    const llm = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          content: '```json\n{"window.customThing":"hello"}\n```',
        }),
    };
    const emulator = new EnvironmentEmulator(llm as any);

    const result = await emulator.analyze({
      code: 'window.customThing;',
      autoFetch: false,
      includeComments: false,
    });

    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(result.variableManifest['window.customThing']).toBe('hello');
    expect(result.missingAPIs).toHaveLength(0);
  });

  it('uses AI API implementation generation for missing APIs', async () => {
    const llm = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({ content: '```json\n{}\n```' }) // inferMissingVariablesWithAI
        .mockResolvedValueOnce({
          content: '```json\n{"window.missingFn":"function() { return 1; }"}\n```',
        }),
    };
    const emulator = new EnvironmentEmulator(llm as any);

    const result = await emulator.analyze({
      code: 'window.missingFn;',
      autoFetch: false,
      includeComments: false,
    });

    expect(llm.chat).toHaveBeenCalledTimes(2);
    expect(result.missingAPIs.length).toBeGreaterThan(0);
    expect(result.variableManifest['window.missingFn']).toContain('function()');
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
    process.env.CHROME_PATH = '/definitely/not/exist/chrome';

    expect(() => emulator.resolveExecutablePath()).toThrow('Configured browser executable was not found');

    process.env.CHROME_PATH = old;
  });
});

