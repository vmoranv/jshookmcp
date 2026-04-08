import { asJsonResponse } from '@server/domains/shared/response';
import { MojoMonitor } from '@modules/mojo-ipc/MojoMonitor';
import { MojoMessageDecoder, listKnownInterfaces } from '@modules/mojo-ipc/MojoMessageDecoder';

class MojoMonitorHandlerCompat {
  constructor(private readonly monitor: any) {}

  getMonitor(): any {
    return this.monitor;
  }

  async handleStart(args: Record<string, unknown>) {
    const maxBuffer = typeof args['maxBuffer'] === 'number' ? args['maxBuffer'] : 10000;
    const interfaces = Array.isArray(args['interfaces'])
      ? (args['interfaces'] as unknown[]).filter(
          (value): value is string => typeof value === 'string',
        )
      : [];

    const sessionId = await this.monitor.startMonitor({
      pid: typeof args['pid'] === 'number' ? args['pid'] : undefined,
      processName: typeof args['processName'] === 'string' ? args['processName'] : undefined,
      interfaces,
      maxBuffer,
    });

    return asJsonResponse({
      sessionId,
      status: 'started',
      hasFrida: this.monitor.hasFrida(),
      config: {
        pid: typeof args['pid'] === 'number' ? args['pid'] : 'auto-detect',
        maxBuffer,
        interfaceFilter: interfaces,
      },
    });
  }

  async handleStop(args: Record<string, unknown>) {
    const sessionId = typeof args['sessionId'] === 'string' ? args['sessionId'] : '';
    if (!sessionId) {
      throw new Error('sessionId is required');
    }

    const messageCount = await this.monitor.stopMonitor(sessionId);
    return asJsonResponse({
      sessionId,
      status: 'stopped',
      messageCount,
    });
  }

  async handleGetMessages(args: Record<string, unknown>) {
    const sessionId = typeof args['sessionId'] === 'string' ? args['sessionId'] : '';
    if (!sessionId) {
      throw new Error('sessionId is required');
    }

    const filter = typeof args['filter'] === 'string' ? args['filter'] : undefined;
    const messages = await this.monitor.getMessages(sessionId, filter);
    return asJsonResponse({
      sessionId,
      messages,
      messageCount: Array.isArray(messages) ? messages.length : 0,
      filter: filter ?? 'none',
    });
  }
}

class MojoDecodeHandlerCompat {
  private readonly decoder = new MojoMessageDecoder();

  async handleDecode(args: Record<string, unknown>) {
    const messageHex = typeof args['messageHex'] === 'string' ? args['messageHex'] : '';
    if (!messageHex) {
      throw new Error('messageHex is required');
    }

    const interfaceName = typeof args['interfaceName'] === 'string' ? args['interfaceName'] : '';
    if (!interfaceName) {
      throw new Error('interfaceName is required');
    }

    return asJsonResponse(await this.decoder.decodeMessage(messageHex, interfaceName));
  }

  async handleListInterfaces(args: Record<string, unknown>) {
    const filter = typeof args['filter'] === 'string' ? args['filter'] : undefined;
    const interfaces = listKnownInterfaces(filter);
    return asJsonResponse({
      interfaces,
      count: interfaces.length,
      filter: filter ?? 'none',
    });
  }
}

export class MojoIPCHandlers {
  private readonly monitorHandler: MojoMonitorHandlerCompat;
  private readonly decodeHandler: MojoDecodeHandlerCompat;

  constructor() {
    const monitor = new MojoMonitor() as any;
    this.monitorHandler = new MojoMonitorHandlerCompat(monitor);
    this.decodeHandler = new MojoDecodeHandlerCompat();
  }

  handleStart(args: Record<string, unknown>) {
    return this.monitorHandler.handleStart(args);
  }

  handleStop(args: Record<string, unknown>) {
    return this.monitorHandler.handleStop(args);
  }

  handleGetMessages(args: Record<string, unknown>) {
    return this.monitorHandler.handleGetMessages(args);
  }

  handleDecode(args: Record<string, unknown>) {
    return this.decodeHandler.handleDecode(args);
  }

  handleListInterfaces(args: Record<string, unknown>) {
    return this.decodeHandler.handleListInterfaces(args);
  }

  getMonitorHandler() {
    return this.monitorHandler;
  }

  getDecodeHandler() {
    return this.decodeHandler;
  }
}
