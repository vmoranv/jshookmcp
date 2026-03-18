import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockBuildHookCode = vi.hoisted(() =>
  vi.fn(
    (name: string, _body: string, cs: boolean, lc: boolean) => `[mock:${name}:cs=${cs}:lc=${lc}]`
  )
);

vi.mock('@server/domains/hooks/preset-builder', () => ({
  buildHookCode: mockBuildHookCode,
}));

import { CORE_PRESETS } from '@server/domains/hooks/preset-definitions.core';

const EXPECTED_CORE_IDS = [
  'eval',
  'function-constructor',
  'atob-btoa',
  'crypto-subtle',
  'json-stringify',
  'object-defineproperty',
  'settimeout',
  'setinterval',
  'addeventlistener',
  'postmessage',
  'webassembly',
  'proxy',
  'reflect',
  'history-pushstate',
  'location-href',
  'navigator-useragent',
  'eventsource',
  'window-open',
  'mutationobserver',
  'formdata',
];

describe('CORE_PRESETS', () => {
  beforeEach(() => {
    mockBuildHookCode.mockClear();
  });

  it('exports a Record<string, PresetEntry>', () => {
    expect(CORE_PRESETS).toBeDefined();
    expect(typeof CORE_PRESETS).toBe('object');
    expect(CORE_PRESETS).not.toBeNull();
  });

  it('contains all expected preset IDs', () => {
    const ids = Object.keys(CORE_PRESETS);
    for (const expectedId of EXPECTED_CORE_IDS) {
      expect(ids).toContain(expectedId);
    }
  });

  it('does not contain unexpected extra entries beyond the known set', () => {
    const ids = Object.keys(CORE_PRESETS);
    for (const id of ids) {
      expect(EXPECTED_CORE_IDS).toContain(id);
    }
  });

  it('has unique preset IDs (no duplicates in object keys)', () => {
    const ids = Object.keys(CORE_PRESETS);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  describe('entry structure', () => {
    it.each(EXPECTED_CORE_IDS)('"%s" has a description string', (id) => {
      const entry = CORE_PRESETS[id];
      expect(entry).toBeDefined();
      expect(typeof entry!.description).toBe('string');
      expect(entry!.description.length).toBeGreaterThan(0);
    });

    it.each(EXPECTED_CORE_IDS)('"%s" has a buildCode function', (id) => {
      const entry = CORE_PRESETS[id];
      expect(entry).toBeDefined();
      expect(typeof entry!.buildCode).toBe('function');
    });
  });

  describe('buildCode delegation to buildHookCode', () => {
    it('eval preset calls buildHookCode with name "eval"', () => {
      const result = CORE_PRESETS['eval']!.buildCode(true, false);
      expect(mockBuildHookCode).toHaveBeenCalledWith('eval', expect.any(String), true, false);
      expect(result).toBe('[mock:eval:cs=true:lc=false]');
    });

    it('function-constructor preset calls buildHookCode correctly', () => {
      const result = CORE_PRESETS['function-constructor']!.buildCode(false, true);
      expect(mockBuildHookCode).toHaveBeenCalledWith(
        'function-constructor',
        expect.any(String),
        false,
        true
      );
      expect(result).toBe('[mock:function-constructor:cs=false:lc=true]');
    });

    it('atob-btoa preset calls buildHookCode correctly', () => {
      CORE_PRESETS['atob-btoa']!.buildCode(true, true);
      expect(mockBuildHookCode).toHaveBeenCalledWith('atob-btoa', expect.any(String), true, true);
    });

    it('crypto-subtle preset calls buildHookCode correctly', () => {
      CORE_PRESETS['crypto-subtle']!.buildCode(false, false);
      expect(mockBuildHookCode).toHaveBeenCalledWith(
        'crypto-subtle',
        expect.any(String),
        false,
        false
      );
    });

    it('settimeout preset calls buildHookCode correctly', () => {
      CORE_PRESETS['settimeout']!.buildCode(true, false);
      expect(mockBuildHookCode).toHaveBeenCalledWith('settimeout', expect.any(String), true, false);
    });

    it('addeventlistener preset calls buildHookCode correctly', () => {
      CORE_PRESETS['addeventlistener']!.buildCode(false, true);
      expect(mockBuildHookCode).toHaveBeenCalledWith(
        'addeventlistener',
        expect.any(String),
        false,
        true
      );
    });

    it('postmessage preset calls buildHookCode correctly', () => {
      CORE_PRESETS['postmessage']!.buildCode(true, true);
      expect(mockBuildHookCode).toHaveBeenCalledWith('postmessage', expect.any(String), true, true);
    });

    it('history-pushstate preset calls buildHookCode correctly', () => {
      CORE_PRESETS['history-pushstate']!.buildCode(false, false);
      expect(mockBuildHookCode).toHaveBeenCalledWith(
        'history-pushstate',
        expect.any(String),
        false,
        false
      );
    });
  });

  describe('buildCode passes captureStack and logToConsole faithfully', () => {
    it.each([
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ] as const)('eval preset with captureStack=%s, logToConsole=%s', (cs, lc) => {
      mockBuildHookCode.mockClear();
      CORE_PRESETS['eval']!.buildCode(cs, lc);
      expect(mockBuildHookCode).toHaveBeenCalledWith('eval', expect.any(String), cs, lc);
    });
  });

  describe('body templates contain expected placeholder tokens', () => {
    it.each(EXPECTED_CORE_IDS)(
      '"%s" body passed to buildHookCode contains STACK_CODE and LOG_FN placeholders',
      (id) => {
        mockBuildHookCode.mockClear();
        CORE_PRESETS[id]!.buildCode(false, false);
        const bodyArg = mockBuildHookCode.mock.calls[0]![1] as string;
        expect(bodyArg).toContain('{{STACK_CODE}}');
        expect(bodyArg).toContain('{{LOG_FN}}');
      }
    );
  });

  describe('body templates reference the correct __aiHooks key', () => {
    it.each(EXPECTED_CORE_IDS)('"%s" body contains its __aiHooks collection key', (id) => {
      mockBuildHookCode.mockClear();
      CORE_PRESETS[id]!.buildCode(false, false);
      const bodyArg = mockBuildHookCode.mock.calls[0]![1] as string;
      expect(bodyArg).toContain(`preset-${id}`);
    });
  });

  describe('description content', () => {
    it('eval description mentions eval()', () => {
      expect(CORE_PRESETS['eval']!.description).toContain('eval');
    });

    it('crypto-subtle description mentions WebCrypto', () => {
      expect(CORE_PRESETS['crypto-subtle']!.description).toContain('WebCrypto');
    });

    it('webassembly description mentions WASM', () => {
      expect(CORE_PRESETS['webassembly']!.description).toContain('WASM');
    });

    it('addeventlistener description mentions event listener', () => {
      expect(CORE_PRESETS['addeventlistener']!.description).toContain('event listener');
    });

    it('postmessage description mentions postMessage', () => {
      expect(CORE_PRESETS['postmessage']!.description).toContain('postMessage');
    });
  });
});
