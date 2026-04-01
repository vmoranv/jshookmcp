import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookPresetToolHandlers } from '../../../../src/server/domains/hooks/preset-handlers';

vi.mock('../../../../src/utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

describe('HookPresetToolHandlers', () => {
  let pageControllerMock: any;
  let pageMock: any;
  let handlers: HookPresetToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    pageMock = {
      evaluate: vi.fn().mockResolvedValue(undefined),
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    };
    pageControllerMock = {
      getPage: vi.fn().mockResolvedValue(pageMock),
    };
    handlers = new HookPresetToolHandlers(pageControllerMock);
  });

  describe('handleHookPreset', () => {
    it('lists available presets accurately', async () => {
      const res = await handlers.handleHookPreset({ listPresets: true });
      expect(res.content[0].text).toContain('"success": true');
      expect(res.content[0].text).toContain('"totalPresets"');
    });

    it('errors when no target is provided gracefully', async () => {
      const res = await handlers.handleHookPreset({});
      expect(res.content[0].text).toContain('"success": false');
      expect(res.content[0].text).toContain('either preset');
    });

    it('errors when invalid preset identity is provided', async () => {
      const res = await handlers.handleHookPreset({ preset: 'invalid_xyz' });
      expect(res.content[0].text).toContain('"success": false');
      expect(res.content[0].text).toContain('invalid_xyz');
    });

    it('injects single valid preset via evaluate correctly', async () => {
      const res = await handlers.handleHookPreset({
        preset: 'custom-1',
        customTemplate: { id: 'custom-1', body: 'console.log();' },
      });
      expect(res.content[0].text).toContain('"success": true');
      expect(pageMock.evaluate).toHaveBeenCalled();
    });

    it('injects multiple presets via array payload', async () => {
      const res = await handlers.handleHookPreset({
        presets: ['custom-2', 'custom-3'],
        customTemplates: [
          { id: 'custom-2', body: '...' },
          { id: 'custom-3', body: '...' },
        ],
      });
      expect(res.content[0].text).toContain('"success": true');
      expect(pageMock.evaluate).toHaveBeenCalledTimes(2);
    });

    it('injects via evaluateOnNewDocument strictly when explicitly defined', async () => {
      const res = await handlers.handleHookPreset({
        preset: 'custom-4',
        customTemplate: { id: 'custom-4', body: '...' },
        method: 'evaluateOnNewDocument',
      });
      expect(res.content[0].text).toContain('"success": true');
      expect(pageMock.evaluateOnNewDocument).toHaveBeenCalled();
    });

    it('handles evaluate error string', async () => {
      pageMock.evaluate.mockRejectedValue('string error');
      const res = await handlers.handleHookPreset({ presets: ['anti-debug-bypass'] });
      expect((res as any).content[0].text).toContain('string error');
    });

    it('handles build code general string err', async () => {
      vi.spyOn(handlers as any, 'buildCustomPresetMap').mockImplementation(() => {
        throw 'string error building';
      });
      const res = await handlers.handleHookPreset({ presets: ['dummy'] });
      expect((res as any).content[0].text).toContain('string error building');
    });

    it('handles injection failures returning composite result', async () => {
      pageMock.evaluate.mockRejectedValue(new Error('inject err'));
      const res = await handlers.handleHookPreset({
        preset: 'custom-fail',
        customTemplate: { id: 'custom-fail', body: '...' },
      });
      expect(res.content[0].text).toContain('"success": false');
      expect(res.content[0].text).toContain('failed');
      expect(res.content[0].text).toContain('inject err');
    });

    it('handles inline custom template array injection maps', async () => {
      const res = await handlers.handleHookPreset({
        presets: ['my-custom'],
        customTemplates: [{ id: 'my-custom', body: 'console.log();' }],
      });
      expect(res.content[0].text).toContain('"success": true');
    });

    it('handles inline custom template singular injection map', async () => {
      const res = await handlers.handleHookPreset({
        preset: 'my-custom2',
        customTemplate: { id: 'my-custom2', body: 'console.log();' },
      });
      expect(res.content[0].text).toContain('"success": true');
    });

    it('errors on invalid custom template structured payloads directly bubbling', async () => {
      // Internal throw inside building map is caught by outer catch
      const res = await handlers.handleHookPreset({
        customTemplate: { id: 'conflict', body: '' }, // missing body
      });
      expect(res.content[0].text).toContain('"success": false');
      expect(res.content[0].text).toContain('non-empty id and body');
    });

    it('errors on custom template overriding built-in default arrays', async () => {
      const res = await handlers.handleHookPreset({
        preset: 'eval',
        customTemplate: { id: 'eval', body: 'overwrite' },
      });
      expect(res.content[0].text).toContain('"success": false');
      expect(res.content[0].text).toContain('conflicts with built-in preset');
    });
  });
});
