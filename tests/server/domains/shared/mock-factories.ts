import { vi, Mock } from 'vitest';

/**
 * DeepPartial utility for creating type-safe mocks of complex objects.
 */
export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

/**
 * Mirror interface for Puppeteer Page to avoid direct dependency in tests.
 */
export interface PuppeteerPageMirror {
  url: Mock<() => string>;
  title: Mock<() => Promise<string>>;
  $: Mock<(selector: string) => Promise<unknown>>;
  $$: Mock<(selector: string) => Promise<unknown[]>>;
  evaluate: Mock<(fn: unknown, ...args: unknown[]) => Promise<unknown>>;
  goto: Mock<(url: string, options?: unknown) => Promise<unknown>>;
  waitForSelector: Mock<(selector: string, options?: unknown) => Promise<unknown>>;
  waitForNavigation: Mock<(options?: unknown) => Promise<unknown>>;
  setUserAgent: Mock<(userAgent: string) => Promise<void>>;
  evaluateOnNewDocument: Mock<(fn: unknown, ...args: unknown[]) => Promise<void>>;
}

/**
 * Mirror interface for Puppeteer Browser to avoid direct dependency in tests.
 */
export interface PuppeteerBrowserMirror {
  newPage: Mock<() => Promise<PuppeteerPageMirror>>;
  close: Mock<() => Promise<void>>;
  disconnect: Mock<() => Promise<void>>;
  version: Mock<() => Promise<string>>;
  targets: Mock<() => unknown[]>;
  process: Mock<() => { pid: number } | null>;
  on: Mock<(event: string, cb: (...args: unknown[]) => void) => void>;
}

/**
 * Mirror interface for ConsoleMonitor to avoid direct dependency in tests.
 */
export interface ConsoleMonitorMirror {
  isNetworkEnabled: Mock<() => boolean>;
  enable: Mock<() => Promise<void>>;
  disable: Mock<() => Promise<void>>;
  getNetworkStatus: Mock<() => unknown>;
  getNetworkRequests: Mock<() => unknown[]>;
  getNetworkResponses: Mock<() => unknown[]>;
  getResponseBody: Mock<(requestId: string) => Promise<string>>;
}

/**
 * Mirror interface for CodeCollector to avoid direct dependency in tests.
 */
export interface WorkflowRunResponse extends CommonSuccessResponse { 
  result: any;
  workflows: any[];
}

export interface CodeCollectorMirror {
  getCollectedUrls: Mock<() => string[]>;
  getCollectedFiles: Mock<() => unknown[]>;
  clearCache: Mock<() => void>;
  getActivePage: Mock<() => Promise<PuppeteerPageMirror>>;
}

/**
 * Factory to create a mock Puppeteer Page.
 */
export function createPageMock(
  overrides: DeepPartial<PuppeteerPageMirror> = {}
): PuppeteerPageMirror {
  return {
    url: vi.fn(() => 'https://example.com'),
    title: vi.fn(async () => 'Default Title'),
    $: vi.fn(async () => null),
    $$: vi.fn(async () => []),
    evaluate: vi.fn(async () => ({})),
    goto: vi.fn(async () => null),
    waitForSelector: vi.fn(async () => null),
    waitForNavigation: vi.fn(async () => null),
    setUserAgent: vi.fn(async () => {}),
    evaluateOnNewDocument: vi.fn(async () => {}),
    ...overrides,
  } as unknown as PuppeteerPageMirror;
}

/**
 * Factory to create a mock Puppeteer Browser.
 */
export function createBrowserMock(
  overrides: DeepPartial<PuppeteerBrowserMirror> = {}
): PuppeteerBrowserMirror {
  return {
    newPage: vi.fn(async () => createPageMock()),
    close: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    version: vi.fn(async () => 'Chrome/120.0.0.0'),
    targets: vi.fn(() => []),
    process: vi.fn(() => ({ pid: 1234 })),
    on: vi.fn(),
    ...overrides,
  } as unknown as PuppeteerBrowserMirror;
}

/**
 * Factory to create a mock ConsoleMonitor.
 */
export function createConsoleMonitorMock(
  overrides: DeepPartial<ConsoleMonitorMirror> = {}
): ConsoleMonitorMirror {
  return {
    isNetworkEnabled: vi.fn(() => true),
    enable: vi.fn(async () => {}),
    disable: vi.fn(async () => {}),
    getNetworkStatus: vi.fn(() => ({})),
    getNetworkRequests: vi.fn(() => []),
    getNetworkResponses: vi.fn(() => []),
    getResponseBody: vi.fn(async () => ''),
    ...overrides,
  } as unknown as ConsoleMonitorMirror;
}

/**
 * Factory to create a mock CodeCollector.
 */
export function createCodeCollectorMock(
  overrides: DeepPartial<CodeCollectorMirror> = {}
): CodeCollectorMirror {
  return {
    getCollectedUrls: vi.fn(() => []),
    getCollectedFiles: vi.fn(() => []),
    clearCache: vi.fn(() => {}),
    getActivePage: vi.fn(async () => createPageMock()),
    ...overrides,
  } as unknown as CodeCollectorMirror;
}

/**
 * Interface representing an MCP tool response.
 */
export interface McpResponse {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * Utility to parse JSON from an MCP response.
 */
export function parseJson<T>(response: unknown): T {
  const res = response as McpResponse;
  if (!res || !res.content || !res.content[0] || !res.content[0].text) {
    throw new Error('Invalid MCP response format');
  }
  return JSON.parse(res.content[0].text) as T;
}
