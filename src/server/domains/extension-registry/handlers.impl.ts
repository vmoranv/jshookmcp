import { PluginRegistry, WebhookBridge } from '@modules/extension-registry';
import { WebhookServer, CommandQueue } from '@server/webhook';
import { argObject, argString, argStringRequired } from '@server/domains/shared/parse-args';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolArgs, ToolResponse } from '@server/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCallable(value: unknown): value is (input: unknown) => unknown {
  return typeof value === 'function';
}

export class ExtensionRegistryHandlers {
  private _webhookServer?: WebhookServer;
  private _commandQueue?: CommandQueue;

  constructor(
    private registry?: PluginRegistry,
    private webhook?: WebhookBridge,
  ) {}

  async handleListInstalled(): Promise<ToolResponse> {
    return asJsonResponse({
      success: true,
      plugins: this.getRegistry().listInstalled(),
    });
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

  async handleUninstall(args: ToolArgs): Promise<ToolResponse> {
    const pluginId = argStringRequired(args, 'pluginId');
    await this.getRegistry().unregister(pluginId);
    this.emitEvent('extension.uninstalled', { pluginId });

    return asJsonResponse({
      success: true,
      pluginId,
    });
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
    bridge.registerExternalCallback(endpointId, baseUrl);

    return asJsonResponse({
      success: true,
      endpointId,
      url: baseUrl,
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
