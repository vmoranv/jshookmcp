import { describe, it, expect } from 'vitest';
import { BrowserAPIDatabase } from '../../../src/modules/emulator/BrowserAPIDatabase.js';

describe('BrowserAPIDatabase', () => {
  it('loads core APIs on initialization', () => {
    const db = new BrowserAPIDatabase();
    const api = db.getAPI('window.setTimeout');

    expect(api).toBeDefined();
    expect(api?.type).toBe('method');
  });

  it('filters APIs by type', () => {
    const db = new BrowserAPIDatabase();
    const constructors = db.getAPIsByType('constructor');

    expect(constructors.some((api) => api.path === 'XMLHttpRequest')).toBe(true);
  });

  it('searches APIs by name/path/description (case-insensitive)', () => {
    const db = new BrowserAPIDatabase();
    const byName = db.searchAPIs('queryselector');
    const byPath = db.searchAPIs('navigator.permissions');
    const byDesc = db.searchAPIs('global window object');

    expect(byName.some((x) => x.path === 'document.querySelector')).toBe(true);
    expect(byPath.some((x) => x.path === 'navigator.permissions')).toBe(true);
    expect(byDesc.some((x) => x.path === 'window')).toBe(true);
  });

  it('allows runtime API registration', () => {
    const db = new BrowserAPIDatabase();
    db.addAPI({
      name: 'customFn',
      path: 'window.customFn',
      type: 'method',
      returnType: 'void',
      antiCrawlImportance: 1,
    });

    expect(db.getAPI('window.customFn')?.name).toBe('customFn');
  });

  it('supports export and re-load from JSON', () => {
    const db = new BrowserAPIDatabase();
    db.addAPI({
      name: 'reloadable',
      path: 'window.reloadable',
      type: 'property',
    });
    const dump = db.exportToJSON();

    const restored = new BrowserAPIDatabase();
    restored.loadFromJSON(dump);

    expect(restored.getAPI('window.reloadable')).toBeDefined();
    expect(restored.getAPI('window.setInterval')).toBeDefined();
  });
});

