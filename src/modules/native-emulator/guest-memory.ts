export interface GuestMemoryReader {
  read(address: number, length: number): Uint8Array;
}

export interface GuestMemoryWriter {
  write(address: number, bytes: Uint8Array): void;
}

export function alignGuestAddress(value: number, alignment: number): number {
  if (!Number.isSafeInteger(alignment) || alignment <= 0) {
    throw new Error(`Invalid guest alignment: ${alignment}`);
  }
  return Math.ceil(value / alignment) * alignment;
}

function decodeGuestU64(bytes: Uint8Array): bigint {
  if (bytes.byteLength < 8) {
    throw new Error(`Expected 8 guest bytes, received ${bytes.byteLength}`);
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(0, true);
}

export function encodeGuestU64(value: bigint | number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt.asUintN(64, BigInt(value)), true);
  return bytes;
}

export function readGuestU64(memory: GuestMemoryReader, address: number): bigint {
  return decodeGuestU64(memory.read(address, 8));
}

export function writeGuestU64(
  memory: GuestMemoryWriter,
  address: number,
  value: bigint | number,
): void {
  memory.write(address, encodeGuestU64(value));
}

export function readGuestPointer(memory: GuestMemoryReader, address: number): number {
  return Number(readGuestU64(memory, address));
}

export function writeGuestPointer(
  memory: GuestMemoryWriter,
  address: number,
  value: bigint | number,
): void {
  writeGuestU64(memory, address, value);
}
