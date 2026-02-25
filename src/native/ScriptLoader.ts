import { promises as fs } from 'fs';
import { join, dirname, resolve } from 'path';
import { platform } from 'os';

// Declare __dirname for CommonJS compatibility (Jest)
declare const __dirname: string | undefined;

// Lazy-initialize base directory to avoid import.meta issues in Jest
let _scriptsBaseDir: string | null = null;

function getScriptsBaseDir(): string {
  if (_scriptsBaseDir) return _scriptsBaseDir;

  // Try CommonJS first (Jest environment)
  try {
    if (typeof __dirname !== 'undefined' && __dirname) {
      _scriptsBaseDir = __dirname;
      return _scriptsBaseDir;
    }
  } catch {}

  // Try ESM via import.meta.url (wrapped to prevent parse-time error)
  try {
    // Use Function constructor to avoid parse-time error
    const getDirFromImportMeta = new Function('return typeof import.meta !== "undefined" ? import.meta.url : null');
    const importMetaUrl = getDirFromImportMeta();
    if (importMetaUrl) {
      const thisPath = new URL(importMetaUrl).pathname;
      // Handle Windows path (remove leading /)
      _scriptsBaseDir = dirname(decodeURIComponent(process.platform === 'win32' ? thisPath.slice(1) : thisPath));
      return _scriptsBaseDir;
    }
  } catch {}

  // Fallback to dist/native relative to cwd
  _scriptsBaseDir = resolve(process.cwd(), 'dist', 'native');
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
