/**
 * ProtocolAnalysisHandlers — delegates to shared utilities from ./shared.ts.
 */

import type {
  FieldSpec,
  PatternSpec,
  ProtocolPattern,
  StateMachine,
} from '@modules/protocol-analysis';
import { ProtocolPatternEngine, StateMachineInferrer } from '@modules/protocol-analysis';
import { argObject, argStringArray, argStringRequired } from '@server/domains/shared/parse-args';
import type { ToolArgs } from '@server/types';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import {
  PROTO_TLS_MIN_RECORD_LEN,
  PROTO_TLS_CONFIDENCE,
  PROTO_WS_CONFIDENCE,
  PROTO_HTTP_CONFIDENCE,
  PROTO_SSH_CONFIDENCE,
} from '@src/constants';
import type {
  PayloadFieldSegment,
  PayloadMutationSummary,
  PacketEndianness,
  PacketTimestampPrecision,
  PcapHeader,
  PcapPacketSummary,
  ProtocolAtomicEvent,
  ProtocolAtomicEventPayload,
} from './shared';
import {
  readFile,
  writeFile,
  isRecord,
  parsePatternSpec,
  parseLegacyField,
  parseEncryptionInfo,
  parseProtocolMessage,
  parseEndian,
  parsePayloadTemplateField,
  buildPayloadFromTemplate,
  normalizeHexString,
  parsePayloadMutation,
  applyPayloadMutation,
  parseMacAddress,
  parseEtherType,
  parseHexPayload,
  parseIpv4Address,
  parseIpAddress,
  parseIpProtocol,
  buildEthernetFrame,
  buildArpPayload,
  buildIpv4Packet,
  buildIpv6Packet,
  buildIcmpEcho,
  parseChecksumEndian,
  computeInternetChecksum,
  parseNonNegativeInteger,
  parsePositiveInteger,
  parseByte,
  parsePcapPacketInput,
  parsePacketEndianness,
  parseTimestampPrecision,
  parsePcapLinkType,
  buildClassicPcap,
  readClassicPcap,
} from './shared';

function readU8(hex: string, offset: number): number {
  return Number.parseInt(hex.substring(offset * 2, offset * 2 + 2), 16);
}
function readU16(hex: string, offset: number): number {
  return Number.parseInt(hex.substring(offset * 2, offset * 2 + 4), 16);
}
function hexSlice(hex: string, offset: number, len: number): string {
  return hex.substring(offset * 2, (offset + len) * 2);
}
function isZeroedDnsHeader(hex: string): boolean {
  return hex.length >= 24 && /^0{24}$/i.test(hex.slice(0, 24));
}

export class ProtocolAnalysisHandlers {
  private engine?: ProtocolPatternEngine;
  private inferrer?: StateMachineInferrer;
  private eventBus?: EventBus<ServerEventMap>;

  constructor(
    engine?: ProtocolPatternEngine,
    inferrer?: StateMachineInferrer,
    eventBus?: EventBus<ServerEventMap>,
  ) {
    this.engine = engine;
    this.inferrer = inferrer;
    this.eventBus = eventBus;
  }

  async handleDefinePattern(args: ToolArgs): Promise<{
    patternId: string;
    pattern: ProtocolPattern;
    success?: boolean;
    error?: string;
  }> {
    try {
      const name =
        typeof args.name === 'string' && args.name.trim().length > 0
          ? args.name
          : 'unnamed_pattern';
      const specObject = argObject(args, 'spec');
      if (specObject) {
        const spec = parsePatternSpec(name, specObject);
        this.getEngine().definePattern(name, spec);
        return {
          patternId: name,
          pattern: this.getEngine().getPattern(name) ?? {
            name,
            fields: [],
            byteOrder: 'big',
          },
          success: true,
        };
      }

      const rawFields = Array.isArray(args.fields) ? args.fields : [];
      const fields = rawFields.map((field, index) => parseLegacyField(field, index));
      const byteOrder =
        args.byteOrder === 'little' || args.byteOrder === 'big' ? args.byteOrder : undefined;
      const encryption = parseEncryptionInfo(args.encryption);
      const pattern = this.getEngine().definePattern(name, fields, {
        ...(byteOrder ? { byteOrder } : {}),
        ...(encryption ? { encryption } : {}),
      });

      return { patternId: name, pattern, success: true };
    } catch (error) {
      return {
        patternId: 'error',
        pattern: {
          name: 'error',
          fields: [],
          byteOrder: 'big',
        },
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async handleAutoDetect(args: ToolArgs): Promise<{
    patterns: ProtocolPattern[];
    success?: boolean;
    error?: string;
  }> {
    try {
      const hexPayloads = (() => {
        const newPayloads = argStringArray(args, 'hexPayloads');
        if (newPayloads.length > 0) {
          return newPayloads;
        }

        return argStringArray(args, 'payloads');
      })();
      const detected = this.getEngine().autoDetect(hexPayloads);
      const patternName =
        typeof args.name === 'string' && args.name.trim().length > 0 ? args.name : undefined;

      if (!detected) {
        const fallback = this.getEngine().autoDetectPattern(
          [],
          patternName ? { name: patternName } : {},
        );
        return { patterns: [fallback], success: true };
      }

      const namedPattern: PatternSpec = {
        ...detected,
        name: patternName ?? detected.name,
      };
      this.getEngine().definePattern(namedPattern.name, namedPattern);
      const result = this.getEngine().getPattern(namedPattern.name) ?? {
        name: namedPattern.name,
        fields: [],
        byteOrder: 'big',
      };
      void this.eventBus?.emit('protocol:pattern_detected', {
        patternName: namedPattern.name,
        confidence: 0,
        timestamp: new Date().toISOString(),
      });
      return {
        patterns: [result],
        success: true,
      };
    } catch (error) {
      return {
        patterns: [],
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async handleInferFields(
    args: ToolArgs,
  ): Promise<{ fields: FieldSpec[]; success?: boolean; error?: string }> {
    try {
      const hexPayloads = argStringArray(args, 'hexPayloads');
      const fields = this.getEngine().inferFields(hexPayloads);
      return { success: true, fields };
    } catch (error) {
      return {
        fields: [],
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async handleExportSchema(args: ToolArgs): Promise<{ schema: string }> {
    try {
      const patternId = argStringRequired(args, 'patternId');
      const pattern = this.getEngine().getPattern(patternId);
      if (!pattern) {
        return { schema: `// Error: pattern '${patternId}' not found` };
      }

      return { schema: this.getEngine().exportProto(pattern) };
    } catch (error) {
      return {
        schema: `// Error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async handleInferStateMachine(args: ToolArgs): Promise<{
    stateMachine: StateMachine;
    mermaid?: string;
    success?: boolean;
    error?: string;
  }> {
    try {
      const rawMessages = args.messages;
      if (!Array.isArray(rawMessages)) {
        throw new Error('messages must be an array');
      }

      const hasLegacyShape = rawMessages.some(
        (message) =>
          isRecord(message) && (message.direction === 'in' || message.direction === 'out'),
      );

      let stateMachine: StateMachine;
      if (hasLegacyShape) {
        const legacyMessages = rawMessages.map((message, index) => {
          if (!isRecord(message)) {
            throw new Error(`messages[${index}] must be an object`);
          }

          const direction = message.direction;
          const payloadHex = typeof message.payloadHex === 'string' ? message.payloadHex : '';
          const timestamp = typeof message.timestamp === 'number' ? message.timestamp : undefined;
          const payload = Buffer.from(payloadHex.replace(/\s+/g, ''), 'hex');

          if (direction !== 'in' && direction !== 'out') {
            throw new Error(`messages[${index}].direction must be "in" or "out"`);
          }

          const legacyDirection: 'in' | 'out' = direction;
          return {
            direction: legacyDirection,
            payload,
            ...(timestamp !== undefined ? { timestamp } : {}),
          };
        });
        stateMachine = this.getInferrer().inferStateMachine(legacyMessages);
      } else {
        const messages = rawMessages.map((message, index) => parseProtocolMessage(message, index));
        stateMachine = this.getInferrer().infer(messages);
      }

      if (args.simplify === true) {
        stateMachine = this.getInferrer().simplify(stateMachine);
      }

      return {
        stateMachine,
        mermaid: this.getInferrer().generateMermaid(stateMachine),
        success: true,
      };
    } catch (error) {
      return {
        stateMachine: {
          states: [],
          transitions: [],
          initial: '',
          initialState: '',
          finalStates: [],
        },
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async handleVisualizeState(args: ToolArgs): Promise<{ mermaidDiagram: string }> {
    try {
      const stateMachineValue = args.stateMachine;
      if (!isRecord(stateMachineValue)) {
        return {
          mermaidDiagram: this.getInferrer().generateMermaid({
            states: [],
            transitions: [],
            initial: '',
            initialState: '',
            finalStates: [],
          }),
        };
      }

      const states = Array.isArray(stateMachineValue.states) ? stateMachineValue.states : [];
      const transitions = Array.isArray(stateMachineValue.transitions)
        ? stateMachineValue.transitions
        : [];
      const initialState =
        typeof stateMachineValue.initialState === 'string' ? stateMachineValue.initialState : '';
      const finalStates = Array.isArray(stateMachineValue.finalStates)
        ? stateMachineValue.finalStates.filter(
            (state): state is string => typeof state === 'string',
          )
        : [];

      return {
        mermaidDiagram: this.getInferrer().generateMermaid({
          states: states.filter((state): state is StateMachine['states'][number] =>
            isRecord(state),
          ),
          transitions: transitions.filter(
            (transition): transition is StateMachine['transitions'][number] => isRecord(transition),
          ),
          initial: initialState,
          initialState,
          finalStates,
        }),
      };
    } catch (error) {
      return {
        mermaidDiagram: `stateDiagram-v2\n  note right of empty: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  async handlePayloadTemplateBuild(args: ToolArgs): Promise<{
    hexPayload: string;
    byteLength: number;
    fields: PayloadFieldSegment[];
    success?: boolean;
    error?: string;
  }> {
    try {
      const rawFields = args.fields;
      if (!Array.isArray(rawFields)) {
        throw new Error('fields must be an array');
      }

      const fields = rawFields.map((field, index) => parsePayloadTemplateField(field, index));
      const endian = parseEndian(args.endian);
      const { payload, segments } = buildPayloadFromTemplate(fields, endian);
      this.emitEvent('protocol:payload_built', {
        byteLength: payload.length,
        fieldCount: segments.length,
      });
      return {
        hexPayload: payload.toString('hex'),
        byteLength: payload.length,
        fields: segments,
        success: true,
      };
    } catch (error) {
      return {
        hexPayload: '',
        byteLength: 0,
        fields: [],
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async handlePayloadMutate(args: ToolArgs): Promise<{
    originalHex: string;
    mutatedHex: string;
    byteLength: number;
    appliedMutations: PayloadMutationSummary[];
    success?: boolean;
    error?: string;
  }> {
    let originalHex = '';

    try {
      if (typeof args.hexPayload !== 'string') {
        throw new Error('hexPayload must be a string');
      }
      originalHex = normalizeHexString(args.hexPayload, 'hexPayload');

      const rawMutations = args.mutations;
      if (!Array.isArray(rawMutations)) {
        throw new Error('mutations must be an array');
      }

      let payload: Buffer = Buffer.from(originalHex, 'hex');
      const appliedMutations: PayloadMutationSummary[] = [];
      for (const [index, rawMutation] of rawMutations.entries()) {
        const mutation = parsePayloadMutation(rawMutation, index);
        const result = applyPayloadMutation(payload, mutation, index);
        payload = result.payload;
        appliedMutations.push(result.summary);
      }

      this.emitEvent('protocol:payload_mutated', {
        byteLength: payload.length,
        mutationCount: appliedMutations.length,
      });

      return {
        originalHex,
        mutatedHex: payload.toString('hex'),
        byteLength: payload.length,
        appliedMutations,
        success: true,
      };
    } catch (error) {
      return {
        originalHex,
        mutatedHex: '',
        byteLength: 0,
        appliedMutations: [],
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
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
        error: error instanceof Error ? error.message : String(error),
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
        senderIp: args.senderIp as string,
        targetMac: targetMac.canonical,
        targetIp: args.targetIp as string,
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
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async handleRawIpPacketBuild(args: ToolArgs): Promise<{
    version: 'ipv4' | 'ipv6' | null;
    protocol: number | null;
    byteLength: number;
    headerLength: number;
    packetHex: string;
    headerHex: string;
    payloadHex: string;
    checksumHex: string | null;
    success?: boolean;
    error?: string;
  }> {
    try {
      const version = args.version === 'ipv6' ? 'ipv6' : 'ipv4';
      const payload = parseHexPayload(args.payloadHex ?? '', 'payloadHex');
      const protocol = parseIpProtocol(args.protocol, 'protocol');
      const dscp = args.dscp === undefined ? 0 : parseNonNegativeInteger(args.dscp, 'dscp');
      const ecn = args.ecn === undefined ? 0 : parseNonNegativeInteger(args.ecn, 'ecn');
      if (dscp > 63) {
        throw new Error('dscp must be between 0 and 63');
      }
      if (ecn > 3) {
        throw new Error('ecn must be between 0 and 3');
      }

      if (version === 'ipv4') {
        const ttl = args.ttl === undefined ? 64 : parseByte(args.ttl, 'ttl');
        const identification =
          args.identification === undefined
            ? 0
            : parseNonNegativeInteger(args.identification, 'identification');
        const fragmentOffset =
          args.fragmentOffset === undefined
            ? 0
            : parseNonNegativeInteger(args.fragmentOffset, 'fragmentOffset');
        if (identification > 0xffff) {
          throw new Error('identification must be between 0 and 65535');
        }
        if (fragmentOffset > 0x1fff) {
          throw new Error('fragmentOffset must be between 0 and 8191');
        }

        const { packet, checksum } = buildIpv4Packet({
          sourceIp: parseIpAddress(args.sourceIp, 'ipv4', 'sourceIp'),
          destinationIp: parseIpAddress(args.destinationIp, 'ipv4', 'destinationIp'),
          protocol,
          payload,
          ttl,
          identification,
          dontFragment: args.dontFragment === true,
          moreFragments: args.moreFragments === true,
          fragmentOffset,
          dscp,
          ecn,
        });
        this.emitEvent('protocol:ip_packet_built', {
          version,
          protocol,
          byteLength: packet.length,
        });
        return {
          version,
          protocol,
          byteLength: packet.length,
          headerLength: 20,
          packetHex: packet.toString('hex'),
          headerHex: packet.subarray(0, 20).toString('hex'),
          payloadHex: payload.toString('hex'),
          checksumHex: checksum.toString(16).padStart(4, '0'),
          success: true,
        };
      }

      const hopLimit =
        args.hopLimit === undefined
          ? args.ttl === undefined
            ? 64
            : parseByte(args.ttl, 'ttl')
          : parseByte(args.hopLimit, 'hopLimit');
      const flowLabel =
        args.flowLabel === undefined ? 0 : parseNonNegativeInteger(args.flowLabel, 'flowLabel');
      if (flowLabel > 0x000fffff) {
        throw new Error('flowLabel must be between 0 and 1048575');
      }

      const packet = buildIpv6Packet({
        sourceIp: parseIpAddress(args.sourceIp, 'ipv6', 'sourceIp'),
        destinationIp: parseIpAddress(args.destinationIp, 'ipv6', 'destinationIp'),
        protocol,
        payload,
        hopLimit,
        dscp,
        ecn,
        flowLabel,
      });
      this.emitEvent('protocol:ip_packet_built', {
        version,
        protocol,
        byteLength: packet.length,
      });
      return {
        version,
        protocol,
        byteLength: packet.length,
        headerLength: 40,
        packetHex: packet.toString('hex'),
        headerHex: packet.subarray(0, 40).toString('hex'),
        payloadHex: payload.toString('hex'),
        checksumHex: null,
        success: true,
      };
    } catch (error) {
      return {
        version: null,
        protocol: null,
        byteLength: 0,
        headerLength: 0,
        packetHex: '',
        headerHex: '',
        payloadHex: '',
        checksumHex: null,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async handleIcmpEchoBuild(args: ToolArgs): Promise<{
    operation: 'request' | 'reply' | null;
    identifier: number | null;
    sequenceNumber: number | null;
    checksum: number | null;
    checksumHex: string;
    byteLength: number;
    packetHex: string;
    payloadHex: string;
    success?: boolean;
    error?: string;
  }> {
    try {
      const operation = args.operation === 'reply' ? 'reply' : 'request';
      const identifier =
        args.identifier === undefined ? 0 : parseNonNegativeInteger(args.identifier, 'identifier');
      const sequenceNumber =
        args.sequenceNumber === undefined
          ? 0
          : parseNonNegativeInteger(args.sequenceNumber, 'sequenceNumber');
      if (identifier > 0xffff) {
        throw new Error('identifier must be between 0 and 65535');
      }
      if (sequenceNumber > 0xffff) {
        throw new Error('sequenceNumber must be between 0 and 65535');
      }

      const payload = parseHexPayload(args.payloadHex ?? '', 'payloadHex');
      const { packet, checksum } = buildIcmpEcho({
        operation,
        identifier,
        sequenceNumber,
        payload,
      });
      const checksumHex = checksum.toString(16).padStart(4, '0');
      this.emitEvent('protocol:icmp_echo_built', {
        operation,
        byteLength: packet.length,
        checksumHex,
      });
      return {
        operation,
        identifier,
        sequenceNumber,
        checksum,
        checksumHex,
        byteLength: packet.length,
        packetHex: packet.toString('hex'),
        payloadHex: payload.toString('hex'),
        success: true,
      };
    } catch (error) {
      return {
        operation: null,
        identifier: null,
        sequenceNumber: null,
        checksum: null,
        checksumHex: '',
        byteLength: 0,
        packetHex: '',
        payloadHex: '',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async handleChecksumApply(args: ToolArgs): Promise<{
    checksumHex: string;
    checksum: number;
    mutatedHex: string;
    byteLength: number;
    rangeStart: number;
    rangeEnd: number;
    success?: boolean;
    error?: string;
  }> {
    try {
      const payload = parseHexPayload(args.hexPayload, 'hexPayload');
      const rangeStart =
        args.startOffset === undefined
          ? 0
          : parseNonNegativeInteger(args.startOffset, 'startOffset');
      const rangeEnd =
        args.endOffset === undefined
          ? payload.length
          : parseNonNegativeInteger(args.endOffset, 'endOffset');
      if (rangeStart > rangeEnd || rangeEnd > payload.length) {
        throw new Error('checksum range must stay within the payload');
      }

      const zeroOffset =
        args.zeroOffset === undefined
          ? undefined
          : parseNonNegativeInteger(args.zeroOffset, 'zeroOffset');
      const zeroLength =
        args.zeroLength === undefined ? 2 : parsePositiveInteger(args.zeroLength, 'zeroLength');
      const writeOffset =
        args.writeOffset === undefined
          ? zeroOffset
          : parseNonNegativeInteger(args.writeOffset, 'writeOffset');
      const endian = parseChecksumEndian(args.endian);

      const working = Buffer.from(payload);
      if (zeroOffset !== undefined) {
        if (zeroOffset + zeroLength > working.length) {
          throw new Error('zeroOffset and zeroLength must stay within the payload');
        }
        working.fill(0, zeroOffset, zeroOffset + zeroLength);
      }

      const checksum = computeInternetChecksum(working.subarray(rangeStart, rangeEnd));
      if (writeOffset !== undefined) {
        if (writeOffset + 2 > working.length) {
          throw new Error('writeOffset must leave room for a 16-bit checksum field');
        }
        if (endian === 'little') {
          working.writeUInt16LE(checksum, writeOffset);
        } else {
          working.writeUInt16BE(checksum, writeOffset);
        }
      }

      const checksumHex = checksum.toString(16).padStart(4, '0');
      this.emitEvent('protocol:checksum_applied', {
        checksumHex,
        byteLength: working.length,
      });
      return {
        checksumHex,
        checksum,
        mutatedHex: working.toString('hex'),
        byteLength: working.length,
        rangeStart,
        rangeEnd,
        success: true,
      };
    } catch (error) {
      return {
        checksumHex: '',
        checksum: 0,
        mutatedHex: '',
        byteLength: 0,
        rangeStart: 0,
        rangeEnd: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

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
      if (typeof args.path !== 'string' || args.path.trim().length === 0) {
        throw new Error('path must be a non-empty string');
      }
      if (!Array.isArray(args.packets)) {
        throw new Error('packets must be an array');
      }

      const packets = args.packets.map((entry, index) => parsePcapPacketInput(entry, index));
      const endianness = parsePacketEndianness(args.endianness);
      const timestampPrecision = parseTimestampPrecision(args.timestampPrecision);
      const snapLength =
        args.snapLength === undefined ? 65535 : parsePositiveInteger(args.snapLength, 'snapLength');
      const linkType = parsePcapLinkType(args.linkType ?? 'ethernet', 'linkType');
      const buffer = buildClassicPcap({
        packets,
        endianness,
        timestampPrecision,
        snapLength,
        linkType,
      });
      await writeFile(args.path, buffer);
      this.emitEvent('protocol:pcap_written', {
        path: args.path,
        packetCount: packets.length,
        byteLength: buffer.length,
      });
      return {
        path: args.path,
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
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async handlePcapRead(args: ToolArgs): Promise<{
    path: string;
    header: PcapHeader | null;
    packets: PcapPacketSummary[];
    success?: boolean;
    error?: string;
  }> {
    try {
      if (typeof args.path !== 'string' || args.path.trim().length === 0) {
        throw new Error('path must be a non-empty string');
      }
      const maxPackets =
        args.maxPackets === undefined
          ? undefined
          : parsePositiveInteger(args.maxPackets, 'maxPackets');
      const maxBytesPerPacket =
        args.maxBytesPerPacket === undefined
          ? undefined
          : parsePositiveInteger(args.maxBytesPerPacket, 'maxBytesPerPacket');
      const buffer = await readFile(args.path);
      const { header, packets } = readClassicPcap(buffer, maxPackets, maxBytesPerPacket);
      this.emitEvent('protocol:pcap_read', {
        path: args.path,
        packetCount: packets.length,
      });
      return {
        path: args.path,
        header,
        packets,
        success: true,
      };
    } catch (error) {
      return {
        path: typeof args.path === 'string' ? args.path : '',
        header: null,
        packets: [],
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private emitEvent<K extends ProtocolAtomicEvent>(
    event: K,
    payload: ProtocolAtomicEventPayload<K>,
  ): void {
    void this.eventBus?.emit(event, {
      ...payload,
      timestamp: new Date().toISOString(),
    } as ServerEventMap[K]);
  }

  private getEngine(): ProtocolPatternEngine {
    if (!this.engine) {
      this.engine = new ProtocolPatternEngine();
    }

    return this.engine;
  }

  private getInferrer(): StateMachineInferrer {
    if (!this.inferrer) {
      this.inferrer = new StateMachineInferrer();
    }

    return this.inferrer;
  }

  async handleProtoFingerprint(
    args: ToolArgs,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const hexPayloads = argStringArray(args, 'hexPayloads');
    const includeKnown = args.includeKnownProtocols !== false;
    const includeHints = args.includeFieldHints !== false;

    if (!hexPayloads || hexPayloads.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: false, error: 'hexPayloads is required' }),
          },
        ],
      };
    }

    const TLS_RECORD_TYPES: Record<number, string> = {
      20: 'ChangeCipherSpec',
      21: 'Alert',
      22: 'Handshake',
      23: 'ApplicationData',
    };
    const TLS_VERSIONS: Record<string, string> = {
      '0300': 'SSL 3.0',
      '0301': 'TLS 1.0',
      '0302': 'TLS 1.1',
      '0303': 'TLS 1.2',
      '0304': 'TLS 1.3',
    };
    const TLS_CIPHER_NAMES: Record<string, string> = {
      '1301': 'TLS_AES_128_GCM_SHA256',
      '1302': 'TLS_AES_256_GCM_SHA384',
      '1303': 'TLS_CHACHA20_POLY1305_SHA256',
      c02b: 'TLS_ECDHE_ECDSA_AES_128_GCM_SHA256',
      c02f: 'TLS_ECDHE_RSA_AES_128_GCM_SHA256',
      c02c: 'TLS_ECDHE_ECDSA_AES_256_GCM_SHA384',
      c030: 'TLS_ECDHE_RSA_AES_256_GCM_SHA384',
      cca9: 'TLS_ECDHE_ECDSA_CHACHA20_POLY1305',
      cca8: 'TLS_ECDHE_RSA_CHACHA20_POLY1305',
      '009c': 'TLS_RSA_AES_128_GCM_SHA256',
      '009d': 'TLS_RSA_AES_256_GCM_SHA384',
      '002f': 'TLS_RSA_AES_128_CBC_SHA',
      '0035': 'TLS_RSA_AES_256_CBC_SHA',
      c013: 'TLS_ECDHE_RSA_AES_128_CBC_SHA',
      c014: 'TLS_ECDHE_RSA_AES_256_CBC_SHA',
      '00ff': 'TLS_EMPTY_RENEGOTIATION_INFO_SCSV',
      '5600': 'TLS_FALLBACK_SCSV',
    };
    const DNS_RCODES: Record<number, string> = {
      0: 'NOERROR',
      1: 'FORMERR',
      2: 'SERVFAIL',
      3: 'NXDOMAIN',
      4: 'NOTIMP',
      5: 'REFUSED',
    };
    const DNS_OPTYPES: Record<number, string> = {
      0: 'QUERY',
      1: 'IQUERY',
      2: 'STATUS',
      3: 'UNASSIGNED',
      4: 'NOTIFY',
      5: 'UPDATE',
    };
    const HTTP_METHODS: Record<string, string> = {
      '474554': 'GET',
      '504f5354': 'POST',
      '505554': 'PUT',
      '44454c45': 'DELETE',
      '48454144': 'HEAD',
      '50415443': 'PATCH',
      '4f505449': 'OPTIONS',
      '434f4e4e': 'CONNECT',
    };

    function parseTlsClientHello(hex: string): Record<string, unknown> | null {
      if (hex.length < 44) return null;
      const recordType = readU8(hex, 0);
      if (recordType !== 0x16) return null;
      const recordVersion = hexSlice(hex, 1, 2);
      const recordLen = readU16(hex, 3);
      if (hex.length / 2 < 5 + recordLen) return null;
      const hsType = readU8(hex, 5);
      if (hsType !== 0x01) return null;

      const result: Record<string, unknown> = {
        recordType: TLS_RECORD_TYPES[recordType] ?? `0x${recordType.toString(16)}`,
        recordVersion: TLS_VERSIONS[recordVersion] ?? recordVersion,
        recordLength: recordLen,
        handshakeType: 'ClientHello',
      };

      // ClientHello body starts at offset 9 (5 TLS record + 4 handshake header)
      let pos = 9;
      if (pos + 2 > hex.length / 2) return result;
      const clientVersion = hexSlice(hex, pos, 2);
      result.clientVersion = TLS_VERSIONS[clientVersion] ?? clientVersion;
      pos += 2;

      // Skip 32-byte random
      pos += 32;

      // Session ID length + data
      if (pos >= hex.length / 2) return result;
      const sessionIdLen = readU8(hex, pos);
      pos += 1 + sessionIdLen;

      // Cipher suites
      if (pos + 2 > hex.length / 2) return result;
      const cipherLen = readU16(hex, pos);
      pos += 2;
      const cipherCount = cipherLen / 2;
      const ciphers: Array<{ hex: string; name: string }> = [];
      for (let i = 0; i < cipherCount && pos + 2 <= hex.length / 2; i++) {
        const cHex = hexSlice(hex, pos, 2).toLowerCase();
        ciphers.push({ hex: cHex, name: TLS_CIPHER_NAMES[cHex] ?? `Unknown(0x${cHex})` });
        pos += 2;
      }
      result.cipherSuites = ciphers;
      result.cipherSuiteCount = ciphers.length;

      // Compression methods
      if (pos >= hex.length / 2) return result;
      const compLen = readU8(hex, pos);
      pos += 1 + compLen;

      // Extensions
      if (pos + 2 > hex.length / 2) return result;
      const extTotalLen = readU16(hex, pos);
      pos += 2;
      const extEnd = pos + extTotalLen;
      const extensions: Array<{ type: string; length: number; name?: string }> = [];
      while (pos + 4 <= extEnd && pos + 4 <= hex.length / 2) {
        const extType = hexSlice(hex, pos, 2).toLowerCase();
        const extLen = readU16(hex, pos + 2);
        const extNames: Record<string, string> = {
          '0000': 'server_name',
          '000a': 'supported_groups',
          '000b': 'ec_point_formats',
          '000d': 'signature_algorithms',
          '0010': 'application_layer_protocol_negotiation',
          '0015': 'padding',
          '0017': 'extended_master_secret',
          '001b': 'compress_certificate',
          '0023': 'session_ticket',
          '0029': 'pre_shared_key',
          '002b': 'supported_versions',
          '002d': 'psk_key_exchange_modes',
          '0033': 'key_share',
          '0039': 'quic_transport_parameters',
          '4469': 'next_protocol_negotiation',
          fe0d: 'encrypted_client_hello',
          ff01: 'renegotiation_info',
        };
        extensions.push({ type: extType, length: extLen, name: extNames[extType] });
        pos += 4 + extLen;
      }
      result.extensions = extensions;
      result.extensionCount = extensions.length;

      return result;
    }

    function parseDnsHeader(hex: string): Record<string, unknown> | null {
      if (hex.length < 24) return null;
      const txId = readU16(hex, 0);
      const flags1 = readU8(hex, 2);
      const flags2 = readU8(hex, 3);
      const qr = (flags1 >> 7) & 1;
      const opcode = (flags1 >> 3) & 0xf;
      const aa = (flags1 >> 2) & 1;
      const tc = (flags1 >> 1) & 1;
      const rd = flags1 & 1;
      const ra = (flags2 >> 7) & 1;
      const z = (flags2 >> 4) & 7;
      const rcode = flags2 & 0xf;
      const qdcount = readU16(hex, 4);
      const ancount = readU16(hex, 6);
      const nscount = readU16(hex, 8);
      const arcount = readU16(hex, 10);

      return {
        transactionId: `0x${txId.toString(16).padStart(4, '0')}`,
        flags: {
          qr: qr === 1 ? 'Response' : 'Query',
          opcode: DNS_OPTYPES[opcode] ?? opcode,
          authoritativeAnswer: !!aa,
          truncation: !!tc,
          recursionDesired: !!rd,
          recursionAvailable: !!ra,
          reserved: z,
          responseCode: DNS_RCODES[rcode] ?? rcode,
        },
        questionCount: qdcount,
        answerCount: ancount,
        authorityCount: nscount,
        additionalCount: arcount,
      };
    }

    function isLikelyDnsHeader(hex: string): boolean {
      if (hex.length < 24 || isZeroedDnsHeader(hex)) return false;

      const flags1 = readU8(hex, 2);
      const flags2 = readU8(hex, 3);
      const qr = (flags1 >> 7) & 1;
      const opcode = (flags1 >> 3) & 0x0f;
      const rcode = flags2 & 0x0f;
      const qdcount = readU16(hex, 4);
      const ancount = readU16(hex, 6);

      if (opcode > 2) return false;
      if (qdcount + ancount === 0) return false;
      if (qr === 0 && rcode !== 0) return false;
      if (qr === 1 && rcode > 5) return false;

      return true;
    }

    const results = hexPayloads.map((hex, idx) => {
      const clean = hex.replace(/\s/g, '');
      const matches: Array<{ protocol: string; layer: string; confidence: number }> = [];
      const actualBytes = clean.length / 2;

      const tlsRecordLen = actualBytes >= 5 ? readU16(clean, 3) : -1;
      const hasCompleteTlsRecord =
        Number.isFinite(tlsRecordLen) && tlsRecordLen >= 0 && actualBytes >= 5 + tlsRecordLen;
      const isTlsCh =
        hasCompleteTlsRecord &&
        tlsRecordLen >= PROTO_TLS_MIN_RECORD_LEN &&
        readU8(clean, 0) === 0x16 &&
        readU8(clean, 5) === 0x01;
      const isDns = isLikelyDnsHeader(clean);
      const isHttp = Object.keys(HTTP_METHODS).some((m) => clean.toUpperCase().startsWith(m));
      const isSsh = clean.toUpperCase().startsWith('5353482D');
      const isWs =
        clean.length >= 4 &&
        (() => {
          const b0 = readU8(clean, 0);
          const b1 = readU8(clean, 1);
          const opcode = b0 & 0x0f;
          // Continuation frames require prior fragmented-frame context, which
          // proto_fingerprint does not have when analyzing isolated samples.
          if (opcode === 0) return false;
          const validOpcode = opcode <= 10 && !(opcode >= 3 && opcode <= 7);
          const masked = ((b1 >> 7) & 1) === 1;
          const wsByteCount = clean.length / 2;
          let payloadLen = b1 & 0x7f;
          let headerBytes = 2;

          if (payloadLen === 126) {
            if (wsByteCount < 4) return false;
            payloadLen = readU16(clean, 2);
            headerBytes = 4;
          } else if (payloadLen === 127) {
            if (wsByteCount < 10) return false;
            const hi32 = (readU16(clean, 2) << 16) | readU16(clean, 4);
            const lo32 = (readU16(clean, 6) << 16) | readU16(clean, 8);
            payloadLen = hi32 > 0 ? 0xffffffff : lo32;
            headerBytes = 10;
          }

          const maskBytes = masked ? 4 : 0;
          const expectedBytes = headerBytes + maskBytes + payloadLen;
          return validOpcode && wsByteCount >= expectedBytes;
        })();

      let deepParse: Record<string, unknown> | null = null;

      if (isTlsCh) {
        matches.push({
          protocol: 'TLS ClientHello',
          layer: 'L6-TLS',
          confidence: PROTO_TLS_CONFIDENCE,
        });
        if (includeHints) deepParse = parseTlsClientHello(clean);
      } else if (isHttp) {
        matches.push({ protocol: 'HTTP/1.x', layer: 'L7-HTTP', confidence: PROTO_HTTP_CONFIDENCE });
        if (includeHints) {
          const method =
            Object.entries(HTTP_METHODS).find(([k]) => clean.toUpperCase().startsWith(k))?.[1] ??
            'UNKNOWN';
          const pathEnd = clean.indexOf('2048545450'); // " HTTP"
          deepParse = { method, httpVersion: pathEnd > 0 ? '1.x' : 'unknown' };
        }
      } else if (isSsh) {
        matches.push({ protocol: 'SSH', layer: 'L7-SSH', confidence: PROTO_SSH_CONFIDENCE });
        if (includeHints && clean.length >= 20) {
          const sshVersion = Buffer.from(
            clean.substring(0, Math.min(clean.length, 80)),
            'hex',
          ).toString('ascii');
          deepParse = { banner: sshVersion };
        }
      } else if (isWs) {
        matches.push({ protocol: 'WebSocket', layer: 'L7-WS', confidence: PROTO_WS_CONFIDENCE });
        if (includeHints && clean.length >= 4) {
          const WS_OPCODES: Record<number, string> = {
            0: 'continuation',
            1: 'text',
            2: 'binary',
            8: 'close',
            9: 'ping',
            10: 'pong',
          };
          const b0 = readU8(clean, 0);
          const b1 = readU8(clean, 1);
          const opcode = b0 & 0xf;
          const masked = (b1 >> 7) & 1;
          let payloadLen = b1 & 0x7f;
          let headerSize = 2;
          if (payloadLen === 126) {
            payloadLen = clean.length >= 4 ? readU16(clean, 2) : 0;
            headerSize = 4;
          } else if (payloadLen === 127) {
            // 64-bit length: bytes 2-9; read as hi32 (bytes 2-5) + lo32 (bytes 6-9)
            if (clean.length >= 20) {
              const hi32 = (readU16(clean, 2) << 16) | readU16(clean, 4);
              const lo32 = (readU16(clean, 6) << 16) | readU16(clean, 8);
              payloadLen = hi32 > 0 ? 0xffffffff : lo32;
            } else {
              payloadLen = 0;
            }
            headerSize = 10;
          }
          if (masked) headerSize += 4;
          deepParse = {
            fin: (b0 >> 7) & 1,
            rsv1: (b0 >> 6) & 1,
            opcode,
            opcodeName: WS_OPCODES[opcode] ?? `reserved(${opcode})`,
            masked: !!masked,
            payloadLength: payloadLen,
            headerSize,
          };
        }
      } else if (isDns) {
        matches.push({ protocol: 'DNS', layer: 'L7-DNS', confidence: 0.85 });
        if (includeHints) deepParse = parseDnsHeader(clean);
      }

      if (includeKnown && matches.length === 0) {
        if (hasCompleteTlsRecord && /^160301|^160302|^160303/i.test(clean.substring(0, 8))) {
          matches.push({ protocol: 'TLS Record', layer: 'L6-TLS', confidence: 0.9 });
        }
        if (clean.substring(0, 8).startsWith('50524920')) {
          matches.push({ protocol: 'HTTP/2 PRI', layer: 'L7-HTTP2', confidence: 0.9 });
        }
      }

      const fieldHints: Array<{ offset: number; hint: string }> = [];
      if (includeHints && !deepParse && clean.length >= 8) {
        const first2 = readU16(clean, 0);
        if (first2 > 0 && first2 < clean.length / 2) {
          fieldHints.push({ offset: 0, hint: `possible length field (${first2} bytes)` });
        }
      }

      const entry: Record<string, unknown> = {
        index: idx,
        size: clean.length / 2,
        protocolMatches:
          matches.length > 0 ? matches : [{ protocol: 'unknown', layer: 'unknown', confidence: 0 }],
      };
      if (deepParse) entry.parsedFields = deepParse;
      if (fieldHints.length > 0) entry.fieldHints = fieldHints;

      return entry;
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, fingerprints: results }, null, 2),
        },
      ],
    };
  }
}
