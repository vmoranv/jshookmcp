import { vi } from 'vitest';
import * as fs from 'node:fs';

/**
 * Utility to parse JSON in tests with type safety.
 * Replaces direct JSON.parse() calls to avoid 'any' and 'no-unsafe-member-access' warnings.
 */
export function parseJson<T>(data: string | null | undefined): T {
  if (data === null || data === undefined || data === '') {
    return [] as unknown as T;
  }
  try {
    return JSON.parse(data) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Type-safe mock helper for EventEmitter and other objects often cast to 'any'
 */
export function mockAs<T>(obj: unknown): T {
  return obj as T;
}

export function createMockMCPClient(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    request: vi.fn(),
    callTool: vi.fn(),
    invoke: vi.fn(),
    notify: vi.fn(),
  };
}

export function mockFileSystem() {
  if (!vi.isMockFunction(fs.readFileSync)) {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('');
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
  }
}

export function mockCDP(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    send: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
    once: vi.fn(),
    removeAllListeners: vi.fn(),
  };
}

export function resetMocks() {
  vi.clearAllMocks();
  vi.resetAllMocks();
}
