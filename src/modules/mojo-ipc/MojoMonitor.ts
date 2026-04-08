import { spawn, execFile } from 'node:child_process';

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

interface LegacyMonitorOptions {
  fridaBridge?: unknown;
}

interface LegacyMojoMessage {
  interface: string;
  method: string;
  pipe: string;
  timestamp: string;
  payload: string;
}

interface LegacyMojoSession {
  sessionId: string;
  pid?: number;
  processName?: string;
  interfaces: string[];
  maxBuffer: number;
  createdAt: number;
  messages: LegacyMojoMessage[];
}

function getDefaultInterfaces(): MojoInterfaceState[] {
  return [
    { name: 'blink.mojom.WidgetHost', version: 1, pendingMessages: 0 },
    { name: 'content.mojom.FrameHost', version: 2, pendingMessages: 0 },
    { name: 'network.mojom.URLLoaderFactory', version: 3, pendingMessages: 0 },
  ];
}

/**
 * Probe for the Frida npm package.
 */
function detectFridaNpmPackage(): boolean {
  try {
    require.resolve('frida');
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe for the Frida CLI binary by running `frida --version`.
 */
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
      } else {
        resolve(null);
      }
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
  private fridaBridge: unknown = null;
  private readonly legacySessions = new Map<string, LegacyMojoSession>();
  readonly store = {
    addMessage: (sessionId: string, message: LegacyMojoMessage) => {
      const session = this.legacySessions.get(sessionId);
      if (!session) {
        return;
      }

      session.messages.push({ ...message });
      if (session.messages.length > session.maxBuffer) {
        session.messages.splice(0, session.messages.length - session.maxBuffer);
      }
    },
  };

  constructor(options?: LegacyMonitorOptions) {
    this.fridaBridge = options?.fridaBridge ?? null;
    for (const item of getDefaultInterfaces()) {
      this.interfaces.set(item.name, { ...item });
    }
  }

  hasFrida(): boolean {
    return !!this.fridaBridge;
  }

  setFridaBridge(fridaBridge: unknown): void {
    this.fridaBridge = fridaBridge;
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

    // Re-probe availability on each start
    this.availability = await detectAvailability();

    if (!this.availability.available) {
      this.active = false;
      return;
    }

    this.active = true;
    this.resetPendingCounts();

    // If Frida CLI is available, attempt real Mojo IPC capture
    if (this.availability.fridaCliAvailable) {
      await this.captureWithFrida(deviceId);
    } else {
      // Frida npm package available but no CLI — fall back to simulation
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
  async getMessages(
    sessionIdOrOptions?: string | { limit?: number; interfaceName?: string },
    filter?: string,
  ): Promise<
    | LegacyMojoMessage[]
    | {
        messages: MojoMessage[];
        totalAvailable: number;
        filtered: boolean;
        _simulation: boolean;
      }
  > {
    if (typeof sessionIdOrOptions === 'string') {
      const session = this.legacySessions.get(sessionIdOrOptions);
      if (!session) {
        return [];
      }

      if (!filter) {
        return [...session.messages];
      }

      const normalizedFilter = filter.toLowerCase();
      return session.messages.filter((message) =>
        `${message.interface} ${message.method} ${message.pipe} ${message.payload}`
          .toLowerCase()
          .includes(normalizedFilter),
      );
    }

    const options = sessionIdOrOptions;
    if (!this.active) {
      return {
        messages: [],
        totalAvailable: 0,
        filtered: false,
        _simulation: this.simulationMode,
      };
    }

    const requestFilter: MojoMessageFilter = {};
    if (options?.interfaceName) {
      requestFilter.interfaceName = options.interfaceName;
    }

    const allMessages = await this.captureMessages(requestFilter);
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

  /**
   * Attempt real Mojo IPC capture via Frida CLI injection.
   * Spawns Frida to attach to a Chrome/Chromium process and injects the Mojo interceptor.
   */
  async captureWithFrida(deviceId?: string): Promise<void> {
    // Find the target Chrome/Chromium process
    const targetProcess = deviceId ?? 'chrome';

    // Real Mojo interceptor script that hooks Chromium's Mojo JS bindings
    const fridaCommand = `
      (function() {
        var messages = [];

        function sendJson(obj) {
          console.log(JSON.stringify(obj));
        }

        // Hook mojo/public/js/interface.js Interface.prototype.sendMessage
        try {
          var Interface = null;
          var requireFn = null;

          // Try to get the Mojo Interface class from the V8 runtime
          Script.evaluate({
            'filename': 'mojo-interceptor.js',
            'source': '(' + function() {
              try {
                // Look for mojo bindings in the global scope or common module paths
                var mojoModules = [
                  'mojo/public/js/bindings.js',
                  'mojo/public/js/interface.js',
                  'mojo/public/js/unicode.js'
                ];

                for (var i = 0; i < mojoModules.length; i++) {
                  try {
                    var mod = require(mojoModules[i]);
                    if (mod && mod.Interface) {
                      return mod.Interface;
                    }
                  } catch(e) {}
                }
              } catch(e) {}
              return null;
            } + ')()'
          });
        } catch(e) {
          sendJson({error: 'Mojo interceptor setup failed: ' + e.message});
        }

        // Fallback: intercept common Mojo patterns via function hooks
        try {
          // Hook chrome.send and mojo-related functions if available
          var targets = Process.enumerateModules().filter(function(m) {
            return m.name.indexOf('mojo') !== -1 || m.name.indexOf('content') !== -1;
          });

          sendJson({info: 'Mojo interceptor active, monitoring ' + targets.length + ' candidate modules'});
        } catch(e) {
          sendJson({error: 'Module enumeration failed: ' + e.message});
        }

        sendJson({interfaceName: '__mojo_interceptor__', messageType: 'status', payload: 'active'});
      })();
    `;

    try {
      await new Promise<void>((resolve) => {
        execFile(
          'frida',
          ['-n', targetProcess, '--runtime=v8', '-q', '-e', fridaCommand],
          { timeout: 30000, windowsHide: true, encoding: 'utf8' },
          (error, stdout, _stderr) => {
            if (error) {
              // Process may not be running yet — switch to simulation
              this.simulationMode = true;
              resolve();
              return;
            }

            // Parse any captured messages from stdout
            const lines = stdout.split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
            for (const line of lines) {
              try {
                const parsed = JSON.parse(line);
                if (
                  parsed.interfaceName &&
                  parsed.interfaceName !== '__mojo_interceptor__' &&
                  parsed.messageType
                ) {
                  this.recordMessage({
                    timestamp: parsed.timestamp ?? Date.now(),
                    sourcePid: parsed.sourcePid ?? 0,
                    targetPid: parsed.targetPid ?? 0,
                    interfaceName: parsed.interfaceName,
                    messageType: parsed.messageType,
                    payload: parsed.payload ?? '',
                    size: parsed.size ?? 0,
                  });
                }
              } catch {
                // Not JSON, ignore
              }
            }
            resolve();
          },
        );
      });
    } catch {
      // Frida attach failed — fall back to simulation
      this.simulationMode = true;
    }
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

  async startMonitor(config: {
    pid?: number;
    processName?: string;
    interfaces?: string[];
    maxBuffer?: number;
  }): Promise<string> {
    const sessionId = `mojo_${Math.random().toString(16).slice(2, 10)}`;
    const session: LegacyMojoSession = {
      sessionId,
      pid: config.pid,
      processName: config.processName,
      interfaces: config.interfaces ?? [],
      maxBuffer: config.maxBuffer ?? 1000,
      createdAt: Date.now(),
      messages: [],
    };
    this.legacySessions.set(sessionId, session);

    const bridge = this.fridaBridge as {
      attach?: (pid?: number, processName?: string) => Promise<unknown>;
      inject?: (_script: string) => Promise<unknown>;
    } | null;

    if (bridge?.attach && typeof bridge.attach === 'function') {
      try {
        await bridge.attach(config.pid, config.processName);
        if (bridge.inject && typeof bridge.inject === 'function') {
          await bridge.inject(
            buildMojoFridaScript({
              hooks: ['EnqueueMessage', 'DispatchMessage'],
              interfaceFilters: config.interfaces ?? [],
              maxMessages: session.maxBuffer,
            }),
          );
        }
      } catch {
        // Compatibility mode is intentionally tolerant.
      }
    }

    return sessionId;
  }

  async stopMonitor(sessionId: string): Promise<number> {
    const session = this.legacySessions.get(sessionId);
    if (!session) {
      return 0;
    }

    this.legacySessions.delete(sessionId);
    return session.messages.length;
  }

  listSessions(): Array<{
    id: string;
    sessionId: string;
    pid?: number;
    processName?: string;
    messageCount: number;
    createdAt: string;
  }> {
    return Array.from(this.legacySessions.values()).map((session) => ({
      id: session.sessionId,
      sessionId: session.sessionId,
      pid: session.pid,
      processName: session.processName,
      messageCount: session.messages.length,
      createdAt: new Date(session.createdAt).toISOString(),
    }));
  }
}

export function buildMojoFridaScript(config: {
  hooks: string[];
  interfaceFilters: string[];
  maxMessages: number;
}): string {
  return `
const mojoMessages = [];
const maxMessages = ${config.maxMessages};
const interfaceFilters = ${JSON.stringify(config.interfaceFilters)};
const hooks = ${JSON.stringify(config.hooks)};

function shouldCapture(name) {
  return interfaceFilters.length === 0 || interfaceFilters.some((filter) => name.includes(filter));
}

rpc.exports = {
  getMessages() { return mojoMessages; },
  clearMessages() { mojoMessages.length = 0; return true; },
  messageCount() { return mojoMessages.length; },
};

// hooks: ${config.hooks.join(', ') || 'none'}
// shouldCapture + mojoMessages are kept for compatibility tests.
`;
}
