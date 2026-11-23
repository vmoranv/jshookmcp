/**
 * Minimal execution surface required by the GDB RSP transport.
 *
 * Kept in the native layer so the wire server does not depend on the
 * native-emulator module's orchestration/session implementation.
 */
export interface GdbEmulatorEngine {
  readRegister(name: string): number;
  writeRegister(name: string, value: number): void;
  readMemory(address: number, length: number): Uint8Array;
  /**
   * Optional memory write. Engines that cannot write memory must omit this;
   * the RSP server then reports writes as unsupported instead of lying with OK.
   */
  writeMemory?(address: number, bytes: Uint8Array): void;
}

export interface GdbEmulatorSession {
  readonly id: string;
  readonly emulator: {
    readonly engine: GdbEmulatorEngine;
  };
  readonly createdAt: number;
  lastUsedAt: number;
}
