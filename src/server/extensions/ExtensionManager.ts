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
    parseRoots(process.env.MCP_WORKFLOW_ROOTS, DEFAULT_WORKFLOW_ROOTS)
  );
  return buildListResult(ctx, pluginRoots, workflowRoots);
}

// Mutex to prevent concurrent reloadExtensions calls from corrupting state.
let reloadMutex: Promise<void> = Promise.resolve();

export async function reloadExtensions(ctx: MCPServerContext): Promise<ExtensionReloadResult> {
  const prev = reloadMutex;
  let resolve!: () => void;
  reloadMutex = new Promise<void>((r) => {
    resolve = r;
  });
  await prev;
  try {
    return await reloadExtensionsInner(ctx);
  } finally {
    resolve();
  }
}

/* ---- workflow loading helper (shared by strict-gate fallback and normal path) ---- */

async function loadWorkflows(
  ctx: MCPServerContext,
  workflowFiles: string[],
  warnings: string[],
  errors: string[]
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
      if (ctx.extensionWorkflowsById.has(workflow.id)) {
        warnings.push(`Skip workflow "${workflow.id}" from ${workflowFile}: duplicate id`);
        continue;
      }
      const record: ExtensionWorkflowRecord = {
        id: workflow.id,
        displayName: workflow.displayName,
        source: workflowFile,
        description: workflow.description,
        tags: workflow.tags,
        timeoutMs: workflow.timeoutMs,
        defaultMaxConcurrency: workflow.defaultMaxConcurrency,
      };
      ctx.extensionWorkflowsById.set(record.id, record);
      const runtimeRecord: ExtensionWorkflowRuntimeRecord = {
        workflow,
        source: workflowFile,
      };
      ctx.extensionWorkflowRuntimeById.set(record.id, runtimeRecord);
    } catch (error) {
      errors.push(`Failed to import workflow file ${workflowFile}: ${String(error)}`);
    }
  }
}

/* ---- main reload implementation ---- */

async function reloadExtensionsInner(ctx: MCPServerContext): Promise<ExtensionReloadResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const removedTools = await clearLoadedExtensionTools(ctx);
  const pluginRoots = resolveRoots(parseRoots(process.env.MCP_PLUGIN_ROOTS, DEFAULT_PLUGIN_ROOTS));
  const workflowRoots = resolveRoots(
    parseRoots(process.env.MCP_WORKFLOW_ROOTS, DEFAULT_WORKFLOW_ROOTS)
  );
  const allowedDigests = parseDigestAllowlist(process.env.MCP_PLUGIN_ALLOWED_DIGESTS);

  // --- Critical security gate: pre-import trust boundary ---
  const strictLoad = isPluginStrictLoad();

  if (strictLoad && allowedDigests.size === 0) {
    const msg =
      'MCP_PLUGIN_ALLOWED_DIGESTS is required when MCP_PLUGIN_SIGNATURE_REQUIRED=true ' +
      'or MCP_PLUGIN_STRICT_LOAD=true. The digest allowlist is the only pre-import trust boundary — ' +
      'without it, plugin code executes before integrity verification. No plugins will be loaded.';
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
    logger.warn(
      '[extensions] Loading plugins WITHOUT MCP_PLUGIN_ALLOWED_DIGESTS allowlist. ' +
        'Plugin code will execute on import() before post-load integrity checks. ' +
        'Set MCP_PLUGIN_STRICT_LOAD=true to enforce allowlist requirement.'
    );
  }

  const baseToolNames = new Set(allTools.map((tool) => tool.name));
  const pluginFiles = await discoverPluginFiles(pluginRoots);
  const coreVersion = ctx.config?.mcp?.version ?? '0.0.0';

  for (const pluginFile of pluginFiles) {
    // --- Pre-import trust gate: verify file digest against allowlist ---
    let fileDigest: string;
    try {
      fileDigest = normalizeHex(await sha256Hex(pluginFile));
      if (allowedDigests.size > 0 && !allowedDigests.has(fileDigest)) {
        warnings.push(
          `Skip plugin file not in MCP_PLUGIN_ALLOWED_DIGESTS allowlist: ${pluginFile}`
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

    const allowInvokeAll = plugin.allowTools.includes('*');

    const lifecycleContext: PluginLifecycleContext = {
      pluginId: plugin.id,
      pluginRoot: pluginFile,
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
        if (!allowInvokeAll && !plugin.allowTools.includes(name)) {
          throw new Error(
            `Plugin "${plugin.id}" is not allowed to invoke "${name}". ` +
              'Declare it in allowTool calls.'
          );
        }
        if (!baseToolNames.has(name)) {
          throw new Error(
            `Plugin "${plugin.id}" can only invoke built-in tools. "${name}" is not built-in.`
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
          deactivateError
        );
      }
      errors.push(`Plugin lifecycle failed for ${plugin.id}: ${String(error)}`);
      continue;
    }

    const loadedTools = plugin.tools.map((t: ExtensionToolDefinition) => t.name);
    const record: ExtensionPluginRecord = {
      id: plugin.id,
      name: plugin.getName,
      source: pluginFile,
      domains: [],
      workflows: [],
      tools: loadedTools,
    };
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
