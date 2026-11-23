/**
 * ProtocolAnalysisPcapHandlers — classic PCAP read/write handlers.
 */

import type { ToolArgs } from '@server/types';
import { getSafeOutputRoots } from '@utils/outputPaths';
import { resolveSafeOutputPath } from '@utils/safeOutput';
import type {
  PacketEndianness,
  PacketTimestampPrecision,
  PcapHeader,
  PcapPacketSummary,
  PcapngInterfaceInfo,
  PcapngPacketSummary,
} from './shared';
import {
  buildClassicPcap,
  parsePcapLinkType,
  parsePcapPacketInput,
  parsePcapng,
  parsePacketEndianness,
  parsePositiveInteger,
  parseTimestampPrecision,
  PCAP_DEFAULT_SNAPLEN,
  PCAPNG_BLOCK_TYPE,
  readClassicPcap,
  readFile,
  writeFile,
} from './shared';
import { ProtocolAnalysisPacketBuildHandlers } from './packet-build-handlers';

/**
 * Split a pcapng 64-bit timestamp (high/low words) into the classic-PCAP
 * (seconds, fraction) contract. The fraction is normalized to microseconds —
 * classic pcap's default `timestampPrecision` — so callers can consume both
 * formats without a precision switch. `tsresol`/`tsresolBase2` come from the
 * packet's interface; unset means 10^-6 (microseconds).
 */
function toPcapTimestamp(
  timestampHigh: number | null,
  timestampLow: number | null,
  tsresol: number | undefined,
  tsresolBase2: boolean | undefined,
): { timestampSeconds: number; timestampFraction: number } {
  if (timestampHigh === null || timestampLow === null) {
    return { timestampSeconds: 0, timestampFraction: 0 };
  }
  const raw = (BigInt(timestampHigh) << 32n) | BigInt(timestampLow);
  const resolution = tsresol ?? 6;
  const divisor = tsresolBase2 ? 2n ** BigInt(resolution) : 10n ** BigInt(resolution);
  const seconds = raw / divisor;
  const fractionMicro = ((raw % divisor) * 1_000_000n) / divisor;
  return {
    timestampSeconds: Number(seconds),
    timestampFraction: Number(fractionMicro),
  };
}

/**
 * Map a PcapngPacketSummary onto the classic PcapPacketSummary contract.
 * The two shapes share no field names (`kind`/`timestampHigh`/`capturedLength`
 * vs `timestampSeconds`/`timestampFraction`/`includedLength`) — a cast would
 * hand consumers undefined fields, so every field is mapped explicitly.
 */
function toPcapPacketSummary(
  packet: PcapngPacketSummary,
  interfaces: PcapngInterfaceInfo[],
): PcapPacketSummary {
  const iface = packet.interfaceId !== null ? interfaces[packet.interfaceId] : undefined;
  const { timestampSeconds, timestampFraction } = toPcapTimestamp(
    packet.timestampHigh,
    packet.timestampLow,
    iface?.tsresol,
    iface?.tsresolBase2,
  );
  return {
    index: packet.index,
    timestampSeconds,
    timestampFraction,
    includedLength: packet.capturedLength,
    originalLength: packet.originalLength,
    // Offloaded payloads keep `dataRef` inside the pcapng summary; the classic
    // contract has no ref field, so inline hex is empty for those packets.
    dataHex: packet.dataHex ?? '',
    truncated: packet.truncated,
  };
}

export class ProtocolAnalysisPcapHandlers extends ProtocolAnalysisPacketBuildHandlers {
  async handlePcapWrite(args: ToolArgs): Promise<{
    path: string;
    packetCount: number;
    byteLength: number;
    endianness: PacketEndianness | null;
    timestampPrecision: PacketTimestampPrecision | null;
    linkType: number | null;
    success?: boolean;
    error?: string;
  }> {
    try {
      const path = await this.parseRequiredWritePath(args);
      if (!Array.isArray(args.packets)) {
        throw new Error('packets must be an array');
      }

      const packets = args.packets.map((entry, index) => parsePcapPacketInput(entry, index));
      const endianness = parsePacketEndianness(args.endianness);
      const timestampPrecision = parseTimestampPrecision(args.timestampPrecision);
      const snapLength =
        args.snapLength === undefined
          ? PCAP_DEFAULT_SNAPLEN
          : parsePositiveInteger(args.snapLength, 'snapLength');
      const linkType = parsePcapLinkType(args.linkType ?? 'ethernet', 'linkType');
      const buffer = buildClassicPcap({
        packets,
        endianness,
        timestampPrecision,
        snapLength,
        linkType,
      });
      await writeFile(path, buffer);
      this.emitEvent('protocol:pcap_written', {
        path,
        packetCount: packets.length,
        byteLength: buffer.length,
      });
      return {
        path,
        packetCount: packets.length,
        byteLength: buffer.length,
        endianness,
        timestampPrecision,
        linkType,
        success: true,
      };
    } catch (error) {
      return {
        path: typeof args.path === 'string' ? args.path : '',
        packetCount: 0,
        byteLength: 0,
        endianness: null,
        timestampPrecision: null,
        linkType: null,
        success: false,
        error: this.errorMessage(error),
      };
    }
  }

  async handlePcapRead(args: ToolArgs): Promise<{
    path: string;
    format: 'pcap' | 'pcapng';
    header: PcapHeader | null;
    packets: PcapPacketSummary[];
    endianness?: string | null;
    blockCount?: number;
    warnings?: string[];
    success?: boolean;
    error?: string;
  }> {
    try {
      const path = this.parseRequiredPath(args);
      const maxPackets =
        args.maxPackets === undefined
          ? undefined
          : parsePositiveInteger(args.maxPackets, 'maxPackets');
      const maxBytesPerPacket =
        args.maxBytesPerPacket === undefined
          ? undefined
          : parsePositiveInteger(args.maxBytesPerPacket, 'maxBytesPerPacket');
      const buffer = await readFile(path);
      // Auto-detect PCAPNG (Section Header Block magic at byte 0) and dispatch
      // transparently — the file extension is unreliable and this is the most
      // common user mistake (research #5). The magic is the shared pcapng.ts
      // SECTION_HEADER block-type constant.
      if (buffer.length >= 4 && buffer.readUInt32BE(0) === PCAPNG_BLOCK_TYPE.SECTION_HEADER) {
        const offloadPacket = (hex: string, packetIndex: number): Promise<string> =>
          this.detailedDataManager.store({ packetIndex, hex });
        const result = await parsePcapng(buffer, {
          maxPackets,
          maxBytesPerPacket,
          offloadPacket,
        });
        this.emitEvent('protocol:pcap_read', {
          path,
          packetCount: result.packets.length,
        });
        return {
          path,
          format: 'pcapng',
          header: null,
          // Map pcapng summaries onto the classic PcapPacketSummary contract —
          // the shapes share no field names, so a cast would yield undefineds.
          packets: result.packets.map((packet) => toPcapPacketSummary(packet, result.interfaces)),
          endianness: result.endianness,
          blockCount: result.blockCount,
          warnings: result.warnings,
          success: true,
        };
      }
      const { header, packets } = readClassicPcap(buffer, maxPackets, maxBytesPerPacket);
      this.emitEvent('protocol:pcap_read', {
        path,
        packetCount: packets.length,
      });
      return {
        path,
        format: 'pcap',
        header,
        packets,
        success: true,
      };
    } catch (error) {
      return {
        path: typeof args.path === 'string' ? args.path : '',
        format: 'pcap',
        header: null,
        packets: [],
        success: false,
        error: this.errorMessage(error),
      };
    }
  }

  protected async parseRequiredWritePath(args: ToolArgs): Promise<string> {
    return await resolveSafeOutputPath(this.parseRequiredPath(args), {
      allowedRoots: getSafeOutputRoots(),
      allowedRootsDescription: 'project root or system temp directory',
    });
  }

  protected parseRequiredPath(args: ToolArgs): string {
    if (typeof args.path !== 'string' || args.path.trim().length === 0) {
      throw new Error('path must be a non-empty string');
    }

    return args.path;
  }
}
