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
  $: Mock<(selector: string) => Promise<any>>;
  $$: Mock<(selector: string) => Promise<any[]>>;
  evaluate: Mock<(fn: any, ...args: any[]) => Promise<any>>;
  goto: Mock<(url: string, options?: any) => Promise<any>>;
  waitForSelector: Mock<(selector: string, options?: any) => Promise<any>>;
  waitForNavigation: Mock<(options?: any) => Promise<any>>;
  setUserAgent: Mock<(userAgent: string) => Promise<void>>;
  evaluateOnNewDocument: Mock<(fn: any, ...args: any[]) => Promise<void>>;
}

/**
 * Mirror interface for Puppeteer Browser to avoid direct dependency in tests.
 */
export interface PuppeteerBrowserMirror {
  newPage: Mock<() => Promise<PuppeteerPageMirror>>;
  close: Mock<() => Promise<void>>;
  disconnect: Mock<() => Promise<void>>;
  version: Mock<() => Promise<string>>;
  targets: Mock<() => any[]>;
  process: Mock<() => { pid: number } | null>;
  on: Mock<(event: string, cb: (...args: any[]) => void) => void>;
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
