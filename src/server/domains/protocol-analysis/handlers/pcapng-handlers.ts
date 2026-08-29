/**
 * ProtocolAnalysisPcapngHandlers — PCAPNG (pcap-ng) read/write handlers.
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ToolArgs } from '@server/types';
import {
  buildPcapng,
  parsePcapng,
  readFile,
  writeFile,
  type PcapngPacketSummary,
  type PcapngReadResult,
  type PcapngWriteInput,
  parseNonNegativeInteger,
  type PcapngWritePacket,
} from './shared';
import { ProtocolAnalysisFingerprintHandlers } from './fingerprint-handlers';

const HEX_RE = /^[0-9a-f]*$/iu;

export interface PcapngReadPayload {
  path: string;
  endianness: string | null;
  blockCount: number;
  sections: PcapngReadResult['sections'];
  interfaces: PcapngReadResult['interfaces'];
  packets: PcapngPacketSummary[];
  nameResolutionRecords: PcapngReadResult['nameResolutionRecords'];
  interfaceStatistics: PcapngReadResult['interfaceStatistics'];
  unknownBlocks: PcapngReadResult['unknownBlocks'];
  warnings: string[];
  success?: boolean;
  error?: string;
}

/** Extra fields carried by the MCP 2.0 Tasks (async) branch of handlePcapngRead. */
export interface PcapngReadTaskFields {
  taskId?: string;
  taskStatus?: string;
  async?: boolean;
}

export class ProtocolAnalysisPcapngHandlers extends ProtocolAnalysisFingerprintHandlers {
  /**
   * Core pcapng parse — shared by the synchronous path and the MCP 2.0 Tasks
   * background executor. Reads the file, parses blocks and offloads oversized
   * packet payloads to the DetailedDataManager sink.
   */
  private async readPcapngCore(
    path: string,
    options: {
      maxPackets?: number;
      maxBytesPerPacket?: number;
      interfaceFilter?: number;
      offloadPacket?: (hex: string, packetIndex: number) => Promise<string>;
    },
  ): Promise<PcapngReadPayload> {
    const buffer = await readFile(path);
    if (buffer.length < 12) {
      throw new Error('PCAPNG file is too small to contain a Section Header Block');
    }
    // Offload any packet payload whose hex exceeds 64 KiB to the shared
    // DetailedDataManager sink — the summary then carries `dataRef` (a
    // retrievable detailId) instead of inline `dataHex`, keeping multi-MB
    // captures out of the LLM context window (matches the project's
    // response-offload pipeline, issue #62).
    const offloadPacket = (hex: string, packetIndex: number): Promise<string> => {
      const detailId = this.detailedDataManager.store({ packetIndex, hex });
      return detailId;
    };
    const result = await parsePcapng(buffer, { ...options, offloadPacket });
    this.emitEvent('protocol:pcapng_read', {
      path,
      blockCount: result.blockCount,
      packetCount: result.packets.length,
    });
    return {
      path,
      endianness: result.endianness,
      blockCount: result.blockCount,
      sections: result.sections,
      interfaces: result.interfaces,
      packets: result.packets,
      nameResolutionRecords: result.nameResolutionRecords,
      interfaceStatistics: result.interfaceStatistics,
      unknownBlocks: result.unknownBlocks,
      warnings: result.warnings,
      success: true,
    };
  }

  async handlePcapngRead(args: ToolArgs): Promise<PcapngReadPayload & PcapngReadTaskFields> {
    try {
      const path = this.parseRequiredPath(args);
      const maxPackets =
        args.maxPackets === undefined
          ? undefined
          : parseNonNegativeInteger(args.maxPackets, 'maxPackets');
      const maxBytesPerPacket =
        args.maxBytesPerPacket === undefined
          ? undefined
          : parseNonNegativeInteger(args.maxBytesPerPacket, 'maxBytesPerPacket');
      const interfaceFilter =
        args.interfaceFilter === undefined
          ? undefined
          : parseNonNegativeInteger(args.interfaceFilter, 'interfaceFilter');

      // Task mode: parse in the background and return a taskId immediately
      // (MCP 2.0 Tasks retrofit — multi-MB captures no longer block the caller).
      if (args.async === true && this.taskManager) {
        const task = await this.taskManager.createTask({
          name: 'pcapng_read',
          executor: async (ctx) => {
            ctx.updateProgress(5, 100, `Reading ${path}...`);
            const result = await this.readPcapngCore(path, {
              maxPackets,
              maxBytesPerPacket,
              interfaceFilter,
            });
            ctx.updateProgress(100, 100, `Parsed ${result.blockCount} block(s)`);
            return result;
          },
        });
        return {
          path,
          endianness: null,
          blockCount: 0,
          sections: [],
          interfaces: [],
          packets: [],
          nameResolutionRecords: [],
          interfaceStatistics: [],
          unknownBlocks: [],
          warnings: [],
          success: true,
          taskId: task.taskId,
          taskStatus: task.status,
          async: true,
        };
      }

      return await this.readPcapngCore(path, {
        maxPackets,
        maxBytesPerPacket,
        interfaceFilter,
      });
    } catch (error) {
      return {
        path: typeof args.path === 'string' ? args.path : '',
        endianness: null,
        blockCount: 0,
        sections: [],
        interfaces: [],
        packets: [],
        nameResolutionRecords: [],
        interfaceStatistics: [],
        unknownBlocks: [],
        warnings: [],
        success: false,
        error: this.errorMessage(error),
      };
    }
  }

  async handlePcapngWrite(args: ToolArgs): Promise<{
    path: string;
    packetCount: number;
    interfaceCount: number;
    byteLength: number;
    endianness: string;
    success?: boolean;
    error?: string;
  }> {
    try {
      const path = this.parseRequiredPath(args);
      const endianness = args.endianness === 'big' ? 'big' : 'little';
      const majorVersion =
        args.majorVersion === undefined
          ? 1
          : parseNonNegativeInteger(args.majorVersion, 'majorVersion');
      const minorVersion =
        args.minorVersion === undefined
          ? 0
          : parseNonNegativeInteger(args.minorVersion, 'minorVersion');

      if (!Array.isArray(args.interfaces)) {
        throw new Error('interfaces must be an array');
      }
      if (!Array.isArray(args.packets)) {
        throw new Error('packets must be an array');
      }

      const interfaces = args.interfaces.map((entry, index) => parseWriteInterface(entry, index));
      const packets = args.packets.map((entry, index) => parseWritePacket(entry, index));

      const input: PcapngWriteInput = {
        endianness,
        majorVersion,
        minorVersion,
        interfaces,
        packets,
      };
      const buffer = buildPcapng(input);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, buffer);
      this.emitEvent('protocol:pcapng_written', {
        path,
        packetCount: packets.length,
        interfaceCount: interfaces.length,
        byteLength: buffer.length,
      });
      return {
        path,
        packetCount: packets.length,
        interfaceCount: interfaces.length,
        byteLength: buffer.length,
        endianness,
        success: true,
      };
    } catch (error) {
      return {
        path: typeof args.path === 'string' ? args.path : '',
        packetCount: 0,
        interfaceCount: 0,
        byteLength: 0,
        endianness: args.endianness === 'big' ? 'big' : 'little',
        success: false,
        error: this.errorMessage(error),
      };
    }
  }
}

// parseNonNegativeInteger now imported from ./shared

function parseWriteInterface(
  value: unknown,
  index: number,
): PcapngWriteInput['interfaces'][number] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`interfaces[${index}] must be an object`);
  }
  const entry = value as Record<string, unknown>;
  const linkType = entry.linkType;
  if (
    typeof linkType !== 'number' ||
    !Number.isInteger(linkType) ||
    linkType < 0 ||
    linkType > 0xffff
  ) {
    throw new Error(`interfaces[${index}].linkType must be an integer between 0 and 65535`);
  }
  const result: PcapngWriteInput['interfaces'][number] = { linkType };
  if (entry.snapLen !== undefined) {
    const snapLen = entry.snapLen;
    if (typeof snapLen !== 'number' || !Number.isInteger(snapLen) || snapLen < 0) {
      throw new Error(`interfaces[${index}].snapLen must be a non-negative integer`);
    }
    result.snapLen = snapLen;
  }
  if (entry.name !== undefined) {
    if (typeof entry.name !== 'string') {
      throw new Error(`interfaces[${index}].name must be a string`);
    }
    result.name = entry.name;
  }
  return result;
}

function parseWritePacket(value: unknown, index: number): PcapngWritePacket {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`packets[${index}] must be an object`);
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.dataHex !== 'string') {
    throw new Error(`packets[${index}].dataHex must be a hex string`);
  }
  const normalized = entry.dataHex.replace(/\s+/g, '').toLowerCase();
  if (normalized.length % 2 !== 0 || !HEX_RE.test(normalized)) {
    throw new Error(`packets[${index}].dataHex must be valid even-length hex`);
  }
  const result: PcapngWritePacket = { dataHex: normalized };
  if (entry.interfaceId !== undefined) {
    if (
      typeof entry.interfaceId !== 'number' ||
      !Number.isInteger(entry.interfaceId) ||
      entry.interfaceId < 0
    ) {
      throw new Error(`packets[${index}].interfaceId must be a non-negative integer`);
    }
    result.interfaceId = entry.interfaceId;
  }
  if (entry.timestampHigh !== undefined) {
    result.timestampHigh = parseOptionalUint32(
      entry.timestampHigh,
      `packets[${index}].timestampHigh`,
    );
  }
  if (entry.timestampLow !== undefined) {
    result.timestampLow = parseOptionalUint32(entry.timestampLow, `packets[${index}].timestampLow`);
  }
  if (entry.originalLength !== undefined) {
    result.originalLength = parseNonNegativeInteger(
      entry.originalLength,
      `packets[${index}].originalLength`,
    );
  }
  return result;
}

function parseOptionalUint32(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} must be an integer between 0 and 4294967295`);
  }
  return value;
}
