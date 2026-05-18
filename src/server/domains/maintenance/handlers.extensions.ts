import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { logger } from '@utils/logger';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolResponse } from '@server/types';
import { asJsonResponse, serializeError } from '@server/domains/shared/response';
import {
  EXTENSION_GIT_CHECKOUT_TIMEOUT_MS,
  EXTENSION_GIT_CLONE_TIMEOUT_MS,
  type RegistryEntry,
  RegistryFetchError,
  execFileAsync,
  execPackageManager,
  fetchJson,
  findRegistryEntryBySlug,
  getRegistryBaseUrl,
  resolveDefaultExtensionRoot,
  assertPublishedExtensionSdkDependency,
  resolveExtensionEntryFile,
  resolveExtensionProjectDir,
  resolveInstalledRuntimeEntry,
  resolvePackageManager,
  serializeRegistryFetchError,
  writeInstalledExtensionMetadata,
} from './handlers/extension-registry-utils';

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

      const pluginIndexPromise = showPlugins
        ? fetchJson<{ plugins: RegistryEntry[] }>(`${registryBase}/plugins.index.json`, {
            cacheKey: 'plugins',
          })
        : undefined;
      const workflowIndexPromise = showWorkflows
        ? fetchJson<{ workflows: RegistryEntry[] }>(`${registryBase}/workflows.index.json`, {
            cacheKey: 'workflows',
          })
        : undefined;

      const [pluginIndex, workflowIndex] = await Promise.all([
        pluginIndexPromise ?? Promise.resolve(undefined),
        workflowIndexPromise ?? Promise.resolve(undefined),
      ]);

      if (pluginIndex) {
        const plugins = Array.isArray(pluginIndex.data.plugins) ? pluginIndex.data.plugins : [];
        result.plugins = plugins.map((plugin) => ({
          slug: plugin.slug,
          id: plugin.id,
          name: plugin.meta.name,
          description: plugin.meta.description,
          author: plugin.meta.author,
          repo: plugin.source.repo,
          commit: plugin.source.commit,
          entry: plugin.source.entry,
        }));
        result.pluginCount = plugins.length;
        result.pluginSource = pluginIndex.source;
        stale = stale || pluginIndex.stale;
      }

      if (workflowIndex) {
        const workflows = Array.isArray(workflowIndex.data.workflows)
          ? workflowIndex.data.workflows
          : [];
        result.workflows = workflows.map((workflow) => ({
          slug: workflow.slug,
          id: workflow.id,
          name: workflow.meta.name,
          description: workflow.meta.description,
          author: workflow.meta.author,
          repo: workflow.source.repo,
          commit: workflow.source.commit,
          entry: workflow.source.entry,
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
      const projectDir = resolveExtensionProjectDir(installDir, entry.source.subpath);
      resolveExtensionEntryFile(projectDir, entry.source.entry);

      if (existsSync(installDir)) {
        return asJsonResponse({
          success: false,
          error: `Target directory already exists: ${installDir}`,
          hint: 'Remove the existing directory first, or specify a different targetDir',
        });
      }

      await mkdir(dirname(installDir), { recursive: true });

      await execFileAsync('git', ['clone', entry.source.repo, installDir], {
        timeout: EXTENSION_GIT_CLONE_TIMEOUT_MS,
      });
      await execFileAsync('git', ['-C', installDir, 'checkout', entry.source.commit], {
        timeout: EXTENSION_GIT_CHECKOUT_TIMEOUT_MS,
      });

      const packageJsonPath = resolve(projectDir, 'package.json');
      if (existsSync(packageJsonPath)) {
        await assertPublishedExtensionSdkDependency(projectDir);
        const packageManager = await resolvePackageManager(projectDir);
        const installArgs =
          packageManager === 'pnpm'
            ? ['--ignore-workspace', 'install', '--no-frozen-lockfile', '--ignore-scripts']
            : ['install', '--ignore-scripts'];
        await execPackageManager(packageManager, installArgs, {
          cwd: projectDir,
          timeout: Math.max(EXTENSION_GIT_CLONE_TIMEOUT_MS, 120_000),
        });

        const buildArgs =
          packageManager === 'pnpm'
            ? ['--ignore-workspace', 'run', '--if-present', 'build']
            : ['run', 'build', '--if-present'];
        await execPackageManager(packageManager, buildArgs, {
          cwd: projectDir,
          timeout: Math.max(EXTENSION_GIT_CLONE_TIMEOUT_MS, 120_000),
        });
      }

      const installedEntry = resolveInstalledRuntimeEntry(projectDir, entry.source.entry);
      const entryFile = resolveExtensionEntryFile(projectDir, installedEntry);
      if (!existsSync(entryFile)) {
        return asJsonResponse({
          success: false,
          error: `Installed extension entry not found: ${installedEntry}`,
          installDir,
          projectDir,
          expectedEntryFile: entryFile,
          hint:
            'The registry source.entry or its compiled JS output must exist after clone/build before ' +
            'reloadExtensions' +
            ' can load it.',
        });
      }

      const metadataPath = await writeInstalledExtensionMetadata(
        isWorkflow ? 'workflow' : 'plugin',
        entry,
        projectDir,
        installedEntry,
      );
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
          projectDir,
          entry: installedEntry,
          entryFile,
          metadataPath,
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
