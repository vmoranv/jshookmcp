import { PAGE, MEM, MEM_TYPE, type MemoryBasicInfo } from './Win32API.js';
import type { NativePatternType } from './NativeMemoryManager.types.js';

export function parsePattern(
  pattern: string,
  patternType: NativePatternType
): { patternBytes: number[]; mask: number[] } {
  const patternBytes: number[] = [];
  const mask: number[] = [];

  switch (patternType) {
    case 'hex': {
      const parts = pattern.trim().split(/\s+/);
      for (const part of parts) {
        if (part === '??' || part === '**' || part === '?') {
          patternBytes.push(0);
          mask.push(0);
        } else {
          const byte = parseInt(part, 16);
          if (!isNaN(byte)) {
            patternBytes.push(byte);
            mask.push(1);
          }
        }
      }
      break;
    }
    case 'int32': {
      const int32Val = parseInt(pattern);
      if (!isNaN(int32Val)) {
        const buf = Buffer.allocUnsafe(4);
        buf.writeInt32LE(int32Val, 0);
        patternBytes.push(...buf);
        mask.push(1, 1, 1, 1);
      }
      break;
    }
    case 'int64': {
      const int64Val = BigInt(pattern);
      const buf64 = Buffer.allocUnsafe(8);
      buf64.writeBigInt64LE(int64Val, 0);
      patternBytes.push(...buf64);
      mask.push(1, 1, 1, 1, 1, 1, 1, 1);
      break;
    }
    case 'float': {
      const floatVal = parseFloat(pattern);
      if (!isNaN(floatVal)) {
        const bufFloat = Buffer.allocUnsafe(4);
        bufFloat.writeFloatLE(floatVal, 0);
        patternBytes.push(...bufFloat);
        mask.push(1, 1, 1, 1);
      }
      break;
    }
    case 'double': {
      const doubleVal = parseFloat(pattern);
      if (!isNaN(doubleVal)) {
        const bufDouble = Buffer.allocUnsafe(8);
        bufDouble.writeDoubleLE(doubleVal, 0);
        patternBytes.push(...bufDouble);
        mask.push(1, 1, 1, 1, 1, 1, 1, 1);
      }
      break;
    }
    case 'string': {
      const strBuf = Buffer.from(pattern, 'utf8');
      patternBytes.push(...strBuf);
      mask.push(...strBuf.map(() => 1));
      break;
    }
  }

  return { patternBytes, mask };
}

export function findPatternInBuffer(buffer: Buffer, pattern: number[], mask: number[]): number[] {
  const matches: number[] = [];

  for (let i = 0; i <= buffer.length - pattern.length; i++) {
    let found = true;
    for (let j = 0; j < pattern.length; j++) {
      if (mask[j] === 1 && buffer[i + j] !== pattern[j]) {
        found = false;
        break;
      }
    }
    if (found) {
      matches.push(i);
    }
  }

  return matches;
}

export function getStateString(state: number): string {
  switch (state) {
    case MEM.COMMIT:
      return 'COMMIT';
    case MEM.RESERVE:
      return 'RESERVE';
    case MEM.FREE:
      return 'FREE';
    default:
      return 'UNKNOWN';
  }
}

export function getProtectionString(protect: number): string {
  if (!protect) return 'NOACCESS';

  const parts: string[] = [];
  if (protect & PAGE.NOACCESS) parts.push('NOACCESS');
  if (protect & PAGE.READONLY) parts.push('R');
  if (protect & PAGE.READWRITE) parts.push('RW');
  if (protect & PAGE.WRITECOPY) parts.push('WC');
  if (protect & PAGE.EXECUTE) parts.push('X');
  if (protect & PAGE.EXECUTE_READ) parts.push('RX');
  if (protect & PAGE.EXECUTE_READWRITE) parts.push('RWX');
  if (protect & PAGE.GUARD) parts.push('GUARD');

  return parts.join(' ') || 'UNKNOWN';
}

export function getTypeString(type: number): string {
  switch (type) {
    case MEM_TYPE.IMAGE:
      return 'IMAGE';
    case MEM_TYPE.MAPPED:
      return 'MAPPED';
    case MEM_TYPE.PRIVATE:
      return 'PRIVATE';
    default:
      return 'UNKNOWN';
  }
}

export function isReadable(info: MemoryBasicInfo): boolean {
  if (info.State !== MEM.COMMIT) return false;

  return (
    (info.Protect & PAGE.READONLY) !== 0 ||
    (info.Protect & PAGE.READWRITE) !== 0 ||
    (info.Protect & PAGE.WRITECOPY) !== 0 ||
    (info.Protect & PAGE.EXECUTE_READ) !== 0 ||
    (info.Protect & PAGE.EXECUTE_READWRITE) !== 0
  );
}

export function isWritable(protect: number): boolean {
  return (
    (protect & PAGE.READWRITE) !== 0 ||
    (protect & PAGE.WRITECOPY) !== 0 ||
    (protect & PAGE.EXECUTE_READWRITE) !== 0
  );
}

export function isExecutable(protect: number): boolean {
  return (
    (protect & PAGE.EXECUTE) !== 0 ||
    (protect & PAGE.EXECUTE_READ) !== 0 ||
    (protect & PAGE.EXECUTE_READWRITE) !== 0
  );
}
