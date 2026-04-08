export interface MojoMessage {
  timestamp: number;
  sourcePid: number;
  targetPid: number;
  interfaceName: string;
  messageType: string;
  payload: string;
  size: number;
}

export interface MojoMessageFilter {
  interfaceName?: string;
  messageType?: string;
  pid?: number;
}

interface MojoInterfaceState {
  name: string;
  version: number;
  pendingMessages: number;
}

interface AvailabilityState {
  available: boolean;
  reason?: string;
  fridaAvailable: boolean;
}

function getDefaultInterfaces(): MojoInterfaceState[] {
  return [
    { name: 'blink.mojom.WidgetHost', version: 1, pendingMessages: 0 },
    { name: 'content.mojom.FrameHost', version: 2, pendingMessages: 0 },
    { name: 'network.mojom.URLLoaderFactory', version: 3, pendingMessages: 0 },
  ];
}

function detectFridaAvailability(): boolean {
  try {
    // Check if frida is installed
    require.resolve('frida');
    return true;
  } catch {
    return false;
  }
}

function detectAvailability(): AvailabilityState {
  const flag = process.env['JSHOOK_ENABLE_MOJO_IPC'];
  const fridaAvailable = detectFridaAvailability();

  if (flag === '1' || flag === 'true') {
    if (!fridaAvailable) {
      return {
        available: true,
        fridaAvailable: false,
        reason:
          'Mojo IPC enabled but Frida is not installed. Messages will be in simulation mode (no real capture). Install Frida for real IPC monitoring: `npm install frida`.',
      };
    }
    return { available: true, fridaAvailable: true };
  }

  return {
    available: false,
    fridaAvailable,
    reason:
      'Mojo IPC backend is not connected. Set JSHOOK_ENABLE_MOJO_IPC=1 when a capture transport is available.',
  };
}

export class MojoMonitor {
  private active = false;
  private simulationMode = false;
  private deviceId?: string;
  private readonly messages: MojoMessage[] = [];
  private readonly interfaces = new Map<string, MojoInterfaceState>();
  private readonly availability = detectAvailability();

  constructor() {
    for (const item of getDefaultInterfaces()) {
      this.interfaces.set(item.name, { ...item });
    }
  }

  isAvailable(): boolean {
    return this.availability.available;
  }

  getUnavailableReason(): string | undefined {
    return this.availability.reason;
  }

  /**
   * Returns true if monitoring is operating in simulation mode (no real Frida capture).
   */
  isSimulationMode(): boolean {
    return this.simulationMode;
  }

  /**
   * Explicitly enable or disable simulation mode.
   * When simulation mode is on, all output includes `_simulation: true` markers.
   */
  setSimulationMode(enabled: boolean): void {
    this.simulationMode = enabled;
  }

  isActive(): boolean {
    return this.active;
  }

  getDeviceId(): string | undefined {
    return this.deviceId;
  }

  async start(deviceId?: string): Promise<void> {
    this.deviceId = deviceId;
    this.active = this.availability.available;

    // Auto-detect simulation mode when Frida is not available
    if (!this.availability.fridaAvailable) {
      this.simulationMode = true;
    }

    if (!this.active) {
      return;
    }

    this.resetPendingCounts();
  }

  async stop(): Promise<void> {
    this.active = false;
    this.deviceId = undefined;
    this.messages.length = 0;
    this.resetPendingCounts();
  }

  async captureMessages(filter: MojoMessageFilter = {}): Promise<MojoMessage[]> {
    if (!this.active) {
      return [];
    }

    const captured: MojoMessage[] = [];
    const remaining: MojoMessage[] = [];

    for (const message of this.messages) {
      if (this.matchesFilter(message, filter)) {
        captured.push({ ...message });
      } else {
        remaining.push(message);
      }
    }

    this.messages.length = 0;
    this.messages.push(...remaining);
    this.recomputePendingCounts();

    return captured;
  }

  async listInterfaces(): Promise<
    Array<{ name: string; version: number; pendingMessages: number }>
  > {
    return [...this.interfaces.values()]
      .map((item) => ({
        name: item.name,
        version: item.version,
        pendingMessages: item.pendingMessages,
      }))
      .toSorted((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * Retrieve messages with optional limit and interface filter.
   * Used by the `mojo_messages_get` tool.
   */
  async getMessages(options?: { limit?: number; interfaceName?: string }): Promise<{
    messages: MojoMessage[];
    totalAvailable: number;
    filtered: boolean;
    _simulation: boolean;
  }> {
    if (!this.active) {
      return {
        messages: [],
        totalAvailable: 0,
        filtered: false,
        _simulation: this.simulationMode,
      };
    }

    const filter: MojoMessageFilter = {};
    if (options?.interfaceName) {
      filter.interfaceName = options.interfaceName;
    }

    const allMessages = await this.captureMessages(filter);
    const limit = options?.limit ?? 100;
    const limitedMessages = allMessages.slice(0, limit);

    return {
      messages: limitedMessages,
      totalAvailable: allMessages.length,
      filtered: !!options?.interfaceName,
      _simulation: this.simulationMode,
    };
  }

  recordMessage(message: MojoMessage, version = 1): void {
    if (!this.active) {
      return;
    }

    this.messages.push({ ...message });

    const existing = this.interfaces.get(message.interfaceName);
    if (existing) {
      existing.pendingMessages += 1;
      return;
    }

    this.interfaces.set(message.interfaceName, {
      name: message.interfaceName,
      version,
      pendingMessages: 1,
    });
  }

  private matchesFilter(message: MojoMessage, filter: MojoMessageFilter): boolean {
    if (filter.interfaceName && message.interfaceName !== filter.interfaceName) {
      return false;
    }

    if (filter.messageType && message.messageType !== filter.messageType) {
      return false;
    }

    if (
      typeof filter.pid === 'number' &&
      message.sourcePid !== filter.pid &&
      message.targetPid !== filter.pid
    ) {
      return false;
    }

    return true;
  }

  private recomputePendingCounts(): void {
    this.resetPendingCounts();

    for (const message of this.messages) {
      const item = this.interfaces.get(message.interfaceName);
      if (item) {
        item.pendingMessages += 1;
      } else {
        this.interfaces.set(message.interfaceName, {
          name: message.interfaceName,
          version: 1,
          pendingMessages: 1,
        });
      }
    }
  }

  private resetPendingCounts(): void {
    for (const item of this.interfaces.values()) {
      item.pendingMessages = 0;
    }
  }
}
