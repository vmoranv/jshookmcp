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
 *  - ExtensionManager.tools.ts       (extension tool registration helpers)
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
import { allTools } from '@server/registry/views';
import { logger } from '@utils/logger';
import { readEnvNullableString } from '@src/config/environment';
import { INSTALLED_EXTENSION_METADATA_FILENAME } from '@server/extensions/types';
import type {
  ExtensionListResult,
  ExtensionPluginRecord,
  ExtensionPluginRuntimeRecord,
  ExtensionReloadResult,
  ExtensionToolRecord,
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
import {
  registerExtensionToolRecord,
  shouldAutoRegisterExtensionTool,
  unregisterExtensionToolRecord,
} from './ExtensionManager.tools';
import { normalizeHookList, wrapExtensionToolHandler } from './ExtensionManager.hooks';

export function listExtensions(ctx: MCPServerContext): ExtensionListResult {
  const pluginRoots = resolveRoots(
    parseRoots(readEnvNullableString('MCP_PLUGIN_ROOTS') ?? undefined, DEFAULT_PLUGIN_ROOTS),
  );
  const workflowRoots = resolveRoots(
    parseRoots(readEnvNullableString('MCP_WORKFLOW_ROOTS') ?? undefined, DEFAULT_WORKFLOW_ROOTS),
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

interface ExtensionDisplayMetadata {
  name?: string;
  description?: string;
  author?: string;
  source_repo?: string;
}

type RawExtensionMetadata = Record<string, string>;

function normalizeMetadataValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readPluginMetadata(
  pluginProjectRoot: string,
  pluginId: string,
  warnings: string[],
): RawExtensionMetadata {
  const metaYamlPath = join(pluginProjectRoot, 'meta.yaml');
  if (!existsSync(metaYamlPath)) {
    warnings.push(`Plugin "${pluginId}" is missing meta.yaml; outward metadata now lives there.`);
    return {};
  }

  return parseSimpleYaml(metaYamlPath);
}

function toDisplayMetadata(meta: RawExtensionMetadata): ExtensionDisplayMetadata {
  return {
    name: normalizeMetadataValue(meta.name),
    description: normalizeMetadataValue(meta.description),
    author: normalizeMetadataValue(meta.author),
    source_repo: normalizeMetadataValue(meta.source_repo),
  };
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
      parseRoots(readEnvNullableString('MCP_PLUGIN_ROOTS') ?? undefined, DEFAULT_PLUGIN_ROOTS),
    );
    const workflowRoots = resolveRoots(
      parseRoots(readEnvNullableString('MCP_WORKFLOW_ROOTS') ?? undefined, DEFAULT_WORKFLOW_ROOTS),
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
    chainsWith: workflow.chainsWith,
    prerequisites: workflow.prerequisites,
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
  metadata: ExtensionDisplayMetadata,
  pluginFile: string,
  loadedTools: string[],
  loadedWorkflows: string[],
): ExtensionPluginRecord {
  return {
    id: plugin.id,
    name: metadata.name ?? plugin.id,
    description: metadata.description,
    source: pluginFile,
    author: metadata.author,
    sourceRepo: metadata.source_repo,
    domains: loadedTools.length > 0 ? [`plugin:${plugin.id}`] : [],
    workflows: loadedWorkflows,
    tools: loadedTools,
  };
}

/**
 * Digest-gate, import, metadata, and integrity-verify one plugin file.
 * Returns null after pushing a skip-reason into warnings/errors.
 */
async function loadVerifiedPlugin(
  ctx: MCPServerContext,
  pluginFile: string,
  allowedDigests: ReadonlySet<string>,
  coreVersion: string,
  warnings: string[],
  errors: string[],
): Promise<{
  plugin: ExtensionBuilder;
  pluginProjectRoot: string;
  meta: RawExtensionMetadata;
} | null> {
  let fileDigest: string;
  try {
    fileDigest = normalizeHex(await sha256Hex(pluginFile));
    if (allowedDigests.size > 0 && !allowedDigests.has(fileDigest)) {
      warnings.push(`Skip plugin file not in MCP_PLUGIN_ALLOWED_DIGESTS allowlist: ${pluginFile}`);
      return null;
    }
  } catch (error) {
    errors.push(`Failed to hash plugin file ${pluginFile}: ${String(error)}`);
    return null;
  }

  let plugin: ExtensionBuilder;
  try {
    const mod: unknown = await import(createFreshImportUrl(pluginFile, 'plugin'));
    const candidate = (mod as Record<string, unknown>).default ?? mod;
    if (!isExtensionBuilder(candidate)) {
      warnings.push(`Skip plugin file without valid ExtensionBuilder: ${pluginFile}`);
      return null;
    }
    plugin = candidate;
  } catch (error) {
    errors.push(`Failed to import plugin file ${pluginFile}: ${String(error)}`);
    return null;
  }

  const pluginProjectRoot = resolvePluginProjectRoot(pluginFile);
  const meta = readPluginMetadata(pluginProjectRoot, plugin.id, warnings);

  if (ctx.extensionPluginsById.has(plugin.id)) {
    warnings.push(`Skip plugin "${plugin.id}" from ${pluginFile}: duplicate plugin id`);
    return null;
  }

  try {
    const verification = await verifyPluginIntegrity(plugin, coreVersion);
    warnings.push(...verification.warnings);
    if (!verification.ok) {
      errors.push(...verification.errors);
      return null;
    }
  } catch (error) {
    errors.push(`Failed to verify plugin ${plugin.id}: ${String(error)}`);
    return null;
  }

  return { plugin, pluginProjectRoot, meta };
}

async function loadPluginWorkflowContributions(
  ctx: MCPServerContext,
  pluginRoots: string[],
  warnings: string[],
  errors: string[],
): Promise<void> {
  const allowedDigests = parseDigestAllowlist(
    readEnvNullableString('MCP_PLUGIN_ALLOWED_DIGESTS') ?? undefined,
  );
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
    const verified = await loadVerifiedPlugin(
      ctx,
      pluginFile,
      allowedDigests,
      coreVersion,
      warnings,
      errors,
    );
    if (!verified) {
      continue;
    }
    const { plugin, meta } = verified;

    const loadedWorkflows: string[] = [];
    const pluginWorkflows = Array.isArray(plugin.workflows) ? plugin.workflows : [];
    for (const candidate of pluginWorkflows) {
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

    const loadedTools = plugin.tools.map((t: ExtensionToolDefinition) => t.name);

    ctx.extensionPluginsById.set(
      plugin.id,
      buildPluginRecord(plugin, toDisplayMetadata(meta), pluginFile, loadedTools, loadedWorkflows),
    );
  }
}

// ── main reload implementation ──

async function reloadExtensionsInner(ctx: MCPServerContext): Promise<ExtensionReloadResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const removedTools = await clearLoadedExtensionTools(ctx);
  const pluginRoots = resolveRoots(
    parseRoots(readEnvNullableString('MCP_PLUGIN_ROOTS') ?? undefined, DEFAULT_PLUGIN_ROOTS),
  );
  const workflowRoots = resolveRoots(
    parseRoots(readEnvNullableString('MCP_WORKFLOW_ROOTS') ?? undefined, DEFAULT_WORKFLOW_ROOTS),
  );
  const allowedDigests = parseDigestAllowlist(
    readEnvNullableString('MCP_PLUGIN_ALLOWED_DIGESTS') ?? undefined,
  );
  let activatedOnReload = 0;

  // ── Critical security gate: pre-import trust boundary ──
  const strictLoad = isPluginStrictLoad();

  if (strictLoad && allowedDigests.size === 0) {
    return reloadStrictLoadDeny(
      ctx,
      { pluginRoots, workflowRoots },
      removedTools,
      warnings,
      errors,
    );
  }

  if (allowedDigests.size === 0) {
    logger.warn(MISSING_PLUGIN_ALLOWLIST_WARNING);
  }

  const baseToolNames = new Set(allTools.map((tool) => tool.name));
  const pluginFiles = await discoverPluginFiles(pluginRoots);
  const coreVersion = ctx.config?.mcp?.version ?? '0.0.0';

  for (const pluginFile of pluginFiles) {
    const verified = await loadVerifiedPlugin(
      ctx,
      pluginFile,
      allowedDigests,
      coreVersion,
      warnings,
      errors,
    );
    if (!verified) {
      continue;
    }
    const { plugin, pluginProjectRoot, meta } = verified;

    const runtimeData = new Map<string, unknown>();
    const metrics = new Set<string>();
    let pluginState: PluginState = 'loaded';

    const lifecycleContext = buildPluginLifecycleContext({
      pluginId: plugin.id,
      pluginRoot: pluginProjectRoot,
      ctx,
      baseToolNames,
      allowedTools: plugin.allowedTools,
      runtimeData,
      metrics,
      getPluginState: () => pluginState,
    });
    const runtimeRecord: ExtensionPluginRuntimeRecord = {
      plugin,
      lifecycleContext,
      state: pluginState,
      source: pluginFile,
    };
    const loadedTools: string[] = [];
    const loadedToolRecords: ExtensionToolRecord[] = [];

    const pluginDomain = `plugin:${plugin.id}`;
    const lifecycleOk = await activatePluginLifecycle({
      plugin,
      pluginFile,
      pluginDomain,
      lifecycleContext,
      pluginStateRef: {
        get value() {
          return pluginState;
        },
        set value(v: PluginState) {
          pluginState = v;
        },
      },
      runtimeRecord,
      baseToolNames,
      ctx,
      loadedTools,
      loadedToolRecords,
      incrementActivated: () => {
        activatedOnReload++;
      },
      warnings,
      errors,
    });
    if (!lifecycleOk) {
      continue;
    }

    const loadedWorkflows: string[] = [];
    const pluginWorkflows = Array.isArray(plugin.workflows) ? plugin.workflows : [];
    for (const candidate of pluginWorkflows) {
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
    const record = buildPluginRecord(
      plugin,
      toDisplayMetadata(meta),
      pluginFile,
      loadedTools,
      loadedWorkflows,
    );
    ctx.extensionPluginsById.set(record.id, record);
  }

  const workflowFiles = await discoverWorkflowFiles(workflowRoots);
  await loadWorkflows(ctx, workflowFiles, warnings, errors);

  if (activatedOnReload > 0 || removedTools > 0) {
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
    autoActivatedTools: [...ctx.extensionToolsByName.values()]
      .filter((record) => record.activationSource === 'reload')
      .map((record) => record.name)
      .toSorted(),
    removedTools,
    warnings,
    errors,
  };
}

/**
 * Strict-load deny path: plugin loading is skipped entirely (trust boundary
 * without an allowlist), but workflow roots still load and the removed-tool
 * notification still fires.
 */
async function reloadStrictLoadDeny(
  ctx: MCPServerContext,
  roots: { pluginRoots: string[]; workflowRoots: string[] },
  removedTools: number,
  warnings: string[],
  errors: string[],
): Promise<ExtensionReloadResult> {
  const msg = STRICT_PLUGIN_ALLOWLIST_ERROR;
  errors.push(msg);
  logger.error('[extensions] ' + msg);

  const workflowFiles = await discoverWorkflowFiles(roots.workflowRoots);
  await loadWorkflows(ctx, workflowFiles, warnings, errors);

  if (removedTools > 0) {
    try {
      await ctx.server.sendToolListChanged();
    } catch (error) {
      logger.warn('sendToolListChanged failed after extension reload:', error);
    }
  }

  ctx.lastExtensionReloadAt = new Date().toISOString();
  const list = buildListResult(ctx, roots.pluginRoots, roots.workflowRoots);
  return {
    ...list,
    addedTools: 0,
    autoActivatedTools: [],
    removedTools,
    warnings,
    errors,
  };
}

/** Ctor inputs for the per-plugin lifecycle context. */
interface PluginLifecycleContextInputs {
  pluginId: string;
  pluginRoot: string;
  ctx: MCPServerContext;
  baseToolNames: Set<string>;
  allowedTools: string[];
  runtimeData: Map<string, unknown>;
  metrics: Set<string>;
  getPluginState: () => PluginState;
}

/** Build the PluginLifecycleContext handed to plugin hooks. */
function buildPluginLifecycleContext(inputs: PluginLifecycleContextInputs): PluginLifecycleContext {
  const { pluginId, pluginRoot, ctx, baseToolNames, allowedTools, runtimeData } = inputs;
  return {
    pluginId,
    pluginRoot,
    config: ctx.config as unknown as Record<string, unknown>,
    get state() {
      return inputs.getPluginState();
    },
    registerMetric(metricName: string) {
      inputs.metrics.add(metricName);
    },
    async invokeTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResponse> {
      if (typeof name !== 'string' || name.length === 0) {
        throw new Error('invokeTool requires a non-empty tool name');
      }
      const allowInvokeAll = allowedTools.includes('*');
      if (!allowInvokeAll && !allowedTools.includes(name)) {
        throw new Error(
          `Plugin "${pluginId}" is not allowed to invoke "${name}". ` +
            'Declare it in allowTool calls.',
        );
      }
      if (!baseToolNames.has(name)) {
        throw new Error(
          `Plugin "${pluginId}" can only invoke built-in tools. "${name}" is not built-in.`,
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
}

/**
 * Lifecycle (onLoad/onValidate/onActivate) + tool registration + rollback for
 * one plugin. Throws are caught here; the caller's loop simply continues.
 */
async function activatePluginLifecycle(pc: {
  plugin: ExtensionBuilder;
  pluginFile: string;
  pluginDomain: string;
  lifecycleContext: PluginLifecycleContext;
  pluginStateRef: { value: PluginState };
  runtimeRecord: ExtensionPluginRuntimeRecord;
  baseToolNames: Set<string>;
  ctx: MCPServerContext;
  /** Receives the names of the tools this plugin contributed. */
  loadedTools: string[];
  loadedToolRecords: ExtensionToolRecord[];
  incrementActivated: () => void;
  warnings: string[];
  errors: string[];
}): Promise<boolean> {
  const {
    plugin,
    pluginFile,
    pluginDomain,
    lifecycleContext,
    pluginStateRef,
    runtimeRecord,
    baseToolNames,
    ctx,
    loadedTools,
    loadedToolRecords,
    incrementActivated,
    warnings,
    errors,
  } = pc;
  const pluginId = plugin.id;
  let pluginState = pluginStateRef.value;
  try {
    if (plugin.onLoadHandler) {
      await plugin.onLoadHandler(lifecycleContext);
    }
    pluginState = 'loaded';
    runtimeRecord.state = pluginState;
    pluginStateRef.value = pluginState;

    if (plugin.onValidateHandler) {
      const validation = await plugin.onValidateHandler(lifecycleContext);
      if (!validation.valid) {
        warnings.push(`Plugin ${plugin.id} validation failed: ${validation.errors.join('; ')}`);
        return false; // skip the rest if invalid
      }
      pluginState = 'validated';
      runtimeRecord.state = pluginState;
      pluginStateRef.value = pluginState;
    }

    if (plugin.onActivateHandler) {
      await plugin.onActivateHandler(lifecycleContext);
      pluginState = 'activated';
      runtimeRecord.state = pluginState;
      pluginStateRef.value = pluginState;
    }
    ctx.extensionPluginRuntimeById.set(plugin.id, runtimeRecord);

    // Register plugin tools into the extension registry and auto-activate
    // the subset visible in the current base profile.
    for (const toolDef of plugin.tools) {
      if (baseToolNames.has(toolDef.name)) {
        pc.warnings.push(
          `Skip tool "${toolDef.name}" from plugin "${plugin.id}": collides with built-in tool name`,
        );
        continue;
      }
      if (ctx.extensionToolsByName.has(toolDef.name)) {
        pc.warnings.push(
          `Skip duplicate extension tool "${toolDef.name}" from plugin "${plugin.id}"`,
        );
        continue;
      }

      const toolRecord: ExtensionToolRecord = {
        name: toolDef.name,
        domain: pluginDomain,
        source: pluginFile,
        tool: {
          name: toolDef.name,
          description: toolDef.description,
          inputSchema: toolDef.schema,
        },
        profiles: toolDef.profiles ?? plugin.profiles,
        // Tool-execution hooks: the plugin's before/after hooks gate and can
        // rewrite calls to ITS OWN tools only (least privilege). Plugins
        // without hooks get the original handler back unchanged.
        handler: wrapExtensionToolHandler({
          pluginId: plugin.id,
          toolName: toolDef.name,
          beforeHooks: normalizeHookList(plugin.toolExecuteBeforeHooks),
          afterHooks: normalizeHookList(plugin.toolExecuteAfterHooks),
          handler: async (args: Record<string, unknown>) => {
            try {
              return await toolDef.handler(args, lifecycleContext);
            } catch (error) {
              logger.error(`[extension:${plugin.id}] Tool "${toolDef.name}" failed:`, error);
              throw error;
            }
          },
        }),
      };
      ctx.extensionToolsByName.set(toolDef.name, toolRecord);
      loadedTools.push(toolDef.name);
      loadedToolRecords.push(toolRecord);

      if (shouldAutoRegisterExtensionTool(ctx.baseTier, toolRecord)) {
        if (registerExtensionToolRecord(ctx, toolRecord, 'reload')) {
          incrementActivated();
        }
      }
    }
  } catch (error) {
    for (const toolRecord of loadedToolRecords.toReversed()) {
      try {
        unregisterExtensionToolRecord(ctx, toolRecord, { removeDefinition: true });
      } catch (toolCleanupError) {
        logger.warn(
          `Failed to roll back extension tool "${toolRecord.name}" for plugin "${pluginId}":`,
          toolCleanupError,
        );
      }
    }
    ctx.extensionPluginRuntimeById.delete(pluginId);
    try {
      if (plugin.onDeactivateHandler && pluginStateRef.value === 'activated') {
        await plugin.onDeactivateHandler(lifecycleContext);
        pluginStateRef.value = 'deactivated';
        runtimeRecord.state = pluginStateRef.value;
      }
    } catch (deactivateError) {
      logger.warn(`Plugin onDeactivate failed during rollback for ${pluginId}:`, deactivateError);
    }
    errors.push(`Plugin lifecycle failed for ${pluginId}: ${String(error)}`);
    return false;
  }
  return true;
}
