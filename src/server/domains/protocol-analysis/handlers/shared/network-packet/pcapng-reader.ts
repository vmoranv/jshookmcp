/**
 * PCAPNG reader — block-level parser for the pcap-ng container format.
 *
 * See ./pcapng.ts for the format overview, shared types, and constants. This
 * module owns the parse direction: byte-order detection, per-block body
 * decoding (Section Header, Interface Description, Enhanced/Simple Packet,
 * Name Resolution, Interface Statistics), and unknown-block surfacing.
 */

import type { PacketEndianness } from './types';
import {
  NRB_RECORD_END,
  NRB_RECORD_IPV4,
  NRB_RECORD_IPV6,
  OPT_COMMENT,
  OPT_END_OF_OPT,
  OPT_IF_NAME,
  OPT_IF_TSRESOL,
  PCAPNG_BLOCK_TYPE,
  PCAPNG_BYTE_ORDER_MAGIC,
  blockTypeName,
  padTo4,
  type PcapngInterfaceInfo,
  type PcapngOption,
  type PcapngReadResult,
} from './pcapng';

export interface PcapngParseOptions {
  maxPackets?: number;
  maxBytesPerPacket?: number;
  interfaceFilter?: number;
  /** When true, include raw bodyHex on every block (verbose). Default false. */
  includeRawBodies?: boolean;
}

// ---------------------------------------------------------------------------
// Byte readers (endianness-aware)
// ---------------------------------------------------------------------------

function readU16(buffer: Buffer, offset: number, endian: PacketEndianness): number {
  return endian === 'little' ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

function readU32(buffer: Buffer, offset: number, endian: PacketEndianness): number {
  return endian === 'little' ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

// ---------------------------------------------------------------------------
// Options parser
// ---------------------------------------------------------------------------

function parseOptions(
  buffer: Buffer,
  start: number,
  end: number,
  endian: PacketEndianness,
  warnings: string[],
): PcapngOption[] {
  const options: PcapngOption[] = [];
  let offset = start;

  while (offset + 4 <= end) {
    const code = readU16(buffer, offset, endian);
    const length = readU16(buffer, offset + 2, endian);
    offset += 4;
    if (code === OPT_END_OF_OPT) {
      break;
    }
    if (offset + length > end) {
      warnings.push(`option code ${code} declares ${length} bytes but exceeds body bounds`);
      break;
    }
    const value = buffer.subarray(offset, offset + length);
    const entry: PcapngOption = {
      code,
      name: optionName(code),
      valueHex: value.toString('hex'),
    };
    if (code === OPT_COMMENT || code === OPT_IF_NAME) {
      entry.text = value.toString('utf8');
    }
    options.push(entry);
    offset = start + padTo4(offset + length - start);
  }

  return options;
}

function optionName(code: number): string {
  switch (code) {
    case OPT_COMMENT:
      return 'opt_comment';
    case OPT_IF_NAME:
      return 'if_name';
    case OPT_IF_TSRESOL:
      return 'if_tsresol';
    default:
      return `opt_${code}`;
  }
}

// ---------------------------------------------------------------------------
// Block-level parsing
// ---------------------------------------------------------------------------

interface ParsedBlock {
  type: number;
  totalLength: number;
  bodyStart: number;
  bodyEnd: number;
}

function readBlockHeader(
  buffer: Buffer,
  offset: number,
  endian: PacketEndianness,
): ParsedBlock | null {
  if (offset + 8 > buffer.length) {
    return null;
  }
  const type = readU32(buffer, offset, endian);
  const totalLength = readU32(buffer, offset + 4, endian);
  if (totalLength < 12 || offset + totalLength > buffer.length) {
    return null;
  }
  const trailingLength = readU32(buffer, offset + totalLength - 4, endian);
  if (trailingLength !== totalLength) {
    return null;
  }
  return {
    type,
    totalLength,
    bodyStart: offset + 8,
    bodyEnd: offset + totalLength - 4,
  };
}

function detectEndianness(buffer: Buffer): PacketEndianness | null {
  if (buffer.length < 8) return null;
  // SHB block type 0x0A0D0D0A is endian-agnostic.
  const firstType = buffer.readUInt32BE(0);
  if (firstType !== PCAPNG_BLOCK_TYPE.SECTION_HEADER) return null;
  // The Byte-Order Magic at offset 8 reveals endianness.
  const bomBe = buffer.readUInt32BE(8);
  const bomLe = buffer.readUInt32LE(8);
  if (bomBe === PCAPNG_BYTE_ORDER_MAGIC) return 'big';
  if (bomLe === PCAPNG_BYTE_ORDER_MAGIC) return 'little';
  return null;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parsePcapng(buffer: Buffer, options: PcapngParseOptions = {}): PcapngReadResult {
  const warnings: string[] = [];
  const endian = detectEndianness(buffer);
  if (endian === null) {
    throw new Error('Not a PCAPNG file: missing Section Header Block with valid Byte-Order Magic');
  }

  const result: PcapngReadResult = {
    endianness: endian,
    sections: [],
    interfaces: [],
    packets: [],
    nameResolutionRecords: [],
    interfaceStatistics: [],
    unknownBlocks: [],
    blockCount: 0,
    warnings,
  };

  let offset = 0;
  let packetIndex = 0;
  let interfaceIndex = 0;
  let currentEndian = endian;

  while (offset + 8 <= buffer.length) {
    const block = readBlockHeader(buffer, offset, currentEndian);
    if (block === null) {
      warnings.push(`truncated or malformed block at offset ${offset}`);
      break;
    }
    result.blockCount++;

    switch (block.type) {
      case PCAPNG_BLOCK_TYPE.SECTION_HEADER:
        currentEndian = parseSectionHeader(buffer, block, currentEndian, result, warnings);
        break;
      case PCAPNG_BLOCK_TYPE.INTERFACE_DESCRIPTION:
        parseInterfaceDescription(buffer, block, currentEndian, result, interfaceIndex);
        interfaceIndex++;
        break;
      case PCAPNG_BLOCK_TYPE.ENHANCED_PACKET:
        parseEnhancedPacket(buffer, block, currentEndian, result, packetIndex, options);
        packetIndex++;
        break;
      case PCAPNG_BLOCK_TYPE.SIMPLE_PACKET:
        parseSimplePacket(buffer, block, currentEndian, result, packetIndex, options);
        packetIndex++;
        break;
      case PCAPNG_BLOCK_TYPE.NAME_RESOLUTION:
        parseNameResolution(buffer, block, currentEndian, result, warnings);
        break;
      case PCAPNG_BLOCK_TYPE.INTERFACE_STATISTICS:
        parseInterfaceStatistics(buffer, block, currentEndian, result);
        break;
      default: {
        const body = buffer.subarray(block.bodyStart, block.bodyEnd);
        result.unknownBlocks.push({
          blockIndex: result.blockCount - 1,
          type: block.type,
          typeName: blockTypeName(block.type),
          totalLength: block.totalLength,
          bodyHex: body.toString('hex'),
        });
        if (block.type === PCAPNG_BLOCK_TYPE.PACKET_OBSOLETE) {
          warnings.push('obsolete Packet Block (type 0x02) encountered; use Enhanced Packet Block');
        }
      }
    }

    if (options.maxPackets !== undefined && result.packets.length >= options.maxPackets) {
      break;
    }
    offset += block.totalLength;
  }

  if (options.interfaceFilter !== undefined) {
    result.packets = result.packets.filter(
      (packet) => packet.kind === 'simple' || packet.interfaceId === options.interfaceFilter,
    );
  }

  return result;
}

function parseSectionHeader(
  buffer: Buffer,
  block: ParsedBlock,
  endian: PacketEndianness,
  result: PcapngReadResult,
  warnings: string[],
): PacketEndianness {
  const bom = readU32(buffer, block.bodyStart, endian);
  let resolvedEndian = endian;
  if (bom === PCAPNG_BYTE_ORDER_MAGIC) {
    resolvedEndian = endian;
  } else {
    const bomBe = buffer.readUInt32BE(block.bodyStart);
    resolvedEndian = bomBe === PCAPNG_BYTE_ORDER_MAGIC ? 'big' : 'little';
    const expected = PCAPNG_BYTE_ORDER_MAGIC.toString(16);
    warnings.push(
      `Section Header Block byte-order magic mismatch (expected 0x${expected}, got 0x${bom.toString(16)})`,
    );
  }

  const majorVersion = readU16(buffer, block.bodyStart + 4, resolvedEndian);
  const minorVersion = readU16(buffer, block.bodyStart + 6, resolvedEndian);
  const sectionLengthHigh = readU32(buffer, block.bodyStart + 8, resolvedEndian);
  const sectionLengthLow = readU32(buffer, block.bodyStart + 12, resolvedEndian);
  const sectionLengthUnspecified =
    sectionLengthHigh === 0xffffffff && sectionLengthLow === 0xffffffff;
  const sectionLengthHex = sectionLengthUnspecified
    ? 'unspecified'
    : (sectionLengthHigh >>> 0).toString(16).padStart(8, '0') +
      (sectionLengthLow >>> 0).toString(16).padStart(8, '0');

  const optionsStart = block.bodyStart + 16;
  const options = parseOptions(buffer, optionsStart, block.bodyEnd, resolvedEndian, warnings);

  result.sections.push({
    byteOrderMagic: bom,
    endianness: resolvedEndian,
    majorVersion,
    minorVersion,
    sectionLengthHex,
    sectionLengthUnspecified,
    options,
  });

  return resolvedEndian;
}

function parseInterfaceDescription(
  buffer: Buffer,
  block: ParsedBlock,
  endian: PacketEndianness,
  result: PcapngReadResult,
  interfaceIndex: number,
): void {
  const linkType = readU16(buffer, block.bodyStart, endian);
  const snapLen = readU32(buffer, block.bodyStart + 4, endian);
  const options = parseOptions(buffer, block.bodyStart + 8, block.bodyEnd, endian, result.warnings);

  const entry: PcapngInterfaceInfo = {
    index: interfaceIndex,
    linkType,
    snapLen,
    options,
  };

  for (const option of options) {
    if (option.code === OPT_IF_NAME && option.text) {
      entry.name = option.text;
    } else if (option.code === OPT_IF_TSRESOL && option.valueHex.length >= 2) {
      const raw = Number.parseInt(option.valueHex.slice(0, 2), 16);
      entry.tsresolBase2 = (raw & 0x80) !== 0;
      entry.tsresol = raw & 0x7f;
    }
  }

  result.interfaces.push(entry);
}

function parseEnhancedPacket(
  buffer: Buffer,
  block: ParsedBlock,
  endian: PacketEndianness,
  result: PcapngReadResult,
  packetIndex: number,
  options: PcapngParseOptions,
): void {
  const interfaceId = readU32(buffer, block.bodyStart, endian);
  const timestampHigh = readU32(buffer, block.bodyStart + 4, endian);
  const timestampLow = readU32(buffer, block.bodyStart + 8, endian);
  const capturedLength = readU32(buffer, block.bodyStart + 12, endian);
  const originalLength = readU32(buffer, block.bodyStart + 16, endian);

  const dataStart = block.bodyStart + 20;
  const paddedCaptured = padTo4(capturedLength);
  if (dataStart + paddedCaptured > block.bodyEnd) {
    result.warnings.push(
      `Enhanced Packet Block ${packetIndex} declares ${capturedLength} captured bytes exceeding body`,
    );
    return;
  }

  const packetBytes = buffer.subarray(dataStart, dataStart + capturedLength);
  const limit = options.maxBytesPerPacket ?? packetBytes.length;
  const visibleLength = Math.min(limit, packetBytes.length);

  result.packets.push({
    index: packetIndex,
    blockIndex: result.blockCount - 1,
    kind: 'enhanced',
    interfaceId,
    timestampHigh,
    timestampLow,
    timestampHex: timestampToHex(timestampHigh, timestampLow),
    capturedLength,
    originalLength,
    dataHex: packetBytes.subarray(0, visibleLength).toString('hex'),
    truncated: visibleLength < packetBytes.length,
  });
}

function parseSimplePacket(
  buffer: Buffer,
  block: ParsedBlock,
  endian: PacketEndianness,
  result: PcapngReadResult,
  packetIndex: number,
  options: PcapngParseOptions,
): void {
  const originalLength = readU32(buffer, block.bodyStart, endian);
  const dataStart = block.bodyStart + 4;
  const available = block.bodyEnd - dataStart;
  const capturedLength = Math.min(originalLength, available);
  const packetBytes = buffer.subarray(dataStart, dataStart + capturedLength);
  const limit = options.maxBytesPerPacket ?? packetBytes.length;
  const visibleLength = Math.min(limit, packetBytes.length);

  result.packets.push({
    index: packetIndex,
    blockIndex: result.blockCount - 1,
    kind: 'simple',
    interfaceId: null,
    timestampHigh: null,
    timestampLow: null,
    timestampHex: null,
    capturedLength,
    originalLength,
    dataHex: packetBytes.subarray(0, visibleLength).toString('hex'),
    truncated: visibleLength < packetBytes.length,
  });
}

function parseNameResolution(
  buffer: Buffer,
  block: ParsedBlock,
  endian: PacketEndianness,
  result: PcapngReadResult,
  warnings: string[],
): void {
  let offset = block.bodyStart;
  while (offset + 4 <= block.bodyEnd) {
    const recordType = readU16(buffer, offset, endian);
    const recordLength = readU16(buffer, offset + 2, endian);
    offset += 4;
    if (recordType === NRB_RECORD_END) {
      break;
    }
    if (offset + recordLength > block.bodyEnd) {
      warnings.push('Name Resolution record exceeds block bounds');
      break;
    }
    const value = buffer.subarray(offset, offset + recordLength);
    const { address, name, typeName } = decodeNameResolutionRecord(recordType, value);
    result.nameResolutionRecords.push({ type: recordType, typeName, address, name });
    offset = block.bodyStart + padTo4(offset + recordLength - block.bodyStart);
  }
}

function decodeNameResolutionRecord(
  type: number,
  value: Buffer,
): { address: string; name: string; typeName: string } {
  if (type === NRB_RECORD_IPV4 && value.length >= 5) {
    const address = [value[0], value[1], value[2], value[3]].map((b) => String(b)).join('.');
    const name = stripAtNull(value.subarray(4).toString('utf8'));
    return { address, name, typeName: 'IPv4' };
  }
  if (type === NRB_RECORD_IPV6 && value.length >= 17) {
    const address = Array.from(value.subarray(0, 16))
      .map((b, i) =>
        i % 2 === 1
          ? `${value[i - 1]!.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
          : '',
      )
      .filter(Boolean)
      .join(':');
    const name = stripAtNull(value.subarray(16).toString('utf8'));
    return { address, name, typeName: 'IPv6' };
  }
  return { address: value.toString('hex'), name: '', typeName: `type_${type}` };
}

const NUL_CHAR = String.fromCharCode(0);

/** Strip a trailing NUL-terminated C string down to its first NUL boundary. */
function stripAtNull(text: string): string {
  const nullIndex = text.indexOf(NUL_CHAR);
  return nullIndex >= 0 ? text.slice(0, nullIndex) : text;
}

function parseInterfaceStatistics(
  buffer: Buffer,
  block: ParsedBlock,
  endian: PacketEndianness,
  result: PcapngReadResult,
): void {
  const interfaceId = readU32(buffer, block.bodyStart, endian);
  const timestampHigh = readU32(buffer, block.bodyStart + 4, endian);
  const timestampLow = readU32(buffer, block.bodyStart + 8, endian);
  const options = parseOptions(
    buffer,
    block.bodyStart + 12,
    block.bodyEnd,
    endian,
    result.warnings,
  );
  result.interfaceStatistics.push({
    index: result.interfaceStatistics.length,
    blockIndex: result.blockCount - 1,
    interfaceId,
    timestampHigh,
    timestampLow,
    timestampHex: timestampToHex(timestampHigh, timestampLow),
    options,
  });
}

function timestampToHex(high: number, low: number): string {
  return (high >>> 0).toString(16).padStart(8, '0') + (low >>> 0).toString(16).padStart(8, '0');
}
