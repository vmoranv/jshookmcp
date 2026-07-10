import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MojoIPCHandlers } from '@server/domains/mojo-ipc/handlers.impl';

describe('MojoIPCHandlers', () => {
  let monitor: {
    isAvailable: ReturnType<typeof vi.fn>;
    getUnavailableReason: ReturnType<typeof vi.fn>;
    probeAvailability: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    isActive: ReturnType<typeof vi.fn>;
    getDeviceId: ReturnType<typeof vi.fn>;
    listInterfaces: ReturnType<typeof vi.fn>;
    getMessages: ReturnType<typeof vi.fn>;
    isSimulationMode: ReturnType<typeof vi.fn>;
    didFridaProbeSucceed: ReturnType<typeof vi.fn>;
    isLiveCapture: ReturnType<typeof vi.fn>;
    getInterfaceCatalogSource: ReturnType<typeof vi.fn>;
    getObservedInterfaceCount: ReturnType<typeof vi.fn>;
  };
  let decoder: {
    decodePayload: ReturnType<typeof vi.fn>;
    encodeMessage: ReturnType<typeof vi.fn>;
  };
  let handlers: MojoIPCHandlers;

  beforeEach(() => {
    monitor = {
      isAvailable: vi.fn().mockReturnValue(true),
      getUnavailableReason: vi.fn().mockReturnValue(undefined),
      probeAvailability: vi.fn().mockResolvedValue({
        available: true,
        fridaAvailable: true,
        fridaCliAvailable: true,
        reason: undefined,
      }),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      isActive: vi.fn().mockReturnValue(true),
      getDeviceId: vi.fn().mockReturnValue(null),
      listInterfaces: vi
        .fn()
        .mockResolvedValue([
          { name: 'network.mojom.NetworkService', version: 1, pendingMessages: 0 },
        ]),
      getMessages: vi.fn().mockResolvedValue({
        messages: [],
        totalAvailable: 0,
        filtered: false,
        simulation: false,
      }),
      isSimulationMode: vi.fn().mockReturnValue(false),
      didFridaProbeSucceed: vi.fn().mockReturnValue(false),
      isLiveCapture: vi.fn().mockReturnValue(false),
      getInterfaceCatalogSource: vi.fn().mockReturnValue('seeded-defaults'),
      getObservedInterfaceCount: vi.fn().mockReturnValue(0),
    };
    decoder = {
      decodePayload: vi
        .fn()
        .mockReturnValue({ header: { version: 1 }, fields: {}, handles: 0, raw: '0001' }),
      encodeMessage: vi.fn().mockReturnValue('0100010100000101'),
    };
    handlers = new MojoIPCHandlers(monitor as any, decoder as any);
  });

  it('starts monitoring with the current API', async () => {
    const result = await handlers.handleMojoMonitorStart({ deviceId: 'chrome' });
    expect(monitor.start).toHaveBeenCalledWith('chrome');
    expect(result).toMatchObject({
      success: true,
      available: true,
      started: true,
      simulation: false,
      interfaceCatalogSource: 'seeded-defaults',
      observedInterfaceCount: 0,
    });
  });

  it('reports mojo capability state', async () => {
    const result = await handlers.handleMojoIpcCapabilities();
    expect(result).toMatchObject({ success: true, tool: 'mojo_ipc_capabilities' });
    expect(result).toHaveProperty('capabilities');
    expect(result).toMatchObject({
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          capability: 'mojo_live_capture',
          available: false,
        }),
      ]),
    });
  });

  it('stops monitoring with the current API', async () => {
    const result = await handlers.handleMojoMonitorStop();
    expect(monitor.stop).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, started: false });
  });

  it('decodes mojo payloads with the current API', async () => {
    const result = await handlers.handleMojoDecodeMessage({ hexPayload: '0001' });
    expect(decoder.decodePayload).toHaveBeenCalledWith('0001');
    expect(result).toMatchObject({ success: true });
  });

  it('passes optional decode context for interface field labels', async () => {
    const result = await handlers.handleMojoDecodeMessage({
      hexPayload: '0001',
      interfaceName: 'network.mojom.URLLoaderFactory',
      messageType: 'CreateLoaderAndStart',
    });

    expect(decoder.decodePayload).toHaveBeenCalledWith('0001', {
      interfaceName: 'network.mojom.URLLoaderFactory',
      messageType: 'CreateLoaderAndStart',
    });
    expect(result).toMatchObject({ success: true });
  });

  it('encodes mojo payloads with the current API', async () => {
    const fields = [{ type: 'bool', value: true }];
    const result = await handlers.handleMojoEncodeMessage({
      interfaceName: 'network.mojom.NetworkService',
      messageType: 1,
      fields,
    });
    expect(decoder.encodeMessage).toHaveBeenCalledWith('network.mojom.NetworkService', 1, fields);
    expect(result).toEqual({ success: true, hexPayload: '0100010100000101' });
  });

  it('lists interfaces with the current API', async () => {
    const result = await handlers.handleMojoListInterfaces();
    expect(monitor.listInterfaces).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      success: true,
      available: true,
      simulation: false,
      interfaceCatalogSource: 'seeded-defaults',
      observedInterfaceCount: 0,
    });
    // Check stub format when using seeded-defaults
    expect(result).toHaveProperty('_stub', 'simulated');
    expect(result).toHaveProperty('stubType', 'simulated');
    expect(result).toHaveProperty('reason');
  });

  it('gets buffered messages with the current API', async () => {
    const result = await handlers.handleMojoMessagesGet({
      interface: 'network.mojom.NetworkService',
      limit: 10,
    });
    expect(monitor.getMessages).toHaveBeenCalledWith({
      limit: 10,
      interfaceName: 'network.mojom.NetworkService',
      messageType: undefined,
      sinceTimestamp: undefined,
      hexSearch: undefined,
    });
    expect(result).toMatchObject({
      success: true,
      available: true,
      interfaceCatalogSource: 'seeded-defaults',
      observedInterfaceCount: 0,
    });
  });

  it('returns unavailable payloads when the monitor is disabled', async () => {
    monitor.isAvailable.mockReturnValueOnce(false);
    monitor.getUnavailableReason.mockReturnValueOnce('not available');
    const result = await handlers.handleMojoMonitorStart({});
    expect(monitor.start).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      success: false,
      available: false,
      capability: 'mojo_ipc_monitoring',
    });
  });
});
