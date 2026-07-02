/**
 * PCAPNG (pcap-ng) format — shared types, constants, and helpers.
 *
 * Implements the block-based capture container format described in
 * https://github.com/pcapng/pcapng/ (IETF draft). The format is a sequence of
 * blocks, each carrying a Block Type + Block Total Length + Body + trailing
 * Block Total Length. Byte order is determined per Section Header Block via the
 * Byte-Order Magic 0x1A2B3C4D.
 *
 * Direction-specific logic lives in sibling modules:
 *   - ./pcapng-reader.ts — parsePcapng and per-block body decoders
 *   - ./pcapng-writer.ts — buildPcapng and block serializers
 */

import type { PacketEndianness } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Standard PCAPNG block type magic numbers. */
export const PCAPNG_BLOCK_TYPE = {
  SECTION_HEADER: 0x0a0d0d0a,
  INTERFACE_DESCRIPTION: 0x00000001,
  /** @deprecated Obsolete Packet Block, superseded by Enhanced Packet Block. */
  PACKET_OBSOLETE: 0x00000002,
  SIMPLE_PACKET: 0x00000003,
  NAME_RESOLUTION: 0x00000004,
  INTERFACE_STATISTICS: 0x00000005,
  ENHANCED_PACKET: 0x00000006,
} as const;

/** Byte-Order Magic inside every Section Header Block. */
export const PCAPNG_BYTE_ORDER_MAGIC = 0x1a2b3c4d;

const BLOCK_TYPE_NAMES: Record<number, string> = {
  [PCAPNG_BLOCK_TYPE.SECTION_HEADER]: 'SectionHeader',
  [PCAPNG_BLOCK_TYPE.INTERFACE_DESCRIPTION]: 'InterfaceDescription',
  [PCAPNG_BLOCK_TYPE.PACKET_OBSOLETE]: 'PacketObsolete',
  [PCAPNG_BLOCK_TYPE.SIMPLE_PACKET]: 'SimplePacket',
  [PCAPNG_BLOCK_TYPE.NAME_RESOLUTION]: 'NameResolution',
  [PCAPNG_BLOCK_TYPE.INTERFACE_STATISTICS]: 'InterfaceStatistics',
  [PCAPNG_BLOCK_TYPE.ENHANCED_PACKET]: 'EnhancedPacket',
};

/** PCAPNG option codes (subset relevant to dissection). */
export const OPT_END_OF_OPT = 0;
export const OPT_COMMENT = 1;
export const OPT_IF_NAME = 2;
export const OPT_IF_TSRESOL = 9;

/** Name Resolution Block record types. */
export const NRB_RECORD_END = 0;
export const NRB_RECORD_IPV4 = 1;
export const NRB_RECORD_IPV6 = 2;

// ---------------------------------------------------------------------------
// Result types (reader output)
// ---------------------------------------------------------------------------

export interface PcapngOption {
  code: number;
  name: string;
  valueHex: string;
  /** Decoded text for comment/if_name options; undefined otherwise. */
  text?: string;
}

export interface PcapngSectionInfo {
  byteOrderMagic: number;
  endianness: PacketEndianness;
  majorVersion: number;
  minorVersion: number;
  /** 64-bit section length as an unsigned hex string (may exceed 2^53). */
  sectionLengthHex: string;
  sectionLengthUnspecified: boolean;
  options: PcapngOption[];
}

export interface PcapngInterfaceInfo {
  index: number;
  linkType: number;
  snapLen: number;
  options: PcapngOption[];
  name?: string;
  /** Timestamp resolution power (default 6 = microseconds when undefined). */
  tsresol?: number;
  tsresolBase2?: boolean;
}

export type PcapngPacketSummary = {
  index: number;
  blockIndex: number;
  kind: 'enhanced' | 'simple';
  interfaceId: number | null;
  timestampHigh: number | null;
  timestampLow: number | null;
  /** Full 64-bit timestamp as unsigned hex (high || low). */
  timestampHex: string | null;
  capturedLength: number;
  originalLength: number;
  dataHex: string;
  truncated: boolean;
};

export interface PcapngNameResolutionRecord {
  type: number;
  typeName: string;
  address: string;
  name: string;
}

export interface PcapngInterfaceStatistics {
  index: number;
  blockIndex: number;
  interfaceId: number;
  timestampHigh: number;
  timestampLow: number;
  timestampHex: string;
  options: PcapngOption[];
}

export interface PcapngUnknownBlock {
  blockIndex: number;
  type: number;
  typeName: string;
  totalLength: number;
  bodyHex: string;
}

export interface PcapngReadResult {
  endianness: PacketEndianness;
  sections: PcapngSectionInfo[];
  interfaces: PcapngInterfaceInfo[];
  packets: PcapngPacketSummary[];
  nameResolutionRecords: PcapngNameResolutionRecord[];
  interfaceStatistics: PcapngInterfaceStatistics[];
  unknownBlocks: PcapngUnknownBlock[];
  blockCount: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Write input types (writer input)
// ---------------------------------------------------------------------------

export interface PcapngWriteInterface {
  linkType: number;
  snapLen?: number;
  name?: string;
}

export interface PcapngWritePacket {
  dataHex: string;
  interfaceId?: number;
  timestampHigh?: number;
  timestampLow?: number;
  originalLength?: number;
}

export interface PcapngWriteInput {
  endianness?: PacketEndianness;
  majorVersion?: number;
  minorVersion?: number;
  interfaces: PcapngWriteInterface[];
  packets: PcapngWritePacket[];
}

// ---------------------------------------------------------------------------
// Shared helpers (used by both reader and writer)
// ---------------------------------------------------------------------------

/** Round `n` up to the next 4-byte boundary (PCAPNG alignment rule). */
export function padTo4(n: number): number {
  return (n + 3) & ~3;
}

/** Human-readable name for a PCAPNG block type magic number. */
export function blockTypeName(type: number): string {
  return BLOCK_TYPE_NAMES[type] ?? `Unknown(0x${type.toString(16).padStart(8, '0')})`;
}
