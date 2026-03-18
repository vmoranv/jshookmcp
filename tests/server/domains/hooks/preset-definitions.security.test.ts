import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockBuildHookCode = vi.hoisted(() =>
  vi.fn(
    (name: string, _body: string, cs: boolean, lc: boolean) => `[mock:${name}:cs=${cs}:lc=${lc}]`
  )
);

vi.mock('@server/domains/hooks/preset-builder', () => ({
  buildHookCode: mockBuildHookCode,
}));

import { SECURITY_PRESETS } from '@server/domains/hooks/preset-definitions.security';

const EXPECTED_SECURITY_IDS = ['anti-debug-bypass', 'crypto-key-capture', 'webassembly-full'];

describe('SECURITY_PRESETS', () => {
  beforeEach(() => {
    mockBuildHookCode.mockClear();
  });

  it('exports a Record<string, PresetEntry>', () => {
    expect(SECURITY_PRESETS).toBeDefined();
    expect(typeof SECURITY_PRESETS).toBe('object');
    expect(SECURITY_PRESETS).not.toBeNull();
  });

  it('contains all expected preset IDs', () => {
    const ids = Object.keys(SECURITY_PRESETS);
    for (const expectedId of EXPECTED_SECURITY_IDS) {
      expect(ids).toContain(expectedId);
    }
  });

  it('does not contain unexpected extra entries beyond the known set', () => {
    const ids = Object.keys(SECURITY_PRESETS);
    for (const id of ids) {
      expect(EXPECTED_SECURITY_IDS).toContain(id);
    }
  });

  it('has unique preset IDs (no duplicates in object keys)', () => {
    const ids = Object.keys(SECURITY_PRESETS);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  describe('entry structure', () => {
    it.each(EXPECTED_SECURITY_IDS)('"%s" has a description string', (id) => {
      const entry = SECURITY_PRESETS[id];
      expect(entry).toBeDefined();
      expect(typeof entry!.description).toBe('string');
      expect(entry!.description.length).toBeGreaterThan(0);
    });

    it.each(EXPECTED_SECURITY_IDS)('"%s" has a buildCode function', (id) => {
      const entry = SECURITY_PRESETS[id];
      expect(entry).toBeDefined();
      expect(typeof entry!.buildCode).toBe('function');
    });
  });

  describe('buildCode delegation to buildHookCode', () => {
    it('anti-debug-bypass preset calls buildHookCode with correct name', () => {
      const result = SECURITY_PRESETS['anti-debug-bypass']!.buildCode(true, false);
      expect(mockBuildHookCode).toHaveBeenCalledWith(
        'anti-debug-bypass',
        expect.any(String),
        true,
        false
      );
      expect(result).toBe('[mock:anti-debug-bypass:cs=true:lc=false]');
    });

    it('crypto-key-capture preset calls buildHookCode with correct name', () => {
      const result = SECURITY_PRESETS['crypto-key-capture']!.buildCode(false, true);
      expect(mockBuildHookCode).toHaveBeenCalledWith(
        'crypto-key-capture',
        expect.any(String),
        false,
        true
      );
      expect(result).toBe('[mock:crypto-key-capture:cs=false:lc=true]');
    });

    it('webassembly-full preset calls buildHookCode with correct name', () => {
      const result = SECURITY_PRESETS['webassembly-full']!.buildCode(true, true);
      expect(mockBuildHookCode).toHaveBeenCalledWith(
        'webassembly-full',
        expect.any(String),
        true,
        true
      );
      expect(result).toBe('[mock:webassembly-full:cs=true:lc=true]');
    });
  });

  describe('buildCode passes captureStack and logToConsole faithfully', () => {
    it.each([
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ] as const)('anti-debug-bypass preset with captureStack=%s, logToConsole=%s', (cs, lc) => {
      mockBuildHookCode.mockClear();
      SECURITY_PRESETS['anti-debug-bypass']!.buildCode(cs, lc);
      expect(mockBuildHookCode).toHaveBeenCalledWith(
        'anti-debug-bypass',
        expect.any(String),
        cs,
        lc
      );
    });
  });

  describe('body templates contain expected placeholder tokens', () => {
    // anti-debug-bypass does not use {{STACK_CODE}}/{{LOG_FN}} since it
    // implements custom blocking logic rather than the standard trace pattern.
    const PRESETS_WITH_PLACEHOLDERS = ['crypto-key-capture', 'webassembly-full'];

    it.each(PRESETS_WITH_PLACEHOLDERS)(
      '"%s" body passed to buildHookCode contains STACK_CODE and LOG_FN placeholders',
      (id) => {
        mockBuildHookCode.mockClear();
        SECURITY_PRESETS[id]!.buildCode(false, false);
        const bodyArg = mockBuildHookCode.mock.calls[0]![1] as string;
        expect(bodyArg).toContain('{{STACK_CODE}}');
        expect(bodyArg).toContain('{{LOG_FN}}');
      }
    );

    it('anti-debug-bypass body does not use standard placeholders', () => {
      mockBuildHookCode.mockClear();
      SECURITY_PRESETS['anti-debug-bypass']!.buildCode(false, false);
      const bodyArg = mockBuildHookCode.mock.calls[0]![1] as string;
      expect(bodyArg).not.toContain('{{STACK_CODE}}');
      expect(bodyArg).not.toContain('{{LOG_FN}}');
    });
  });

  describe('body templates reference the correct __aiHooks key', () => {
    it.each(EXPECTED_SECURITY_IDS)('"%s" body contains its __aiHooks collection key', (id) => {
      mockBuildHookCode.mockClear();
      SECURITY_PRESETS[id]!.buildCode(false, false);
      const bodyArg = mockBuildHookCode.mock.calls[0]![1] as string;
      expect(bodyArg).toContain(`preset-${id}`);
    });
  });

  describe('description content', () => {
    it('anti-debug-bypass description mentions anti-debugging', () => {
      expect(SECURITY_PRESETS['anti-debug-bypass']!.description).toContain('anti-debug');
    });

    it('anti-debug-bypass description mentions debugger traps', () => {
      expect(SECURITY_PRESETS['anti-debug-bypass']!.description).toContain('debugger');
    });

    it('crypto-key-capture description mentions extractable', () => {
      expect(SECURITY_PRESETS['crypto-key-capture']!.description).toContain('extractable');
    });

    it('crypto-key-capture description mentions WebCrypto', () => {
      expect(SECURITY_PRESETS['crypto-key-capture']!.description).toContain('WebCrypto');
    });

    it('webassembly-full description mentions WebAssembly', () => {
      expect(SECURITY_PRESETS['webassembly-full']!.description).toContain('WebAssembly');
    });

    it('webassembly-full description mentions import calls', () => {
      expect(SECURITY_PRESETS['webassembly-full']!.description).toContain('import calls');
    });
  });

  describe('security preset body content characteristics', () => {
    it('anti-debug-bypass body contains debugger detection logic', () => {
      mockBuildHookCode.mockClear();
      SECURITY_PRESETS['anti-debug-bypass']!.buildCode(false, false);
      const bodyArg = mockBuildHookCode.mock.calls[0]![1] as string;
      expect(bodyArg).toContain('debugger');
      expect(bodyArg).toContain('console.clear');
      expect(bodyArg).toContain('performance.now');
      expect(bodyArg).toContain('outerWidth');
    });

    it('crypto-key-capture body forces extractable:true', () => {
      mockBuildHookCode.mockClear();
      SECURITY_PRESETS['crypto-key-capture']!.buildCode(false, false);
      const bodyArg = mockBuildHookCode.mock.calls[0]![1] as string;
      expect(bodyArg).toContain('importKey');
      expect(bodyArg).toContain('true');
    });

    it('webassembly-full body hooks WebAssembly.Memory', () => {
      mockBuildHookCode.mockClear();
      SECURITY_PRESETS['webassembly-full']!.buildCode(false, false);
      const bodyArg = mockBuildHookCode.mock.calls[0]![1] as string;
      expect(bodyArg).toContain('WebAssembly.Memory');
      expect(bodyArg).toContain('memory_created');
    });
  });
});
