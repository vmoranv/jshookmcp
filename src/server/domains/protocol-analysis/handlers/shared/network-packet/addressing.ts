import { isIP } from 'node:net';
import { normalizeHexString } from '../payload/core';
import { ETHER_TYPE_MAP, IP_PROTOCOL_MAP, PCAP_LINK_TYPE_MAP } from './types';
import type {
  ChecksumEndian,
  PacketEndianness,
  PacketTimestampPrecision,
  ParsedMacAddress,
} from './types';

function parseNamedOrNumericValue(
  value: unknown,
  label: string,
  map: Readonly<Record<string, number>>,
  max: number,
): number {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > max) {
      throw new Error(`${label} must be an integer between 0 and ${max}`);
    }
    return value;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string or integer`);
  }

  const normalized = value.trim().toLowerCase();
  const mapped = map[normalized];
  if (mapped !== undefined) {
    return mapped;
  }

  if (/^\d+$/.test(normalized)) {
    const parsed = Number.parseInt(normalized, 10);
    if (parsed > max) {
      throw new Error(`${label} must be less than or equal to ${max}`);
    }
    return parsed;
  }

  const hex = normalizeHexString(normalized, label);
  const parsed = Number.parseInt(hex, 16);
  if (parsed > max) {
    throw new Error(`${label} must be less than or equal to ${max}`);
  }
  return parsed;
}

export function parseMacAddress(value: unknown, label: string): ParsedMacAddress {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty MAC address string`);
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^0x/, '')
    .replace(/[:\-.\s]/g, '');
  if (!/^[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error(`${label} must be a valid 6-byte MAC address`);
  }

  const canonical = normalized.match(/.{2}/g)?.join(':');
  if (!canonical) {
    throw new Error(`${label} must be a valid 6-byte MAC address`);
  }

  return {
    canonical,
    bytes: Buffer.from(normalized, 'hex'),
  };
}

export function parseIpv4Address(value: unknown, label: string): Buffer {
  if (typeof value !== 'string' || isIP(value.trim()) !== 4) {
    throw new Error(`${label} must be a valid IPv4 address`);
  }

  const octets = value
    .trim()
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  return Buffer.from(octets);
}

function parseIpv6Groups(value: string, label: string): string[] {
  if (value.length === 0) {
    return [];
  }

  return value.split(':').flatMap((part) => {
    if (part.length === 0) {
      return [];
    }
    if (part.includes('.')) {
      const ipv4 = parseIpv4Address(part, label);
      return [ipv4.readUInt16BE(0).toString(16), ipv4.readUInt16BE(2).toString(16)];
    }
    if (!/^[0-9a-f]{1,4}$/i.test(part)) {
      throw new Error(`${label} contains an invalid IPv6 group`);
    }
    return [part];
  });
}

function parseIpv6Address(value: unknown, label: string): Buffer {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a valid IPv6 address`);
  }

  const normalized = value.trim().toLowerCase().split('%')[0] ?? '';
  if (isIP(normalized) !== 6) {
    throw new Error(`${label} must be a valid IPv6 address`);
  }

  const segments = normalized.split('::');
  if (segments.length > 2) {
    throw new Error(`${label} must be a valid IPv6 address`);
  }

  const head = parseIpv6Groups(segments[0] ?? '', label);
  const tail = parseIpv6Groups(segments[1] ?? '', label);
  const groups =
    segments.length === 2
      ? [...head, ...Array.from({ length: 8 - head.length - tail.length }, () => '0'), ...tail]
      : head;

  if (groups.length !== 8) {
    throw new Error(`${label} must expand to exactly 8 IPv6 groups`);
  }

  const output = Buffer.alloc(16);
  for (const [index, group] of groups.entries()) {
    output.writeUInt16BE(Number.parseInt(group, 16), index * 2);
  }
  return output;
}

export function parseIpAddress(value: unknown, version: 'ipv4' | 'ipv6', label: string): Buffer {
  return version === 'ipv4' ? parseIpv4Address(value, label) : parseIpv6Address(value, label);
}

export function parseEtherType(value: unknown, label: string): number {
  return parseNamedOrNumericValue(value, label, ETHER_TYPE_MAP, 0xffff);
}

export function parseIpProtocol(value: unknown, label: string): number {
  return parseNamedOrNumericValue(value, label, IP_PROTOCOL_MAP, 0xff);
}

export function parsePcapLinkType(value: unknown, label: string): number {
  return parseNamedOrNumericValue(value, label, PCAP_LINK_TYPE_MAP, 0xffffffff);
}

export function parseChecksumEndian(value: unknown): ChecksumEndian {
  return value === 'little' ? 'little' : 'big';
}

export function parsePacketEndianness(value: unknown): PacketEndianness {
  return value === 'big' ? 'big' : 'little';
}

export function parseTimestampPrecision(value: unknown): PacketTimestampPrecision {
  return value === 'nano' ? 'nano' : 'micro';
}

export function parseHexPayload(value: unknown, label: string): Buffer {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a hex string`);
  }
  return Buffer.from(normalizeHexString(value, label), 'hex');
}
