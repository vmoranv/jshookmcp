import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PluginRegistry, WebhookBridge } from '@modules/extension-registry';
import type { RegisteredPluginManifest } from '@modules/extension-registry';
import { CommandQueue, WebhookServer } from '@server/webhook';
import {
  argObject,
  argString,
  argStringArray,
  argStringRequired,
} from '@server/domains/shared/parse-args';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolArgs, ToolResponse } from '@server/types';
import { getProjectRoot } from '@utils/outputPaths';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCallable(value: unknown): value is (input: unknown) => unknown {
  return typeof value === 'function';
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function isAbsolutePath(value: string): boolean {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function cleanStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function moduleNameFromSource(source: string): string {
  const parsed = isHttpUrl(source) ? new URL(source).pathname : source;
  const baseName = path.basename(parsed).replace(/\.[cm]?js$/u, '');
  return baseName || 'extension-plugin';
}

function resolveLocalSource(source: string): string {
  return isAbsolutePath(source) ? path.normalize(source) : path.resolve(getProjectRoot(), source);
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Expected JSON object in ${filePath}`);
  }
  return parsed;
}

function extractPackagePermissions(pkg: Record<string, unknown>): string[] | undefined {
  const config = isRecord(pkg.jshookmcp) ? pkg.jshookmcp : undefined;
  return cleanStringArray(config?.permissions) ?? cleanStringArray(pkg.permissions);
}

function extractPackageEntry(pkg: Record<string, unknown>): string | undefined {
  const config = isRecord(pkg.jshookmcp) ? pkg.jshookmcp : undefined;
  const exportsField = pkg.exports;
  return (
    cleanString(config?.entry) ??
    cleanString(pkg.entry) ??
    cleanString(pkg.jshookmcpEntry) ??
    cleanString(pkg.module) ??
    cleanString(pkg.main) ??
    cleanString(exportsField)
  );
}

function toManifestCandidate(record: Record<string, unknown>): Partial<RegisteredPluginManifest> {
  const candidate: Partial<RegisteredPluginManifest> = {};
  const id = cleanString(record.id);
  const name = cleanString(record.name);
  const version = cleanString(record.version);
  const entry = cleanString(record.entry);
  const permissions = cleanStringArray(record.permissions);
  if (id) candidate.id = id;
  if (name) candidate.name = name;
  if (version) candidate.version = version;
  if (entry) candidate.entry = entry;
  if (permissions) candidate.permissions = permissions;
  return candidate;
}

export class ExtensionRegistryHandlers {
  private webhookServer?: WebhookServer;
  private commandQueue?: CommandQueue;

  constructor(
    private registry?: PluginRegistry,
    private webhook?: WebhookBridge,
  ) {}

  async handleInstallTool(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleInstall(args));
  }

  async handleInstall(args: ToolArgs): Promise<ToolResponse> {
    const manifest = await this.resolveInstallManifest(args);
    const pluginId = await this.getRegistry().register(manifest);
    this.emitEvent('extension.installed', { pluginId });

    return asJsonResponse({
      success: true,
      pluginId,
      manifest: this.getRegistry().getInstalled(pluginId) ?? {
        ...manifest,
        id: pluginId,
        permissions: manifest.permissions ?? [],
        status: 'unloaded',
      },
    });
  }

  async handleListInstalledTool(): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleListInstalled());
  }

  async handleListInstalled(): Promise<ToolResponse> {
    return asJsonResponse({
      success: true,
      plugins: this.getRegistry().listInstalled(),
    });
  }

  async handleInfoTool(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleInfo(args));
  }

  async handleInfo(args: ToolArgs): Promise<ToolResponse> {
    const pluginId = argStringRequired(args, 'pluginId');
    const manifest = this.getRegistry().getInstalled(pluginId);
    if (!manifest) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    return asJsonResponse({
      success: true,
      pluginId,
      manifest,
    });
  }

  async handleExecuteInContextTool(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleExecuteInContext(args));
  }

  async handleExecuteInContext(args: ToolArgs): Promise<ToolResponse> {
    const pluginId = argStringRequired(args, 'pluginId');
    const contextName = argStringRequired(args, 'contextName');
    const contextArgs = argObject(args, 'args') ?? {};
    const { manifest, exports } = await this.getRegistry().loadPlugin(pluginId);

    const context = this.resolveContext(exports, contextName);
    if (!context) {
      throw new Error(`Context "${contextName}" was not found in plugin "${pluginId}"`);
    }

    const result = await Promise.resolve(context(contextArgs));
    this.emitEvent('extension.executed', { pluginId, contextName });

    return asJsonResponse({
      success: true,
      manifest,
      contextName,
      result,
    });
  }

  async handleReloadTool(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleReload(args));
  }

  async handleReload(args: ToolArgs): Promise<ToolResponse> {
    const pluginId = argStringRequired(args, 'pluginId');
    await this.getRegistry().unloadPlugin(pluginId);
    const loaded = await this.getRegistry().loadPlugin(pluginId);
    this.emitEvent('extension.reloaded', { pluginId });

    return asJsonResponse({
      success: true,
      pluginId,
      manifest: loaded.manifest,
      exportedKeys: Object.keys(loaded.exports).toSorted(),
    });
  }

  async handleUninstallTool(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleUninstall(args));
  }

  async handleUninstall(args: ToolArgs): Promise<ToolResponse> {
    const pluginId = argStringRequired(args, 'pluginId');
    await this.getRegistry().unregister(pluginId);
    this.emitEvent('extension.uninstalled', { pluginId });

    return asJsonResponse({
      success: true,
      pluginId,
    });
  }

  async handleWebhookDispatchTool(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWebhookDispatch(args));
  }

  async handleWebhookCreate(args: ToolArgs): Promise<ToolResponse> {
    const name = argStringRequired(args, 'name');
    const webhookPath = argStringRequired(args, 'path');
    const secret = argString(args, 'secret');
    const events = Array.isArray(args.events)
      ? (args.events as string[]).filter((e): e is string => typeof e === 'string')
      : [];

    const server = this.getWebhookServer();
    if (!server.isRunning()) {
      server.start();
    }

    const endpointId = server.registerEndpoint({
      path: webhookPath,
      method: 'POST',
      secret: secret ?? undefined,
    });

    const bridge = this.getWebhook();
    const baseUrl = `http://localhost:${server.getPort()}${webhookPath}`;
    const externalUrl = argString(args, 'url');
    if (externalUrl) {
      bridge.registerExternalCallback(endpointId, externalUrl);
    }

    return asJsonResponse({
      success: true,
      endpointId,
      url: baseUrl,
      ...(externalUrl ? { externalUrl } : {}),
      name,
      events,
    });
  }

  async handleWebhookList(): Promise<ToolResponse> {
    const server = this.getWebhookServer();
    const endpoints = server.listEndpoints();
    return asJsonResponse({
      success: true,
      endpoints,
      port: server.getPort(),
      running: server.isRunning(),
    });
  }

  async handleWebhookDelete(args: ToolArgs): Promise<ToolResponse> {
    const endpointId = argStringRequired(args, 'endpointId');
    const server = this.getWebhookServer();
    try {
      server.removeEndpoint(endpointId);
    } catch (err) {
      throw new Error(`GRACEFUL: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
    return asJsonResponse({
      success: true,
      endpointId,
    });
  }

  async handleWebhookCommands(args: ToolArgs): Promise<ToolResponse> {
    const endpointId = argStringRequired(args, 'endpointId');
    const status = argString(args, 'status');
    const command = argObject(args, 'command');

    if (command) {
      const queue = this.getCommandQueue();
      const cmdId = queue.enqueue({
        endpointId,
        payload: command,
      });
      return asJsonResponse({
        success: true,
        commandId: cmdId,
        status: 'pending',
      });
    }

    const queue = this.getCommandQueue();
    const filter: Record<string, unknown> = { endpointId };
    if (status) {
      filter.status = status;
    }
    const commands = queue.dequeue(filter);

    return asJsonResponse({
      success: true,
      endpointId,
      commands,
      count: Array.isArray(commands) ? commands.length : commands ? 1 : 0,
    });
  }

  getWebhookServer(): WebhookServer {
    if (!this.webhookServer) {
      this.commandQueue = new CommandQueue();
      this.webhookServer = new WebhookServer({
        commandQueue: this.commandQueue,
      });
    }
    return this.webhookServer;
  }

  async startWebhookServer(): Promise<void> {
    const server = this.getWebhookServer();
    if (!server.isRunning()) {
      server.start();
    }
  }

  async stopWebhookServer(): Promise<void> {
    if (this.webhookServer) {
      await this.webhookServer.stop();
      this.webhookServer = undefined;
      this.commandQueue = undefined;
    }
  }

  private getRegistry(): PluginRegistry {
    if (!this.registry) {
      this.registry = new PluginRegistry();
    }

    return this.registry;
  }

  private getWebhook(): WebhookBridge {
    if (!this.webhook) {
      this.webhook = new WebhookBridge();
    }

    return this.webhook;
  }

  private getCommandQueue(): CommandQueue {
    if (!this.commandQueue) {
      this.commandQueue = new CommandQueue();
    }
    return this.commandQueue;
  }

  private async resolveInstallManifest(args: ToolArgs): Promise<RegisteredPluginManifest> {
    const source = argString(args, 'source');
    const sourceCandidate = source ? await this.manifestFromSource(source) : {};
    const inlineArgs = argObject(args, 'manifest');
    const inlineCandidate = inlineArgs ? toManifestCandidate(inlineArgs) : {};
    const directCandidate = toManifestCandidate(args);
    const permissions = Array.isArray(args.permissions)
      ? argStringArray(args, 'permissions')
      : (directCandidate.permissions ?? inlineCandidate.permissions ?? sourceCandidate.permissions);
    const merged = {
      ...sourceCandidate,
      ...inlineCandidate,
      ...directCandidate,
      permissions,
    };

    const name = merged.name;
    const entry = merged.entry;
    if (!name || !entry) {
      throw new Error(
        'extension_install requires name and entry via source, manifest, or top-level arguments',
      );
    }

    return {
      id: merged.id ?? name,
      name,
      version: merged.version ?? '0.0.0',
      entry,
      permissions: merged.permissions ?? [],
    };
  }

  private async manifestFromSource(source: string): Promise<Partial<RegisteredPluginManifest>> {
    if (isHttpUrl(source)) {
      return {
        id: moduleNameFromSource(source),
        name: moduleNameFromSource(source),
        version: '0.0.0',
        entry: source,
      };
    }

    const resolved = resolveLocalSource(source);
    const sourceStat = await stat(resolved).catch((error: unknown) => {
      throw new Error(`Extension source not found: ${source}`, { cause: error });
    });

    if (sourceStat.isDirectory()) {
      return this.manifestFromPackageJson(path.join(resolved, 'package.json'), resolved);
    }

    if (
      path.basename(resolved).toLowerCase() === 'package.json' ||
      path.extname(resolved).toLowerCase() === '.json'
    ) {
      return this.manifestFromPackageJson(resolved, path.dirname(resolved));
    }

    return {
      id: moduleNameFromSource(resolved),
      name: moduleNameFromSource(resolved),
      version: '0.0.0',
      entry: pathToFileURL(resolved).href,
    };
  }

  private async manifestFromPackageJson(
    packageJsonPath: string,
    packageDir: string,
  ): Promise<Partial<RegisteredPluginManifest>> {
    const pkg = await readJsonFile(packageJsonPath);
    const entry = extractPackageEntry(pkg);
    const resolvedEntry = entry
      ? isHttpUrl(entry) || entry.startsWith('file://')
        ? entry
        : pathToFileURL(path.resolve(packageDir, entry)).href
      : undefined;

    return {
      id: cleanString(pkg.id) ?? cleanString(pkg.name),
      name: cleanString(pkg.name),
      version: cleanString(pkg.version) ?? '0.0.0',
      entry: resolvedEntry,
      permissions: extractPackagePermissions(pkg),
    };
  }

  private emitEvent(event: string, payload: unknown): void {
    void this.getWebhook()
      .sendEvent(event, payload)
      .catch(() => undefined);
  }

  private resolveContext(
    exportsRecord: Record<string, unknown>,
    contextName: string,
  ): ((input: unknown) => unknown) | null {
    const directContext = exportsRecord[contextName];
    if (isCallable(directContext)) {
      return directContext;
    }

    const defaultExport = exportsRecord.default;
    if (contextName === 'default' && isCallable(defaultExport)) {
      return defaultExport;
    }

    if (isRecord(defaultExport)) {
      const nestedContext = defaultExport[contextName];
      if (isCallable(nestedContext)) {
        return nestedContext;
      }
    }

    return null;
  }

  async handleWebhookDispatch(args: ToolArgs): Promise<ToolResponse> {
    const action = argString(args, 'action');
    switch (action) {
      case 'create':
        return this.handleWebhookCreate(args);
      case 'list':
        return this.handleWebhookList();
      case 'delete':
        return this.handleWebhookDelete(args);
      case 'commands':
        return this.handleWebhookCommands(args);
      default:
        return asJsonResponse({
          error: `Invalid action: "${action}". Expected one of: create, list, delete, commands`,
        });
    }
  }
}
