export interface BLEEnvironmentCheck {
  platform: string;
  supported: boolean;
  issues: string[];
}

export interface BLEHIDReport {
  reportId: number;
  reportType: 'keyboard' | 'mouse' | 'consumer';
  data: Buffer;
}

export class BLEHIDInjector {
  private connected = false;

  checkEnvironment(): BLEEnvironmentCheck {
    return {
      platform: process.platform,
      supported:
        process.platform === 'win32' ||
        process.platform === 'linux' ||
        process.platform === 'darwin',
      issues: [],
    };
  }

  async scanBLEDevices(): Promise<Array<{ id: string; name: string }>> {
    return [];
  }

  async connectHID(deviceId: string): Promise<void> {
    void deviceId;
    this.connected = true;
  }

  async sendHIDReport(_report: BLEHIDReport): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected');
    }
  }

  disconnect(): void {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
