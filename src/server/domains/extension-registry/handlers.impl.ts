import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RegisteredPluginManifest } from '@modules/extension-registry';
import { PluginRegistry, WebhookBridge } from '@modules/extension-registry';
import { WebhookServer, CommandQueue } from '@server/webhook';
import { argObject, argString, argStringRequired } from '@server/domains/shared/parse-args';
import { asJsonResponse, toolErrorToResponse } from '@server/domains/shared/response';
import type { ToolArgs, ToolResponse } from '@server/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCallable(value: unknown): value is (input: unknown) => unknown {
  return typeof value === 'function';
}

function sanitizePluginId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-');
  return normalized.length > 0 ? normalized : `plugin-${Date.now()}`;
}

function createManifestFromEntry(entry: string): RegisteredPluginManifest {
  const parsed = path.parse(entry);
  const baseName = parsed.name || 'plugin';
  return {
    id: sanitizePluginId(baseName),
    name: baseName,
    version: '0.0.0',
    entry,
    permissions: [],
  };
}

function parseManifest(value: unknown): RegisteredPluginManifest {
  if (!isRecord(value)) {
    throw new Error('Extension manifest must be an object');
  }

  const { id, name, version, entry, permissions } = value;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof version !== 'string' ||
    typeof entry !== 'string'
  ) {
    throw new Error('Extension manifest requires id, name, version, and entry');
  }

  return {
    id,
    name,
    version,
    entry,
    permissions: Array.isArray(permissions)
      ? permissions.filter((permission): permission is string => typeof permission === 'string')
      : [],
  };
}

export class ExtensionRegistryHandlers {
  private _webhookServer?: WebhookServer;
  private _commandQueue?: CommandQueue;

  constructor(
    private registry?: PluginRegistry,
    private webhook?: WebhookBridge,
  ) {}

  // ── Plugin Lifecycle ──

  async handleListInstalled(): Promise<ToolResponse> {
    try {
      return asJsonResponse({
        success: true,
        plugins: this.getRegistry().listInstalled(),
      });
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  async handleExecuteInContext(args: ToolArgs): Promise<ToolResponse> {
    try {
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
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  async handleInstall(args: ToolArgs): Promise<ToolResponse> {
    try {
      const url = argStringRequired(args, 'url');
      const manifest = await this.loadManifestFromUrl(url);
      const pluginId = await this.getRegistry().register(manifest);
      this.emitEvent('extension.installed', { pluginId, url });

      return asJsonResponse({
        success: true,
        pluginId,
        manifest,
      });
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  async handleReload(args: ToolArgs): Promise<ToolResponse> {
    try {
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
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  async handleUninstall(args: ToolArgs): Promise<ToolResponse> {
    try {
      const pluginId = argStringRequired(args, 'pluginId');
      await this.getRegistry().unregister(pluginId);
      this.emitEvent('extension.uninstalled', { pluginId });

      return asJsonResponse({
        success: true,
        pluginId,
      });
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  // ── Webhook C2 ──

  async handleWebhookCreate(args: ToolArgs): Promise<ToolResponse> {
    try {
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

      // Register external callback URL in WebhookBridge for event forwarding
      const bridge = this.getWebhook();
      const baseUrl = `http://localhost:${server.getPort()}${webhookPath}`;
      bridge.registerExternalCallback(endpointId, baseUrl);

      return asJsonResponse({
        success: true,
        endpointId,
        url: baseUrl,
        name,
        events,
      });
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  async handleWebhookList(): Promise<ToolResponse> {
    try {
      const server = this.getWebhookServer();
      const endpoints = server.listEndpoints();
      return asJsonResponse({
        success: true,
        endpoints,
        port: server.getPort(),
        running: server.isRunning(),
      });
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  async handleWebhookDelete(args: ToolArgs): Promise<ToolResponse> {
    try {
      const endpointId = argStringRequired(args, 'endpointId');
      const server = this.getWebhookServer();
      server.removeEndpoint(endpointId);
      return asJsonResponse({
        success: true,
        endpointId,
      });
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  async handleWebhookCommands(args: ToolArgs): Promise<ToolResponse> {
    try {
      const endpointId = argStringRequired(args, 'endpointId');
      const status = argString(args, 'status');

      // If a command is provided, enqueue it
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

      // Otherwise, list commands for this endpoint
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
    } catch (error) {
      return toolErrorToResponse(error);
    }
  }

  // ── WebhookServer Lifecycle ──

  getWebhookServer(): WebhookServer {
    if (!this._webhookServer) {
      this._commandQueue = new CommandQueue();
      this._webhookServer = new WebhookServer({
        commandQueue: this._commandQueue,
      });
    }
    return this._webhookServer;
  }

  async startWebhookServer(): Promise<void> {
    const server = this.getWebhookServer();
    if (!server.isRunning()) {
      server.start();
    }
  }

  async stopWebhookServer(): Promise<void> {
    if (this._webhookServer) {
      await this._webhookServer.stop();
      this._webhookServer = undefined;
      this._commandQueue = undefined;
    }
  }

  // ── Private Helpers ──

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
    if (!this._commandQueue) {
      this._commandQueue = new CommandQueue();
    }
    return this._commandQueue;
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

  private async loadManifestFromUrl(url: string): Promise<RegisteredPluginManifest> {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return this.loadManifestFromRemoteUrl(url);
    }

    return this.loadManifestFromLocalUrl(url);
  }

  private async loadManifestFromRemoteUrl(url: string): Promise<RegisteredPluginManifest> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch extension from ${url}: ${response.status} ${response.statusText}`,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    const body = await response.text();

    if (contentType.includes('json') || url.endsWith('.json')) {
      const manifest = parseManifest(JSON.parse(body));
      return {
        ...manifest,
        entry: this.resolveRemoteEntry(url, manifest.entry),
      };
    }

    return createManifestFromEntry(url);
  }

  private async loadManifestFromLocalUrl(url: string): Promise<RegisteredPluginManifest> {
    const localPath = url.startsWith('file://') ? fileURLToPath(new URL(url)) : path.resolve(url);
    if (localPath.endsWith('.json')) {
      const content = await readFile(localPath, 'utf8');
      const manifest = parseManifest(JSON.parse(content));
      return {
        ...manifest,
        entry: this.resolveLocalEntry(localPath, manifest.entry),
      };
    }

    return createManifestFromEntry(localPath);
  }

  private resolveRemoteEntry(baseUrl: string, entry: string): string {
    if (
      entry.startsWith('http://') ||
      entry.startsWith('https://') ||
      entry.startsWith('file://')
    ) {
      return entry;
    }

    return new URL(entry, baseUrl).href;
  }

  private resolveLocalEntry(manifestPath: string, entry: string): string {
    if (
      entry.startsWith('http://') ||
      entry.startsWith('https://') ||
      entry.startsWith('file://')
    ) {
      return entry;
    }

    return path.isAbsolute(entry) ? entry : path.resolve(path.dirname(manifestPath), entry);
  }
}
