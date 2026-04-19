/**
 * Extension registry utilities — fetch, cache, install helpers.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { logger } from '@utils/logger';
import { getConfig } from '@utils/config';
import { EXTENSION_GIT_CLONE_TIMEOUT_MS, EXTENSION_GIT_CHECKOUT_TIMEOUT_MS } from '@src/constants';
import {
  INSTALLED_EXTENSION_METADATA_FILENAME,
  type InstalledExtensionMetadata,
} from '@server/extensions/types';

export const execFileAsync = promisify(execFile);

export function getJshookInstallRoot(): string {
  return fileURLToPath(new URL('../../../../', import.meta.url));
}

function parseFirstRoot(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  return value
    .split(',')
    .map((item) => item.trim())
    .find((item) => item.length > 0);
}

export function resolveDefaultExtensionRoot(kind: 'plugin' | 'workflow'): string {
  const envKey = kind === 'workflow' ? 'MCP_WORKFLOW_ROOTS' : 'MCP_PLUGIN_ROOTS';
  const configured = parseFirstRoot(process.env[envKey]);
  if (configured) {
    return resolve(configured);
  }

  const installRoot = getJshookInstallRoot();
  return resolve(installRoot, kind === 'workflow' ? 'workflows' : 'plugins');
}

export function getRegistryBaseUrl(): string {
  const baseUrl = (process.env.EXTENSION_REGISTRY_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error(
      'EXTENSION_REGISTRY_BASE_URL is not configured. Set it in .env or environment before browsing or installing extensions.',
    );
  }
  return baseUrl;
}

export interface RegistryEntry {
  slug: string;
  id: string;
  source: {
    type: string;
    repo: string;
    ref: string;
    commit: string;
    subpath: string;
    entry: string;
  };
  meta: {
    name: string;
    description: string;
    author: string;
    source_repo: string;
  };
}

export function normalizeInstallPathSegment(
  value: string | undefined,
  field: 'subpath' | 'entry',
): string {
  const normalized = value?.trim();
  if (!normalized) {
    if (field === 'subpath') {
      return '.';
    }
    throw new Error(`Registry source.${field} must be a non-empty string`);
  }
  return normalized;
}

function ensurePathStaysWithin(
  baseDir: string,
  targetPath: string,
  field: 'subpath' | 'entry',
): void {
  const rel = relative(baseDir, targetPath).replace(/\\/g, '/');
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
    throw new Error(`Registry source.${field} must stay within ${baseDir}: ${targetPath}`);
  }
}

export function resolveExtensionProjectDir(installDir: string, subpath: string): string {
  const normalizedSubpath = normalizeInstallPathSegment(subpath, 'subpath');
  const projectDir = resolve(installDir, normalizedSubpath);
  ensurePathStaysWithin(installDir, projectDir, 'subpath');
  return projectDir;
}

export function resolveExtensionEntryFile(projectDir: string, entryPath: string): string {
  const normalizedEntry = normalizeInstallPathSegment(entryPath, 'entry');
  const resolvedEntryFile = resolve(projectDir, normalizedEntry);
  ensurePathStaysWithin(projectDir, resolvedEntryFile, 'entry');
  return resolvedEntryFile;
}

function buildRuntimeEntryCandidates(entryPath: string): string[] {
  const normalizedEntry = normalizeInstallPathSegment(entryPath, 'entry').replace(/\\/g, '/');
  const candidates = [normalizedEntry];

  if (!normalizedEntry.endsWith('.ts')) {
    return candidates;
  }

  const jsEntry = `${normalizedEntry.slice(0, -3)}.js`;
  candidates.unshift(jsEntry);
  if (!normalizedEntry.startsWith('dist/')) {
    candidates.unshift(`dist/${jsEntry}`);
  }

  return [...new Set(candidates)];
}

export function resolveInstalledRuntimeEntry(projectDir: string, entryPath: string): string {
  const candidates = buildRuntimeEntryCandidates(entryPath);
  for (const candidate of candidates) {
    if (existsSync(resolveExtensionEntryFile(projectDir, candidate))) {
      return candidate;
    }
  }

  return normalizeInstallPathSegment(entryPath, 'entry');
}

export async function writeInstalledExtensionMetadata(
  kind: 'plugin' | 'workflow',
  entry: RegistryEntry,
  projectDir: string,
  installedEntryPath: string,
): Promise<string> {
  const payload: InstalledExtensionMetadata = {
    version: 1,
    kind,
    slug: entry.slug,
    id: entry.id,
    source: {
      type: entry.source.type,
      repo: entry.source.repo,
      ref: entry.source.ref,
      commit: entry.source.commit,
      subpath: normalizeInstallPathSegment(entry.source.subpath, 'subpath'),
      entry: normalizeInstallPathSegment(installedEntryPath, 'entry'),
    },
  };
  const metadataPath = resolve(projectDir, INSTALLED_EXTENSION_METADATA_FILENAME);
  await writeFile(metadataPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return metadataPath;
}

type PackageManagerCommand = 'pnpm' | 'npm';
type RegistryIndexKind = 'plugins' | 'workflows';

const LOCAL_EXTENSION_SDK_PACKAGE = '@jshookmcp/extension-sdk';
const LOCAL_EXTENSION_SDK_ROOT = resolve(getJshookInstallRoot(), 'packages', 'extension-sdk');

const enum RegistryLimit {
  FETCH_TIMEOUT_MS = 10_000,
}

function getRegistryCacheDir(): string {
  return getConfig().paths.registryCacheDir;
}

type RegistryFetchCode =
  | 'timeout'
  | 'dns_failure'
  | 'connection_refused'
  | 'tls_error'
  | 'http_error'
  | 'fetch_failed';

export interface RegistryFetchResult<T> {
  data: T;
  stale: boolean;
  source: 'network' | 'cache';
  cachePath?: string;
}

export class RegistryFetchError extends Error {
  constructor(
    readonly code: RegistryFetchCode,
    readonly url: string,
    message: string,
    readonly cachePath?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RegistryFetchError';
  }
}

function resolvePackageManagerInvocation(
  packageManager: PackageManagerCommand,
  args: string[],
): { command: string; args: string[] } {
  if (process.platform !== 'win32') {
    /* istanbul ignore next -- OS specific fallback */
    return { command: packageManager, args };
  }

  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', `${packageManager} ${args.join(' ')}`],
  };
}

export async function execPackageManager(
  packageManager: PackageManagerCommand,
  args: string[],
  options: Parameters<typeof execFileAsync>[2],
) {
  const invocation = resolvePackageManagerInvocation(packageManager, args);
  return execFileAsync(invocation.command, invocation.args, {
    ...options,
    env: {
      ...process.env,
      ...options?.env,
      CI: 'true',
    },
  });
}

export async function resolvePackageManager(installDir: string): Promise<PackageManagerCommand> {
  const packageJsonPath = resolve(installDir, 'package.json');
  const pnpmLockPath = resolve(installDir, 'pnpm-lock.yaml');
  const npmLockPath = resolve(installDir, 'package-lock.json');

  if (existsSync(packageJsonPath)) {
    try {
      const raw = await readFile(packageJsonPath, 'utf8');
      const pkg = JSON.parse(raw) as { packageManager?: string };
      const packageManager = pkg.packageManager?.trim().toLowerCase().split('@')[0];
      if (packageManager === 'pnpm') return 'pnpm';
      if (packageManager === 'npm') return 'npm';
    } catch {
      // ignore parse/read issues and fall through to lockfile heuristics
    }
  }

  if (existsSync(pnpmLockPath)) return 'pnpm';
  if (existsSync(npmLockPath)) return 'npm';
  return 'pnpm';
}

function getRegistryCachePath(kind: RegistryIndexKind): string {
  return resolve(getRegistryCacheDir(), `registry-${kind}.json`);
}

async function readRegistryCache<T>(kind: RegistryIndexKind): Promise<T | null> {
  const cachePath = getRegistryCachePath(kind);
  try {
    const raw = await readFile(cachePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeRegistryCache(kind: RegistryIndexKind, payload: unknown): Promise<void> {
  const cachePath = getRegistryCachePath(kind);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf8');
}

function classifyRegistryFetchError(
  url: string,
  error: unknown,
  cachePath?: string,
): RegistryFetchError {
  if (error instanceof RegistryFetchError) {
    return error;
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return new RegistryFetchError(
      'timeout',
      url,
      `Registry fetch timed out after ${RegistryLimit.FETCH_TIMEOUT_MS}ms: ${url}`,
      cachePath,
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
    return new RegistryFetchError(
      'dns_failure',
      url,
      `DNS resolution failed for registry URL: ${url}`,
      cachePath,
    );
  }
  if (message.includes('ECONNREFUSED')) {
    return new RegistryFetchError(
      'connection_refused',
      url,
      `Connection refused by registry server: ${url}`,
      cachePath,
    );
  }
  if (message.includes('CERT_') || message.includes('certificate') || message.includes('SSL')) {
    return new RegistryFetchError(
      'tls_error',
      url,
      `TLS/certificate error when connecting to registry: ${url}`,
      cachePath,
    );
  }

  const httpMatch = message.match(/HTTP\s+(\d+)/i);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    return new RegistryFetchError('http_error', url, message, cachePath, status);
  }

  return new RegistryFetchError('fetch_failed', url, message, cachePath);
}

export function serializeRegistryFetchError(error: RegistryFetchError): Record<string, unknown> {
  return {
    success: false,
    error: error.code,
    message: error.message,
    url: error.url,
    // SECURITY: Do NOT include cachePath in error response — it leaks filesystem layout.
    ...(typeof error.status === 'number' ? { status: error.status } : {}),
  };
}

export async function fetchJson<T>(
  url: string,
  options?: { cacheKey?: RegistryIndexKind },
): Promise<RegistryFetchResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RegistryLimit.FETCH_TIMEOUT_MS);
  const cachePath = options?.cacheKey ? getRegistryCachePath(options.cacheKey) : undefined;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new RegistryFetchError(
        'http_error',
        url,
        `HTTP ${res.status} ${res.statusText} from ${url}`,
        cachePath,
        res.status,
      );
    }
    const data = (await res.json()) as T;
    if (options?.cacheKey) {
      try {
        await writeRegistryCache(options.cacheKey, data);
      } catch (cacheError) {
        logger.warn(
          `[extensions] Failed to persist ${options.cacheKey} registry cache for ${url}:`,
          cacheError,
        );
      }
    }
    return {
      data,
      stale: false,
      source: 'network',
      cachePath,
    };
  } catch (error: unknown) {
    const classified = classifyRegistryFetchError(url, error, cachePath);
    if (options?.cacheKey) {
      const cached = await readRegistryCache<T>(options.cacheKey);
      if (cached) {
        logger.warn(
          `[extensions] Using stale ${options.cacheKey} registry cache after ${classified.code}: ${url}`,
        );
        return {
          data: cached,
          stale: true,
          source: 'cache',
          cachePath,
        };
      }
    }
    throw classified;
  } finally {
    clearTimeout(timer);
  }
}

async function rewriteLocalExtensionSdkDependency(installDir: string): Promise<boolean> {
  const packageJsonPath = resolve(installDir, 'package.json');

  try {
    const raw = await readFile(packageJsonPath, 'utf8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const sections = [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ];
    const relativeSdkPath = relative(installDir, LOCAL_EXTENSION_SDK_ROOT).replace(/\\/g, '/');
    const localSdkSpec = `file:${relativeSdkPath || '.'}`;
    let changed = false;

    for (const sectionName of sections) {
      const section = pkg[sectionName];
      if (!section || typeof section !== 'object') {
        continue;
      }
      const dependencyMap = section as Record<string, unknown>;
      const currentValue = dependencyMap[LOCAL_EXTENSION_SDK_PACKAGE];
      if (typeof currentValue === 'string' && currentValue.startsWith('workspace:')) {
        dependencyMap[LOCAL_EXTENSION_SDK_PACKAGE] = localSdkSpec;
        changed = true;
      }
    }

    if (!changed) {
      return false;
    }

    await writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    logger.info(
      `[extensions] Rewrote ${LOCAL_EXTENSION_SDK_PACKAGE} dependency to local file path for ${installDir}`,
    );
    return true;
  } catch (error) {
    logger.warn(
      `[extensions] Failed to rewrite ${LOCAL_EXTENSION_SDK_PACKAGE} dependency for ${installDir}:`,
      error,
    );
    return false;
  }
}

type RegistryEntryMatch = {
  entry: RegistryEntry;
  kind: 'plugin' | 'workflow';
};

export async function findRegistryEntryBySlug(
  registryBase: string,
  slug: string,
): Promise<RegistryEntryMatch> {
  const [workflowResult, pluginResult] = await Promise.allSettled([
    fetchJson<{ workflows: RegistryEntry[] }>(`${registryBase}/workflows.index.json`, {
      cacheKey: 'workflows',
    }),
    fetchJson<{ plugins: RegistryEntry[] }>(`${registryBase}/plugins.index.json`, {
      cacheKey: 'plugins',
    }),
  ]);

  if (workflowResult.status === 'fulfilled') {
    const workflows = Array.isArray(workflowResult.value.data.workflows)
      ? workflowResult.value.data.workflows
      : [];
    const workflowEntry = workflows.find((item) => item.slug === slug);
    if (workflowEntry) {
      return { entry: workflowEntry, kind: 'workflow' };
    }
  }

  if (pluginResult.status === 'fulfilled') {
    const plugins = Array.isArray(pluginResult.value.data.plugins)
      ? pluginResult.value.data.plugins
      : [];
    const pluginEntry = plugins.find((item) => item.slug === slug);
    if (pluginEntry) {
      return { entry: pluginEntry, kind: 'plugin' };
    }
  }

  const workflowFetchError =
    workflowResult.status === 'rejected'
      ? workflowResult.reason instanceof Error
        ? workflowResult.reason
        : new Error(String(workflowResult.reason))
      : undefined;
  const pluginFetchError =
    pluginResult.status === 'rejected'
      ? pluginResult.reason instanceof Error
        ? pluginResult.reason
        : new Error(String(pluginResult.reason))
      : undefined;

  if (workflowFetchError && pluginFetchError) {
    throw new Error(
      `Failed to resolve extension slug "${slug}": workflow registry error: ${workflowFetchError.message}; plugin registry error: ${pluginFetchError.message}`,
    );
  }

  if (pluginFetchError) {
    throw new Error(
      `Extension "${slug}" was not found in workflow registry, and plugin registry lookup failed: ${pluginFetchError.message}`,
    );
  }

  if (workflowFetchError) {
    throw new Error(
      `Extension "${slug}" was not found in plugin registry, and workflow registry lookup failed: ${workflowFetchError.message}`,
    );
  }

  throw new Error(`Extension "${slug}" not found in workflow or plugin registry`);
}

export {
  EXTENSION_GIT_CLONE_TIMEOUT_MS,
  EXTENSION_GIT_CHECKOUT_TIMEOUT_MS,
  rewriteLocalExtensionSdkDependency,
};
