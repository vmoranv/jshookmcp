import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getExtensionRegistryDir, getProjectRoot } from '@utils/outputPaths';
import { getGlobalInstrumentation, MetricNames, SpanNames } from '@utils/instrumentation';

/** Payload for `extension:loaded` on the server event bus. */
export interface PluginLoadedEvent {
  pluginId: string;
  toolCount: number;
  source: string;
  timestamp: string;
}

/** Payload for `extension:unloaded` on the server event bus. */
export interface PluginUnloadedEvent {
  pluginId: string;
  timestamp: string;
}

/**
 * Minimal event-sink port for plugin lifecycle events.
 *
 * Declared structurally here so the module layer does not import the server
 * `EventBus`/`ServerEventMap` contract. `EventBus<ServerEventMap>` satisfies it,
 * so the extension-registry domain can still pass `ctx.eventBus` unchanged.
 */
export interface PluginEventBus {
  emit(event: 'extension:loaded', payload: PluginLoadedEvent): void | Promise<void>;
  emit(event: 'extension:unloaded', payload: PluginUnloadedEvent): void | Promise<void>;
}

export interface RegisteredPluginManifest {
  id: string;
  name: string;
  version: string;
  entry: string;
  permissions?: string[];
}

export interface RegisteredPluginInfo {
  id: string;
  name: string;
  version: string;
  entry: string;
  permissions: string[];
  status: 'loaded' | 'unloaded';
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
  const trimmed = value.trim().toLowerCase();
  const normalized = trimmed.replace(/\//g, '-').replace(/(?!^@)[^a-z0-9@_-]+/g, '-');
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

/**
 * Number of invocable contexts a loaded plugin module exposes — its callable
 * "tool" surface, not its raw export count. Mirrors the resolution rules in
 * `resolveContext`: a top-level function export, or a function member of a
 * `default` object export. Reported as `toolCount` on `extension:loaded`.
 */
function countPluginTools(exportsRecord: Record<string, unknown>): number {
  let count = 0;
  for (const [key, value] of Object.entries(exportsRecord)) {
    if (typeof value === 'function') {
      count += 1;
      continue;
    }
    if (key === 'default' && isRecord(value)) {
      count += Object.values(value).filter((member) => typeof member === 'function').length;
    }
  }
  return count;
}

export class PluginRegistry {
  private readonly rootDir: string;

  private readonly registryFile: string;

  private readonly moduleCacheDir: string;

  private readonly installedPlugins = new Map<string, StoredPluginManifest>();

  private readonly loadedPlugins = new Map<string, LoadedPluginRecord>();

  /**
   * Server event bus used to publish the `extension:loaded` / `extension:unloaded`
   * lifecycle events. Optional: the registry works without it (the events are
   * simply not published) so callers that only need registry state — tests, the
   * lazy handler default — need no bus. Production threads the single server bus
   * in via the extension-registry domain manifest (`ctx.eventBus`).
   */
  private readonly eventBus?: PluginEventBus;

  /**
   * Per-key mutual-exclusion locks implemented as Promise chains.
   * Ensures operations on the same pluginId (cache-check+download+write,
   * load+unload manifest mutation) are serialised without introducing a
   * heavyweight dependency.  A failing predecessor does NOT block the
   * successor — the `.then(fn, fn)` pattern keeps the chain alive.
   */
  private readonly locks = new Map<string, Promise<unknown>>();

  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(key, next);
    // Garbage-collect completed locks to prevent unbounded growth.
    // Use .then(onFulfilled, onRejected) — NOT .finally() — so the
    // cleanup promise never rejects even when fn throws.  A rejected
    // .finally() promise with no handler is an unhandledRejection
    // that crashes the process under Node --unhandled-rejections=throw.
    void next.then(
      () => {
        if (this.locks.get(key) === next) this.locks.delete(key);
      },
      () => {
        if (this.locks.get(key) === next) this.locks.delete(key);
      },
    );
    return next;
  }

  constructor(rootDir: string = getExtensionRegistryDir(), eventBus?: PluginEventBus) {
    this.rootDir = rootDir;
    this.eventBus = eventBus;
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

  getInstalled(pluginId: string): RegisteredPluginInfo | undefined {
    const manifest = this.installedPlugins.get(pluginId);
    if (!manifest) {
      return undefined;
    }

    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      entry: manifest.entry,
      permissions: [...manifest.permissions],
      status: manifest.status,
    };
  }

  /**
   * `plugin_active_total` — gauge of currently LOADED plugins.
   *
   * Emitted at the two points the loaded set actually changes, not sampled on a
   * timer and not derived from `listInstalled()`: that reports installed, which
   * is a different number, and a gauge refreshed only when someone asks is stale
   * exactly when it matters.
   */
  private recordActivePluginCount(action: 'load' | 'unload', pluginId: string): void {
    getGlobalInstrumentation().emitMetric(
      MetricNames.pluginActiveTotal,
      this.loadedPlugins.size,
      'gauge',
      { action, pluginId },
    );
  }

  async loadPlugin(
    pluginId: string,
  ): Promise<{ manifest: RegisteredPluginManifest; exports: Record<string, unknown> }> {
    const span = getGlobalInstrumentation().startSpan(SpanNames.pluginLifecycle, {
      action: 'load',
      pluginId,
    });
    try {
      const result = await this.withLock(`plugin:${pluginId}`, async () => {
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

        // Clone the manifest so mutations never leak through the reference
        // shared with unloadPlugin / persisted state.
        const loaded: StoredPluginManifest = {
          ...manifest,
          status: 'loaded',
        };
        manifest.status = 'loaded';
        this.loadedPlugins.set(pluginId, {
          manifest: loaded,
          exports: exportsRecord,
        });
        this.recordActivePluginCount('load', pluginId);
        await this.persist();
        // Only the genuine first-load branch reaches here — the cached
        // `existing` branch above returns early, so a repeat loadPlugin() call
        // does not re-announce a load that already happened.
        void this.eventBus?.emit('extension:loaded', {
          pluginId,
          toolCount: countPluginTools(exportsRecord),
          source: loaded.entry,
          timestamp: new Date().toISOString(),
        });

        return {
          manifest: this.toPublicManifest(loaded),
          exports: exportsRecord,
        };
      });
      span.end({ status: 'ok', loaded: this.loadedPlugins.size });
      return result;
    } catch (error) {
      span.end({ status: 'error' });
      throw error;
    }
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    const span = getGlobalInstrumentation().startSpan(SpanNames.pluginLifecycle, {
      action: 'unload',
      pluginId,
    });
    try {
      await this.withLock(`plugin:${pluginId}`, async () => {
        const manifest = this.installedPlugins.get(pluginId);
        if (!manifest) {
          return;
        }

        // Map.delete reports whether the plugin was actually in the loaded set,
        // so `extension:unloaded` marks a real transition out of it and not an
        // unload of a plugin that was never loaded.
        const wasLoaded = this.loadedPlugins.delete(pluginId);
        this.recordActivePluginCount('unload', pluginId);
        manifest.status = 'unloaded';
        await this.persist();
        if (wasLoaded) {
          void this.eventBus?.emit('extension:unloaded', {
            pluginId,
            timestamp: new Date().toISOString(),
          });
        }
      });
      span.end({ status: 'ok', loaded: this.loadedPlugins.size });
    } catch (error) {
      span.end({ status: 'error' });
      throw error;
    }
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
      : path.resolve(getProjectRoot(), manifest.entry);
  }

  private async downloadRemoteModule(pluginId: string, url: string): Promise<string> {
    return this.withLock(`download:${pluginId}`, async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Failed to download plugin module: ${response.status} ${response.statusText}`,
        );
      }

      const source = await response.text();
      const outputPath = path.join(this.moduleCacheDir, `${sanitizeId(pluginId)}.mjs`);

      // Content-addressable cache check: skip rewrite when the existing copy is
      // byte-identical to the freshly fetched source. Avoids touching mtime,
      // invalidating dynamic-import caches, and re-paying disk-write cost for
      // unchanged remote modules.
      const newHash = createHash('sha256').update(source).digest('hex');
      try {
        const existing = await readFile(outputPath, 'utf8');
        const existingHash = createHash('sha256').update(existing).digest('hex');
        if (existingHash === newHash) {
          return outputPath;
        }
      } catch {
        // Cached copy missing or unreadable — fall through to write.
      }

      await mkdir(this.moduleCacheDir, { recursive: true });
      await writeFile(outputPath, source, 'utf8');
      return outputPath;
    });
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
