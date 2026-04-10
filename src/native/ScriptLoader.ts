import { promises as fs, existsSync } from 'fs';
import { join } from 'node:path';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';

// Lazy-initialize base directory to avoid direct import.meta parsing pitfalls.
let _scriptsBaseDir: string | null = null;

function tryGetEsmBaseDir(): string | null {
  try {
    const readImportMetaUrl = new Function(
      'try { return import.meta.url ?? null; } catch { return null; }',
    ) as () => string | null;

    const metaUrl = readImportMetaUrl();
    return metaUrl ? fileURLToPath(new URL('.', metaUrl)) : null;
  } catch {
    return null;
  }
}

function getScriptsBaseDir(): string {
  if (_scriptsBaseDir) return _scriptsBaseDir;

  const esmBaseDir = tryGetEsmBaseDir();
  if (esmBaseDir) {
    _scriptsBaseDir = esmBaseDir;
    return _scriptsBaseDir;
  }

  // Fallback for test/CLI contexts where import.meta is unavailable.
  return process.cwd();
}

export class ScriptLoader {
  private scriptCache = new Map<string, string>();
  private scriptsDir: string;

  constructor() {
    const esmDir = getScriptsBaseDir();
    // In tsdown flat mode, esmDir is 'dist' so we check native/scripts.
    // In src or test mode, it's deep inside src/native, where scripts are alongside it.
    if (existsSync(join(esmDir, 'native', 'scripts'))) {
      this.scriptsDir = join(esmDir, 'native', 'scripts');
    } else if (existsSync(join(esmDir, 'scripts'))) {
      this.scriptsDir = join(esmDir, 'scripts');
    } else if (existsSync(join(process.cwd(), 'dist', 'native', 'scripts'))) {
      this.scriptsDir = join(process.cwd(), 'dist', 'native', 'scripts');
    } else {
      this.scriptsDir = join(process.cwd(), 'src', 'native', 'scripts');
    }
  }

  async loadScript(name: string): Promise<string> {
    if (this.scriptCache.has(name)) {
      return this.scriptCache.get(name)!;
    }

    const plat = platform();
    const platformDir = plat === 'win32' ? 'windows' : plat === 'darwin' ? 'macos' : 'linux';
    const scriptPath = join(this.scriptsDir, platformDir, name);

    const content = await fs.readFile(scriptPath, 'utf-8');
    this.scriptCache.set(name, content);
    return content;
  }

  /**
   * Get the file system path to a script (for -File execution)
   */
  getScriptPath(name: string): string {
    const plat = platform();
    const platformDir = plat === 'win32' ? 'windows' : plat === 'darwin' ? 'macos' : 'linux';
    return join(this.scriptsDir, platformDir, name);
  }

  clearCache(): void {
    this.scriptCache.clear();
  }
}
