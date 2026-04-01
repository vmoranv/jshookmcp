import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function CamoufoxBrowserManagerMock() {}

const mockState = vi.hoisted(() => ({
  camoufoxError: null as Error | null,
  sqliteRelated: false,
}));

vi.mock('@utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@utils/betterSqlite3', () => ({
  isBetterSqlite3RelatedError: vi.fn(() => mockState.sqliteRelated),
  formatBetterSqlite3Error: vi.fn(() => 'SQLite error formatted'),
}));

vi.mock('@server/domains/shared/modules', () => ({
  CamoufoxBrowserManager: CamoufoxBrowserManagerMock,
}));

vi.mock('camoufox-js', () => {
  if (mockState.camoufoxError) {
    throw mockState.camoufoxError;
  }
  return {};
});

async function loadHandlers() {
  vi.resetModules();
  return await import('@server/domains/browser/handlers/camoufox-browser');
}

function makeDeps() {
  return {
    getCamoufoxManager: vi.fn(() => null),
    setCamoufoxManager: vi.fn(),
    closeCamoufox: vi.fn(async () => {}),
  };
}

describe('CamoufoxBrowserHandlers dependency checks', () => {
  beforeEach(() => {
    mockState.camoufoxError = null;
    mockState.sqliteRelated = false;
    vi.clearAllMocks();
  });

  it('returns a not-installed error when camoufox-js import fails', async () => {
    mockState.camoufoxError = new Error("Cannot find package 'camoufox-js'");
    const { CamoufoxBrowserHandlers } = await loadHandlers();
    const handlers = new CamoufoxBrowserHandlers(makeDeps() as any);
    const parsed = parseJson<any>(await handlers.handleCamoufoxServerLaunch({}));

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Camoufox dependencies check failed');
    expect(parsed.error).toContain('error when mocking a module');
  });

  it('returns a sqlite backend error when dependency probing reports sqlite issues', async () => {
    mockState.camoufoxError = new Error('native sqlite backend mismatch');
    mockState.sqliteRelated = true;
    const { CamoufoxBrowserHandlers } = await loadHandlers();
    const handlers = new CamoufoxBrowserHandlers(makeDeps() as any);
    const parsed = parseJson<any>(await handlers.handleCamoufoxServerLaunch({}));

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('native SQLite backend');
    expect(parsed.error).toContain('SQLite error formatted');
  });
});
