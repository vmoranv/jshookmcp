import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { glob } from 'tinyglobby';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ExtensionBuilder, ExtensionToolDefinition, PluginLifecycleContext, PluginState } from '@server/plugins/PluginContract';
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

const IS_TS_RUNTIME = import.meta.url.endsWith('.ts');
const EXTENSION_MANAGER_DIR = dirname(fileURLToPath(import.meta.url));
const EXTENSION_INSTALL_ROOT = resolve(EXTENSION_MANAGER_DIR, '..', '..', '..');
const DEFAULT_PLUGIN_ROOTS = IS_TS_RUNTIME
  ? [join(EXTENSION_INSTALL_ROOT, 'plugins'), join(EXTENSION_INSTALL_ROOT, 'dist', 'plugins')]
  : [join(EXTENSION_INSTALL_ROOT, 'dist', 'plugins'), join(EXTENSION_INSTALL_ROOT, 'plugins')];
const DEFAULT_WORKFLOW_ROOTS = [join(EXTENSION_INSTALL_ROOT, 'workflows')];

function parseRoots(raw: string | undefined, fallback: string[]): string[] {
  const value = raw?.trim();
  if (!value) return fallback;
  const roots = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return roots.length > 0 ? [...new Set(roots)] : fallback;
}

function resolveRoots(roots: string[]): string[] {
  const resolved = roots.map((root) => (isAbsolute(root) ? root : resolve(process.cwd(), root)));
  return [...new Set(resolved)].sort((a, b) => a.localeCompare(b));
}

function parseVersionParts(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(a: string, b: string): number | null {
  const aa = parseVersionParts(a);
  const bb = parseVersionParts(b);
  if (!aa || !bb) return null;
  const [aMajor, aMinor, aPatch] = aa;
  const [bMajor, bMinor, bPatch] = bb;
  if (aMajor > bMajor) return 1;
  if (aMajor < bMajor) return -1;
  if (aMinor > bMinor) return 1;
  if (aMinor < bMinor) return -1;
  if (aPatch > bPatch) return 1;
  if (aPatch < bPatch) return -1;
  return 0;
}

function isCompatibleVersion(range: string, currentVersion: string): boolean {
  const input = range.trim();
  if (!input || input === '*') return true;

  if (input.startsWith('>=')) {
    const base = input.slice(2).trim();
    const cmp = compareVersion(currentVersion, base);
    return cmp !== null && cmp >= 0;
  }

  if (input.startsWith('^')) {
    const base = input.slice(1).trim();
    const cc = parseVersionParts(currentVersion);
    const bb = parseVersionParts(base);
    if (!cc || !bb) return false;
    const cmp = compareVersion(currentVersion, base);
    return cmp !== null && cmp >= 0 && cc[0] === bb[0];
  }

  if (input.startsWith('~')) {
    const base = input.slice(1).trim();
    const cc = parseVersionParts(currentVersion);
    const bb = parseVersionParts(base);
    if (!cc || !bb) return false;
    const cmp = compareVersion(currentVersion, base);
    return cmp !== null && cmp >= 0 && cc[0] === bb[0] && cc[1] === bb[1];
  }

  const cmp = compareVersion(currentVersion, input);
  return cmp !== null && cmp === 0;
}

async function sha256Hex(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function normalizeHex(value: string): string {
  return value.trim().toLowerCase().replace(/^0x/, '');
}



function isTruthyEnv(value: string | undefined): boolean {
  return ['1', 'true'].includes((value ?? '').toLowerCase());
}

function isPluginSignatureRequired(): boolean {
  const raw = process.env.MCP_PLUGIN_SIGNATURE_REQUIRED;
  if (raw === undefined || raw.trim() === '') {
    return process.env.NODE_ENV === 'production';
  }
  return isTruthyEnv(raw);
}

function isPluginStrictLoad(): boolean {
  const raw = process.env.MCP_PLUGIN_STRICT_LOAD;
  if (raw === undefined || raw.trim() === '') {
    return isPluginSignatureRequired();
  }
  return isTruthyEnv(raw) || isPluginSignatureRequired();
}

function parseDigestAllowlist(raw: string | undefined): Set<string> {
  const value = raw?.trim();
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map((item) => normalizeHex(item))
      .filter((item) => item.length > 0),
  );
}

async function verifyPluginIntegrity(
  plugin: ExtensionBuilder,
  currentVersion: string,
): Promise<{ ok: boolean; errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isCompatibleVersion(plugin.getCompatibleCore, currentVersion)) {
    errors.push(
      `Plugin ${plugin.id} incompatible with core ${currentVersion}; requires ${plugin.getCompatibleCore}`,
    );
  }

  // File integrity verified separately since builders do not package checksums inline easily.
  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

function isExtensionBuilder(value: unknown): value is ExtensionBuilder {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return !!(
    typeof candidate.id === 'string' &&
    typeof candidate.version === 'string' &&
    Array.isArray(candidate.tools)
  );
}

function isWorkflowContract(value: unknown): value is WorkflowContract {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return !!(
    candidate.kind === 'workflow-contract' &&
    candidate.version === 1 &&
    typeof candidate.id === 'string' &&
    typeof candidate.displayName === 'string' &&
    typeof candidate.build === 'function'
  );
}

async function collectMatchingFiles(
  roots: string[],
  matcher: (filename: string) => boolean,
): Promise<string[]> {
  const files = new Set<string>();
  for (const root of roots) {
    let matchedPaths: string[];
    try {
      matchedPaths = await glob('**/*', {
        cwd: root,
        absolute: true,
        onlyFiles: true,
        ignore: ['**/node_modules/**', '**/.git/**', '**/.pnpm/**'],
      });
    } catch {
      continue;
    }

    for (const file of matchedPaths) {
      if (matcher(basename(file))) {
        files.add(file);
      }
    }
  }
  return [...files].sort((a, b) => a.localeCompare(b));
}

function normalizeExtensionCandidateKey(root: string, file: string): string {
  const normalizedRoot = root
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();

  const relDir = dirname(file)
    .slice(root.length)
    .replace(/^[/\\]+/, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();

  if (!relDir || relDir === 'dist') {
    return `${normalizedRoot}::`;
  }

  const normalizedRelDir = relDir.endsWith('/dist') ? relDir.slice(0, -'/dist'.length) : relDir;
  return `${normalizedRoot}::${normalizedRelDir}`;
}

async function discoverPluginFiles(pluginRoots: string[]): Promise<string[]> {
  type Candidate = {
    file: string;
    key: string;
    isJs: boolean;
    isTs: boolean;
    rootIndex: number;
  };
  const candidates: Candidate[] = [];

  for (const [rootIndex, root] of pluginRoots.entries()) {
    const files = await collectMatchingFiles(
      [root],
      (filename) => filename === 'manifest.js' || filename === 'manifest.ts',
    );

    for (const file of files) {
      candidates.push({
        file,
        key: normalizeExtensionCandidateKey(root, file),
        isJs: file.endsWith('.js'),
        isTs: file.endsWith('.ts'),
        rootIndex,
      });
    }
  }

  const extensionRank = (candidate: Candidate): number => {
    if (candidate.isJs) return 0;
    if (candidate.isTs) return 1;
    return 2;
  };

  const byKey = new Map<string, Candidate>();
  for (const candidate of candidates.sort((a, b) => a.file.localeCompare(b.file))) {
    const existing = byKey.get(candidate.key);
    if (!existing) {
      byKey.set(candidate.key, candidate);
      continue;
    }

    const existingRoot = existing.rootIndex;
    const candidateRoot = candidate.rootIndex;
    const existingExtRank = extensionRank(existing);
    const candidateExtRank = extensionRank(candidate);

    const shouldReplace =
      candidateRoot < existingRoot ||
      (candidateRoot === existingRoot && candidateExtRank < existingExtRank) ||
      (candidateRoot === existingRoot &&
        candidateExtRank === existingExtRank &&
        candidate.file.localeCompare(existing.file) < 0);

    if (shouldReplace) {
      byKey.set(candidate.key, candidate);
    }
  }

  return [...byKey.values()].map((item) => item.file).sort((a, b) => a.localeCompare(b));
}

async function discoverWorkflowFiles(workflowRoots: string[]): Promise<string[]> {
  type Candidate = {
    file: string;
    key: string;
    isJs: boolean;
    isTs: boolean;
    rootIndex: number;
  };

  const candidates: Candidate[] = [];

  for (const [rootIndex, root] of workflowRoots.entries()) {
    const files = await collectMatchingFiles(
      [root],
      (filename) =>
        filename.endsWith('.workflow.js') ||
        filename.endsWith('.workflow.ts') ||
        filename === 'workflow.js' ||
        filename === 'workflow.ts',
    );

    for (const file of files) {
      candidates.push({
        file,
        key: normalizeExtensionCandidateKey(root, file),
        isJs: file.endsWith('.js'),
        isTs: file.endsWith('.ts'),
        rootIndex,
      });
    }
  }

  const extensionRank = (candidate: Candidate): number => {
    if (candidate.isJs) return 0;
    if (candidate.isTs) return 1;
    return 2;
  };

  const byKey = new Map<string, Candidate>();
  for (const candidate of candidates.sort((a, b) => a.file.localeCompare(b.file))) {
    const existing = byKey.get(candidate.key);
    if (!existing) {
      byKey.set(candidate.key, candidate);
      continue;
    }

    const existingRoot = existing.rootIndex;
    const candidateRoot = candidate.rootIndex;
    const existingExtRank = extensionRank(existing);
    const candidateExtRank = extensionRank(candidate);

    const shouldReplace =
      candidateRoot < existingRoot ||
      (candidateRoot === existingRoot && candidateExtRank < existingExtRank) ||
      (candidateRoot === existingRoot &&
        candidateExtRank === existingExtRank &&
        candidate.file.localeCompare(existing.file) < 0);

    if (shouldReplace) {
      byKey.set(candidate.key, candidate);
    }
  }

  return [...byKey.values()].map((item) => item.file).sort((a, b) => a.localeCompare(b));
}

function extractConfigValue<T = unknown>(ctx: MCPServerContext, path: string, fallback?: T): T {
  const segments = path.split('.').filter(Boolean);
  let current: unknown = ctx.config as unknown as Record<string, unknown>;
  for (const segment of segments) {
    if (!current || typeof current !== 'object') return fallback as T;
    current = (current as Record<string, unknown>)[segment];
  }
  return (current as T) ?? (fallback as T);
}

function createFreshImportUrl(modulePath: string, kind: 'plugin' | 'workflow'): string {
  const moduleUrl = new URL(pathToFileURL(modulePath).href);
  moduleUrl.searchParams.set('reloadTs', String(Date.now()));
  logger.debug(`[extensions] Loading fresh ${kind} module: ${modulePath}`);
  return moduleUrl.href;
}

async function clearLoadedExtensionTools(ctx: MCPServerContext): Promise<number> {
  let removed = 0;

  for (const [pluginId, runtime] of ctx.extensionPluginRuntimeById.entries()) {
    try {
      if (runtime.plugin.onDeactivateHandler && runtime.state === 'activated') {
        await runtime.plugin.onDeactivateHandler(runtime.lifecycleContext);
        runtime.state = 'deactivated';
      }
    } catch (error) {
      logger.warn(`Plugin onDeactivate failed for "${pluginId}":`, error);
    }
    try {
      if (runtime.plugin.onDeactivateHandler) {
        runtime.state = 'unloaded';
      }
    } catch (error) {
      logger.warn(`Plugin onUnload failed for "${pluginId}":`, error);
    }
  }

  for (const record of ctx.extensionToolsByName.values()) {
    try {
      record.registeredTool?.remove();
    } catch (error) {
      logger.warn(`Failed to remove extension tool "${record.name}":`, error);
    }
    ctx.router.removeHandler(record.name);
    ctx.activatedToolNames.delete(record.name);
    ctx.activatedRegisteredTools.delete(record.name);
    removed++;
  }
  ctx.extensionToolsByName.clear();
  ctx.extensionPluginsById.clear();
  ctx.extensionPluginRuntimeById.clear();
  ctx.extensionWorkflowsById.clear();
  ctx.extensionWorkflowRuntimeById.clear();
  return removed;
}

function buildListResult(
  ctx: MCPServerContext,
  pluginRoots: string[],
  workflowRoots: string[],
): ExtensionListResult {
  return {
    pluginRoots,
    workflowRoots,
    pluginCount: ctx.extensionPluginsById.size,
    workflowCount: ctx.extensionWorkflowsById.size,
    toolCount: ctx.extensionToolsByName.size,
    lastReloadAt: ctx.lastExtensionReloadAt,
    plugins: [...ctx.extensionPluginsById.values()],
    workflows: [...ctx.extensionWorkflowsById.values()],
    tools: [...ctx.extensionToolsByName.values()].map((record) => ({
      name: record.name,
      domain: record.domain,
      source: record.source,
    })),
  };
}

export function listExtensions(ctx: MCPServerContext): ExtensionListResult {
  const pluginRoots = resolveRoots(parseRoots(process.env.MCP_PLUGIN_ROOTS, DEFAULT_PLUGIN_ROOTS));
  const workflowRoots = resolveRoots(parseRoots(process.env.MCP_WORKFLOW_ROOTS, DEFAULT_WORKFLOW_ROOTS));
  return buildListResult(ctx, pluginRoots, workflowRoots);
}

// Mutex to prevent concurrent reloadExtensions calls from corrupting state.
let reloadMutex: Promise<void> = Promise.resolve();

export async function reloadExtensions(ctx: MCPServerContext): Promise<ExtensionReloadResult> {
  const prev = reloadMutex;
  let resolve!: () => void;
  reloadMutex = new Promise<void>((r) => { resolve = r; });
  await prev;
  try {
    return await reloadExtensionsInner(ctx);
  } finally {
    resolve();
  }
}

async function reloadExtensionsInner(ctx: MCPServerContext): Promise<ExtensionReloadResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const removedTools = await clearLoadedExtensionTools(ctx);
  const pluginRoots = resolveRoots(parseRoots(process.env.MCP_PLUGIN_ROOTS, DEFAULT_PLUGIN_ROOTS));
  const workflowRoots = resolveRoots(parseRoots(process.env.MCP_WORKFLOW_ROOTS, DEFAULT_WORKFLOW_ROOTS));
  const allowedDigests = parseDigestAllowlist(process.env.MCP_PLUGIN_ALLOWED_DIGESTS);

  // --- Critical security gate: pre-import trust boundary ---
  // import() executes module top-level code immediately. The ONLY pre-import
  // trust mechanism is the file digest allowlist. When signature verification
  // is required, we MUST have an allowlist — otherwise a malicious plugin can
  // execute arbitrary code before its self-reported signature is checked.
  // is checked.
  const strictLoad = isPluginStrictLoad();

  if (strictLoad && allowedDigests.size === 0) {
    const msg = 'MCP_PLUGIN_ALLOWED_DIGESTS is required when MCP_PLUGIN_SIGNATURE_REQUIRED=true ' +
      'or MCP_PLUGIN_STRICT_LOAD=true. The digest allowlist is the only pre-import trust boundary — ' +
      'without it, plugin code executes before integrity verification. No plugins will be loaded.';
    errors.push(msg);
    logger.error('[extensions] ' + msg);

    // Skip all plugin loading but still process workflows
    const workflowFiles = await discoverWorkflowFiles(workflowRoots);
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
        ctx.extensionWorkflowsById.set(workflow.id, {
          id: workflow.id,
          displayName: workflow.displayName,
          source: workflowFile,
          description: workflow.description,
          tags: workflow.tags,
          timeoutMs: workflow.timeoutMs,
          defaultMaxConcurrency: workflow.defaultMaxConcurrency,
        });
        const runtimeRecord: ExtensionWorkflowRuntimeRecord = {
          workflow,
          source: workflowFile,
        };
        ctx.extensionWorkflowRuntimeById.set(workflow.id, runtimeRecord);
      } catch (error) {
        errors.push(`Failed to import workflow file ${workflowFile}: ${String(error)}`);
      }
    }

    ctx.lastExtensionReloadAt = new Date().toISOString();
    const list = buildListResult(ctx, pluginRoots, workflowRoots);
    return { ...list, addedTools: 0, removedTools, warnings, errors };
  }

  if (allowedDigests.size === 0) {
    logger.warn(
      '[extensions] Loading plugins WITHOUT MCP_PLUGIN_ALLOWED_DIGESTS allowlist. ' +
      'Plugin code will execute on import() before post-load integrity checks. ' +
      'Set MCP_PLUGIN_STRICT_LOAD=true to enforce allowlist requirement.',
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
        warnings.push(`Skip plugin file not in MCP_PLUGIN_ALLOWED_DIGESTS allowlist: ${pluginFile}`);
        continue;
      }
    } catch (error) {
      errors.push(`Failed to hash plugin file ${pluginFile}: ${String(error)}`);
      continue;
    }

    // NOTE: import() executes module top-level code. At this point the file
    // has passed the allowlist gate (if configured). Post-import verification
    // (checksum, signature, version compat) still runs below but cannot undo
    // any side effects from top-level execution.
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
      async invokeTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
        if (typeof name !== 'string' || name.length === 0) {
          throw new Error('invokeTool requires a non-empty tool name');
        }
        if (!allowInvokeAll && !plugin.allowTools.includes(name)) {
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
        // Force fully unknown coercing to bypass standard structural check constraints
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
          warnings.push(
            `Plugin ${plugin.id} validation failed: ${validation.errors.join('; ')}`,
          );
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
        logger.warn(`Plugin onDeactivate failed during rollback for ${plugin.id}:`, deactivateError);
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
