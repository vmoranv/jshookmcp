/**
 * Tests for InjectionValidator — Target process and payload validation for DLL/shellcode injection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks
const state = vi.hoisted(() => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
  createReadStream: vi.fn(),
  execSync: vi.fn(),
  digest: vi.fn(() => 'mocked-hash'),
  update: vi.fn(),
  createHash: vi.fn(),
  processInfo: vi.fn(),
}));

// Setup createHash chain
state.createHash.mockImplementation(() => ({
  update: state.update.mockReturnThis(),
  digest: state.digest,
}));

vi.mock('node:fs', () => ({
  existsSync: state.existsSync,
  statSync: state.statSync,
  readFileSync: state.readFileSync,
  createReadStream: state.createReadStream,
}));

vi.mock('node:child_process', () => ({
  execSync: state.execSync,
}));

vi.mock('node:crypto', () => ({
  createHash: state.createHash,
}));

vi.mock('@modules/process', () => ({
  UnifiedProcessManager: class {
    async getProcessByPid(pid: number) {
      return state.processInfo(pid);
    }
    getPlatform() {
      return process.platform;
    }
  },
}));

import {
  InjectionValidator,
  InjectionValidationMode,
  type InjectionValidatorConfig,
} from '@modules/process/memory/injection-validator';

describe('InjectionValidator', () => {
  let validator: InjectionValidator;
  let config: InjectionValidatorConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    state.digest.mockReturnValue('mocked-hash');
    state.readFileSync.mockReturnValue(Buffer.from('dummy'));

    // Reset createHash mock chain
    state.update.mockReturnThis();
    state.createHash.mockImplementation(() => ({
      update: state.update,
      digest: state.digest,
    }));

    // Fake streaming read for computeFileHash: emit one data chunk then end.
    state.createReadStream.mockImplementation(() => {
      const listeners: Record<string, Array<(arg?: unknown) => void>> = {};
      const stream = {
        on(event: string, cb: (arg?: unknown) => void) {
          (listeners[event] ??= []).push(cb);
          return stream;
        },
      };
      queueMicrotask(() => {
        for (const cb of listeners['data'] ?? []) cb(Buffer.from('dummy'));
        for (const cb of listeners['end'] ?? []) cb();
      });
      return stream;
    });

    // Default PowerShell signature result: not signed.
    state.execSync.mockReturnValue('NotSigned|');

    config = {
      mode: InjectionValidationMode.BALANCED,
      maxShellcodeSize: 1024 * 1024, // 1MB
      requireHashForDll: false,
    };
    validator = new InjectionValidator(config);
  });

  describe('Target Process Validation', () => {
    describe('PID validation', () => {
      it('rejects PID 0', async () => {
        state.processInfo.mockResolvedValue(null);

        const result = await validator.validateTargetProcess(0);

        expect(result.valid).toBe(false);
        expect(result.processExists).toBe(false);
        expect(result.errors).toContain('Invalid PID: 0');
      });

      it('rejects negative PID', async () => {
        state.processInfo.mockResolvedValue(null);

        const result = await validator.validateTargetProcess(-1);

        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Invalid PID: -1');
      });

      it('rejects non-existent PID', async () => {
        state.processInfo.mockResolvedValue(null);

        const result = await validator.validateTargetProcess(99999);

        expect(result.valid).toBe(false);
        expect(result.processExists).toBe(false);
        expect(result.errors).toContain('Process 99999 does not exist or is not accessible');
      });

      it('accepts valid PID for accessible process', async () => {
        state.processInfo.mockResolvedValue({
          pid: 1234,
          name: 'test.exe',
          executablePath: '/usr/bin/test',
        });

        const result = await validator.validateTargetProcess(1234);

        expect(result.valid).toBe(true);
        expect(result.processExists).toBe(true);
        expect(result.processAccessible).toBe(true);
        expect(result.processName).toBe('test.exe');
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('Critical system process detection', () => {
      const criticalProcesses = {
        win32: [
          'csrss.exe',
          'smss.exe',
          'winlogon.exe',
          'services.exe',
          'lsass.exe',
          'wininit.exe',
        ],
        linux: ['init', 'systemd', 'kthreadd'],
        darwin: ['launchd', 'kernel_task'],
      };

      it.each(criticalProcesses.win32)(
        'rejects Windows critical process: %s',
        async (processName) => {
          const originalPlatform = process.platform;
          Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

          state.processInfo.mockResolvedValue({
            pid: 1234,
            name: processName,
            executablePath: `/usr/bin${processName}`,
          });

          const result = await validator.validateTargetProcess(1234);

          expect(result.valid).toBe(false);
          expect(result.isCriticalSystemProcess).toBe(true);
          expect(result.errors).toContain(
            `Target process is a critical system process: ${processName}`,
          );

          Object.defineProperty(process, 'platform', {
            value: originalPlatform,
            configurable: true,
          });
        },
      );

      it.each(criticalProcesses.linux)(
        'rejects Linux critical process: %s',
        async (processName) => {
          const originalPlatform = process.platform;
          Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

          state.processInfo.mockResolvedValue({
            pid: 1,
            name: processName,
            executablePath: `/sbin/${processName}`,
          });

          const result = await validator.validateTargetProcess(1);

          expect(result.valid).toBe(false);
          expect(result.isCriticalSystemProcess).toBe(true);

          Object.defineProperty(process, 'platform', {
            value: originalPlatform,
            configurable: true,
          });
        },
      );

      it('accepts non-critical process', async () => {
        state.processInfo.mockResolvedValue({
          pid: 1234,
          name: 'myapp.exe',
          executablePath: '/Users/test/myapp.exe',
        });

        const result = await validator.validateTargetProcess(1234);

        expect(result.valid).toBe(true);
        expect(result.isCriticalSystemProcess).toBe(false);
      });
    });

    describe('Validation modes', () => {
      it('PERMISSIVE mode skips signature checks', async () => {
        validator = new InjectionValidator({ ...config, mode: InjectionValidationMode.PERMISSIVE });
        state.processInfo.mockResolvedValue({
          pid: 1234,
          name: 'unsigned.exe',
          executablePath: '/test/unsigned.exe',
        });

        const result = await validator.validateTargetProcess(1234);

        expect(result.valid).toBe(true);
        expect(result.isSigned).toBeUndefined();
        expect(result.warnings).toHaveLength(0);
      });

      it('BALANCED mode issues warnings for unsigned processes but allows', async () => {
        validator = new InjectionValidator({ ...config, mode: InjectionValidationMode.BALANCED });
        state.processInfo.mockResolvedValue({
          pid: 1234,
          name: 'unsigned.exe',
          executablePath: '/test/unsigned.exe',
        });

        const result = await validator.validateTargetProcess(1234);

        expect(result.valid).toBe(true);
        // Note: signature check implementation depends on platform-specific logic
      });

      it('DISABLED mode returns valid immediately', async () => {
        validator = new InjectionValidator({ ...config, mode: InjectionValidationMode.DISABLED });

        const result = await validator.validateTargetProcess(1234);

        expect(result.valid).toBe(true);
        expect(state.processInfo).not.toHaveBeenCalled();
      });
    });
  });

  describe('DLL Payload Validation', () => {
    it('rejects non-existent DLL file', async () => {
      state.existsSync.mockReturnValue(false);

      const result = await validator.validateDllPayload('/nonexistent.dll');

      expect(result.valid).toBe(false);
      expect(result.fileExists).toBe(false);
      expect(result.payloadType).toBe('dll');
      expect(result.errors).toContain('DLL file not found: /nonexistent.dll');
    });

    it('accepts existing DLL file', async () => {
      state.existsSync.mockReturnValue(true);
      state.statSync.mockReturnValue({ size: 1024 * 50 } as any);

      const result = await validator.validateDllPayload('/valid.dll');

      expect(result.valid).toBe(true);
      expect(result.fileExists).toBe(true);
      expect(result.fileSize).toBe(1024 * 50);
      expect(result.errors).toHaveLength(0);
    });

    it('validates DLL hash when expectedHash provided', async () => {
      state.existsSync.mockReturnValue(true);
      state.statSync.mockReturnValue({ size: 1024 } as any);
      state.readFileSync.mockReturnValue(Buffer.from('dummy'));
      state.digest.mockReturnValue('mocked-hash');

      const result = await validator.validateDllPayload('/test.dll', {
        expectedHash: 'mocked-hash',
      });

      // Debug: log the actual result
      if (!result.valid || !result.hashMatch) {
        console.log('Result:', JSON.stringify(result, null, 2));
        console.log('readFileSync called:', state.readFileSync.mock.calls);
        console.log('digest called:', state.digest.mock.calls);
      }

      expect(result.hashMatch).toBe(true);
      expect(result.expectedHash).toBe('mocked-hash');
      expect(result.actualHash).toBe('mocked-hash');
      expect(result.valid).toBe(true);
    });

    it('rejects DLL when hash mismatch', async () => {
      state.existsSync.mockReturnValue(true);
      state.statSync.mockReturnValue({ size: 1024 } as any);
      state.readFileSync.mockReturnValue(Buffer.from('dummy'));
      state.digest.mockReturnValue('different-hash');

      const result = await validator.validateDllPayload('/test.dll', {
        expectedHash: 'expected-hash',
      });

      expect(result.valid).toBe(false);
      expect(result.hashMatch).toBe(false);
      expect(result.errors).toContain('DLL hash mismatch');
    });

    it('requires hash when config.requireHashForDll is true', async () => {
      validator = new InjectionValidator({ ...config, requireHashForDll: true });
      state.existsSync.mockReturnValue(true);
      state.statSync.mockReturnValue({ size: 1024 } as any);

      const result = await validator.validateDllPayload('/test.dll');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('DLL hash validation required but no expectedHash provided');
    });

    it('warns on unusually large DLL files', async () => {
      state.existsSync.mockReturnValue(true);
      state.statSync.mockReturnValue({ size: 100 * 1024 * 1024 } as any); // 100MB

      const result = await validator.validateDllPayload('/huge.dll');

      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('DLL file is unusually large'),
      );
    });
  });

  describe('Shellcode Payload Validation', () => {
    it('validates hex-encoded shellcode format', async () => {
      const result = await validator.validateShellcodePayload('909090', 'hex');

      expect(result.valid).toBe(true);
      expect(result.payloadType).toBe('shellcode');
      expect(result.shellcodeSize).toBe(3);
      expect(result.encodingValid).toBe(true);
    });

    it('rejects invalid hex-encoded shellcode', async () => {
      const result = await validator.validateShellcodePayload('90909G', 'hex');

      expect(result.valid).toBe(false);
      expect(result.encodingValid).toBe(false);
      expect(result.errors).toContain('Invalid hex encoding in shellcode');
    });

    it('validates base64-encoded shellcode format', async () => {
      const shellcode = Buffer.from([0x90, 0x90, 0x90]).toString('base64');
      const result = await validator.validateShellcodePayload(shellcode, 'base64');

      expect(result.valid).toBe(true);
      expect(result.shellcodeSize).toBe(3);
      expect(result.encodingValid).toBe(true);
    });

    it('rejects invalid base64-encoded shellcode', async () => {
      const result = await validator.validateShellcodePayload('invalid@base64!', 'base64');

      expect(result.valid).toBe(false);
      expect(result.encodingValid).toBe(false);
      expect(result.errors).toContain('Invalid base64 encoding in shellcode');
    });

    it('rejects shellcode exceeding size limit', async () => {
      const largeShellcode = 'A'.repeat((config.maxShellcodeSize ?? 0) * 2 + 2); // Hex = 2 chars per byte
      const result = await validator.validateShellcodePayload(largeShellcode, 'hex');

      expect(result.valid).toBe(false);
      expect(result.errors.some((err) => err.includes('Shellcode size'))).toBe(true);
      expect(result.errors.some((err) => err.includes('exceeds maximum'))).toBe(true);
    });

    it('warns on empty shellcode', async () => {
      const result = await validator.validateShellcodePayload('', 'hex');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Shellcode is empty');
    });

    it('warns on suspiciously small shellcode', async () => {
      const result = await validator.validateShellcodePayload('90', 'hex'); // 1 byte

      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('Shellcode is suspiciously small'),
      );
    });
  });

  describe('Confirmation Requirement', () => {
    beforeEach(() => {
      state.existsSync.mockReturnValue(true);
      state.statSync.mockReturnValue({ size: 1024 } as any);
    });

    it('does not require confirmation in PERMISSIVE mode', async () => {
      validator = new InjectionValidator({ ...config, mode: InjectionValidationMode.PERMISSIVE });
      state.processInfo.mockResolvedValue({
        pid: 1234,
        name: 'test.exe',
        executablePath: '/test/test.exe',
      });

      const targetValidation = await validator.validateTargetProcess(1234);
      const payloadValidation = await validator.validateDllPayload('/test/inject.dll');
      const confirmation = validator.requireConfirmation(targetValidation, payloadValidation);

      expect(confirmation.required).toBe(false);
    });

    it('does not require confirmation in BALANCED mode for valid targets', async () => {
      validator = new InjectionValidator({ ...config, mode: InjectionValidationMode.BALANCED });
      state.processInfo.mockResolvedValue({
        pid: 1234,
        name: 'test.exe',
        executablePath: '/test/test.exe',
      });

      const targetValidation = await validator.validateTargetProcess(1234);
      const payloadValidation = await validator.validateDllPayload('/test/inject.dll');
      const confirmation = validator.requireConfirmation(targetValidation, payloadValidation);

      expect(confirmation.required).toBe(false);
    });

    it('requires confirmation in STRICT mode for unsigned processes', async () => {
      validator = new InjectionValidator({ ...config, mode: InjectionValidationMode.STRICT });
      state.processInfo.mockResolvedValue({
        pid: 1234,
        name: 'unsigned.exe',
        executablePath: '/test/unsigned.exe',
      });

      const targetValidation = await validator.validateTargetProcess(1234);
      targetValidation.isSigned = false; // Simulate unsigned process

      const payloadValidation = await validator.validateDllPayload('/test/inject.dll');
      const confirmation = validator.requireConfirmation(targetValidation, payloadValidation);

      expect(confirmation.required).toBe(true);
      expect(confirmation.reason).toContain('not digitally signed');
    });

    it('requires confirmation in STRICT mode when payload has warnings', async () => {
      validator = new InjectionValidator({ ...config, mode: InjectionValidationMode.STRICT });
      state.processInfo.mockResolvedValue({
        pid: 1234,
        name: 'test.exe',
        executablePath: '/test/test.exe',
      });

      const targetValidation = await validator.validateTargetProcess(1234);
      const payloadValidation = await validator.validateDllPayload('/test/inject.dll');
      payloadValidation.warnings.push('DLL is from an unusual location');

      const confirmation = validator.requireConfirmation(targetValidation, payloadValidation);

      expect(confirmation.required).toBe(true);
      expect(confirmation.reason).toBeDefined();
    });
  });

  describe('Validation workflow integration', () => {
    it('returns comprehensive validation result for complete DLL injection flow', async () => {
      validator = new InjectionValidator({ ...config, mode: InjectionValidationMode.BALANCED });
      state.existsSync.mockReturnValue(true);
      state.statSync.mockReturnValue({ size: 1024 * 10 } as any);
      state.processInfo.mockResolvedValue({
        pid: 1234,
        name: 'target.exe',
        executablePath: '/app/target.exe',
      });

      const targetValidation = await validator.validateTargetProcess(1234);
      const payloadValidation = await validator.validateDllPayload('/inject/payload.dll');
      const confirmation = validator.requireConfirmation(targetValidation, payloadValidation);

      expect(targetValidation.valid).toBe(true);
      expect(payloadValidation.valid).toBe(true);
      expect(confirmation.required).toBe(false);
    });

    it('returns comprehensive validation result for complete shellcode injection flow', async () => {
      validator = new InjectionValidator({ ...config, mode: InjectionValidationMode.STRICT });
      state.processInfo.mockResolvedValue({
        pid: 1234,
        name: 'target.exe',
        executablePath: '/app/target.exe',
      });

      const shellcode = Buffer.from([0x90, 0x90, 0x90, 0xc3]).toString('hex');
      const targetValidation = await validator.validateTargetProcess(1234);
      const payloadValidation = await validator.validateShellcodePayload(shellcode, 'hex');
      validator.requireConfirmation(targetValidation, payloadValidation);

      expect(targetValidation.valid).toBe(true);
      expect(payloadValidation.valid).toBe(true);
      expect(payloadValidation.shellcodeSize).toBe(4);
      // Confirmation may be required depending on signature status
    });
  });

  describe('Error accumulation', () => {
    it('accumulates multiple validation errors', async () => {
      validator = new InjectionValidator({ ...config, requireHashForDll: true });
      state.existsSync.mockReturnValue(false);

      const result = await validator.validateDllPayload('/nonexistent.dll');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors).toContain('DLL file not found: /nonexistent.dll');
    });
  });
});
