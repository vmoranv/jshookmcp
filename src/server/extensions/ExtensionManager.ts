import { readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { DomainManifest } from '../registry/contracts.js';
import type { MCPServerContext } from '../MCPServer.context.js';
import type { PluginContract, PluginLifecycleContext, PluginState } from '../plugins/PluginContract.js';
import type { WorkflowContract } from '../workflows/WorkflowContract.js';
import { allTools } from '../ToolCatalog.js';
import { logger } from '../../utils/logger.js';
import type { ToolHandler } from '../types.js';
import type {
  ExtensionListResult,
  ExtensionPluginRecord,
  ExtensionPluginRuntimeRecord,
  ExtensionReloadResult,
  ExtensionWorkflowRecord,
} from './types.js';

const DEFAULT_PLUGIN_ROOTS = ['./plugins'];
const DEFAULT_WORKFLOW_ROOTS = ['./workflows'];

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

function safeHexEquals(a: string, b: string): boolean {
  const left = Buffer.from(normalizeHex(a), 'hex');
  const right = Buffer.from(normalizeHex(b), 'hex');
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
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
  plugin: PluginContract,
  pluginFile: string,
  currentVersion: string,
): Promise<{ ok: boolean; errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isCompatibleVersion(plugin.manifest.compatibleCore, currentVersion)) {
    errors.push(
      `Plugin ${plugin.manifest.id} incompatible with core ${currentVersion}; requires ${plugin.manifest.compatibleCore}`,
    );
  }

  let fileDigest: string | undefined;
  if (plugin.manifest.checksum || plugin.manifest.signature) {
    fileDigest = await sha256Hex(pluginFile);
  }

  if (plugin.manifest.checksum && fileDigest) {
    if (!safeHexEquals(plugin.manifest.checksum, fileDigest)) {
      errors.push(`Plugin ${plugin.manifest.id} checksum mismatch`);
    }
  }

  const signatureRequired = (process.env.MCP_PLUGIN_SIGNATURE_REQUIRED ?? 'false').toLowerCase() === 'true';
  const signatureSecret = process.env.MCP_PLUGIN_SIGNATURE_SECRET?.trim();
  const signature = plugin.manifest.signature?.trim();

  if (signatureRequired && !signature) {
    errors.push(`Plugin ${plugin.manifest.id} is missing required signature`);
  }

  if (signature) {
    if (!signatureSecret) {
      if (signatureRequired) {
        errors.push('MCP_PLUGIN_SIGNATURE_SECRET is required to verify plugin signatures');
      } else {
        warnings.push(`Plugin ${plugin.manifest.id} has signature but MCP_PLUGIN_SIGNATURE_SECRET is not set; signature not verified`);
      }
    } else if (fileDigest) {
      const expected = createHmac('sha256', signatureSecret).update(fileDigest).digest('hex');
      if (!safeHexEquals(signature, expected)) {
        errors.push(`Plugin ${plugin.manifest.id} signature verification failed`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

function isPluginContract(value: unknown): value is PluginContract {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const manifest = candidate.manifest as Record<string, unknown> | undefined;
  return !!(
    manifest &&
    manifest.kind === 'plugin-manifest' &&
    manifest.version === 1 &&
    typeof manifest.id === 'string' &&
    typeof candidate.onLoad === 'function'
  );
}

function isDomainManifest(value: unknown): value is DomainManifest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return !!(
    candidate.kind === 'domain-manifest' &&
    candidate.version === 1 &&
    typeof candidate.domain === 'string' &&
    typeof candidate.depKey === 'string' &&
    typeof candidate.ensure === 'function' &&
    Array.isArray(candidate.registrations)
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
  const files: string[] = [];
  const queue = [...roots].sort((a, b) => a.localeCompare(b));
  while (queue.length > 0) {
    const current = queue.shift()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    const sortedEntries = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sortedEntries) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(abs);
        queue.sort((a, b) => a.localeCompare(b));
        continue;
      }
      if (entry.isFile() && matcher(entry.name)) {
        files.push(abs);
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function discoverPluginFiles(pluginRoots: string[]): Promise<string[]> {
  const all = await collectMatchingFiles(
    pluginRoots,
    (filename) => filename === 'manifest.js' || filename === 'manifest.ts',
  );
  // Prefer JS when both JS/TS exist in the same directory.
  const byDir = new Map<string, string>();
  for (const file of all) {
    const dir = dirname(file);
    const existing = byDir.get(dir);
    if (!existing) {
      byDir.set(dir, file);
      continue;
    }
    if (file.endsWith('.js') && existing.endsWith('.ts')) {
      byDir.set(dir, file);
    }
  }
  return [...byDir.values()].sort((a, b) => a.localeCompare(b));
}

async function discoverWorkflowFiles(workflowRoots: string[]): Promise<string[]> {
  return collectMatchingFiles(
    workflowRoots,
    (filename) =>
      filename.endsWith('.workflow.js') ||
      filename.endsWith('.workflow.ts') ||
      filename === 'workflow.js' ||
      filename === 'workflow.ts',
  );
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

async function clearLoadedExtensionTools(ctx: MCPServerContext): Promise<number> {
  let removed = 0;

  for (const [pluginId, runtime] of ctx.extensionPluginRuntimeById.entries()) {
    try {
      if (runtime.plugin.onDeactivate && runtime.state === 'activated') {
        await runtime.plugin.onDeactivate(runtime.lifecycleContext);
        runtime.state = 'deactivated';
      }
    } catch (error) {
      logger.warn(`Plugin onDeactivate failed for "${pluginId}":`, error);
    }
    try {
      if (runtime.plugin.onUnload) {
        await runtime.plugin.onUnload(runtime.lifecycleContext);
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
  const signatureRequired = (process.env.MCP_PLUGIN_SIGNATURE_REQUIRED ?? 'false').toLowerCase() === 'true';
  const strictLoad = signatureRequired ||
    ['1', 'true'].includes((process.env.MCP_PLUGIN_STRICT_LOAD ?? '').toLowerCase());

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
        const mod: unknown = await import(pathToFileURL(workflowFile).href);
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
        });
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
    let plugin: PluginContract;
    try {
      const mod: unknown = await import(pathToFileURL(pluginFile).href);
      const candidate = (mod as Record<string, unknown>).default ?? mod;
      if (!isPluginContract(candidate)) {
        warnings.push(`Skip plugin file without valid PluginContract: ${pluginFile}`);
        continue;
      }
      plugin = candidate;
    } catch (error) {
      errors.push(`Failed to import plugin file ${pluginFile}: ${String(error)}`);
      continue;
    }
    if (ctx.extensionPluginsById.has(plugin.manifest.id)) {
      warnings.push(`Skip plugin "${plugin.manifest.id}" from ${pluginFile}: duplicate plugin id`);
      continue;
    }
    try {
      const verification = await verifyPluginIntegrity(plugin, pluginFile, coreVersion);
      warnings.push(...verification.warnings);
      if (!verification.ok) {
        errors.push(...verification.errors);
        continue;
      }
    } catch (error) {
      errors.push(`Failed to verify plugin ${plugin.manifest.id}: ${String(error)}`);
      continue;
    }

    const runtimeData = new Map<string, unknown>();
    const domains: DomainManifest[] = [];
    const workflows: WorkflowContract[] = [];
    const metrics = new Set<string>();
    let pluginState: PluginState = 'loaded';

    // --- Permission enforcement helpers ---
    // The framework checks declared permissions BEFORE allowing registrations.
    // Plugins without declared permissions get warnings; when strict mode is
    // enabled, undeclared capabilities are blocked.
    const pluginPermissions = plugin.manifest.permissions ?? {} as Record<string, unknown>;
    const permissionEnforce = strictLoad || signatureRequired;
    const toolExecutionPermission = (
      pluginPermissions as { toolExecution?: { allowTools?: unknown } }
    ).toolExecution;
    const allowInvokedTools = Array.isArray(toolExecutionPermission?.allowTools)
      ? toolExecutionPermission.allowTools.filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      )
      : [];
    const allowInvokeAll = allowInvokedTools.includes('*');

    function checkRegistrationPermission(
      capability: string,
      action: string,
    ): boolean {
      const declared = !!(pluginPermissions as Record<string, unknown>)[capability];
      if (!declared) {
        const msg = `Plugin "${plugin.manifest.id}" attempted ${action} without declaring "${capability}" permission`;
        if (permissionEnforce) {
          errors.push(msg + ' (blocked by strict mode)');
          return false;
        }
        warnings.push(msg + ' (allowed — set MCP_PLUGIN_STRICT_LOAD=true to enforce)');
      }
      return true;
    }

    const lifecycleContext: PluginLifecycleContext = {
      pluginId: plugin.manifest.id,
      pluginRoot: pluginFile,
      config: ctx.config as unknown as Record<string, unknown>,
      get state() {
        return pluginState;
      },
      registerDomain(manifest) {
        if (!checkRegistrationPermission('toolExecution', `registerDomain("${(manifest as {domain?: string}).domain ?? 'unknown'}")`)) {
          return;
        }
        domains.push(manifest);
      },
      registerWorkflow(workflow) {
        if (!checkRegistrationPermission('toolExecution', `registerWorkflow("${(workflow as {id?: string}).id ?? 'unknown'}")`)) {
          return;
        }
        workflows.push(workflow);
      },
      registerMetric(metricName) {
        metrics.add(metricName);
      },
      async invokeTool(name, args = {}) {
        if (typeof name !== 'string' || name.length === 0) {
          throw new Error('invokeTool requires a non-empty tool name');
        }
        if (!checkRegistrationPermission('toolExecution', `invokeTool("${name}")`)) {
          throw new Error(`Plugin "${plugin.manifest.id}" is not allowed to invoke tools`);
        }
        if (!allowInvokeAll && !allowInvokedTools.includes(name)) {
          throw new Error(
            `Plugin "${plugin.manifest.id}" is not allowed to invoke "${name}". ` +
            'Declare it in permissions.toolExecution.allowTools.',
          );
        }
        if (!baseToolNames.has(name)) {
          throw new Error(
            `Plugin "${plugin.manifest.id}" can only invoke built-in tools. "${name}" is not built-in.`,
          );
        }
        if (!ctx.router.has(name)) {
          throw new Error(`Tool "${name}" is not available in the current active profile.`);
        }
        return ctx.executeToolWithTracking(name, (args ?? {}) as Record<string, unknown>);
      },
      hasPermission(capability) {
        const permissions = plugin.manifest.permissions as Record<string, unknown> | undefined;
        return !!permissions?.[capability];
      },
      getConfig(path, fallback) {
        // Only expose config values — do not leak full ctx.config reference
        return extractConfigValue(ctx, path, fallback);
      },
      setRuntimeData(key, value) {
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
      await plugin.onLoad(lifecycleContext);
      pluginState = 'loaded';
      runtimeRecord.state = pluginState;
      if (plugin.onValidate) {
        const validation = await plugin.onValidate(lifecycleContext);
        if (!validation.valid) {
          warnings.push(
            `Plugin ${plugin.manifest.id} validation failed: ${validation.errors.join('; ')}`,
          );
          continue;
        }
        pluginState = 'validated';
        runtimeRecord.state = pluginState;
      }
      if (plugin.onRegister) {
        await plugin.onRegister(lifecycleContext);
        pluginState = 'registered';
        runtimeRecord.state = pluginState;
      }
      if (plugin.onActivate) {
        await plugin.onActivate(lifecycleContext);
        pluginState = 'activated';
        runtimeRecord.state = pluginState;
      }
      ctx.extensionPluginRuntimeById.set(plugin.manifest.id, runtimeRecord);
    } catch (error) {
      try {
        if (plugin.onDeactivate && pluginState === 'activated') {
          await plugin.onDeactivate(lifecycleContext);
          pluginState = 'deactivated';
          runtimeRecord.state = pluginState;
        }
      } catch (deactivateError) {
        logger.warn(`Plugin onDeactivate failed during rollback for ${plugin.manifest.id}:`, deactivateError);
      }
      try {
        if (plugin.onUnload) {
          await plugin.onUnload(lifecycleContext);
          pluginState = 'unloaded';
          runtimeRecord.state = pluginState;
        }
      } catch (unloadError) {
        logger.warn(`Plugin onUnload failed during rollback for ${plugin.manifest.id}:`, unloadError);
      }
      errors.push(`Plugin lifecycle failed for ${plugin.manifest.id}: ${String(error)}`);
      continue;
    }

    for (const manifestDomain of plugin.manifest.contributes?.domains ?? []) {
      if (checkRegistrationPermission('toolExecution', `contributes.domains("${(manifestDomain as {domain?: string}).domain ?? 'unknown'}")`)) {
        domains.push(manifestDomain);
      }
    }
    for (const workflow of plugin.manifest.contributes?.workflows ?? []) {
      if (checkRegistrationPermission('toolExecution', `contributes.workflows("${(workflow as {id?: string}).id ?? 'unknown'}")`)) {
        workflows.push(workflow);
      }
    }
    for (const metric of plugin.manifest.contributes?.metrics ?? []) {
      metrics.add(metric);
    }

    const loadedTools: string[] = [];
    const loadedDomains = new Set<string>();
    const loadedWorkflows = new Set<string>();

    for (const domain of domains) {
      if (!isDomainManifest(domain)) {
        warnings.push(`Plugin ${plugin.manifest.id} returned invalid domain manifest`);
        continue;
      }

      let handlerInstance: unknown;
      try {
        handlerInstance = domain.ensure(ctx);
      } catch (error) {
        errors.push(
          `Plugin ${plugin.manifest.id} failed to initialize domain ${domain.domain}: ${String(error)}`,
        );
        continue;
      }

      loadedDomains.add(domain.domain);
      const deps = { ...ctx.handlerDeps, [domain.depKey]: handlerInstance };

      for (const registration of domain.registrations) {
        const toolName = registration.tool.name;
        if (baseToolNames.has(toolName)) {
          warnings.push(`Skip plugin tool "${toolName}" from ${plugin.manifest.id}: name conflicts with built-in tool`);
          continue;
        }
        if (ctx.extensionToolsByName.has(toolName)) {
          warnings.push(`Skip plugin tool "${toolName}" from ${plugin.manifest.id}: already loaded by another extension`);
          continue;
        }
        try {
          const handler = registration.bind(deps) as unknown as ToolHandler;
          // Register MCP tool FIRST — if this fails, no orphan handler is left.
          const registeredTool = ctx.registerSingleTool(registration.tool);
          try {
            ctx.router.addHandlers({ [toolName]: handler });
          } catch (routerError) {
            // Rollback MCP registration on router failure
            try { registeredTool.remove(); } catch { /* best-effort */ }
            throw routerError;
          }
          ctx.activatedToolNames.add(toolName);
          ctx.activatedRegisteredTools.set(toolName, registeredTool);
          ctx.extensionToolsByName.set(toolName, {
            name: toolName,
            domain: registration.domain || domain.domain,
            source: plugin.manifest.id,
            tool: registration.tool,
            registeredTool,
          });
          loadedTools.push(toolName);
        } catch (error) {
          errors.push(
            `Plugin ${plugin.manifest.id} failed to register tool ${toolName}: ${String(error)}`,
          );
        }
      }
    }

    for (const workflow of workflows) {
      if (!isWorkflowContract(workflow)) {
        warnings.push(`Plugin ${plugin.manifest.id} returned invalid workflow contract`);
        continue;
      }
      if (ctx.extensionWorkflowsById.has(workflow.id)) {
        warnings.push(`Skip workflow "${workflow.id}" from ${plugin.manifest.id}: duplicate id`);
        continue;
      }
      ctx.extensionWorkflowsById.set(workflow.id, {
        id: workflow.id,
        displayName: workflow.displayName,
        source: plugin.manifest.id,
      });
      loadedWorkflows.add(workflow.id);
    }

    const record: ExtensionPluginRecord = {
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      source: pluginFile,
      domains: [...loadedDomains],
      workflows: [...loadedWorkflows],
      tools: loadedTools,
    };
    ctx.extensionPluginsById.set(record.id, record);
  }

  const workflowFiles = await discoverWorkflowFiles(workflowRoots);
  for (const workflowFile of workflowFiles) {
    try {
      const mod: unknown = await import(pathToFileURL(workflowFile).href);
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
      };
      ctx.extensionWorkflowsById.set(record.id, record);
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
