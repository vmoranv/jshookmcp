import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MojoIPCHandlers } from '@server/domains/mojo-ipc/handlers.impl';

describe('MojoIPCHandlers', () => {
  let monitor: {
    isAvailable: ReturnType<typeof vi.fn>;
    getUnavailableReason: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    isActive: ReturnType<typeof vi.fn>;
    getDeviceId: ReturnType<typeof vi.fn>;
    listInterfaces: ReturnType<typeof vi.fn>;
    getMessages: ReturnType<typeof vi.fn>;
    isSimulationMode: ReturnType<typeof vi.fn>;
  };
  let decoder: {
    decodePayload: ReturnType<typeof vi.fn>;
  };
  let handlers: MojoIPCHandlers;

  beforeEach(() => {
    monitor = {
      isAvailable: vi.fn().mockReturnValue(true),
      getUnavailableReason: vi.fn().mockReturnValue(undefined),
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
        _simulation: false,
      }),
      isSimulationMode: vi.fn().mockReturnValue(false),
    };
    decoder = {
      decodePayload: vi
        .fn()
        .mockReturnValue({ header: { version: 1 }, fields: {}, handles: 0, raw: '0001' }),
    };
    handlers = new MojoIPCHandlers(monitor as any, decoder as any);
  });

  it('starts monitoring with the current API', async () => {
    const result = await handlers.handleMojoMonitorStart({ deviceId: 'chrome' });
    expect(monitor.start).toHaveBeenCalledWith('chrome');
    expect(result).toMatchObject({ success: true, available: true, started: true });
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

  it('lists interfaces with the current API', async () => {
    const result = await handlers.handleMojoListInterfaces();
    expect(monitor.listInterfaces).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, available: true });
  });

  it('gets buffered messages with the current API', async () => {
    const result = await handlers.handleMojoMessagesGet({
      interface: 'network.mojom.NetworkService',
      limit: 10,
    });
    expect(monitor.getMessages).toHaveBeenCalledWith({
      limit: 10,
      interfaceName: 'network.mojom.NetworkService',
    });
    expect(result).toMatchObject({ success: true, available: true });
  });

  it('returns unavailable payloads when the monitor is disabled', async () => {
    monitor.isAvailable.mockReturnValueOnce(false);
    monitor.getUnavailableReason.mockReturnValueOnce('not available');
    const result = await handlers.handleMojoMonitorStart({});
    expect(result).toMatchObject({ success: false, available: false });
  });
});
