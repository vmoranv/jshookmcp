import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { logger } from '@utils/logger';
import { EXTENSION_GIT_CLONE_TIMEOUT_MS, EXTENSION_GIT_CHECKOUT_TIMEOUT_MS } from '@src/constants';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolResponse } from '@server/types';
import { asJsonResponse, serializeError } from '@server/domains/shared/response';

const execFileAsync = promisify(execFile);

function getJshookInstallRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return resolve(dirname(currentFile), '..', '..', '..', '..');
}

function parseFirstRoot(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  return value
    .split(',')
    .map((item) => item.trim())
    .find((item) => item.length > 0);
}

function resolveDefaultExtensionRoot(kind: 'plugin' | 'workflow'): string {
  const envKey = kind === 'workflow' ? 'MCP_WORKFLOW_ROOTS' : 'MCP_PLUGIN_ROOTS';
  const configured = parseFirstRoot(process.env[envKey]);
  if (configured) {
    return resolve(configured);
  }

  const installRoot = getJshookInstallRoot();
  return resolve(installRoot, kind === 'workflow' ? 'workflows' : 'plugins');
}

function getRegistryBaseUrl(): string {
  const baseUrl = (process.env.EXTENSION_REGISTRY_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error(
      'EXTENSION_REGISTRY_BASE_URL is not configured. Set it in .env or environment before browsing or installing extensions.'
    );
  }
  return baseUrl;
}

interface RegistryEntry {
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

type PackageManagerCommand = 'pnpm' | 'npm';
type RegistryIndexKind = 'plugins' | 'workflows';

const LOCAL_EXTENSION_SDK_PACKAGE = '@jshookmcp/extension-sdk';
const LOCAL_EXTENSION_SDK_ROOT = resolve(getJshookInstallRoot(), 'packages', 'extension-sdk');

const enum RegistryLimit {
  FETCH_TIMEOUT_MS = 10_000,
}

const REGISTRY_CACHE_DIR = resolve(homedir(), '.jshookmcp', 'cache');

type RegistryFetchCode =
  | 'timeout'
  | 'dns_failure'
  | 'connection_refused'
  | 'tls_error'
  | 'http_error'
  | 'fetch_failed';

interface RegistryFetchResult<T> {
  data: T;
  stale: boolean;
  source: 'network' | 'cache';
  cachePath?: string;
}

class RegistryFetchError extends Error {
  constructor(
    readonly code: RegistryFetchCode,
    readonly url: string,
    message: string,
    readonly cachePath?: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'RegistryFetchError';
  }
}

function resolvePackageManagerInvocation(
  packageManager: PackageManagerCommand,
  args: string[]
): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', `${packageManager} ${args.join(' ')}`],
    };
  }

  return { command: packageManager, args };
}

async function execPackageManager(
  packageManager: PackageManagerCommand,
  args: string[],
  options: Parameters<typeof execFileAsync>[2]
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

async function resolvePackageManager(installDir: string): Promise<PackageManagerCommand> {
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
  return resolve(REGISTRY_CACHE_DIR, `registry-${kind}.json`);
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
  cachePath?: string
): RegistryFetchError {
  if (error instanceof RegistryFetchError) {
    return error;
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return new RegistryFetchError(
      'timeout',
      url,
      `Registry fetch timed out after ${RegistryLimit.FETCH_TIMEOUT_MS}ms: ${url}`,
      cachePath
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('ENOTFOUND') || message.includes('getaddrinfo')) {
    return new RegistryFetchError(
      'dns_failure',
      url,
      `DNS resolution failed for registry URL: ${url}`,
      cachePath
    );
  }
  if (message.includes('ECONNREFUSED')) {
    return new RegistryFetchError(
      'connection_refused',
      url,
      `Connection refused by registry server: ${url}`,
      cachePath
    );
  }
  if (message.includes('CERT_') || message.includes('certificate') || message.includes('SSL')) {
    return new RegistryFetchError(
      'tls_error',
      url,
      `TLS/certificate error when connecting to registry: ${url}`,
      cachePath
    );
  }

  const httpMatch = message.match(/HTTP\s+(\d+)/i);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    return new RegistryFetchError('http_error', url, message, cachePath, status);
  }

  return new RegistryFetchError('fetch_failed', url, message, cachePath);
}

function serializeRegistryFetchError(error: RegistryFetchError): Record<string, unknown> {
  return {
    success: false,
    error: error.code,
    message: error.message,
    url: error.url,
    ...(typeof error.status === 'number' ? { status: error.status } : {}),
    ...(error.cachePath ? { cachePath: error.cachePath } : {}),
  };
}

async function fetchJson<T>(
  url: string,
  options?: { cacheKey?: RegistryIndexKind }
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
        res.status
      );
    }
    const data = (await res.json()) as T;
    if (options?.cacheKey) {
      try {
        await writeRegistryCache(options.cacheKey, data);
      } catch (cacheError) {
        logger.warn(
          `[extensions] Failed to persist ${options.cacheKey} registry cache for ${url}:`,
          cacheError
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
          `[extensions] Using stale ${options.cacheKey} registry cache after ${classified.code}: ${url}`
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
  if (!existsSync(packageJsonPath)) {
    return false;
  }

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
      `[extensions] Rewrote ${LOCAL_EXTENSION_SDK_PACKAGE} dependency to local file path for ${installDir}`
    );
    return true;
  } catch (error) {
    logger.warn(
      `[extensions] Failed to rewrite ${LOCAL_EXTENSION_SDK_PACKAGE} dependency for ${installDir}:`,
      error
    );
    return false;
  }
}

type RegistryEntryMatch = {
  entry: RegistryEntry;
  kind: 'plugin' | 'workflow';
};

async function findRegistryEntryBySlug(
  registryBase: string,
  slug: string
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
      `Failed to resolve extension slug "${slug}": workflow registry error: ${workflowFetchError.message}; plugin registry error: ${pluginFetchError.message}`
    );
  }

  if (pluginFetchError) {
    throw new Error(
      `Extension "${slug}" was not found in workflow registry, and plugin registry lookup failed: ${pluginFetchError.message}`
    );
  }

  if (workflowFetchError) {
    throw new Error(
      `Extension "${slug}" was not found in plugin registry, and workflow registry lookup failed: ${workflowFetchError.message}`
    );
  }

  throw new Error(`Extension "${slug}" not found in workflow or plugin registry`);
}

export class ExtensionManagementHandlers {
  private readonly ctx: MCPServerContext;

  constructor(ctx: MCPServerContext) {
    this.ctx = ctx;
  }

  async handleListExtensions(): Promise<ToolResponse> {
    try {
      const result = this.ctx.listExtensions();
      return asJsonResponse({ success: true, ...result });
    } catch (error) {
      logger.error('Failed to list extensions:', error);
      return asJsonResponse(serializeError(error));
    }
  }

  async handleReloadExtensions(): Promise<ToolResponse> {
    try {
      const result = await this.ctx.reloadExtensions();
      return asJsonResponse({ success: true, ...result });
    } catch (error) {
      logger.error('Failed to reload extensions:', error);
      return asJsonResponse(serializeError(error));
    }
  }

  async handleBrowseExtensionRegistry(kind: string): Promise<ToolResponse> {
    try {
      const registryBase = getRegistryBaseUrl();
      const showPlugins = kind === 'all' || kind === 'plugin';
      const showWorkflows = kind === 'all' || kind === 'workflow';

      const result: Record<string, unknown> = { success: true };
      let stale = false;

      const pluginPromise = showPlugins
        ? fetchJson<{ plugins: RegistryEntry[] }>(`${registryBase}/plugins.index.json`, {
            cacheKey: 'plugins',
          })
        : undefined;
      const workflowPromise = showWorkflows
        ? fetchJson<{ workflows: RegistryEntry[] }>(`${registryBase}/workflows.index.json`, {
            cacheKey: 'workflows',
          })
        : undefined;

      const [pluginIndex, workflowIndex] = await Promise.all([
        pluginPromise ?? Promise.resolve(undefined),
        workflowPromise ?? Promise.resolve(undefined),
      ]);

      if (pluginIndex) {
        const plugins = Array.isArray(pluginIndex.data.plugins) ? pluginIndex.data.plugins : [];
        result.plugins = plugins.map((p) => ({
          slug: p.slug,
          id: p.id,
          name: p.meta.name,
          description: p.meta.description,
          author: p.meta.author,
          repo: p.source.repo,
          commit: p.source.commit,
          entry: p.source.entry,
        }));
        result.pluginCount = plugins.length;
        result.pluginSource = pluginIndex.source;
        stale = stale || pluginIndex.stale;
      }

      if (workflowIndex) {
        const workflows = Array.isArray(workflowIndex.data.workflows)
          ? workflowIndex.data.workflows
          : [];
        result.workflows = workflows.map((w) => ({
          slug: w.slug,
          id: w.id,
          name: w.meta.name,
          description: w.meta.description,
          author: w.meta.author,
          repo: w.source.repo,
          commit: w.source.commit,
          entry: w.source.entry,
        }));
        result.workflowCount = workflows.length;
        result.workflowSource = workflowIndex.source;
        stale = stale || workflowIndex.stale;
      }

      if (stale) {
        result.stale = true;
      }

      return asJsonResponse(result);
    } catch (error) {
      logger.error('Failed to browse extension registry:', error);
      if (error instanceof RegistryFetchError) {
        return asJsonResponse(serializeRegistryFetchError(error));
      }
      return asJsonResponse(serializeError(error));
    }
  }

  async handleInstallExtension(slug: string, targetDir?: string): Promise<ToolResponse> {
    try {
      const registryBase = getRegistryBaseUrl();
      const { entry, kind } = await findRegistryEntryBySlug(registryBase, slug);
      const isWorkflow = kind === 'workflow';
      const defaultRoot = resolveDefaultExtensionRoot(isWorkflow ? 'workflow' : 'plugin');
      const installDir = targetDir ? resolve(targetDir) : resolve(defaultRoot, slug);

      if (existsSync(installDir)) {
        return asJsonResponse({
          success: false,
          error: `Target directory already exists: ${installDir}`,
          hint: 'Remove the existing directory first, or specify a different targetDir',
        });
      }

      await mkdir(dirname(installDir), { recursive: true });

      // Clone
      await execFileAsync('git', ['clone', entry.source.repo, installDir], {
        timeout: EXTENSION_GIT_CLONE_TIMEOUT_MS,
      });

      // Checkout pinned commit
      await execFileAsync('git', ['-C', installDir, 'checkout', entry.source.commit], {
        timeout: EXTENSION_GIT_CHECKOUT_TIMEOUT_MS,
      });

      const packageJsonPath = resolve(installDir, 'package.json');
      if (existsSync(packageJsonPath)) {
        await rewriteLocalExtensionSdkDependency(installDir);
        const packageManager = await resolvePackageManager(installDir);
        const installArgs =
          packageManager === 'pnpm'
            ? ['--ignore-workspace', 'install', '--no-frozen-lockfile']
            : ['install'];

        await execPackageManager(packageManager, installArgs, {
          cwd: installDir,
          timeout: Math.max(EXTENSION_GIT_CLONE_TIMEOUT_MS, 120_000),
        });

        const buildArgs =
          packageManager === 'pnpm'
            ? ['--ignore-workspace', 'run', '--if-present', 'build']
            : ['run', 'build', '--if-present'];

        await execPackageManager(packageManager, buildArgs, {
          cwd: installDir,
          timeout: Math.max(EXTENSION_GIT_CLONE_TIMEOUT_MS, 120_000),
        });
      }

      // Reload extensions to pick up the new plugin
      const reloadResult = await this.ctx.reloadExtensions();

      return asJsonResponse({
        success: true,
        installed: {
          slug: entry.slug,
          id: entry.id,
          name: entry.meta.name,
          repo: entry.source.repo,
          commit: entry.source.commit,
          installDir,
        },
        reload: {
          addedTools: reloadResult.addedTools,
          pluginCount: reloadResult.pluginCount,
          workflowCount: reloadResult.workflowCount,
          errors: reloadResult.errors,
          warnings: reloadResult.warnings,
        },
      });
    } catch (error) {
      logger.error('Failed to install extension:', error);
      if (error instanceof RegistryFetchError) {
        return asJsonResponse(serializeRegistryFetchError(error));
      }
      return asJsonResponse(serializeError(error));
    }
  }
}
