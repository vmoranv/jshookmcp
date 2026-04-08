import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface RegisteredPluginManifest {
  id: string;
  name: string;
  version: string;
  entry: string;
  permissions?: string[];
}

interface StoredPluginManifest {
  id: string;
  name: string;
  version: string;
  entry: string;
  permissions: string[];
  status: 'loaded' | 'unloaded';
}

interface LoadedPluginRecord {
  manifest: StoredPluginManifest;
  exports: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
  return normalized.length > 0 ? normalized : `plugin-${Date.now()}`;
}

function toStoredPluginManifest(value: unknown): StoredPluginManifest | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, name, version, entry, permissions, status } = value;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof version !== 'string' ||
    typeof entry !== 'string' ||
    (status !== 'loaded' && status !== 'unloaded')
  ) {
    return null;
  }

  return {
    id,
    name,
    version,
    entry,
    permissions: Array.isArray(permissions)
      ? permissions.filter((permission): permission is string => typeof permission === 'string')
      : [],
    status,
  };
}

export class PluginRegistry {
  private readonly rootDir: string;

  private readonly registryFile: string;

  private readonly moduleCacheDir: string;

  private readonly installedPlugins = new Map<string, StoredPluginManifest>();

  private readonly loadedPlugins = new Map<string, LoadedPluginRecord>();

  constructor(rootDir = path.resolve(process.cwd(), 'artifacts', 'extension-registry')) {
    this.rootDir = rootDir;
    this.registryFile = path.join(rootDir, 'plugins.json');
    this.moduleCacheDir = path.join(rootDir, 'modules');
    this.initializeFromDisk();
  }

  async register(plugin: RegisteredPluginManifest): Promise<string> {
    const pluginId = sanitizeId(plugin.id || plugin.name);
    const manifest: StoredPluginManifest = {
      id: pluginId,
      name: plugin.name,
      version: plugin.version,
      entry: plugin.entry,
      permissions: plugin.permissions ? [...plugin.permissions] : [],
      status: this.loadedPlugins.has(pluginId) ? 'loaded' : 'unloaded',
    };

    this.installedPlugins.set(pluginId, manifest);
    await this.persist();
    return pluginId;
  }

  async unregister(pluginId: string): Promise<void> {
    await this.unloadPlugin(pluginId);
    this.installedPlugins.delete(pluginId);
    await this.persist();
  }

  listInstalled(): {
    id: string;
    name: string;
    version: string;
    status: 'loaded' | 'unloaded';
    permissions: string[];
  }[] {
    return [...this.installedPlugins.values()]
      .map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        status: plugin.status,
        permissions: [...plugin.permissions],
      }))
      .toSorted((left, right) => left.name.localeCompare(right.name));
  }

  async loadPlugin(
    pluginId: string,
  ): Promise<{ manifest: RegisteredPluginManifest; exports: Record<string, unknown> }> {
    const manifest = this.installedPlugins.get(pluginId);
    if (!manifest) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const existing = this.loadedPlugins.get(pluginId);
    if (existing) {
      return {
        manifest: this.toPublicManifest(existing.manifest),
        exports: existing.exports,
      };
    }

    const entryPath = await this.resolveEntryPath(manifest);
    const importUrl = pathToFileURL(entryPath);
    importUrl.searchParams.set('ts', String(Date.now()));
    const moduleExports: unknown = await import(importUrl.href);
    const exportsRecord = isRecord(moduleExports) ? moduleExports : {};

    manifest.status = 'loaded';
    this.loadedPlugins.set(pluginId, {
      manifest,
      exports: exportsRecord,
    });
    await this.persist();

    return {
      manifest: this.toPublicManifest(manifest),
      exports: exportsRecord,
    };
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    const manifest = this.installedPlugins.get(pluginId);
    if (!manifest) {
      return;
    }

    this.loadedPlugins.delete(pluginId);
    manifest.status = 'unloaded';
    await this.persist();
  }

  private initializeFromDisk(): void {
    if (!existsSync(this.rootDir)) {
      mkdirSync(this.rootDir, { recursive: true });
    }

    if (!existsSync(this.moduleCacheDir)) {
      mkdirSync(this.moduleCacheDir, { recursive: true });
    }

    if (!existsSync(this.registryFile)) {
      return;
    }

    const content = readFileSync(this.registryFile, 'utf8');
    if (!content.trim()) {
      return;
    }

    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      return;
    }

    for (const item of parsed) {
      const manifest = toStoredPluginManifest(item);
      if (manifest) {
        this.installedPlugins.set(manifest.id, manifest);
      }
    }
  }

  private async persist(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await mkdir(this.moduleCacheDir, { recursive: true });
    await writeFile(
      this.registryFile,
      JSON.stringify([...this.installedPlugins.values()], null, 2),
      'utf8',
    );
  }

  private async resolveEntryPath(manifest: StoredPluginManifest): Promise<string> {
    if (manifest.entry.startsWith('http://') || manifest.entry.startsWith('https://')) {
      return this.downloadRemoteModule(manifest.id, manifest.entry);
    }

    if (manifest.entry.startsWith('file://')) {
      return fileURLToPath(new URL(manifest.entry));
    }

    return path.isAbsolute(manifest.entry)
      ? manifest.entry
      : path.resolve(process.cwd(), manifest.entry);
  }

  private async downloadRemoteModule(pluginId: string, url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to download plugin module: ${response.status} ${response.statusText}`,
      );
    }

    const source = await response.text();
    const outputPath = path.join(this.moduleCacheDir, `${sanitizeId(pluginId)}.mjs`);
    await mkdir(this.moduleCacheDir, { recursive: true });
    await writeFile(outputPath, source, 'utf8');
    return outputPath;
  }

  private toPublicManifest(manifest: StoredPluginManifest): RegisteredPluginManifest {
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      entry: manifest.entry,
      permissions: [...manifest.permissions],
    };
  }
}
