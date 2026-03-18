/**
 * Pattern parsing helpers shared between platform scan implementations.
 */

/**
 * Convert a pattern string + type into a byte array and bitmask.
 * Used by Windows (PowerShell) and Linux (direct memory read) scanners.
 */
export function buildPatternBytesAndMask(
  pattern: string,
  patternType: string
): { patternBytes: number[]; mask: number[] } {
  let patternBytes: number[] = [];
  let mask: number[] = [];

  switch (patternType) {
    case 'hex': {
      const hexParts = pattern.trim().split(/\s+/);
      for (const part of hexParts) {
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
        patternBytes = Array.from(buf);
        mask = [1, 1, 1, 1];
      }
      break;
    }
    case 'int64': {
      const int64Val = BigInt.asIntN(64, BigInt(pattern));
      const buf64 = Buffer.allocUnsafe(8);
      buf64.writeBigInt64LE(int64Val, 0);
      patternBytes = Array.from(buf64);
      mask = [1, 1, 1, 1, 1, 1, 1, 1];
      break;
    }
    case 'float': {
      const floatVal = parseFloat(pattern);
      if (!isNaN(floatVal)) {
        const bufFloat = Buffer.allocUnsafe(4);
        bufFloat.writeFloatLE(floatVal, 0);
        patternBytes = Array.from(bufFloat);
        mask = [1, 1, 1, 1];
      }
      break;
    }
    case 'double': {
      const doubleVal = parseFloat(pattern);
      if (!isNaN(doubleVal)) {
        const bufDouble = Buffer.allocUnsafe(8);
        bufDouble.writeDoubleLE(doubleVal, 0);
        patternBytes = Array.from(bufDouble);
        mask = [1, 1, 1, 1, 1, 1, 1, 1];
      }
      break;
    }
    case 'string': {
      const stringBuf = Buffer.from(pattern, 'utf8');
      patternBytes = Array.from(stringBuf);
      mask = patternBytes.map(() => 1);
      break;
    }
  }

  if (patternBytes.length === 0) {
    throw new Error('Invalid pattern');
  }

  return { patternBytes, mask };
}

/** Convert a pattern string to a byte array and mask for macOS with wildcard support. */
export function patternToBytesMac(
  pattern: string,
  patternType: string
): { bytes: number[]; mask: number[] } {
  const bytes: number[] = [];
  const mask: number[] = [];

  switch (patternType) {
    case 'hex': {
      const parts = pattern.trim().split(/\s+/);
      for (const part of parts) {
        if (part === '??' || part === '?' || part === '**') {
          bytes.push(0);
          mask.push(0);
        } else {
          const b = parseInt(part, 16);
          if (isNaN(b)) throw new Error(`Invalid hex byte: ${part}`);
          bytes.push(b);
          mask.push(1);
        }
      }
      if (!bytes.length) throw new Error('Pattern is empty');
      break;
    }
    case 'int32': {
      const v = parseInt(pattern);
      if (isNaN(v)) throw new Error('Invalid int32 value');
      const buf = Buffer.allocUnsafe(4);
      buf.writeInt32LE(v, 0);
      const arr = Array.from(buf);
      bytes.push(...arr);
      mask.push(...arr.map(() => 1));
      break;
    }
    case 'int64': {
      const buf = Buffer.allocUnsafe(8);
      buf.writeBigInt64LE(BigInt.asIntN(64, BigInt(pattern)), 0);
      const arr = Array.from(buf);
      bytes.push(...arr);
      mask.push(...arr.map(() => 1));
      break;
    }
    case 'float': {
      const v = parseFloat(pattern);
      if (isNaN(v)) throw new Error('Invalid float value');
      const buf = Buffer.allocUnsafe(4);
      buf.writeFloatLE(v, 0);
      const arr = Array.from(buf);
      bytes.push(...arr);
      mask.push(...arr.map(() => 1));
      break;
    }
    case 'double': {
      const v = parseFloat(pattern);
      if (isNaN(v)) throw new Error('Invalid double value');
      const buf = Buffer.allocUnsafe(8);
      buf.writeDoubleLE(v, 0);
      const arr = Array.from(buf);
      bytes.push(...arr);
      mask.push(...arr.map(() => 1));
      break;
    }
    case 'string': {
      const arr = Array.from(Buffer.from(pattern, 'utf8'));
      bytes.push(...arr);
      mask.push(...arr.map(() => 1));
      break;
    }
    default:
      throw new Error(`Unsupported pattern type: ${patternType}`);
  }

  return { bytes, mask };
}
