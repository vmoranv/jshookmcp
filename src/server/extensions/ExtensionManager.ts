/**
 * Extension Manager — thin facade for plugin and workflow lifecycle.
 *
 * Sub-modules:
 *  - ExtensionManager.roots.ts       (path resolution)
 *  - ExtensionManager.version.ts     (semver compat)
 *  - ExtensionManager.integrity.ts   (digest allowlist, env guards)
 *  - ExtensionManager.guards.ts      (type guards)
 *  - ExtensionManager.discovery.ts   (file scanning)
 *  - ExtensionManager.lifecycle.ts   (cleanup, config, list building)
 */
import type { MCPServerContext } from '@server/MCPServer.context';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type {
  ExtensionBuilder,
  ExtensionToolDefinition,
  PluginLifecycleContext,
  PluginState,
  ToolResponse,
} from '@server/plugins/PluginContract';
import type { WorkflowContract } from '@server/workflows/WorkflowContract';
import { allTools } from '@server/ToolCatalog';
import { logger } from '@utils/logger';
import { INSTALLED_EXTENSION_METADATA_FILENAME } from '@server/extensions/types';
import type {
  ExtensionListResult,
  ExtensionPluginRecord,
  ExtensionPluginRuntimeRecord,
  ExtensionReloadResult,
  ExtensionWorkflowRecord,
  ExtensionWorkflowRuntimeRecord,
} from '@server/extensions/types';

import {
  DEFAULT_PLUGIN_ROOTS,
  DEFAULT_WORKFLOW_ROOTS,
  parseRoots,
  resolveRoots,
} from './ExtensionManager.roots';
import {
  sha256Hex,
  normalizeHex,
  isPluginStrictLoad,
  parseDigestAllowlist,
  verifyPluginIntegrity,
} from './ExtensionManager.integrity';
import { isExtensionBuilder, isWorkflowContract } from './ExtensionManager.guards';
import { discoverPluginFiles, discoverWorkflowFiles } from './ExtensionManager.discovery';
import {
  extractConfigValue,
  createFreshImportUrl,
  clearLoadedExtensionTools,
  buildListResult,
} from './ExtensionManager.lifecycle';

export function listExtensions(ctx: MCPServerContext): ExtensionListResult {
  const pluginRoots = resolveRoots(parseRoots(process.env.MCP_PLUGIN_ROOTS, DEFAULT_PLUGIN_ROOTS));
  const workflowRoots = resolveRoots(
    parseRoots(process.env.MCP_WORKFLOW_ROOTS, DEFAULT_WORKFLOW_ROOTS),
  );
  return buildListResult(ctx, pluginRoots, workflowRoots);
}

// Mutex to prevent concurrent reloadExtensions calls from corrupting state.

/**
 * Parse a flat key: value YAML file (no nesting, no arrays).
 * Returns a Record<string, string> of trimmed key/value pairs.
 * Returns empty object on any error (file missing, malformed, etc.).
 */
function parseSimpleYaml(filePath: string): Record<string, string> {
  try {
    const text = readFileSync(filePath, 'utf-8');
    const result: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx < 1) continue;
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();
      if (key) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function findInstalledMetadataRoot(startDir: string): string | null {
  let currentDir = startDir;
  while (true) {
    if (existsSync(join(currentDir, INSTALLED_EXTENSION_METADATA_FILENAME))) {
      return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function resolvePluginProjectRoot(pluginFile: string): string {
  const entryDir = dirname(pluginFile);
  const metadataRoot = findInstalledMetadataRoot(entryDir);
  if (metadataRoot) {
    return metadataRoot;
  }

  if (basename(entryDir).toLowerCase() === 'dist') {
    return dirname(entryDir);
  }

  return entryDir;
}
let reloadMutex: Promise<void> = Promise.resolve();
const lazyWorkflowLoadAttempted = new WeakSet<MCPServerContext>();
const STRICT_PLUGIN_ALLOWLIST_ERROR =
  'MCP_PLUGIN_ALLOWED_DIGESTS is required when MCP_PLUGIN_SIGNATURE_REQUIRED=true ' +
  'or MCP_PLUGIN_STRICT_LOAD=true. The digest allowlist is the only pre-import trust boundary — ' +
  'without it, plugin code executes before integrity verification. No plugins will be loaded.';
const MISSING_PLUGIN_ALLOWLIST_WARNING =
  '[extensions] Loading plugins WITHOUT MCP_PLUGIN_ALLOWED_DIGESTS allowlist. ' +
  'Plugin code will execute on import() before post-load integrity checks. ' +
  'Set MCP_PLUGIN_STRICT_LOAD=true to enforce allowlist requirement.';

async function withReloadMutex<T>(operation: () => Promise<T>): Promise<T> {
  const prev = reloadMutex;
  let resolve!: () => void;
  reloadMutex = new Promise<void>((r) => {
    resolve = r;
  });
  await prev;
  try {
    return await operation();
  } finally {
    resolve();
  }
}

export async function reloadExtensions(ctx: MCPServerContext): Promise<ExtensionReloadResult> {
  return withReloadMutex(() => reloadExtensionsInner(ctx));
}

export async function ensureWorkflowsLoaded(ctx: MCPServerContext): Promise<void> {
  if (ctx.extensionWorkflowRuntimeById.size > 0 || lazyWorkflowLoadAttempted.has(ctx)) {
    return;
  }

  await withReloadMutex(async () => {
    if (ctx.extensionWorkflowRuntimeById.size > 0 || lazyWorkflowLoadAttempted.has(ctx)) {
      return;
    }

    lazyWorkflowLoadAttempted.add(ctx);
    const warnings: string[] = [];
    const errors: string[] = [];
    const pluginRoots = resolveRoots(
      parseRoots(process.env.MCP_PLUGIN_ROOTS, DEFAULT_PLUGIN_ROOTS),
    );
    const workflowRoots = resolveRoots(
      parseRoots(process.env.MCP_WORKFLOW_ROOTS, DEFAULT_WORKFLOW_ROOTS),
    );
    await loadPluginWorkflowContributions(ctx, pluginRoots, warnings, errors);
    const workflowFiles = await discoverWorkflowFiles(workflowRoots);

    await loadWorkflows(ctx, workflowFiles, warnings, errors);

    for (const warning of warnings) {
      logger.warn(`[extensions] ${warning}`);
    }
    for (const error of errors) {
      logger.error(`[extensions] ${error}`);
    }
  });
}

// ── workflow loading helper (shared by strict-gate fallback and normal path) ──

async function loadWorkflows(
  ctx: MCPServerContext,
  workflowFiles: string[],
  warnings: string[],
  errors: string[],
): Promise<void> {
  for (const workflowFile of workflowFiles) {
    try {
      const mod: unknown = await import(createFreshImportUrl(workflowFile, 'workflow'));
      const candidate = (mod as Record<string, unknown>).default ?? mod;
      if (!isWorkflowContract(candidate)) {
        warnings.push(`Skip workflow file without valid WorkflowContract: ${workflowFile}`);
        continue;
      }
      const workflow: WorkflowContract = candidate;
      registerWorkflowContract(ctx, workflow, workflowFile, warnings);
    } catch (error) {
      errors.push(`Failed to import workflow file ${workflowFile}: ${String(error)}`);
    }
  }
}

function registerWorkflowContract(
  ctx: MCPServerContext,
  workflow: WorkflowContract,
  source: string,
  warnings: string[],
): boolean {
  if (ctx.extensionWorkflowsById.has(workflow.id)) {
    warnings.push(`Skip workflow "${workflow.id}" from ${source}: duplicate id`);
    return false;
  }
  const record: ExtensionWorkflowRecord = {
    id: workflow.id,
    displayName: workflow.displayName,
    source,
    description: workflow.description,
    tags: workflow.tags,
    timeoutMs: workflow.timeoutMs,
    defaultMaxConcurrency: workflow.defaultMaxConcurrency,
    route: workflow.route,
  };
  ctx.extensionWorkflowsById.set(record.id, record);
  const runtimeRecord: ExtensionWorkflowRuntimeRecord = {
    workflow,
    source,
    route: workflow.route,
  };
  ctx.extensionWorkflowRuntimeById.set(record.id, runtimeRecord);
  return true;
}

function buildPluginRecord(
  plugin: ExtensionBuilder,
  pluginFile: string,
  loadedTools: string[],
  loadedWorkflows: string[],
): ExtensionPluginRecord {
  return {
    id: plugin.id,
    name: plugin.pluginName,
    source: pluginFile,
    author: plugin.pluginAuthor || undefined,
    sourceRepo: plugin.pluginSourceRepo || undefined,
    domains: [],
    workflows: loadedWorkflows,
    tools: loadedTools,
  };
}

async function loadPluginWorkflowContributions(
  ctx: MCPServerContext,
  pluginRoots: string[],
  warnings: string[],
  errors: string[],
): Promise<void> {
  const allowedDigests = parseDigestAllowlist(process.env.MCP_PLUGIN_ALLOWED_DIGESTS);
  const strictLoad = isPluginStrictLoad();
  if (strictLoad && allowedDigests.size === 0) {
    errors.push(STRICT_PLUGIN_ALLOWLIST_ERROR);
    logger.error('[extensions] ' + STRICT_PLUGIN_ALLOWLIST_ERROR);
    return;
  }

  if (allowedDigests.size === 0) {
    logger.warn(MISSING_PLUGIN_ALLOWLIST_WARNING);
  }

  const pluginFiles = await discoverPluginFiles(pluginRoots);
  const coreVersion = ctx.config?.mcp?.version ?? '0.0.0';

  for (const pluginFile of pluginFiles) {
    let fileDigest: string;
    try {
      fileDigest = normalizeHex(await sha256Hex(pluginFile));
      if (allowedDigests.size > 0 && !allowedDigests.has(fileDigest)) {
        warnings.push(
          `Skip plugin file not in MCP_PLUGIN_ALLOWED_DIGESTS allowlist: ${pluginFile}`,
        );
        continue;
      }
    } catch (error) {
      errors.push(`Failed to hash plugin file ${pluginFile}: ${String(error)}`);
      continue;
    }

    let plugin: ExtensionBuilder;
    try {
      const mod: unknown = await import(createFreshImportUrl(pluginFile, 'plugin'));
      const candidate = (mod as Record<string, unknown>).default ?? mod;
      if (!isExtensionBuilder(candidate)) {
        warnings.push(`Skip plugin file without valid ExtensionBuilder: ${pluginFile}`);
        continue;
      }
      plugin = candidate;
    } catch (error) {
      errors.push(`Failed to import plugin file ${pluginFile}: ${String(error)}`);
      continue;
    }

    const pluginProjectRoot = resolvePluginProjectRoot(pluginFile);
    const metaYamlPath = join(pluginProjectRoot, 'meta.yaml');
    const meta = parseSimpleYaml(metaYamlPath);
    plugin.mergeMetadata(meta);

    if (ctx.extensionPluginsById.has(plugin.id)) {
      warnings.push(`Skip plugin "${plugin.id}" from ${pluginFile}: duplicate plugin id`);
      continue;
    }

    try {
      const verification = await verifyPluginIntegrity(plugin, coreVersion);
      warnings.push(...verification.warnings);
      if (!verification.ok) {
        errors.push(...verification.errors);
        continue;
      }
    } catch (error) {
      errors.push(`Failed to verify plugin ${plugin.id}: ${String(error)}`);
      continue;
    }

    const loadedWorkflows: string[] = [];
    for (const candidate of plugin.workflows) {
      if (!isWorkflowContract(candidate)) {
        warnings.push(
          `Skip invalid workflow contribution from plugin "${plugin.id}" in ${pluginFile}`,
        );
        continue;
      }
      const workflowSource = `${pluginFile}#workflow:${candidate.id}`;
      if (registerWorkflowContract(ctx, candidate, workflowSource, warnings)) {
        loadedWorkflows.push(candidate.id);
      }
    }

    if (loadedWorkflows.length === 0) {
      continue;
    }

    ctx.extensionPluginsById.set(
      plugin.id,
      buildPluginRecord(plugin, pluginFile, [], loadedWorkflows),
    );
  }
}

// ── main reload implementation ──

async function reloadExtensionsInner(ctx: MCPServerContext): Promise<ExtensionReloadResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const removedTools = await clearLoadedExtensionTools(ctx);
  const pluginRoots = resolveRoots(parseRoots(process.env.MCP_PLUGIN_ROOTS, DEFAULT_PLUGIN_ROOTS));
  const workflowRoots = resolveRoots(
    parseRoots(process.env.MCP_WORKFLOW_ROOTS, DEFAULT_WORKFLOW_ROOTS),
  );
  const allowedDigests = parseDigestAllowlist(process.env.MCP_PLUGIN_ALLOWED_DIGESTS);

  // ── Critical security gate: pre-import trust boundary ──
  const strictLoad = isPluginStrictLoad();

  if (strictLoad && allowedDigests.size === 0) {
    const msg = STRICT_PLUGIN_ALLOWLIST_ERROR;
    errors.push(msg);
    logger.error('[extensions] ' + msg);

    // Skip all plugin loading but still process workflows
    const workflowFiles = await discoverWorkflowFiles(workflowRoots);
    await loadWorkflows(ctx, workflowFiles, warnings, errors);

    ctx.lastExtensionReloadAt = new Date().toISOString();
    const list = buildListResult(ctx, pluginRoots, workflowRoots);
    return { ...list, addedTools: 0, removedTools, warnings, errors };
  }

  if (allowedDigests.size === 0) {
    logger.warn(MISSING_PLUGIN_ALLOWLIST_WARNING);
  }

  const baseToolNames = new Set(allTools.map((tool) => tool.name));
  const pluginFiles = await discoverPluginFiles(pluginRoots);
  const coreVersion = ctx.config?.mcp?.version ?? '0.0.0';

  for (const pluginFile of pluginFiles) {
    // ── Pre-import trust gate: verify file digest against allowlist ──
    let fileDigest: string;
    try {
      fileDigest = normalizeHex(await sha256Hex(pluginFile));
      if (allowedDigests.size > 0 && !allowedDigests.has(fileDigest)) {
        warnings.push(
          `Skip plugin file not in MCP_PLUGIN_ALLOWED_DIGESTS allowlist: ${pluginFile}`,
        );
        continue;
      }
    } catch (error) {
      errors.push(`Failed to hash plugin file ${pluginFile}: ${String(error)}`);
      continue;
    }

    let plugin: ExtensionBuilder;
    try {
      const mod: unknown = await import(createFreshImportUrl(pluginFile, 'plugin'));
      const candidate = (mod as Record<string, unknown>).default ?? mod;
      if (!isExtensionBuilder(candidate)) {
        warnings.push(`Skip plugin file without valid ExtensionBuilder: ${pluginFile}`);
        continue;
      }
      plugin = candidate;
    } catch (error) {
      errors.push(`Failed to import plugin file ${pluginFile}: ${String(error)}`);
      continue;
    }

    // ── Inject metadata from adjacent meta.yaml (single source of truth) ──
    const pluginProjectRoot = resolvePluginProjectRoot(pluginFile);
    const metaYamlPath = join(pluginProjectRoot, 'meta.yaml');
    const meta = parseSimpleYaml(metaYamlPath);
    plugin.mergeMetadata(meta);

    if (ctx.extensionPluginsById.has(plugin.id)) {
      warnings.push(`Skip plugin "${plugin.id}" from ${pluginFile}: duplicate plugin id`);
      continue;
    }
    try {
      const verification = await verifyPluginIntegrity(plugin, coreVersion);
      warnings.push(...verification.warnings);
      if (!verification.ok) {
        errors.push(...verification.errors);
        continue;
      }
    } catch (error) {
      errors.push(`Failed to verify plugin ${plugin.id}: ${String(error)}`);
      continue;
    }

    const runtimeData = new Map<string, unknown>();
    const metrics = new Set<string>();
    let pluginState: PluginState = 'loaded';

    const allowInvokeAll = plugin.allowedTools.includes('*');

    const lifecycleContext: PluginLifecycleContext = {
      pluginId: plugin.id,
      pluginRoot: pluginProjectRoot,
      config: ctx.config as unknown as Record<string, unknown>,
      get state() {
        return pluginState;
      },
      registerMetric(metricName: string) {
        metrics.add(metricName);
      },
      async invokeTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResponse> {
        if (typeof name !== 'string' || name.length === 0) {
          throw new Error('invokeTool requires a non-empty tool name');
        }
        if (!allowInvokeAll && !plugin.allowedTools.includes(name)) {
          throw new Error(
            `Plugin "${plugin.id}" is not allowed to invoke "${name}". ` +
              'Declare it in allowTool calls.',
          );
        }
        if (!baseToolNames.has(name)) {
          throw new Error(
            `Plugin "${plugin.id}" can only invoke built-in tools. "${name}" is not built-in.`,
          );
        }
        if (!ctx.router.has(name)) {
          throw new Error(`Tool "${name}" is not available in the current active profile.`);
        }
        return ctx.executeToolWithTracking(name, (args ?? {}) as Record<string, unknown>);
      },
      hasPermission(_capability: string) {
        return true;
      },
      getConfig<T>(path: string, fallback?: T) {
        return extractConfigValue(ctx, path, fallback);
      },
      setRuntimeData(key: string, value: unknown) {
        runtimeData.set(key, value);
      },
      getRuntimeData<T = unknown>(key: string): T | undefined {
        return runtimeData.get(key) as T | undefined;
      },
    };
    const runtimeRecord: ExtensionPluginRuntimeRecord = {
      plugin,
      lifecycleContext,
      state: pluginState,
      source: pluginFile,
    };

    try {
      if (plugin.onLoadHandler) {
        await plugin.onLoadHandler(lifecycleContext);
      }
      pluginState = 'loaded';
      runtimeRecord.state = pluginState;

      if (plugin.onValidateHandler) {
        const validation = await plugin.onValidateHandler(lifecycleContext);
        if (!validation.valid) {
          warnings.push(`Plugin ${plugin.id} validation failed: ${validation.errors.join('; ')}`);
          continue; // skip the rest if invalid
        }
        pluginState = 'validated';
        runtimeRecord.state = pluginState;
      }

      if (plugin.onActivateHandler) {
        await plugin.onActivateHandler(lifecycleContext);
        pluginState = 'activated';
        runtimeRecord.state = pluginState;
      }
      ctx.extensionPluginRuntimeById.set(plugin.id, runtimeRecord);
    } catch (error) {
      try {
        if (plugin.onDeactivateHandler && pluginState === 'activated') {
          await plugin.onDeactivateHandler(lifecycleContext);
          pluginState = 'deactivated';
          runtimeRecord.state = pluginState;
        }
      } catch (deactivateError) {
        logger.warn(
          `Plugin onDeactivate failed during rollback for ${plugin.id}:`,
          deactivateError,
        );
      }
      errors.push(`Plugin lifecycle failed for ${plugin.id}: ${String(error)}`);
      continue;
    }

    const loadedTools = plugin.tools.map((t: ExtensionToolDefinition) => t.name);
    const loadedWorkflows: string[] = [];
    for (const candidate of plugin.workflows) {
      if (!isWorkflowContract(candidate)) {
        warnings.push(
          `Skip invalid workflow contribution from plugin "${plugin.id}" in ${pluginFile}`,
        );
        continue;
      }
      const workflowSource = `${pluginFile}#workflow:${candidate.id}`;
      if (registerWorkflowContract(ctx, candidate, workflowSource, warnings)) {
        loadedWorkflows.push(candidate.id);
      }
    }
    const record = buildPluginRecord(plugin, pluginFile, loadedTools, loadedWorkflows);
    ctx.extensionPluginsById.set(record.id, record);
  }

  const workflowFiles = await discoverWorkflowFiles(workflowRoots);
  await loadWorkflows(ctx, workflowFiles, warnings, errors);

  if (ctx.extensionToolsByName.size > 0 || removedTools > 0) {
    try {
      await ctx.server.sendToolListChanged();
    } catch (error) {
      logger.warn('sendToolListChanged failed after extension reload:', error);
    }
  }

  ctx.lastExtensionReloadAt = new Date().toISOString();
  const list = buildListResult(ctx, pluginRoots, workflowRoots);
  return {
    ...list,
    addedTools: ctx.extensionToolsByName.size,
    removedTools,
    warnings,
    errors,
  };
}
