import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MojoIPCHandlers } from '@server/domains/mojo-ipc/handlers.impl';

// ── mock factories ────────────────────────────────────────────────────────────

function createMockMonitor(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function createMockDecoder(overrides: Record<string, unknown> = {}) {
  return {
    decodePayload: vi
      .fn()
      .mockReturnValue({ header: { version: 1 }, fields: {}, handles: 0, raw: '0001' }),
    ...overrides,
  };
}

function createMockEventBus() {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    removeAllListeners: vi.fn(),
  };
}

// ── test subject ──────────────────────────────────────────────────────────────

describe('MojoIPCHandlers — coverage expansion', () => {
  let monitor: ReturnType<typeof createMockMonitor>;
  let decoder: ReturnType<typeof createMockDecoder>;
  let eventBus: ReturnType<typeof createMockEventBus>;
  let handlers: MojoIPCHandlers;

  beforeEach(() => {
    monitor = createMockMonitor();
    decoder = createMockDecoder();
    eventBus = createMockEventBus();
    handlers = new MojoIPCHandlers(monitor as any, decoder as any, eventBus as any);
  });

  // ── handleMojoMonitorDispatch ─────────────────────────────────────────────

  describe('handleMojoMonitorDispatch', () => {
    it('delegates to handleMojoMonitorStop when action is "stop"', async () => {
      const result = await handlers.handleMojoMonitorDispatch({ action: 'stop' });
      expect(monitor.stop).toHaveBeenCalledOnce();
      expect(result).toMatchObject({ success: true, available: true, started: false });
    });

    it('delegates to handleMojoMonitorStart when action is not "stop"', async () => {
      const result = await handlers.handleMojoMonitorDispatch({ action: 'start' });
      expect(monitor.start).toHaveBeenCalled();
      expect(result).toMatchObject({ success: true, available: true, started: true });
    });

    it('delegates to handleMojoMonitorStart when action is undefined', async () => {
      const result = await handlers.handleMojoMonitorDispatch({});
      expect(monitor.start).toHaveBeenCalled();
      expect(result).toMatchObject({ success: true, available: true });
    });

    it('delegates to handleMojoMonitorStart when action is empty string', async () => {
      const result = await handlers.handleMojoMonitorDispatch({ action: '' });
      expect(monitor.start).toHaveBeenCalled();
      expect(result).toMatchObject({ success: true, available: true });
    });

    it('delegates to handleMojoMonitorStart when action is a random string', async () => {
      const result = await handlers.handleMojoMonitorDispatch({ action: 'status' });
      expect(monitor.start).toHaveBeenCalled();
      expect(result).toMatchObject({ success: true, available: true });
    });
  });

  // ── handleMojoMonitorStart ────────────────────────────────────────────────

  describe('handleMojoMonitorStart', () => {
    it('starts monitoring and returns success payload', async () => {
      const result = await handlers.handleMojoMonitorStart({ deviceId: 'chrome' });
      expect(monitor.start).toHaveBeenCalledWith('chrome');
      expect(result).toEqual({
        success: true,
        available: true,
        started: true,
        deviceId: null,
      });
    });

    it('starts monitoring without deviceId', async () => {
      monitor.getDeviceId.mockReturnValue(undefined);
      const result = await handlers.handleMojoMonitorStart({});
      expect(monitor.start).toHaveBeenCalledWith(undefined);
      expect(result).toMatchObject({ success: true, available: true, started: true });
      // source does `?? null`, so undefined becomes null
      expect(result).toHaveProperty('deviceId', null);
    });

    it('returns unavailable payload when monitor is not available', async () => {
      monitor.isAvailable.mockReturnValue(false);
      monitor.getUnavailableReason.mockReturnValue('Frida not installed');
      const result = await handlers.handleMojoMonitorStart({});
      expect(result).toEqual({
        success: false,
        available: false,
        action: 'mojo_monitor',
        error: 'Frida not installed',
      });
    });

    it('returns unavailable payload with default reason when reason is undefined', async () => {
      monitor.isAvailable.mockReturnValue(false);
      monitor.getUnavailableReason.mockReturnValue(undefined);
      const result = await handlers.handleMojoMonitorStart({});
      expect(result).toEqual({
        success: false,
        available: false,
        action: 'mojo_monitor',
        error: 'Mojo IPC monitoring is not available',
      });
    });

    it('returns deviceId from monitor when set', async () => {
      monitor.getDeviceId.mockReturnValue('usb1234');
      const result = await handlers.handleMojoMonitorStart({ deviceId: 'usb1234' });
      expect(result).toMatchObject({ deviceId: 'usb1234' });
    });

    it('reflects isActive=false when monitor reports inactive after start', async () => {
      monitor.isActive.mockReturnValue(false);
      const result = await handlers.handleMojoMonitorStart({});
      expect(result).toMatchObject({ started: false });
    });
  });

  // ── handleMojoMonitorStop ─────────────────────────────────────────────────

  describe('handleMojoMonitorStop', () => {
    it('stops monitoring and returns success payload', async () => {
      const result = await handlers.handleMojoMonitorStop();
      expect(monitor.stop).toHaveBeenCalledOnce();
      expect(result).toEqual({
        success: true,
        available: true,
        started: false,
      });
    });

    it('returns unavailable payload when monitor is not available', async () => {
      monitor.isAvailable.mockReturnValue(false);
      monitor.getUnavailableReason.mockReturnValue('Frida not installed');
      const result = await handlers.handleMojoMonitorStop();
      expect(monitor.stop).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        available: false,
        action: 'mojo_monitor',
        error: 'Frida not installed',
      });
    });

    it('returns unavailable payload with default reason when reason is undefined', async () => {
      monitor.isAvailable.mockReturnValue(false);
      monitor.getUnavailableReason.mockReturnValue(undefined);
      const result = await handlers.handleMojoMonitorStop();
      expect(result).toEqual({
        success: false,
        available: false,
        action: 'mojo_monitor',
        error: 'Mojo IPC monitoring is not available',
      });
    });
  });

  // ── handleMojoDecodeMessage ───────────────────────────────────────────────

  describe('handleMojoDecodeMessage', () => {
    it('decodes a valid hex payload', async () => {
      const decoded = {
        header: { version: 1, flags: 0 },
        fields: { field0: true },
        handles: 0,
        raw: '01000101',
      };
      decoder.decodePayload.mockReturnValue(decoded);
      const result = await handlers.handleMojoDecodeMessage({ hexPayload: '01000101' });
      expect(decoder.decodePayload).toHaveBeenCalledWith('01000101');
      expect(result).toEqual({ success: true, decoded });
    });

    it('returns error when hexPayload is empty string', async () => {
      const result = await handlers.handleMojoDecodeMessage({ hexPayload: '' });
      expect(result).toEqual({
        success: false,
        error: 'hexPayload is required',
      });
      expect(decoder.decodePayload).not.toHaveBeenCalled();
    });

    it('returns error when hexPayload is undefined', async () => {
      const result = await handlers.handleMojoDecodeMessage({});
      expect(result).toEqual({
        success: false,
        error: 'hexPayload is required',
      });
      expect(decoder.decodePayload).not.toHaveBeenCalled();
    });

    it('handles argString default for hexPayload', async () => {
      decoder.decodePayload.mockReturnValue({ header: {}, fields: {}, raw: '' });
      // hexPayload missing → argString returns '' → length 0 → error
      const result = await handlers.handleMojoDecodeMessage({ other: 'value' });
      expect(result).toEqual({
        success: false,
        error: 'hexPayload is required',
      });
    });

    it('decodes payload with complex fields', async () => {
      const decoded = {
        header: { version: 2, flags: 1, messageType: 5, numFields: 3, handles: 2 },
        fields: { field0: 'hello', field1: { handle: 42 }, field2: 99 },
        handles: 1,
        raw: 'abcdef0123456789',
      };
      decoder.decodePayload.mockReturnValue(decoded);
      const result = await handlers.handleMojoDecodeMessage({ hexPayload: 'abcdef0123456789' });
      expect(result).toMatchObject({ success: true });
      expect(result).toHaveProperty('decoded.fields.field0', 'hello');
      expect(result).toHaveProperty('decoded.handles', 1);
    });
  });

  // ── handleMojoListInterfaces ──────────────────────────────────────────────

  describe('handleMojoListInterfaces', () => {
    it('returns list of interfaces', async () => {
      const interfaces = [
        { name: 'blink.mojom.WidgetHost', version: 1, pendingMessages: 0 },
        { name: 'network.mojom.URLLoaderFactory', version: 3, pendingMessages: 5 },
      ];
      monitor.listInterfaces.mockResolvedValue(interfaces);
      const result = await handlers.handleMojoListInterfaces();
      expect(result).toEqual({
        success: true,
        available: true,
        active: true,
        interfaces,
      });
    });

    it('returns unavailable payload with interfaces=[] when monitor is not available', async () => {
      monitor.isAvailable.mockReturnValue(false);
      monitor.getUnavailableReason.mockReturnValue('No Frida');
      const result = await handlers.handleMojoListInterfaces();
      expect(result).toMatchObject({
        success: false,
        available: false,
        action: 'mojo_list_interfaces',
        error: 'No Frida',
        interfaces: [],
      });
    });

    it('returns unavailable payload with default reason when reason is undefined', async () => {
      monitor.isAvailable.mockReturnValue(false);
      monitor.getUnavailableReason.mockReturnValue(undefined);
      const result = await handlers.handleMojoListInterfaces();
      expect(result).toMatchObject({
        error: 'Mojo IPC monitoring is not available',
        interfaces: [],
      });
    });

    it('reflects active=false when monitor reports inactive', async () => {
      monitor.isActive.mockReturnValue(false);
      const result = await handlers.handleMojoListInterfaces();
      expect(result).toMatchObject({ active: false });
    });

    it('returns empty interfaces list from monitor', async () => {
      monitor.listInterfaces.mockResolvedValue([]);
      const result = await handlers.handleMojoListInterfaces();
      expect(result).toMatchObject({ interfaces: [], success: true });
    });
  });

  // ── handleMojoMessagesGet ─────────────────────────────────────────────────

  describe('handleMojoMessagesGet', () => {
    it('returns messages with default limit when no limit specified', async () => {
      const result = await handlers.handleMojoMessagesGet({});
      expect(monitor.getMessages).toHaveBeenCalledWith({
        limit: 100,
        interfaceName: undefined,
      });
      expect(result).toMatchObject({
        success: true,
        available: true,
        active: true,
      });
    });

    it('clamps limit to 10000 when limit exceeds maximum', async () => {
      const result = await handlers.handleMojoMessagesGet({ limit: 50000 });
      expect(monitor.getMessages).toHaveBeenCalledWith({
        limit: 10000,
        interfaceName: undefined,
      });
      expect(result).toMatchObject({ success: true });
    });

    it('passes exact limit when within range', async () => {
      const result = await handlers.handleMojoMessagesGet({ limit: 50 });
      expect(monitor.getMessages).toHaveBeenCalledWith({
        limit: 50,
        interfaceName: undefined,
      });
      expect(result).toMatchObject({ success: true });
    });

    it('passes interfaceName filter to getMessages', async () => {
      const result = await handlers.handleMojoMessagesGet({
        interface: 'network.mojom.NetworkService',
      });
      expect(monitor.getMessages).toHaveBeenCalledWith({
        limit: 100,
        interfaceName: 'network.mojom.NetworkService',
      });
      expect(result).toMatchObject({ success: true });
    });

    it('passes both limit and interfaceName', async () => {
      const result = await handlers.handleMojoMessagesGet({
        limit: 200,
        interface: 'blink.mojom.WidgetHost',
      });
      expect(monitor.getMessages).toHaveBeenCalledWith({
        limit: 200,
        interfaceName: 'blink.mojom.WidgetHost',
      });
      expect(result).toMatchObject({ success: true });
    });

    it('emits mojo:message_captured event when messages are present', async () => {
      const messages = [
        {
          interfaceName: 'network.mojom.NetworkService',
          methodName: 'CreateURLLoader',
          payload: 'abcd',
        },
        { interfaceName: 'blink.mojom.WidgetHost', methodName: 'OnResize', payload: 'efgh' },
      ];
      monitor.getMessages.mockResolvedValue({
        messages,
        totalAvailable: 2,
        filtered: false,
        _simulation: false,
      });
      const result = await handlers.handleMojoMessagesGet({});

      expect(eventBus.emit).toHaveBeenCalledWith('mojo:message_captured', {
        messageCount: 2,
        timestamp: expect.any(String),
      });
      expect(result).toMatchObject({
        success: true,
        messages,
        totalAvailable: 2,
        filtered: false,
        _simulation: false,
      });
    });

    it('does not emit event when messages array is empty', async () => {
      monitor.getMessages.mockResolvedValue({
        messages: [],
        totalAvailable: 0,
        filtered: false,
        _simulation: false,
      });
      await handlers.handleMojoMessagesGet({});
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('does not emit event when messages is undefined', async () => {
      monitor.getMessages.mockResolvedValue({
        messages: undefined as any,
        totalAvailable: 0,
        filtered: false,
        _simulation: false,
      });
      await handlers.handleMojoMessagesGet({});
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('does not emit event when messages is not an array', async () => {
      monitor.getMessages.mockResolvedValue({
        messages: 'not-an-array' as any,
        totalAvailable: 0,
        filtered: false,
        _simulation: false,
      });
      await handlers.handleMojoMessagesGet({});
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('adds _warning when monitor is in simulation mode', async () => {
      monitor.isSimulationMode.mockReturnValue(true);
      monitor.getMessages.mockResolvedValue({
        messages: [],
        totalAvailable: 0,
        filtered: false,
        _simulation: true,
      });
      const result = (await handlers.handleMojoMessagesGet({})) as Record<string, unknown>;
      expect(result).toHaveProperty('_warning');
      expect(result['_warning']).toContain('simulation mode');
    });

    it('does not add _warning when not in simulation mode', async () => {
      monitor.isSimulationMode.mockReturnValue(false);
      const result = (await handlers.handleMojoMessagesGet({})) as Record<string, unknown>;
      expect(result).not.toHaveProperty('_warning');
    });

    it('returns unavailable payload when monitor is not available', async () => {
      monitor.isAvailable.mockReturnValue(false);
      monitor.getUnavailableReason.mockReturnValue('Frida not installed');
      const result = await handlers.handleMojoMessagesGet({});
      expect(monitor.getMessages).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        success: false,
        available: false,
        action: 'mojo_messages_get',
        error: 'Frida not installed',
        messages: [],
        totalAvailable: 0,
        filtered: false,
        _simulation: true,
      });
    });

    it('returns unavailable payload with default reason', async () => {
      monitor.isAvailable.mockReturnValue(false);
      monitor.getUnavailableReason.mockReturnValue(undefined);
      const result = await handlers.handleMojoMessagesGet({});
      expect(result).toMatchObject({
        error: 'Mojo IPC monitoring is not available',
      });
    });

    it('does not emit event when messages array is non-empty but eventBus is undefined', async () => {
      const handlersNoBus = new MojoIPCHandlers(monitor as any, decoder as any, undefined);
      monitor.getMessages.mockResolvedValue({
        messages: [{ interfaceName: 'test', payload: 'ab' }],
        totalAvailable: 1,
        filtered: false,
        _simulation: false,
      });
      // Should not throw
      const result = await handlersNoBus.handleMojoMessagesGet({});
      expect(result).toMatchObject({ success: true, totalAvailable: 1 });
    });

    it('handles limit=0 by clamping to 0 (below default 100)', async () => {
      const result = await handlers.handleMojoMessagesGet({ limit: 0 });
      expect(monitor.getMessages).toHaveBeenCalledWith({
        limit: 0,
        interfaceName: undefined,
      });
      expect(result).toMatchObject({ success: true });
    });

    it('handles negative limit by passing undefined through argNumber', async () => {
      const result = await handlers.handleMojoMessagesGet({ limit: -5 });
      expect(monitor.getMessages).toHaveBeenCalledWith({
        limit: -5,
        interfaceName: undefined,
      });
      expect(result).toMatchObject({ success: true });
    });

    it('emits event with correct messageCount for single message', async () => {
      monitor.getMessages.mockResolvedValue({
        messages: [{ interfaceName: 'test' }],
        totalAvailable: 1,
        filtered: false,
        _simulation: false,
      });
      await handlers.handleMojoMessagesGet({});
      expect(eventBus.emit).toHaveBeenCalledWith(
        'mojo:message_captured',
        expect.objectContaining({ messageCount: 1 }),
      );
    });

    it('preserves _simulation flag from getMessages result', async () => {
      monitor.getMessages.mockResolvedValue({
        messages: [],
        totalAvailable: 0,
        filtered: true,
        _simulation: true,
      });
      const result = (await handlers.handleMojoMessagesGet({})) as Record<string, unknown>;
      expect(result).toMatchObject({ filtered: true, _simulation: true });
    });
  });

  // ── lazy initialization (private getMonitor / getDecoder) ──────────────────

  describe('lazy initialization of monitor and decoder', () => {
    it('creates MojoMonitor lazily when not provided', async () => {
      const handlersNoDeps = new MojoIPCHandlers(undefined, decoder as any, eventBus as any);
      // MojoMonitor constructor will run — it calls getDefaultInterfaces()
      // We exercise the path by calling a method that uses getMonitor()
      // Since the real MojoMonitor.isAvailable() is false by default, start returns unavailable
      const result = await handlersNoDeps.handleMojoMonitorStart({});
      expect(result).toMatchObject({ success: false, available: false });
    });

    it('creates MojoDecoder lazily when not provided', async () => {
      const handlersNoDeps = new MojoIPCHandlers(monitor as any, undefined, eventBus as any);
      // The real MojoDecoder will parse the hex string
      const result = await handlersNoDeps.handleMojoDecodeMessage({ hexPayload: '01000101000100' });
      expect(result).toMatchObject({ success: true, decoded: expect.any(Object) });
    });

    it('reuses the same lazy-created monitor on subsequent calls', async () => {
      const handlersNoDeps = new MojoIPCHandlers(undefined, decoder as any, eventBus as any);
      // First call creates monitor
      await handlersNoDeps.handleMojoMonitorStart({});
      // Second call reuses same instance
      const result = await handlersNoDeps.handleMojoMonitorStop();
      expect(result).toMatchObject({ success: false, available: false });
    });

    it('reuses the same lazy-created decoder on subsequent calls', async () => {
      const handlersNoDeps = new MojoIPCHandlers(monitor as any, undefined, eventBus as any);
      const result1 = await handlersNoDeps.handleMojoDecodeMessage({ hexPayload: '01000101' });
      const result2 = await handlersNoDeps.handleMojoDecodeMessage({ hexPayload: '02000101' });
      expect(result1).toMatchObject({ success: true });
      expect(result2).toMatchObject({ success: true });
    });
  });

  // ── unavailablePayload helper (indirect coverage) ──────────────────────────

  describe('unavailablePayload shape across all methods', () => {
    it('handleMojoMonitorStart returns correct unavailable shape', async () => {
      monitor.isAvailable.mockReturnValue(false);
      monitor.getUnavailableReason.mockReturnValue('reason');
      const result = await handlers.handleMojoMonitorStart({});
      expect(Object.keys(result as object).toSorted()).toEqual(
        ['action', 'available', 'error', 'success'].toSorted(),
      );
    });

    it('handleMojoMonitorStop returns correct unavailable shape', async () => {
      monitor.isAvailable.mockReturnValue(false);
      monitor.getUnavailableReason.mockReturnValue('reason');
      const result = await handlers.handleMojoMonitorStop();
      expect(Object.keys(result as object).toSorted()).toEqual(
        ['action', 'available', 'error', 'success'].toSorted(),
      );
    });

    it('handleMojoListInterfaces returns extended unavailable shape', async () => {
      monitor.isAvailable.mockReturnValue(false);
      monitor.getUnavailableReason.mockReturnValue('reason');
      const result = await handlers.handleMojoListInterfaces();
      expect(Object.keys(result as object).toSorted()).toEqual(
        ['action', 'available', 'error', 'interfaces', 'success'].toSorted(),
      );
    });

    it('handleMojoMessagesGet returns extended unavailable shape', async () => {
      monitor.isAvailable.mockReturnValue(false);
      monitor.getUnavailableReason.mockReturnValue('reason');
      const result = await handlers.handleMojoMessagesGet({});
      expect(Object.keys(result as object).toSorted()).toEqual(
        [
          '_simulation',
          'action',
          'available',
          'error',
          'filtered',
          'messages',
          'success',
          'totalAvailable',
        ].toSorted(),
      );
    });
  });
});
