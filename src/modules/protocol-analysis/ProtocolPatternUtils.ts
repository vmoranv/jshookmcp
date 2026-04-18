import type { FieldSpec } from './types';

const PRINTABLE_MIN = 0x20;
const PRINTABLE_MAX = 0x7e;

export const DELIMITER_CANDIDATES = [
  Buffer.from([0x2c]),
  Buffer.from([0x7c]),
  Buffer.from([0x3a]),
  Buffer.from([0x3b]),
  Buffer.from([0x09]),
  Buffer.from([0x00]),
  Buffer.from([0x0d, 0x0a]),
];

export function normalizeHexPayload(value: string): string {
  return value.replace(/^0x/i, '').replace(/\s+/g, '').toLowerCase();
}

export function isHexPayload(value: string): boolean {
  const normalized = normalizeHexPayload(value);
  if (normalized.length === 0 || normalized.length % 2 !== 0) {
    return false;
  }

  return /^[0-9a-f]+$/i.test(normalized);
}

export function parseHexPayload(value: string): Buffer | null {
  if (!isHexPayload(value)) {
    return null;
  }

  return Buffer.from(normalizeHexPayload(value), 'hex');
}

export function isPrintableByte(value: number): boolean {
  return value >= PRINTABLE_MIN && value <= PRINTABLE_MAX;
}

export function printableRatio(buffer: Buffer): number {
  if (buffer.length === 0) {
    return 0;
  }

  let printableCount = 0;
  for (const value of buffer.values()) {
    if (isPrintableByte(value)) {
      printableCount += 1;
    }
  }

  return printableCount / buffer.length;
}

export function averagePrintableRatio(buffers: Buffer[]): number {
  if (buffers.length === 0) {
    return 0;
  }

  const sum = buffers.reduce((accumulator, buffer) => accumulator + printableRatio(buffer), 0);
  return sum / buffers.length;
}

export function splitBuffer(buffer: Buffer, delimiter: Buffer): Buffer[] {
  if (delimiter.length === 0) {
    return [buffer];
  }

  const parts: Buffer[] = [];
  let start = 0;
  let index = buffer.indexOf(delimiter, start);

  while (index >= 0) {
    parts.push(buffer.subarray(start, index));
    start = index + delimiter.length;
    index = buffer.indexOf(delimiter, start);
  }

  parts.push(buffer.subarray(start));
  return parts;
}

export function bufferToDelimiterString(buffer: Buffer): string {
  return printableRatio(buffer) === 1 ? buffer.toString('utf8') : buffer.toString('hex');
}

export function parsePayloads(hexPayloads: string[]): Buffer[] {
  const buffers: Buffer[] = [];
  for (const hexPayload of hexPayloads) {
    const payload = parseHexPayload(hexPayload);
    if (payload) {
      buffers.push(payload);
    }
  }

  return buffers;
}

export function decodeInteger(buffer: Buffer, byteOrder: 'le' | 'be'): number | null {
  if (buffer.length === 0) {
    return null;
  }

  if (buffer.length === 1) {
    return buffer.readUInt8(0);
  }

  if (buffer.length === 2) {
    return byteOrder === 'le' ? buffer.readUInt16LE(0) : buffer.readUInt16BE(0);
  }

  if (buffer.length === 4) {
    return byteOrder === 'le' ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0);
  }

  if (buffer.length === 8) {
    const value =
      byteOrder === 'le' ? Number(buffer.readBigUInt64LE(0)) : Number(buffer.readBigUInt64BE(0));
    return Number.isFinite(value) ? value : null;
  }

  let value = 0;
  const bytes = byteOrder === 'le' ? [...buffer.values()].toReversed() : [...buffer.values()];
  for (const byte of bytes) {
    value = value * 256 + byte;
  }

  return Number.isFinite(value) ? value : null;
}

export function decodeFloat(buffer: Buffer, byteOrder: 'le' | 'be'): number | null {
  if (buffer.length === 4) {
    const value = byteOrder === 'le' ? buffer.readFloatLE(0) : buffer.readFloatBE(0);
    return Number.isFinite(value) ? value : null;
  }

  if (buffer.length === 8) {
    const value = byteOrder === 'le' ? buffer.readDoubleLE(0) : buffer.readDoubleBE(0);
    return Number.isFinite(value) ? value : null;
  }

  return null;
}

export function countOccurrences(buffer: Buffer, delimiter: Buffer): number {
  if (delimiter.length === 0) {
    return 0;
  }

  let count = 0;
  let start = 0;
  let index = buffer.indexOf(delimiter, start);
  while (index >= 0) {
    count += 1;
    start = index + delimiter.length;
    index = buffer.indexOf(delimiter, start);
  }

  return count;
}

export function inferFieldType(samples: Buffer[]): FieldSpec['type'] {
  if (samples.length === 0) {
    return 'bytes';
  }

  if (
    samples.every((sample) => sample.length === 1) &&
    samples.every((sample) => sample[0] === 0 || sample[0] === 1)
  ) {
    return 'bool';
  }

  if (averagePrintableRatio(samples) >= 0.7) {
    return 'string';
  }

  if (samples.every((sample) => sample.length === 4) && looksLikeFloatSamples(samples)) {
    return 'float';
  }

  if (samples.every((sample) => sample.length <= 4)) {
    return 'int';
  }

  return 'bytes';
}

export function looksLikeFloatSamples(samples: Buffer[]): boolean {
  const decoded: number[] = [];
  for (const sample of samples) {
    const value = decodeFloat(sample, 'be');
    if (value === null) {
      return false;
    }

    decoded.push(value);
  }

  return decoded.some((value) => Math.abs(value) > 0.001 && Math.abs(value) < 1_000_000);
}

export function isPrintableColumn(buffers: Buffer[], offset: number): boolean {
  let valueCount = 0;
  let printableCount = 0;
  for (const buffer of buffers) {
    const value = buffer[offset];
    if (value === undefined) {
      continue;
    }

    valueCount += 1;
    if (isPrintableByte(value)) {
      printableCount += 1;
    }
  }

  return valueCount > 0 && printableCount / valueCount >= 0.8;
}

export function isBooleanColumn(buffers: Buffer[], offset: number): boolean {
  let valueCount = 0;
  for (const buffer of buffers) {
    const value = buffer[offset];
    if (value === undefined) {
      continue;
    }

    valueCount += 1;
    if (value !== 0 && value !== 1) {
      return false;
    }
  }

  return valueCount > 0;
}

export function buildDelimitedFields(buffers: Buffer[], delimiter: Buffer): FieldSpec[] {
  if (delimiter.length === 0) {
    return [];
  }

  const tokenized = buffers.map((buffer) => splitBuffer(buffer, delimiter));
  const firstRow = tokenized[0];
  if (!firstRow || firstRow.length < 2) {
    return [];
  }

  const tokenCount = firstRow.length;
  if (!tokenized.every((parts) => parts.length === tokenCount)) {
    return [];
  }

  const fields: FieldSpec[] = [];
  let currentOffset = 0;
  for (let index = 0; index < tokenCount; index += 1) {
    const template = firstRow[index];
    if (!template) {
      continue;
    }

    const samples = tokenized
      .map((parts) => parts[index])
      .filter((part): part is Buffer => Buffer.isBuffer(part));

    fields.push({
      name: `field_${index + 1}`,
      offset: currentOffset,
      length: template.length,
      type: inferFieldType(samples),
    });
    currentOffset += template.length + delimiter.length;
  }

  return fields;
}

export function buildFixedWidthFields(buffers: Buffer[]): FieldSpec[] {
  const minLength = Math.min(...buffers.map((buffer) => buffer.length));
  const fields: FieldSpec[] = [];
  let offset = 0;

  while (offset < minLength && fields.length < 24) {
    if (isPrintableColumn(buffers, offset)) {
      let end = offset + 1;
      while (end < minLength && isPrintableColumn(buffers, end)) {
        end += 1;
      }

      fields.push({
        name: `field_${fields.length + 1}`,
        offset,
        length: end - offset,
        type: 'string',
      });
      offset = end;
      continue;
    }

    if (isBooleanColumn(buffers, offset)) {
      fields.push({
        name: `field_${fields.length + 1}`,
        offset,
        length: 1,
        type: 'bool',
      });
      offset += 1;
      continue;
    }

    const remaining = minLength - offset;
    if (remaining >= 4) {
      const floatSamples = buffers.map((buffer) => buffer.subarray(offset, offset + 4));
      if (looksLikeFloatSamples(floatSamples)) {
        fields.push({
          name: `field_${fields.length + 1}`,
          offset,
          length: 4,
          type: 'float',
        });
        offset += 4;
        continue;
      }
    }

    const segmentLength = remaining >= 4 ? 4 : Math.min(remaining, 2);
    const samples = buffers.map((buffer) => buffer.subarray(offset, offset + segmentLength));
    fields.push({
      name: `field_${fields.length + 1}`,
      offset,
      length: segmentLength,
      type: inferFieldType(samples),
    });
    offset += segmentLength;
  }

  return fields;
}

export function inferDelimiter(buffers: Buffer[]): string | undefined {
  for (const candidate of DELIMITER_CANDIDATES) {
    const counts = buffers.map((buffer) => countOccurrences(buffer, candidate));
    const firstCount = counts[0];
    if (
      typeof firstCount === 'number' &&
      firstCount >= 2 &&
      counts.every((count) => count === firstCount)
    ) {
      return bufferToDelimiterString(candidate);
    }
  }

  return undefined;
}

export function inferByteOrder(buffers: Buffer[]): 'le' | 'be' {
  const minLength = Math.min(...buffers.map((buffer) => buffer.length));
  if (minLength < 2) {
    return 'be';
  }

  let leScore = 0;
  let beScore = 0;
  const limit = Math.min(minLength - 1, 8);

  for (let offset = 0; offset < limit; offset += 2) {
    let leSmallValues = 0;
    let beSmallValues = 0;

    for (const buffer of buffers) {
      const little = buffer.readUInt16LE(offset);
      const big = buffer.readUInt16BE(offset);
      if (little < 4096) {
        leSmallValues += 1;
      }
      if (big < 4096) {
        beSmallValues += 1;
      }
    }

    if (leSmallValues > beSmallValues) {
      leScore += 1;
    } else if (beSmallValues > leSmallValues) {
      beScore += 1;
    }
  }

  return leScore > beScore ? 'le' : 'be';
}

export function labelMagicFields(fields: FieldSpec[], buffers: Buffer[]): FieldSpec[] {
  if (fields.length === 0 || buffers.length < 2) {
    return fields;
  }

  const minLen = Math.min(...buffers.map((b) => b.length));
  let commonPrefixLen = 0;
  for (let offset = 0; offset < minLen; offset += 1) {
    const byte = buffers[0]![offset];
    if (buffers.every((b) => b[offset] === byte)) {
      commonPrefixLen = offset + 1;
    } else {
      break;
    }
  }

  if (commonPrefixLen === 0) {
    return fields;
  }

  let magicLabelApplied = false;
  return fields.map((field) => {
    if (!magicLabelApplied && field.offset === 0 && commonPrefixLen >= 2) {
      magicLabelApplied = true;
      return { ...field, name: 'magic' };
    }

    if (
      magicLabelApplied &&
      field.type === 'int' &&
      field.length <= 2 &&
      field.offset <= commonPrefixLen
    ) {
      return { ...field, name: 'version' };
    }

    return field;
  });
}
