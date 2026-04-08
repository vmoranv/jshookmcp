import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SerialBridge } from '@src/modules/hardware/SerialBridge';

// Mock serialport
vi.mock('serialport', () => ({
  SerialPort: {
    list: vi.fn().mockResolvedValue([
      {
        path: '/dev/ttyUSB0',
        manufacturer: 'FTDI',
        serialNumber: 'ABC123',
        vendorId: '10c4',
        productId: 'ea60',
      },
    ]),
  },
}));

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Mock fs
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

import { SerialPort } from 'serialport';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

const mockList = vi.mocked(SerialPort.list);
const mockSpawn = vi.mocked(spawn);

describe('SerialBridge', () => {
  let bridge: SerialBridge;

  beforeEach(() => {
    bridge = new SerialBridge();
    vi.clearAllMocks();
  });

  describe('listPorts', () => {
    it('should list available ports', async () => {
      const ports = await bridge.listPorts();
      expect(ports).toHaveLength(1);
      expect(ports[0].path).toBe('/dev/ttyUSB0');
    });

    it('should return empty array when serialport not installed', async () => {
      mockList.mockRejectedValueOnce(new Error('module not found'));
      const ports = await bridge.listPorts();
      expect(ports).toEqual([]);
    });
  });

  describe('openPort', () => {
    it('should open port', async () => {
      await bridge.openPort('/dev/ttyUSB0', 9600);
      expect(bridge.isOpenPort()).toBe(true);
    });

    it('should use default baud rate', async () => {
      await bridge.openPort('/dev/ttyUSB0');
      expect(bridge.isOpenPort()).toBe(true);
    });
  });

  describe('sendCommand', () => {
    it('should throw if port not open', async () => {
      await expect(bridge.sendCommand({ command: 'version' })).rejects.toThrow(
        'No serial port open',
      );
    });

    it('should send command when port is open', async () => {
      await bridge.openPort('/dev/ttyUSB0');
      const response = await bridge.sendCommand({ command: 'version' });
      expect(response).toBe('Echo: version');
    });

    it('should include args in command string', async () => {
      await bridge.openPort('/dev/ttyUSB0');
      const response = await bridge.sendCommand({ command: 'read', args: ['0x1000', '0x100'] });
      expect(response).toBe('Echo: read 0x1000 0x100');
    });
  });

  describe('closePort', () => {
    it('should close port', async () => {
      await bridge.openPort('/dev/ttyUSB0');
      await bridge.closePort();
      expect(bridge.isOpenPort()).toBe(false);
    });
  });

  describe('flashFirmware', () => {
    it('should flash firmware via esptool', async () => {
      const mockChild = {
        stdout: {
          on: vi.fn((_: string, cb: (data: Buffer) => void) => {
            cb(Buffer.from('success'));
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (code?: number) => void) => {
          if (event === 'close') {
            setTimeout(() => cb(0), 10);
          }
        }),
      } as unknown as ChildProcess;

      mockSpawn.mockReturnValue(mockChild);

      const result = await bridge.flashFirmware('/dev/ttyUSB0', '/path/firmware.bin');
      expect(result).toContain('Flash successful');
    });

    it('should throw if esptool not found', async () => {
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (err?: NodeJS.ErrnoException) => void) => {
          if (event === 'error') {
            setTimeout(
              () => cb({ code: 'ENOENT', message: 'not found' } as NodeJS.ErrnoException),
              10,
            );
          }
        }),
      } as unknown as ChildProcess;

      mockSpawn.mockReturnValue(mockChild);

      await expect(bridge.flashFirmware('/dev/ttyUSB0', '/path/firmware.bin')).rejects.toThrow(
        'esptool.py not found',
      );
    });
  });

  describe('isESP32Port', () => {
    it('should detect ESP32 by vendor ID', () => {
      const esp32 = bridge.isESP32Port({ path: '/dev/ttyUSB0', vendorId: '10c4' });
      expect(esp32).toBe(true);
    });

    it('should detect non-ESP32 port', () => {
      const notESP32 = bridge.isESP32Port({ path: '/dev/ttyUSB0', vendorId: '1234' });
      expect(notESP32).toBe(false);
    });

    it('should handle missing vendorId', () => {
      const result = bridge.isESP32Port({ path: '/dev/ttyUSB0' });
      expect(result).toBe(false);
    });

    it('should detect other ESP32 vendor IDs', () => {
      expect(bridge.isESP32Port({ path: '/dev/ttyUSB0', vendorId: '1a86' })).toBe(true);
      expect(bridge.isESP32Port({ path: '/dev/ttyUSB0', vendorId: '0403' })).toBe(true);
      expect(bridge.isESP32Port({ path: '/dev/ttyUSB0', vendorId: '303a' })).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(bridge.isESP32Port({ path: '/dev/ttyUSB0', vendorId: '10C4' })).toBe(true);
    });
  });
});
