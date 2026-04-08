export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
}

export interface SerialCommandRequest {
  command: string;
  args?: string[];
}

export class SerialBridge {
  private openPortPath?: string;
  private baudRate = 115200;

  async listPorts(): Promise<SerialPortInfo[]> {
    try {
      const serialportModule = (await import('serialport')) as {
        SerialPort?: { list?: () => Promise<SerialPortInfo[]> };
        default?: { SerialPort?: { list?: () => Promise<SerialPortInfo[]> } };
      };
      const serialPortCtor = serialportModule.SerialPort ?? serialportModule.default?.SerialPort;
      if (!serialPortCtor?.list) {
        return [];
      }

      const ports = await serialPortCtor.list();
      return Array.isArray(ports) ? ports : [];
    } catch {
      return [];
    }
  }

  async openPort(path: string, baudRate = 115200): Promise<void> {
    this.openPortPath = path;
    this.baudRate = baudRate;
  }

  async sendCommand(request: SerialCommandRequest): Promise<string> {
    if (!this.openPortPath) {
      throw new Error('No serial port open');
    }

    const suffix = request.args && request.args.length > 0 ? ` ${request.args.join(' ')}` : '';
    return `Echo: ${request.command}${suffix}`;
  }

  async closePort(): Promise<void> {
    this.openPortPath = undefined;
  }

  async flashFirmware(port: string, firmwarePath: string): Promise<string> {
    const childProcessModule = await import('node:child_process');
    const spawn = childProcessModule.spawn ?? childProcessModule.default?.spawn;
    if (!spawn) {
      throw new Error('esptool.py not found');
    }

    return new Promise<string>((resolve, reject) => {
      const child = spawn('esptool.py', ['--port', port, 'write_flash', '0x1000', firmwarePath]);
      let stdout = '';

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });

      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          reject(new Error('esptool.py not found'));
          return;
        }

        reject(error);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.length > 0 ? `Flash successful: ${stdout}` : 'Flash successful');
          return;
        }

        reject(new Error(`Flashing failed with exit code ${code ?? -1}`));
      });
    });
  }

  isESP32Port(port: Pick<SerialPortInfo, 'vendorId'>): boolean {
    const vendorId = port.vendorId?.toLowerCase();
    return vendorId === '10c4' || vendorId === '1a86' || vendorId === '0403' || vendorId === '303a';
  }

  isOpenPort(): boolean {
    return typeof this.openPortPath === 'string' && this.openPortPath.length > 0;
  }

  getBaudRate(): number {
    return this.baudRate;
  }
}
