import { promises as fs, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { platform } from 'os';
import { fileURLToPath } from 'node:url';

// Lazy-initialize base directory to avoid direct import.meta parsing pitfalls.
let _scriptsBaseDir: string | null = null;

function tryGetEsmBaseDir(): string | null {
  try {
    const readImportMetaPath = new Function(
      'try { return import.meta.dirname ?? import.meta.url ?? null; } catch { return null; }'
    ) as () => string | null;

    const metaPath = readImportMetaPath();
    if (!metaPath) return null;

    if (metaPath.startsWith('file://')) {
      return dirname(fileURLToPath(metaPath));
    }
    return metaPath;
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
  const distNativeDir = resolve(process.cwd(), 'dist', 'native');
  const srcNativeDir = resolve(process.cwd(), 'src', 'native');
  _scriptsBaseDir = existsSync(join(distNativeDir, 'scripts'))
    ? distNativeDir
    : existsSync(join(srcNativeDir, 'scripts'))
      ? srcNativeDir
      : distNativeDir;
  return _scriptsBaseDir;
}

export class ScriptLoader {
  private scriptCache = new Map<string, string>();
  private scriptsDir: string;

  constructor() {
    this.scriptsDir = join(getScriptsBaseDir(), 'scripts');
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
