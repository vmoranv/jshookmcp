/**
 * PCAPNG writer — serializer for the pcap-ng container format.
 *
 * See ./pcapng.ts for the format overview, shared types, and constants. This
 * module owns the build direction: Section Header Block, Interface Description
 * Block (per interface), and Enhanced Packet Block (per packet) construction.
 */

import type { PacketEndianness } from './types';
import {
  OPT_IF_NAME,
  PCAPNG_BLOCK_TYPE,
  PCAPNG_BYTE_ORDER_MAGIC,
  padTo4,
  type PcapngWriteInput,
  type PcapngWriteInterface,
  type PcapngWritePacket,
} from './pcapng';

// ---------------------------------------------------------------------------
// Byte writers (endianness-aware)
// ---------------------------------------------------------------------------

function writeU16(buffer: Buffer, offset: number, value: number, endian: PacketEndianness): void {
  if (endian === 'little') {
    buffer.writeUInt16LE(value, offset);
  } else {
    buffer.writeUInt16BE(value, offset);
  }
}

function writeU32(buffer: Buffer, offset: number, value: number, endian: PacketEndianness): void {
  if (endian === 'little') {
    buffer.writeUInt32LE(value, offset);
  } else {
    buffer.writeUInt32BE(value, offset);
  }
}

// ---------------------------------------------------------------------------
// Options builder
// ---------------------------------------------------------------------------

function buildOptions(entries: { code: number; value: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(4);
    header.writeUInt16LE(entry.code, 0);
    header.writeUInt16LE(entry.value.length, 2);
    const paddedLength = padTo4(entry.value.length);
    const padded = Buffer.alloc(paddedLength);
    entry.value.copy(padded);
    parts.push(header, padded);
  }
  const endOpt = Buffer.alloc(4); // opt_endofopt (code=0, length=0)
  parts.push(endOpt);
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

function buildSectionHeader(
  endian: PacketEndianness,
  majorVersion: number,
  minorVersion: number,
): Buffer {
  // Fixed body: BOM(4) + version(4) + sectionLength(8) = 16 bytes.
  const body = Buffer.alloc(16);
  writeU32(body, 0, PCAPNG_BYTE_ORDER_MAGIC, endian);
  writeU16(body, 4, majorVersion, endian);
  writeU16(body, 6, minorVersion, endian);
  // Section length unspecified (0xFFFFFFFFFFFFFFFF).
  writeU32(body, 8, 0xffffffff, endian);
  writeU32(body, 12, 0xffffffff, endian);
  return wrapBlock(PCAPNG_BLOCK_TYPE.SECTION_HEADER, body, endian);
}

function buildInterfaceDescription(entry: PcapngWriteInterface, endian: PacketEndianness): Buffer {
  const optionEntries: { code: number; value: Buffer }[] = [];
  if (entry.name) {
    optionEntries.push({ code: OPT_IF_NAME, value: Buffer.from(entry.name, 'utf8') });
  }
  const options = buildOptions(optionEntries);
  const body = Buffer.alloc(8 + options.length);
  writeU16(body, 0, entry.linkType, endian);
  writeU16(body, 2, 0, endian); // reserved
  writeU32(body, 4, entry.snapLen ?? 0x00040000, endian); // default 262144
  options.copy(body, 8);
  return wrapBlock(PCAPNG_BLOCK_TYPE.INTERFACE_DESCRIPTION, body, endian);
}

function buildEnhancedPacket(packet: PcapngWritePacket, endian: PacketEndianness): Buffer {
  const data = Buffer.from(packet.dataHex.replace(/\s+/g, ''), 'hex');
  const paddedDataLength = padTo4(data.length);
  // Fixed header: interfaceId(4) + tsHigh(4) + tsLow(4) + capturedLen(4) + originalLen(4) = 20 bytes.
  const body = Buffer.alloc(20 + paddedDataLength);
  writeU32(body, 0, packet.interfaceId ?? 0, endian);
  writeU32(body, 4, packet.timestampHigh ?? 0, endian);
  writeU32(body, 8, packet.timestampLow ?? 0, endian);
  writeU32(body, 12, data.length, endian);
  writeU32(body, 16, packet.originalLength ?? data.length, endian);
  data.copy(body, 20);
  return wrapBlock(PCAPNG_BLOCK_TYPE.ENHANCED_PACKET, body, endian);
}

function wrapBlock(type: number, body: Buffer, endian: PacketEndianness): Buffer {
  const totalLength = 8 + body.length + 4;
  const header = Buffer.alloc(8);
  writeU32(header, 0, type, endian);
  writeU32(header, 4, totalLength, endian);
  const trailer = Buffer.alloc(4);
  writeU32(trailer, 0, totalLength, endian);
  return Buffer.concat([header, body, trailer]);
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function buildPcapng(input: PcapngWriteInput): Buffer {
  if (input.interfaces.length === 0) {
    throw new Error('at least one interface is required');
  }
  const endian: PacketEndianness = input.endianness === 'big' ? 'big' : 'little';
  const major = input.majorVersion ?? 1;
  const minor = input.minorVersion ?? 0;

  const parts: Buffer[] = [buildSectionHeader(endian, major, minor)];
  for (const entry of input.interfaces) {
    parts.push(buildInterfaceDescription(entry, endian));
  }
  for (const packet of input.packets) {
    parts.push(buildEnhancedPacket(packet, endian));
  }
  return Buffer.concat(parts);
}
