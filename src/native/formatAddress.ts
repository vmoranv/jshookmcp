/**
 * Address formatting utilities — single source of truth for
 * bigint ↔ hex-string address conversion.
 *
 * @module formatAddress
 */

/** Format a bigint address to its canonical hex representation: `0xABCD1234`. */
export function formatAddress(addr: bigint): string {
  return `0x${addr.toString(16).toUpperCase()}`;
}

/** Parse a hex address string (with or without `0x` prefix) to bigint. */
export function parseAddress(addr: string): bigint {
  return BigInt(addr.startsWith('0x') || addr.startsWith('0X') ? addr : `0x${addr}`);
}
