import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join, resolve } from 'node:path';

const state = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFile: vi.fn(),
  platform: vi.fn(),
}));

vi.mock('fs', () => ({
  promises: {
    readFile: state.readFile,
  },
  existsSync: state.existsSync,
}));

vi.mock('os', () => ({
  platform: state.platform,
}));

describe('ScriptLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    state.platform.mockReturnValue('win32');
    state.readFile.mockResolvedValue('Write-Host "ok"');
    state.existsSync.mockImplementation((path: string) =>
      path.endsWith(join('dist', 'native', 'scripts'))
    );
  });

  it('prefers dist/native scripts when they exist', async () => {
    const { ScriptLoader } = await import('@src/native/ScriptLoader');
    const loader = new ScriptLoader();

    expect(loader.getScriptPath('read-memory.ps1')).toBe(
      join(resolve(process.cwd(), 'dist', 'native'), 'scripts', 'windows', 'read-memory.ps1')
    );
  });

  it('falls back to src/native scripts when dist scripts are missing', async () => {
    state.existsSync.mockImplementation((path: string) =>
      path.endsWith(join('src', 'native', 'scripts'))
    );

    const { ScriptLoader } = await import('@src/native/ScriptLoader');
    const loader = new ScriptLoader();

    expect(loader.getScriptPath('inject.ps1')).toBe(
      join(resolve(process.cwd(), 'src', 'native'), 'scripts', 'windows', 'inject.ps1')
    );
  });

  it('caches loaded scripts until the cache is cleared', async () => {
    const { ScriptLoader } = await import('@src/native/ScriptLoader');
    const loader = new ScriptLoader();

    await expect(loader.loadScript('scan.ps1')).resolves.toBe('Write-Host "ok"');
    await expect(loader.loadScript('scan.ps1')).resolves.toBe('Write-Host "ok"');
    expect(state.readFile).toHaveBeenCalledTimes(1);

    loader.clearCache();
    await loader.loadScript('scan.ps1');
    expect(state.readFile).toHaveBeenCalledTimes(2);
  });

  it('uses the current OS platform when resolving script file paths', async () => {
    state.platform.mockReturnValue('darwin');

    const { ScriptLoader } = await import('@src/native/ScriptLoader');
    const loader = new ScriptLoader();

    await loader.loadScript('probe.sh');

    expect(state.readFile).toHaveBeenCalledWith(
      join(resolve(process.cwd(), 'dist', 'native'), 'scripts', 'macos', 'probe.sh'),
      'utf-8'
    );
  });
});
