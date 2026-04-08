import { execFile, spawn } from 'node:child_process';

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
  fridaCliAvailable: boolean;
}

function getDefaultInterfaces(): MojoInterfaceState[] {
  return [
    { name: 'blink.mojom.WidgetHost', version: 1, pendingMessages: 0 },
    { name: 'content.mojom.FrameHost', version: 2, pendingMessages: 0 },
    { name: 'network.mojom.URLLoaderFactory', version: 3, pendingMessages: 0 },
  ];
}

function detectFridaNpmPackage(): boolean {
  try {
    require.resolve('frida');
    return true;
  } catch {
    return false;
  }
}

async function probeFridaCli(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const child = spawn('frida', ['--version'], {
      timeout: 5000,
      windowsHide: true,
    });

    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.on('close', (code) => {
      if (code === 0 && stdout.trim().length > 0) {
        resolve('frida');
        return;
      }

      resolve(null);
    });

    child.on('error', () => {
      resolve(null);
    });
  });
}

async function detectAvailability(): Promise<AvailabilityState> {
  const flag = process.env['JSHOOK_ENABLE_MOJO_IPC'];
  const fridaNpm = detectFridaNpmPackage();
  const fridaCli = await probeFridaCli();
  const fridaAvailable = fridaNpm || fridaCli !== null;

  if (flag === '0' || flag === 'false') {
    return {
      available: false,
      fridaAvailable,
      fridaCliAvailable: fridaCli !== null,
      reason: 'Mojo IPC disabled by JSHOOK_ENABLE_MOJO_IPC=0.',
    };
  }

  return {
    available: fridaAvailable,
    fridaAvailable,
    fridaCliAvailable: fridaCli !== null,
    reason: fridaAvailable
      ? undefined
      : 'Mojo IPC backend is not connected. Install Frida for real IPC monitoring: https://frida.re/docs/installation/',
  };
}

function matchesFilter(message: MojoMessage, filter: MojoMessageFilter): boolean {
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

function buildFridaScript(): string {
  return `
const messages = [];
recv('message', () => {});
rpc.exports = {
  flush() {
    return messages;
  },
};
`;
}

export class MojoMonitor {
  private active = false;
  private simulationMode = false;
  private deviceId?: string;
  private readonly messages: MojoMessage[] = [];
  private readonly interfaces = new Map<string, MojoInterfaceState>();
  private availability: AvailabilityState = {
    available: false,
    fridaAvailable: false,
    fridaCliAvailable: false,
    reason: 'Not yet initialized. Call start() to probe availability.',
  };

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

  isSimulationMode(): boolean {
    return this.simulationMode;
  }

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
    this.availability = await detectAvailability();

    if (!this.availability.available) {
      this.active = false;
      return;
    }

    this.active = true;
    this.resetPendingCounts();

    if (this.availability.fridaCliAvailable) {
      await this.captureWithFrida(deviceId);
    } else {
      this.simulationMode = true;
    }
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
      if (matchesFilter(message, filter)) {
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

    return {
      messages: allMessages.slice(0, limit),
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

  async captureWithFrida(deviceId?: string): Promise<void> {
    const targetProcess = deviceId ?? 'chrome';
    const script = buildFridaScript();

    await new Promise<void>((resolve, reject) => {
      execFile(
        'frida',
        ['-q', '-n', targetProcess, '-l', '-', '--runtime=v8'],
        { timeout: 10_000, windowsHide: true },
        (error) => {
          if (error) {
            this.simulationMode = true;
            reject(error);
            return;
          }

          this.simulationMode = false;
          resolve();
        },
      ).stdin?.end(script);
    }).catch(() => {
      this.simulationMode = true;
    });
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
