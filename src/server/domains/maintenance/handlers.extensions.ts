import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { logger } from '@utils/logger';
import {
  EXTENSION_GIT_CLONE_TIMEOUT_MS,
  EXTENSION_GIT_CHECKOUT_TIMEOUT_MS,
} from '@src/constants';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolResponse } from '@server/types';
import { asJsonResponse, serializeError } from '@server/domains/shared/response';

const execFileAsync = promisify(execFile);

function getRegistryBaseUrl(): string {
  const baseUrl = (process.env.EXTENSION_REGISTRY_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error(
      'EXTENSION_REGISTRY_BASE_URL is not configured. Set it in .env or environment before browsing or installing extensions.',
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

async function resolvePackageManager(installDir: string): Promise<PackageManagerCommand> {
  const packageJsonPath = resolve(installDir, 'package.json');
  const pnpmLockPath = resolve(installDir, 'pnpm-lock.yaml');
  const npmLockPath = resolve(installDir, 'package-lock.json');

  if (existsSync(packageJsonPath)) {
    try {
      const raw = await readFile(packageJsonPath, 'utf8');
      const pkg = JSON.parse(raw) as { packageManager?: string };
      if (pkg.packageManager?.startsWith('pnpm@')) return 'pnpm';
      if (pkg.packageManager?.startsWith('npm@')) return 'npm';
    } catch {
      // ignore parse/read issues and fall through to lockfile heuristics
    }
  }

  if (existsSync(pnpmLockPath)) return 'pnpm';
  if (existsSync(npmLockPath)) return 'npm';
  return 'pnpm';
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
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

  async handleBrowseExtensionRegistry(
    kind: string,
  ): Promise<ToolResponse> {
    try {
      const registryBase = getRegistryBaseUrl();
      const showPlugins = kind === 'all' || kind === 'plugin';
      const showWorkflows = kind === 'all' || kind === 'workflow';

      const result: Record<string, unknown> = { success: true };

      if (showPlugins) {
        const index = await fetchJson<{ plugins: RegistryEntry[] }>(
          `${registryBase}/plugins.index.json`,
        );
        result.plugins = index.plugins.map((p) => ({
          slug: p.slug,
          id: p.id,
          name: p.meta.name,
          description: p.meta.description,
          author: p.meta.author,
          repo: p.source.repo,
          commit: p.source.commit,
          entry: p.source.entry,
        }));
        result.pluginCount = index.plugins.length;
      }

      if (showWorkflows) {
        const index = await fetchJson<{ workflows: RegistryEntry[] }>(
          `${registryBase}/workflows.index.json`,
        );
        result.workflows = index.workflows.map((w) => ({
          slug: w.slug,
          id: w.id,
          name: w.meta.name,
          description: w.meta.description,
          author: w.meta.author,
          repo: w.source.repo,
          commit: w.source.commit,
          entry: w.source.entry,
        }));
        result.workflowCount = index.workflows.length;
      }

      return asJsonResponse(result);
    } catch (error) {
      logger.error('Failed to browse extension registry:', error);
      return asJsonResponse(serializeError(error));
    }
  }

  async handleInstallExtension(
    slug: string,
    targetDir?: string,
  ): Promise<ToolResponse> {
    try {
      const registryBase = getRegistryBaseUrl();
      // Fetch both indices to find the extension
      const [pluginsIndex, workflowsIndex] = await Promise.all([
        fetchJson<{ plugins: RegistryEntry[] }>(`${registryBase}/plugins.index.json`),
        fetchJson<{ workflows: RegistryEntry[] }>(`${registryBase}/workflows.index.json`),
      ]);

      const entry =
        pluginsIndex.plugins.find((p) => p.slug === slug) ??
        workflowsIndex.workflows.find((w) => w.slug === slug);

      if (!entry) {
        return asJsonResponse({
          success: false,
          error: `Extension "${slug}" not found in registry`,
          availableSlugs: [
            ...pluginsIndex.plugins.map((p) => p.slug),
            ...workflowsIndex.workflows.map((w) => w.slug),
          ],
        });
      }

      const isWorkflow = workflowsIndex.workflows.some((w) => w.slug === slug);
      const defaultRoot = isWorkflow ? './workflows' : './plugins';
      const installDir = targetDir
        ? resolve(targetDir)
        : resolve(process.cwd(), defaultRoot, slug);

      if (existsSync(installDir)) {
        return asJsonResponse({
          success: false,
          error: `Target directory already exists: ${installDir}`,
          hint: 'Remove the existing directory first, or specify a different targetDir',
        });
      }

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
        const packageManager = await resolvePackageManager(installDir);
        const installArgs = packageManager === 'pnpm'
          ? ['install', '--no-frozen-lockfile']
          : ['install'];

        await execFileAsync(packageManager, installArgs, {
          cwd: installDir,
          timeout: Math.max(EXTENSION_GIT_CLONE_TIMEOUT_MS, 120_000),
        });

        await execFileAsync(packageManager, ['run', 'build', '--if-present'], {
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
      return asJsonResponse(serializeError(error));
    }
  }
}
