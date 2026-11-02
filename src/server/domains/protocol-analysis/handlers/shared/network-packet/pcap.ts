import { isRecord } from '../protocol-schema';
import { parseHexPayload } from './addressing';
import { parseNonNegativeInteger, parsePositiveInteger } from '../payload/core';
import type {
  PacketEndianness,
  PacketTimestampPrecision,
  PcapHeader,
  PcapPacketInput,
  PcapPacketSummary,
} from './types';

/** Default snaplen for classic PCAP writes (libpcap's standard 65535). */
export const PCAP_DEFAULT_SNAPLEN = 65535;

function writeUint32(
  buffer: Buffer,
  offset: number,
  value: number,
  endianness: PacketEndianness,
): void {
  if (endianness === 'little') {
    buffer.writeUInt32LE(value, offset);
  } else {
    buffer.writeUInt32BE(value, offset);
  }
}

function writeUint16(
  buffer: Buffer,
  offset: number,
  value: number,
  endianness: PacketEndianness,
): void {
  if (endianness === 'little') {
    buffer.writeUInt16LE(value, offset);
  } else {
    buffer.writeUInt16BE(value, offset);
  }
}

function readUint32(buffer: Buffer, offset: number, endianness: PacketEndianness): number {
  return endianness === 'little' ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function readUint16(buffer: Buffer, offset: number, endianness: PacketEndianness): number {
  return endianness === 'little' ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

function getPcapMagic(endianness: PacketEndianness, precision: PacketTimestampPrecision): Buffer {
  const hex =
    endianness === 'little'
      ? precision === 'nano'
        ? '4d3cb2a1'
        : 'd4c3b2a1'
      : precision === 'nano'
        ? 'a1b23c4d'
        : 'a1b2c3d4';
  return Buffer.from(hex, 'hex');
}

function parsePcapHeader(buffer: Buffer): PcapHeader {
  if (buffer.length < 24) {
    throw new Error('PCAP file is too small to contain a global header');
  }

  const magic = buffer.subarray(0, 4).toString('hex');
  let endianness: PacketEndianness;
  let timestampPrecision: PacketTimestampPrecision;
  switch (magic) {
    case 'd4c3b2a1':
      endianness = 'little';
      timestampPrecision = 'micro';
      break;
    case '4d3cb2a1':
      endianness = 'little';
      timestampPrecision = 'nano';
      break;
    case 'a1b2c3d4':
      endianness = 'big';
      timestampPrecision = 'micro';
      break;
    case 'a1b23c4d':
      endianness = 'big';
      timestampPrecision = 'nano';
      break;
    default:
      throw new Error('Unsupported capture format: only classic PCAP files are supported');
  }

  return {
    endianness,
    timestampPrecision,
    versionMajor: readUint16(buffer, 4, endianness),
    versionMinor: readUint16(buffer, 6, endianness),
    snapLength: readUint32(buffer, 16, endianness),
    linkType: readUint32(buffer, 20, endianness),
  };
}

export function parsePcapPacketInput(value: unknown, index: number): PcapPacketInput {
  if (!isRecord(value)) {
    throw new Error(`packets[${index}] must be an object`);
  }

  const data = parseHexPayload(value.dataHex, `packets[${index}].dataHex`);
  const timestampSeconds =
    value.timestampSeconds === undefined
      ? 0
      : parseNonNegativeInteger(value.timestampSeconds, `packets[${index}].timestampSeconds`);
  const timestampFraction =
    value.timestampFraction === undefined
      ? 0
      : parseNonNegativeInteger(value.timestampFraction, `packets[${index}].timestampFraction`);
  const originalLength =
    value.originalLength === undefined
      ? data.length
      : parsePositiveInteger(value.originalLength, `packets[${index}].originalLength`);
  if (originalLength < data.length) {
    throw new Error(`packets[${index}].originalLength must be >= included packet length`);
  }

  return {
    data,
    timestampSeconds,
    timestampFraction,
    originalLength,
  };
}

export function buildClassicPcap(args: {
  packets: PcapPacketInput[];
  endianness: PacketEndianness;
  timestampPrecision: PacketTimestampPrecision;
  snapLength: number;
  linkType: number;
}): Buffer {
  const globalHeader = Buffer.alloc(24);
  getPcapMagic(args.endianness, args.timestampPrecision).copy(globalHeader, 0);
  writeUint16(globalHeader, 4, 2, args.endianness);
  writeUint16(globalHeader, 6, 4, args.endianness);
  writeUint32(globalHeader, 8, 0, args.endianness);
  writeUint32(globalHeader, 12, 0, args.endianness);
  writeUint32(globalHeader, 16, args.snapLength, args.endianness);
  writeUint32(globalHeader, 20, args.linkType, args.endianness);

  const records = args.packets.map((packet) => {
    const header = Buffer.alloc(16);
    writeUint32(header, 0, packet.timestampSeconds, args.endianness);
    writeUint32(header, 4, packet.timestampFraction, args.endianness);
    writeUint32(header, 8, packet.data.length, args.endianness);
    writeUint32(header, 12, packet.originalLength, args.endianness);
    return Buffer.concat([header, packet.data]);
  });

  return Buffer.concat([globalHeader, ...records]);
}

export function readClassicPcap(
  buffer: Buffer,
  maxPackets: number | undefined,
  maxBytesPerPacket: number | undefined,
): { header: PcapHeader; packets: PcapPacketSummary[] } {
  const header = parsePcapHeader(buffer);
  const packets: PcapPacketSummary[] = [];
  let offset = 24;

  while (offset < buffer.length) {
    if (maxPackets !== undefined && packets.length >= maxPackets) {
      break;
    }
    if (offset + 16 > buffer.length) {
      throw new Error('PCAP file ends with an incomplete packet header');
    }

    const timestampSeconds = readUint32(buffer, offset, header.endianness);
    const timestampFraction = readUint32(buffer, offset + 4, header.endianness);
    const includedLength = readUint32(buffer, offset + 8, header.endianness);
    const originalLength = readUint32(buffer, offset + 12, header.endianness);
    offset += 16;

    if (offset + includedLength > buffer.length) {
      throw new Error('PCAP file ends with an incomplete packet payload');
    }

    const packetBytes = buffer.subarray(offset, offset + includedLength);
    offset += includedLength;
    const limit = maxBytesPerPacket === undefined ? packetBytes.length : maxBytesPerPacket;
    const visibleLength = Math.min(limit, packetBytes.length);
    packets.push({
      index: packets.length,
      timestampSeconds,
      timestampFraction,
      includedLength,
      originalLength,
      dataHex: packetBytes.subarray(0, visibleLength).toString('hex'),
      truncated: visibleLength < packetBytes.length,
    });
  }

  return { header, packets };
}
