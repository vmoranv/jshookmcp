import { MojoDecoder, MojoMonitor } from '@modules/mojo-ipc';
import { argNumber, argString } from '@server/domains/shared/parse-args';

function unavailablePayload(
  reason: string,
  action: string,
): {
  success: false;
  available: false;
  action: string;
  error: string;
} {
  return {
    success: false,
    available: false,
    action,
    error: reason,
  };
}

export class MojoIPCHandlers {
  constructor(
    private monitor?: MojoMonitor,
    private decoder?: MojoDecoder,
  ) {}

  async handleMojoMonitorStart(args: Record<string, unknown>): Promise<unknown> {
    const monitor = this.getMonitor();
    if (!monitor.isAvailable()) {
      return unavailablePayload(
        monitor.getUnavailableReason() ?? 'Mojo IPC monitoring is not available',
        'mojo_monitor_start',
      );
    }

    const deviceId = argString(args, 'deviceId');
    await monitor.start(deviceId);

    return {
      success: true,
      available: true,
      started: monitor.isActive(),
      deviceId: monitor.getDeviceId() ?? null,
    };
  }

  async handleMojoMonitorStop(): Promise<unknown> {
    const monitor = this.getMonitor();
    if (!monitor.isAvailable()) {
      return unavailablePayload(
        monitor.getUnavailableReason() ?? 'Mojo IPC monitoring is not available',
        'mojo_monitor_stop',
      );
    }

    await monitor.stop();

    return {
      success: true,
      available: true,
      started: false,
    };
  }

  async handleMojoDecodeMessage(args: Record<string, unknown>): Promise<unknown> {
    const hexPayload = argString(args, 'hexPayload', '');
    if (hexPayload.length === 0) {
      return {
        success: false,
        error: 'hexPayload is required',
      };
    }

    const decoded = this.getDecoder().decodePayload(hexPayload);
    return {
      success: true,
      decoded,
    };
  }

  async handleMojoListInterfaces(): Promise<unknown> {
    const monitor = this.getMonitor();
    if (!monitor.isAvailable()) {
      return {
        ...unavailablePayload(
          monitor.getUnavailableReason() ?? 'Mojo IPC monitoring is not available',
          'mojo_list_interfaces',
        ),
        interfaces: [],
      };
    }

    const interfaces = await monitor.listInterfaces();
    return {
      success: true,
      available: true,
      active: monitor.isActive(),
      interfaces,
    };
  }

  async handleMojoMessagesGet(args: Record<string, unknown>): Promise<unknown> {
    const monitor = this.getMonitor();
    if (!monitor.isAvailable()) {
      return {
        ...unavailablePayload(
          monitor.getUnavailableReason() ?? 'Mojo IPC monitoring is not available',
          'mojo_messages_get',
        ),
        messages: [],
        totalAvailable: 0,
        filtered: false,
        _simulation: true,
      };
    }

    const limit = argNumber(args, 'limit');
    const interfaceName = argString(args, 'interface');

    const result = await monitor.getMessages({
      limit: limit !== undefined ? Math.min(limit, 10000) : 100,
      interfaceName,
    });

    const response: Record<string, unknown> = {
      success: true,
      available: true,
      active: monitor.isActive(),
      messages: result.messages,
      totalAvailable: result.totalAvailable,
      filtered: result.filtered,
      _simulation: result._simulation,
    };

    if (monitor.isSimulationMode()) {
      response._warning =
        'Mojo IPC is operating in simulation mode. Messages are not captured from real Frida hooks. Install Frida for live IPC monitoring.';
    }

    return response;
  }

  private getMonitor(): MojoMonitor {
    if (!this.monitor) {
      this.monitor = new MojoMonitor();
    }

    return this.monitor;
  }

  private getDecoder(): MojoDecoder {
    if (!this.decoder) {
      this.decoder = new MojoDecoder();
    }

    return this.decoder;
  }
}
