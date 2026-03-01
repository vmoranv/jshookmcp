import type { BrowserType } from './BrowserEnvironmentRules.js';

export type APIType = 'property' | 'method' | 'constructor' | 'event';

export interface APIDefinition {
  name: string;

  path: string;

  type: APIType;

  returnType?: string;

  parameters?: Array<{
    name: string;
    type: string;
    optional?: boolean;
    defaultValue?: unknown;
  }>;

  implementation?: string | Function;

  description?: string;

  browsers?: BrowserType[];

  minVersion?: Record<BrowserType, string>;

  deprecated?: boolean;

  replacement?: string;

  antiCrawlImportance?: number;
}

export class BrowserAPIDatabase {
  private apis: Map<string, APIDefinition> = new Map();

  constructor() {
    this.initializeAPIs();
  }

  private initializeAPIs(): void {
    this.addAPI({
      name: 'window',
      path: 'window',
      type: 'property',
      returnType: 'Window',
      description: 'Global window object',
      antiCrawlImportance: 10,
    });

    this.addAPI({
      name: 'self',
      path: 'window.self',
      type: 'property',
      returnType: 'Window',
      description: 'Reference to window itself',
      antiCrawlImportance: 8,
    });

    this.addAPI({
      name: 'top',
      path: 'window.top',
      type: 'property',
      returnType: 'Window',
      description: 'Topmost window',
      antiCrawlImportance: 7,
    });

    this.addAPI({
      name: 'parent',
      path: 'window.parent',
      type: 'property',
      returnType: 'Window',
      description: 'Parent window',
      antiCrawlImportance: 7,
    });

    this.addAPI({
      name: 'setTimeout',
      path: 'window.setTimeout',
      type: 'method',
      returnType: 'number',
      parameters: [
        { name: 'callback', type: 'Function' },
        { name: 'delay', type: 'number', optional: true, defaultValue: 0 },
      ],
      implementation: 'function(callback, delay) { return setTimeout(callback, delay); }',
      antiCrawlImportance: 9,
    });

    this.addAPI({
      name: 'setInterval',
      path: 'window.setInterval',
      type: 'method',
      returnType: 'number',
      parameters: [
        { name: 'callback', type: 'Function' },
        { name: 'delay', type: 'number', optional: true, defaultValue: 0 },
      ],
      implementation: 'function(callback, delay) { return setInterval(callback, delay); }',
      antiCrawlImportance: 8,
    });

    this.addAPI({
      name: 'clearTimeout',
      path: 'window.clearTimeout',
      type: 'method',
      returnType: 'void',
      parameters: [{ name: 'id', type: 'number' }],
      implementation: 'function(id) { clearTimeout(id); }',
      antiCrawlImportance: 7,
    });

    this.addAPI({
      name: 'clearInterval',
      path: 'window.clearInterval',
      type: 'method',
      returnType: 'void',
      parameters: [{ name: 'id', type: 'number' }],
      implementation: 'function(id) { clearInterval(id); }',
      antiCrawlImportance: 7,
    });

    this.addAPI({
      name: 'requestAnimationFrame',
      path: 'window.requestAnimationFrame',
      type: 'method',
      returnType: 'number',
      parameters: [{ name: 'callback', type: 'FrameRequestCallback' }],
      implementation: 'function(callback) { return setTimeout(callback, 16); }',
      antiCrawlImportance: 8,
    });

    this.addAPI({
      name: 'cancelAnimationFrame',
      path: 'window.cancelAnimationFrame',
      type: 'method',
      returnType: 'void',
      parameters: [{ name: 'id', type: 'number' }],
      implementation: 'function(id) { clearTimeout(id); }',
      antiCrawlImportance: 7,
    });

    this.addAPI({
      name: 'btoa',
      path: 'window.btoa',
      type: 'method',
      returnType: 'string',
      parameters: [{ name: 'data', type: 'string' }],
      implementation: 'function(data) { return Buffer.from(data).toString("base64"); }',
      antiCrawlImportance: 6,
    });

    this.addAPI({
      name: 'atob',
      path: 'window.atob',
      type: 'method',
      returnType: 'string',
      parameters: [{ name: 'data', type: 'string' }],
      implementation: 'function(data) { return Buffer.from(data, "base64").toString(); }',
      antiCrawlImportance: 6,
    });

    this.addAPI({
      name: 'plugins',
      path: 'navigator.plugins',
      type: 'property',
      returnType: 'PluginArray',
      description: 'Browser plugins',
      antiCrawlImportance: 9,
    });

    this.addAPI({
      name: 'mimeTypes',
      path: 'navigator.mimeTypes',
      type: 'property',
      returnType: 'MimeTypeArray',
      description: 'Supported MIME types',
      antiCrawlImportance: 8,
    });

    this.addAPI({
      name: 'permissions',
      path: 'navigator.permissions',
      type: 'property',
      returnType: 'Permissions',
      description: 'Permissions API',
      antiCrawlImportance: 7,
      browsers: ['chrome', 'firefox', 'edge'],
    });

    this.addAPI({
      name: 'getBattery',
      path: 'navigator.getBattery',
      type: 'method',
      returnType: 'Promise<BatteryManager>',
      parameters: [],
      implementation: 'function() { return Promise.resolve({}); }',
      antiCrawlImportance: 5,
      browsers: ['chrome', 'firefox', 'edge', 'opera'],
    });

    this.addAPI({
      name: 'getGamepads',
      path: 'navigator.getGamepads',
      type: 'method',
      returnType: 'Gamepad[]',
      parameters: [],
      implementation: 'function() { return []; }',
      antiCrawlImportance: 3,
    });

    this.addAPI({
      name: 'sendBeacon',
      path: 'navigator.sendBeacon',
      type: 'method',
      returnType: 'boolean',
      parameters: [
        { name: 'url', type: 'string' },
        { name: 'data', type: 'any', optional: true },
      ],
      implementation: 'function() { return true; }',
      antiCrawlImportance: 6,
    });

    this.addAPI({
      name: 'getElementById',
      path: 'document.getElementById',
      type: 'method',
      returnType: 'HTMLElement | null',
      parameters: [{ name: 'id', type: 'string' }],
      implementation: 'function() { return null; }',
      antiCrawlImportance: 7,
    });

    this.addAPI({
      name: 'querySelector',
      path: 'document.querySelector',
      type: 'method',
      returnType: 'Element | null',
      parameters: [{ name: 'selector', type: 'string' }],
      implementation: 'function() { return null; }',
      antiCrawlImportance: 7,
    });

    this.addAPI({
      name: 'querySelectorAll',
      path: 'document.querySelectorAll',
      type: 'method',
      returnType: 'NodeList',
      parameters: [{ name: 'selector', type: 'string' }],
      implementation: 'function() { return []; }',
      antiCrawlImportance: 7,
    });

    this.addAPI({
      name: 'createElement',
      path: 'document.createElement',
      type: 'method',
      returnType: 'HTMLElement',
      parameters: [{ name: 'tagName', type: 'string' }],
      implementation: 'function() { return {}; }',
      antiCrawlImportance: 8,
    });

    this.addAPI({
      name: 'createTextNode',
      path: 'document.createTextNode',
      type: 'method',
      returnType: 'Text',
      parameters: [{ name: 'data', type: 'string' }],
      implementation: 'function() { return {}; }',
      antiCrawlImportance: 6,
    });

    this.addAPI({
      name: 'addEventListener',
      path: 'document.addEventListener',
      type: 'method',
      returnType: 'void',
      parameters: [
        { name: 'type', type: 'string' },
        { name: 'listener', type: 'EventListener' },
        { name: 'options', type: 'boolean | AddEventListenerOptions', optional: true },
      ],
      implementation: 'function() {}',
      antiCrawlImportance: 7,
    });

    this.addAPI({
      name: 'log',
      path: 'console.log',
      type: 'method',
      returnType: 'void',
      parameters: [{ name: 'message', type: 'any' }],
      implementation: 'function(...args) { console.log(...args); }',
      antiCrawlImportance: 5,
    });

    this.addAPI({
      name: 'warn',
      path: 'console.warn',
      type: 'method',
      returnType: 'void',
      parameters: [{ name: 'message', type: 'any' }],
      implementation: 'function(...args) { console.warn(...args); }',
      antiCrawlImportance: 4,
    });

    this.addAPI({
      name: 'error',
      path: 'console.error',
      type: 'method',
      returnType: 'void',
      parameters: [{ name: 'message', type: 'any' }],
      implementation: 'function(...args) { console.error(...args); }',
      antiCrawlImportance: 4,
    });

    this.addAPI({
      name: 'XMLHttpRequest',
      path: 'XMLHttpRequest',
      type: 'constructor',
      returnType: 'XMLHttpRequest',
      description: 'XMLHttpRequest constructor',
      antiCrawlImportance: 9,
    });

    this.addAPI({
      name: 'fetch',
      path: 'window.fetch',
      type: 'method',
      returnType: 'Promise<Response>',
      parameters: [
        { name: 'input', type: 'RequestInfo' },
        { name: 'init', type: 'RequestInit', optional: true },
      ],
      implementation: 'function() { return Promise.reject(new Error("Not implemented")); }',
      antiCrawlImportance: 8,
    });

    this.addAPI({
      name: 'getItem',
      path: 'localStorage.getItem',
      type: 'method',
      returnType: 'string | null',
      parameters: [{ name: 'key', type: 'string' }],
      implementation: 'function() { return null; }',
      antiCrawlImportance: 7,
    });

    this.addAPI({
      name: 'setItem',
      path: 'localStorage.setItem',
      type: 'method',
      returnType: 'void',
      parameters: [
        { name: 'key', type: 'string' },
        { name: 'value', type: 'string' },
      ],
      implementation: 'function() {}',
      antiCrawlImportance: 7,
    });
  }

  addAPI(api: APIDefinition): void {
    this.apis.set(api.path, api);
  }

  getAPI(path: string): APIDefinition | undefined {
    return this.apis.get(path);
  }

  getAllAPIs(): APIDefinition[] {
    return Array.from(this.apis.values());
  }

  getAPIsByType(type: APIType): APIDefinition[] {
    return this.getAllAPIs().filter((api) => api.type === type);
  }

  searchAPIs(query: string): APIDefinition[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllAPIs().filter(
      (api) =>
        api.name.toLowerCase().includes(lowerQuery) ||
        api.path.toLowerCase().includes(lowerQuery) ||
        api.description?.toLowerCase().includes(lowerQuery)
    );
  }

  exportToJSON(): string {
    return JSON.stringify(Array.from(this.apis.entries()), null, 2);
  }

  loadFromJSON(json: string): void {
    const data = JSON.parse(json);
    this.apis = new Map(data);
  }
}
