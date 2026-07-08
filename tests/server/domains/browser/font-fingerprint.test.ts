import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildFontFingerprintScript,
  StealthInjectionHandlers,
} from '@server/domains/browser/handlers/stealth-injection';
import { FONT_FALLBACK_PROBE_LIST } from '@src/constants/browser';

function vmEvaluate(script: string, env: Record<string, unknown> = {}): unknown {
  const keys = Object.keys(env);
  const vals = Object.values(env);
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, 'document', 'queryLocalFonts', 'return (' + script + ');');
  return fn(...vals, env['document'] ?? undefined, env['queryLocalFonts'] ?? undefined);
}

describe('buildFontFingerprintScript', () => {
  const baseOpts = {
    useLocalFontApi: true,
    spoof: false,
    maxFonts: 2000,
    probeList: FONT_FALLBACK_PROBE_LIST,
  };

  it('uses queryLocalFonts when available and returns unique families', async () => {
    const queryLocalFonts = vi.fn(async () => [
      { family: 'Arial', style: 'Regular', fullName: 'Arial' },
      { family: 'Arial', style: 'Bold', fullName: 'Arial Bold' },
      { family: 'Consolas', style: 'Regular', fullName: 'Consolas' },
    ]);
    const result = (await vmEvaluate(buildFontFingerprintScript(baseOpts), {
      queryLocalFonts,
      document: undefined,
    })) as Record<string, unknown>;

    expect(queryLocalFonts).toHaveBeenCalledOnce();
    expect(result['source']).toBe('queryLocalFonts');
    expect(result['localFontApiAvailable']).toBe(true);
    // dedupe by family: Arial appears once, Consolas once
    expect(result['detected']).toEqual(['Arial', 'Consolas']);
    expect(result['count']).toBe(2);
    expect(typeof result['hash']).toBe('string');
    expect((result['hash'] as string).length).toBe(8);
  });

  it('falls back to document.fonts.check probe when queryLocalFonts is missing', async () => {
    const check = vi.fn((spec: string) => spec.includes('Arial') || spec.includes('Verdana'));
    const document = { fonts: { check } };
    const result = (await vmEvaluate(
      buildFontFingerprintScript({ ...baseOpts, useLocalFontApi: false }),
      { document },
    )) as Record<string, unknown>;

    expect(result['source']).toBe('probeFallback');
    expect(result['localFontApiAvailable']).toBe(false);
    expect(result['detected']).toEqual(['Arial', 'Verdana']);
    // every probe name was tested exactly once
    expect(check).toHaveBeenCalledTimes(FONT_FALLBACK_PROBE_LIST.length);
  });

  it('falls back to probe when queryLocalFonts rejects (permission denied)', async () => {
    const queryLocalFonts = vi.fn(async () => {
      throw new Error('NotAllowedError');
    });
    const check = vi.fn(() => true);
    const document = { fonts: { check } };
    const result = (await vmEvaluate(buildFontFingerprintScript(baseOpts), {
      queryLocalFonts,
      document,
    })) as Record<string, unknown>;

    expect(result['source']).toBe('probeFallback');
    expect(result['localFontApiAvailable']).toBe(false);
    expect(typeof result['localFontApiError']).toBe('string');
    expect(result['detected']).toEqual(FONT_FALLBACK_PROBE_LIST.slice());
  });

  it('returns unavailable source when neither queryLocalFonts nor document.fonts exist', async () => {
    const result = (await vmEvaluate(
      buildFontFingerprintScript({ ...baseOpts, useLocalFontApi: false }),
      {},
    )) as Record<string, unknown>;

    expect(result['source']).toBe('unavailable');
    expect(result['detected']).toEqual([]);
    expect(result['count']).toBe(0);
  });

  it('overrides document.fonts.check when spoof=true', async () => {
    const originalCheck = vi.fn(() => false);
    const documentProxy: Record<string, unknown> = {
      fonts: { check: originalCheck },
    };
    await vmEvaluate(
      buildFontFingerprintScript({ ...baseOpts, useLocalFontApi: false, spoof: true }),
      { document: documentProxy },
    );

    expect(documentProxy['fonts']).toBeInstanceOf(Object);
    const overridden = (documentProxy['fonts'] as { check: unknown }).check;
    expect(overridden).not.toBe(originalCheck);
    expect((overridden as () => boolean)()).toBe(true);
  });

  it('produces a stable hash for the same font set regardless of order', async () => {
    const queryA = vi.fn(async () => [
      { family: 'Arial' },
      { family: 'Consolas' },
      { family: 'Verdana' },
    ]);
    const queryB = vi.fn(async () => [
      { family: 'Verdana' },
      { family: 'Arial' },
      { family: 'Consolas' },
    ]);
    const a = (await vmEvaluate(buildFontFingerprintScript(baseOpts), {
      queryLocalFonts: queryA,
    })) as Record<string, unknown>;
    const b = (await vmEvaluate(buildFontFingerprintScript(baseOpts), {
      queryLocalFonts: queryB,
    })) as Record<string, unknown>;
    expect(a['hash']).toEqual(b['hash']);
  });

  it('caps enumerated families at maxFonts', async () => {
    const queryLocalFonts = vi.fn(async () => [
      { family: 'A' },
      { family: 'B' },
      { family: 'C' },
      { family: 'D' },
    ]);
    const result = (await vmEvaluate(buildFontFingerprintScript({ ...baseOpts, maxFonts: 2 }), {
      queryLocalFonts,
    })) as Record<string, unknown>;
    expect(result['detected']).toEqual(['A', 'B']);
    expect(result['count']).toBe(2);
  });
});

describe('StealthInjectionHandlers.handleBrowserFontFingerprint', () => {
  const pageController: any = { evaluate: vi.fn() };
  const getActiveDriver = vi.fn((): 'chrome' | 'camoufox' => 'chrome');
  let handlers: StealthInjectionHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new StealthInjectionHandlers({ pageController, getActiveDriver });
  });

  it('returns detected fonts, hash, and source from the page probe', async () => {
    pageController.evaluate.mockResolvedValueOnce({
      detected: ['Arial', 'Consolas'],
      count: 2,
      hash: 'deadbeef',
      source: 'queryLocalFonts',
      localFontApiAvailable: true,
      localFontApiError: null,
      spoofed: false,
      spoofError: null,
    });

    const body = parseJson<Record<string, unknown>>(
      await handlers.handleBrowserFontFingerprint({}),
    ) as any;

    expect(body.success).toBe(true);
    expect(body.count).toBe(2);
    expect(body.detected).toEqual(['Arial', 'Consolas']);
    expect(body.hash).toBe('deadbeef');
    expect(body.source).toBe('queryLocalFonts');
    expect(body.localFontApiAvailable).toBe(true);
    expect(body.spoofed).toBe(false);
    expect(body._nextStepHint).toContain('spoof=true');
    expect(pageController.evaluate).toHaveBeenCalledOnce();
    // The evaluated code should carry the probe fallback list
    const evaluated = pageController.evaluate.mock.calls[0][0] as string;
    expect(evaluated).toContain('Arial');
  });

  it('surfaces spoofed=true and spoof error from the page', async () => {
    pageController.evaluate.mockResolvedValueOnce({
      detected: [],
      count: 0,
      hash: '00000000',
      source: 'probeFallback',
      localFontApiAvailable: false,
      spoofed: true,
      spoofError: undefined,
    });

    const body = parseJson<Record<string, unknown>>(
      await handlers.handleBrowserFontFingerprint({ spoof: true }),
    ) as any;

    expect(body.success).toBe(true);
    expect(body.spoofed).toBe(true);
    expect(body._nextStepHint).toContain('spoof=false');
  });

  it('returns a failure response when the probe returns null', async () => {
    pageController.evaluate.mockResolvedValueOnce(null);

    const body = parseJson<Record<string, unknown>>(
      await handlers.handleBrowserFontFingerprint({}),
    ) as any;

    expect(body.success).toBe(false);
    expect(body.error).toContain('no result');
  });

  it('returns a failure response when evaluate throws', async () => {
    pageController.evaluate.mockRejectedValueOnce(new Error('page gone'));

    const body = parseJson<Record<string, unknown>>(
      await handlers.handleBrowserFontFingerprint({}),
    ) as any;

    expect(body.success).toBe(false);
    expect(body.error).toContain('page gone');
  });
});
