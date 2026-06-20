/**
 * ProtocolAnalysisLinkLayerHandlers — Ethernet and ARP builders.
 */

import type { ToolArgs } from '@server/types';
import {
  buildArpPayload,
  buildEthernetFrame,
  parseEtherType,
  parseHexPayload,
  parseIpv4Address,
  parseMacAddress,
  parseNonNegativeInteger,
  parsePositiveInteger,
} from './shared';
import { ProtocolAnalysisPayloadHandlers } from './payload-handlers';

export class ProtocolAnalysisLinkLayerHandlers extends ProtocolAnalysisPayloadHandlers {
  private formatIpv4(buffer: Buffer): string {
    return Array.from(buffer.values()).join('.');
  }

  async handleEthernetFrameBuild(args: ToolArgs): Promise<{
    destinationMac: string;
    sourceMac: string;
    etherType: number;
    etherTypeHex: string;
    byteLength: number;
    headerHex: string;
    frameHex: string;
    success?: boolean;
    error?: string;
  }> {
    try {
      const destinationMac = parseMacAddress(args.destinationMac, 'destinationMac');
      const sourceMac = parseMacAddress(args.sourceMac, 'sourceMac');
      const etherType = parseEtherType(args.etherType, 'etherType');
      const payload = parseHexPayload(args.payloadHex, 'payloadHex');
      const frame = buildEthernetFrame(destinationMac, sourceMac, etherType, payload);
      this.emitEvent('protocol:ethernet_frame_built', {
        byteLength: frame.length,
        etherType: `0x${etherType.toString(16).padStart(4, '0')}`,
      });
      return {
        destinationMac: destinationMac.canonical,
        sourceMac: sourceMac.canonical,
        etherType,
        etherTypeHex: `0x${etherType.toString(16).padStart(4, '0')}`,
        byteLength: frame.length,
        headerHex: frame.subarray(0, 14).toString('hex'),
        frameHex: frame.toString('hex'),
        success: true,
      };
    } catch (error) {
      return {
        destinationMac: '',
        sourceMac: '',
        etherType: 0,
        etherTypeHex: '0x0000',
        byteLength: 0,
        headerHex: '',
        frameHex: '',
        success: false,
        error: this.errorMessage(error),
      };
    }
  }

  async handleArpBuild(args: ToolArgs): Promise<{
    operation: 'request' | 'reply' | null;
    byteLength: number;
    payloadHex: string;
    senderMac: string;
    senderIp: string;
    targetMac: string;
    targetIp: string;
    success?: boolean;
    error?: string;
  }> {
    try {
      const operation = args.operation === 'reply' ? 'reply' : 'request';
      const senderMac = parseMacAddress(args.senderMac, 'senderMac');
      const targetMac = parseMacAddress(args.targetMac ?? '00:00:00:00:00:00', 'targetMac');
      const senderIp = parseIpv4Address(args.senderIp, 'senderIp');
      const targetIp = parseIpv4Address(args.targetIp, 'targetIp');
      const hardwareType =
        args.hardwareType === undefined
          ? 1
          : parseNonNegativeInteger(args.hardwareType, 'hardwareType');
      const protocolType = parseEtherType(args.protocolType ?? 'ipv4', 'protocolType');
      const hardwareSize =
        args.hardwareSize === undefined
          ? 6
          : parsePositiveInteger(args.hardwareSize, 'hardwareSize');
      const protocolSize =
        args.protocolSize === undefined
          ? 4
          : parsePositiveInteger(args.protocolSize, 'protocolSize');
      const payload = buildArpPayload({
        operation,
        hardwareType,
        protocolType,
        hardwareSize,
        protocolSize,
        senderMac,
        senderIp,
        targetMac,
        targetIp,
      });
      this.emitEvent('protocol:arp_built', {
        operation,
        byteLength: payload.length,
      });
      return {
        operation,
        byteLength: payload.length,
        payloadHex: payload.toString('hex'),
        senderMac: senderMac.canonical,
        senderIp: this.formatIpv4(senderIp),
        targetMac: targetMac.canonical,
        targetIp: this.formatIpv4(targetIp),
        success: true,
      };
    } catch (error) {
      return {
        operation: null,
        byteLength: 0,
        payloadHex: '',
        senderMac: '',
        senderIp: '',
        targetMac: '',
        targetIp: '',
        success: false,
        error: this.errorMessage(error),
      };
    }
  }
}
