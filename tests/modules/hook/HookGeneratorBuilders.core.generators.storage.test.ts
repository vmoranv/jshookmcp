import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  generateCookieHook,
  generateLocalStorageHook,
  getInjectionInstructions,
} from '@modules/hook/HookGeneratorBuilders.core.generators.storage';

describe('HookGeneratorBuilders.core.generators.storage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('generates storage hooks for mutators and readers', () => {
    const script = generateLocalStorageHook('log', 'window.__storagePatched = true;');

    expect(script).toContain('const originalSetItem = Storage.prototype.setItem;');
    expect(script).toContain('Storage.prototype.setItem = function(key, value)');
    expect(script).toContain('Storage.prototype.getItem = function(key)');
    expect(script).toContain('Storage.prototype.removeItem = function(key)');
    expect(script).toContain('Storage.prototype.clear = function()');
    expect(script).toContain('[Storage Hook] ${storageType}.setItem:');
    expect(script).toContain('[Storage Hook] ${storageType}.getItem:');
    expect(script).toContain('[Storage Hook] ${storageType}.removeItem:');
    expect(script).toContain('[Storage Hook] ${storageType}.clear:');
    expect(script).toContain('window.__storagePatched = true;');
  });

  it('supports blocking storage writes', () => {
    const script = generateLocalStorageHook('block');

    expect(script).toContain('return;');
    expect(script).toContain('return originalSetItem.apply(this, arguments);');
  });

  it('generates cookie hooks with getter, setter and parsing helpers', () => {
    const script = generateCookieHook('log', 'window.__cookiePatched = true;');

    expect(script).toContain("Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')");
    expect(script).toContain("Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie')");
    expect(script).toContain('function parseCookie(cookieString)');
    expect(script).toContain("Object.defineProperty(document, 'cookie'");
    expect(script).toContain("console.log('[Cookie Hook] get:', {");
    expect(script).toContain("console.log('[Cookie Hook] set:', {");
    expect(script).toContain('window.__cookiePatched = true;');
  });

  it('supports blocking cookie writes', () => {
    const script = generateCookieHook('block');

    expect(script).toContain('return;');
  });

  it('returns injection instructions that mention the selected hook type', () => {
    const instructions = getInjectionInstructions('cookie');

    expect(instructions).toBe(
      'This hook script monitors cookie operations. Inject it into the target page via page_evaluate or console_execute to activate.'
    );
  });
});
