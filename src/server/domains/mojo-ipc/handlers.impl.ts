import { MojoDecoder, MojoMonitor } from '@modules/mojo-ipc';
import { capabilityFailure, capabilityReport } from '@server/domains/shared/capabilities';
import { argNumber, argString } from '@server/domains/shared/parse-args';
import type { EventBus, ServerEventMap } from '@server/EventBus';

function getMojoFix(reason: string): string {
  return reason.includes('JSHOOK_ENABLE_MOJO_IPC')
    ? 'Unset JSHOOK_ENABLE_MOJO_IPC or set it to 1, then retry.'
    : 'Install Frida and ensure the Chromium target is running.';
}

function unavailablePayload(reason: string, tool: string): Record<string, unknown> {
  return {
    ...capabilityFailure(tool, 'mojo_ipc_monitoring', reason, getMojoFix(reason)),
    error: reason,
  };
}

export class MojoIPCHandlers {
  constructor(
    private monitor?: MojoMonitor,
    private decoder?: MojoDecoder,
    private eventBus?: EventBus<ServerEventMap>,
  ) {}

  async handleMojoMonitorDispatch(args: Record<string, unknown>): Promise<unknown> {
    return String(args['action'] ?? '') === 'stop'
      ? this.handleMojoMonitorStop()
      : this.handleMojoMonitorStart(args);
  }

  async handleMojoIpcCapabilities(): Promise<unknown> {
    const monitor = this.getMonitor();
    const availability =
      typeof monitor.probeAvailability === 'function'
        ? await monitor.probeAvailability()
        : {
            available: monitor.isAvailable(),
            reason: monitor.getUnavailableReason(),
            fridaAvailable: monitor.isAvailable(),
            fridaCliAvailable: false,
          };

    return capabilityReport('mojo_ipc_capabilities', [
      {
        capability: 'mojo_ipc_monitoring',
        status: availability.available ? 'available' : 'unavailable',
        reason: availability.reason,
        fix: availability.available ? undefined : getMojoFix(availability.reason ?? ''),
        details: {
          tools: ['mojo_monitor', 'mojo_list_interfaces', 'mojo_messages_get'],
          fridaAvailable: availability.fridaAvailable,
          fridaCliAvailable: availability.fridaCliAvailable,
          active: monitor.isActive(),
          simulationMode: monitor.isSimulationMode(),
        },
      },
      {
        capability: 'mojo_payload_decode',
        status: 'available',
        details: {
          tools: ['mojo_decode_message'],
        },
      },
    ]);
  }

  async handleMojoMonitorStart(args: Record<string, unknown>): Promise<unknown> {
    const monitor = this.getMonitor();
    const deviceId = argString(args, 'deviceId');
    await monitor.start(deviceId);

    if (!monitor.isAvailable()) {
      return unavailablePayload(
        monitor.getUnavailableReason() ?? 'Mojo IPC monitoring is not available',
        'mojo_monitor',
      );
    }

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
        'mojo_monitor',
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

    const result = (await monitor.getMessages({
      limit: limit !== undefined ? Math.min(limit, 10000) : 100,
      interfaceName,
    })) as {
      messages: unknown[];
      totalAvailable: number;
      filtered: boolean;
      _simulation: boolean;
    };

    const response: Record<string, unknown> = {
      success: true,
      available: true,
      active: monitor.isActive(),
      messages: result.messages,
      totalAvailable: result.totalAvailable,
      filtered: result.filtered,
      _simulation: result._simulation,
    };

    if (result.messages && Array.isArray(result.messages) && result.messages.length > 0) {
      void this.eventBus?.emit('mojo:message_captured', {
        messageCount: result.messages.length,
        timestamp: new Date().toISOString(),
      });
    }

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
