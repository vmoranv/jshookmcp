import { beforeEach, describe, expect, it, vi } from 'vitest';

const findBrowserExecutableMock = vi.hoisted(() => vi.fn(() => undefined));
const fetchRealEnvironmentDataMock = vi.hoisted(() => vi.fn());

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@src/utils/browserExecutable', () => ({
  findBrowserExecutable: findBrowserExecutableMock,
}));

vi.mock('@modules/emulator/EnvironmentEmulatorFetch', () => ({
  fetchRealEnvironmentData: fetchRealEnvironmentDataMock,
}));

import { EnvironmentEmulator } from '@modules/emulator/EnvironmentEmulator';

describe('EnvironmentEmulator helper coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findBrowserExecutableMock.mockReturnValue(undefined);
  });

  it('covers helper guards and template lookup fallbacks', () => {
    const emulator = new EnvironmentEmulator() as any;

    expect(emulator.isRecord(null)).toBe(false);
    expect(emulator.isRecord('text')).toBe(false);
    expect(emulator.isRecord({ value: 1 })).toBe(true);

    expect(emulator.isIdentifierNode({ type: 'Identifier', name: 'window' })).toBe(true);
    expect(emulator.isIdentifierNode({ type: 'Identifier', name: 1 })).toBe(false);
    expect(emulator.isStringLiteralNode({ type: 'StringLiteral', value: 'href' })).toBe(true);
    expect(emulator.isStringLiteralNode({ type: 'StringLiteral', value: 12 })).toBe(false);
    expect(
      emulator.isMemberExpressionNode({
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'window' },
        property: { type: 'Identifier', name: 'location' },
      }),
    ).toBe(true);
    expect(emulator.isMemberExpressionNode({ type: 'MemberExpression', object: {} })).toBe(false);

    expect(emulator.getMemberExpressionPath({ type: 'Identifier', name: 'window' })).toBe('window');
    expect(
      emulator.getMemberExpressionPath({
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'customRoot' },
        property: { type: 'Identifier', name: 'x' },
      }),
    ).toBeNull();
    expect(emulator.getValueFromTemplate('window.innerWidth', null)).toBeUndefined();
    expect(emulator.getValueFromTemplate('window.missing.branch', { window: {} })).toBeUndefined();
  });

  it('classifies missing api suggestions through the private classifier', () => {
    const emulator = new EnvironmentEmulator() as any;
    const missing = emulator.identifyMissingAPIs(
      {
        window: ['window.customValue', 'window.customFunc()'],
        document: ['document.customElement', 'document.customList'],
        navigator: [],
        location: [],
        screen: [],
        other: [],
      },
      { 'window.customValue': undefined },
    );

    expect(missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'window.customValue',
          type: 'property',
          suggestion: 'null: window.customValue = null',
        }),
        expect.objectContaining({
          path: 'window.customFunc()',
          type: 'function',
          suggestion: ': window.customFunc() = function() {}',
        }),
        expect.objectContaining({
          path: 'document.customElement',
          type: 'object',
          suggestion: ': document.customElement = {}',
        }),
        expect.objectContaining({
          path: 'document.customList',
          type: 'object',
          suggestion: ': document.customList = {}',
        }),
      ]),
    );
  });

  it('keeps the existing browser when fetchRealEnvironment returns only manifest data', async () => {
    const emulator = new EnvironmentEmulator() as any;
    const existingBrowser = { close: vi.fn().mockResolvedValue(undefined) };
    emulator.browser = existingBrowser;
    fetchRealEnvironmentDataMock.mockResolvedValue({
      manifest: { 'window.innerWidth': 1440 },
      browser: undefined,
    });

    const manifest = await emulator.fetchRealEnvironment(
      'https://target.test',
      {
        window: ['window.innerWidth'],
        document: [],
        navigator: [],
        location: [],
        screen: [],
        other: [],
      },
      2,
    );

    expect(manifest).toEqual({ 'window.innerWidth': 1440 });
    expect(fetchRealEnvironmentDataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        browser: existingBrowser,
        url: 'https://target.test',
        depth: 2,
      }),
    );
    expect(emulator.browser).toBe(existingBrowser);
  });
});
