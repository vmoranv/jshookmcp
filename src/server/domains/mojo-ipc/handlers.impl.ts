import { MojoDecoder, MojoMonitor } from '@modules/mojo-ipc';
import {
  capabilityFailure,
  capabilityReport,
  createStub,
} from '@server/domains/shared/capabilities';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
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

const LIVE_CAPTURE_REASON =
  'Current Mojo IPC backend only exposes a seeded interface catalog and simulated capture. Live Chromium Mojo ' +
  'hooks are not implemented in this build.';
const LIVE_CAPTURE_FIX =
  'No user-side fix is available in this build. Treat mojo_monitor/mojo_list_interfaces/mojo_messages_get as ' +
  'simulation-only until real Frida hooks are implemented.';

function getFridaProbeSucceeded(monitor: MojoMonitor): boolean {
  const maybeMonitor = monitor as MojoMonitor & { didFridaProbeSucceed?: () => boolean };
  return typeof maybeMonitor.didFridaProbeSucceed === 'function'
    ? maybeMonitor.didFridaProbeSucceed()
    : false;
}

export class MojoIPCHandlers {
  constructor(
    private monitor?: MojoMonitor,
    private decoder?: MojoDecoder,
    private eventBus?: EventBus<ServerEventMap>,
  ) {}

  async handleMojoMonitorDispatchTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMojoMonitorDispatch(args));
  }

  async handleMojoIpcCapabilitiesTool(): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMojoIpcCapabilities());
  }

  async handleMojoDecodeMessageTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMojoDecodeMessage(args));
  }

  async handleMojoListInterfacesTool(): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMojoListInterfaces());
  }

  async handleMojoMessagesGetTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleMojoMessagesGet(args));
  }

  async handleMojoMonitorDispatch(args: Record<string, unknown>): Promise<unknown> {
    return String(args['action'] ?? '') === 'stop'
      ? this.handleMojoMonitorStop()
      : this.handleMojoMonitorStart(args);
  }

  async handleMojoIpcCapabilities(): Promise<unknown> {
    const monitor = this.getMonitor();
    const fridaProbeSucceeded = getFridaProbeSucceeded(monitor);
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
          fridaProbeSucceeded,
          active: monitor.isActive(),
          simulationMode: monitor.isSimulationMode(),
          interfaceCatalogSource: monitor.getInterfaceCatalogSource(),
          observedInterfaceCount: monitor.getObservedInterfaceCount(),
          liveCaptureImplemented: false,
        },
      },
      {
        capability: 'mojo_live_capture',
        status: 'unavailable',
        reason: LIVE_CAPTURE_REASON,
        fix: LIVE_CAPTURE_FIX,
        details: {
          tools: ['mojo_monitor', 'mojo_list_interfaces', 'mojo_messages_get'],
          fridaAvailable: availability.fridaAvailable,
          fridaCliAvailable: availability.fridaCliAvailable,
          fridaProbeSucceeded,
          active: monitor.isActive(),
          simulationMode: monitor.isSimulationMode(),
          interfaceCatalogSource: monitor.getInterfaceCatalogSource(),
          observedInterfaceCount: monitor.getObservedInterfaceCount(),
          fallbackMode: availability.available ? 'simulation' : 'none',
          liveCaptureImplemented: false,
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

    const isSimulation = monitor.isSimulationMode();

    if (isSimulation) {
      return createStub({
        tool: 'mojo_monitor',
        stubType: 'simulated',
        reason: 'Real Frida-backed message capture is not active',
        fix: 'Install Frida and attach to a Chromium target with Mojo IPC traffic',
        data: {
          available: true,
          started: monitor.isActive(),
          deviceId: monitor.getDeviceId() ?? null,
          simulation: true, // Keep for backward compatibility
          interfaceCatalogSource: monitor.getInterfaceCatalogSource(),
          observedInterfaceCount: monitor.getObservedInterfaceCount(),
        },
        warning:
          'Mojo IPC monitor is running in simulation mode. Real Frida-backed message capture is not active.',
      });
    }

    return {
      success: true,
      available: true,
      started: monitor.isActive(),
      deviceId: monitor.getDeviceId() ?? null,
      simulation: false,
      interfaceCatalogSource: monitor.getInterfaceCatalogSource(),
      observedInterfaceCount: monitor.getObservedInterfaceCount(),
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
      simulation: monitor.isSimulationMode(),
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

    const isSimulation = monitor.isSimulationMode();
    const catalogSource = monitor.getInterfaceCatalogSource();
    const interfaces = await monitor.listInterfaces();

    // Use stub format when in simulation or using seeded defaults
    if (isSimulation || catalogSource === 'seeded-defaults') {
      const reason =
        catalogSource === 'seeded-defaults'
          ? 'Interface list currently comes from the seeded default catalog; no live observed Mojo interfaces have been captured yet.'
          : 'Mojo IPC monitor is running in simulation mode. Interface counts may not reflect live traffic.';

      return createStub({
        tool: 'mojo_list_interfaces',
        stubType: 'simulated',
        reason,
        fix: 'Install Frida and attach to a Chromium target to capture live Mojo interfaces',
        data: {
          available: true,
          active: monitor.isActive(),
          interfaces,
          simulation: isSimulation, // Keep for backward compatibility
          interfaceCatalogSource: catalogSource,
          observedInterfaceCount: monitor.getObservedInterfaceCount(),
        },
        warning: reason,
      });
    }

    return {
      success: true,
      available: true,
      active: monitor.isActive(),
      interfaces,
      simulation: false,
      interfaceCatalogSource: catalogSource,
      observedInterfaceCount: monitor.getObservedInterfaceCount(),
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
        simulation: true,
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
      simulation: boolean;
    };

    if (result.messages && Array.isArray(result.messages) && result.messages.length > 0) {
      void this.eventBus?.emit('mojo:message_captured', {
        messageCount: result.messages.length,
        timestamp: new Date().toISOString(),
      });
    }

    const isSimulation = result.simulation || monitor.isSimulationMode();

    if (isSimulation) {
      return createStub({
        tool: 'mojo_messages_get',
        stubType: 'simulated',
        reason:
          'Mojo IPC is operating in simulation mode. Messages are not captured from real Frida hooks.',
        fix: 'Install Frida for live IPC monitoring',
        data: {
          available: true,
          active: monitor.isActive(),
          messages: result.messages,
          totalAvailable: result.totalAvailable,
          filtered: result.filtered,
          simulation: true, // Keep for backward compatibility
          interfaceCatalogSource: monitor.getInterfaceCatalogSource(),
          observedInterfaceCount: monitor.getObservedInterfaceCount(),
        },
        warning:
          'Mojo IPC is operating in simulation mode. Messages are not captured from real Frida hooks. Install Frida for live IPC monitoring.',
      });
    }

    return {
      success: true,
      available: true,
      active: monitor.isActive(),
      messages: result.messages,
      totalAvailable: result.totalAvailable,
      filtered: result.filtered,
      simulation: false,
      interfaceCatalogSource: monitor.getInterfaceCatalogSource(),
      observedInterfaceCount: monitor.getObservedInterfaceCount(),
    };
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
