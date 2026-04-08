import type {
  EncryptionInfo,
  FieldSpec,
  PatternDetectionResult,
  PatternSpec,
  ProtocolField,
  ProtocolPattern,
} from './types';

const PRINTABLE_MIN = 0x20;
const PRINTABLE_MAX = 0x7e;
const DELIMITER_CANDIDATES = [
  Buffer.from([0x2c]),
  Buffer.from([0x7c]),
  Buffer.from([0x3a]),
  Buffer.from([0x3b]),
  Buffer.from([0x09]),
  Buffer.from([0x00]),
  Buffer.from([0x0d, 0x0a]),
];

function normalizeHexPayload(value: string): string {
  return value.replace(/^0x/i, '').replace(/\s+/g, '').toLowerCase();
}

function isHexPayload(value: string): boolean {
  const normalized = normalizeHexPayload(value);
  if (normalized.length === 0 || normalized.length % 2 !== 0) {
    return false;
  }

  return /^[0-9a-f]+$/i.test(normalized);
}

function parseHexPayload(value: string): Buffer | null {
  if (!isHexPayload(value)) {
    return null;
  }

  return Buffer.from(normalizeHexPayload(value), 'hex');
}

function isPrintableByte(value: number): boolean {
  return value >= PRINTABLE_MIN && value <= PRINTABLE_MAX;
}

function printableRatio(buffer: Buffer): number {
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

function averagePrintableRatio(buffers: Buffer[]): number {
  if (buffers.length === 0) {
    return 0;
  }

  const sum = buffers.reduce((accumulator, buffer) => accumulator + printableRatio(buffer), 0);
  return sum / buffers.length;
}

function splitBuffer(buffer: Buffer, delimiter: Buffer): Buffer[] {
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

function bufferToDelimiterString(buffer: Buffer): string {
  return printableRatio(buffer) === 1 ? buffer.toString('utf8') : buffer.toString('hex');
}

export class ProtocolPatternEngine {
  private readonly patterns = new Map<string, PatternSpec>();

  private readonly legacyPatterns = new Map<string, ProtocolPattern>();

  definePattern(name: string, spec: PatternSpec): void;
  definePattern(
    name: string,
    fields: ProtocolField[],
    options?: { byteOrder?: 'big' | 'little'; encryption?: EncryptionInfo },
  ): ProtocolPattern;
  definePattern(
    name: string,
    specOrFields: PatternSpec | ProtocolField[],
    options?: { byteOrder?: 'big' | 'little'; encryption?: EncryptionInfo },
  ): ProtocolPattern | void {
    const legacyPattern = Array.isArray(specOrFields)
      ? this.createLegacyPattern(name, specOrFields, options)
      : this.createLegacyPatternFromSpec(name, specOrFields);
    const spec = this.createSpecFromLegacyPattern(legacyPattern);

    this.patterns.set(name, spec);
    this.legacyPatterns.set(name, legacyPattern);

    if (Array.isArray(specOrFields)) {
      return legacyPattern;
    }
  }

  detectPattern(hexPayload: string): PatternDetectionResult | null {
    const payload = parseHexPayload(hexPayload);
    if (!payload) {
      return null;
    }

    let bestMatch: PatternDetectionResult | null = null;

    for (const pattern of this.patterns.values()) {
      const totalChecks = pattern.fields.length + (pattern.fieldDelimiter ? 1 : 0);
      if (totalChecks === 0) {
        continue;
      }

      let matches = 0;
      if (
        pattern.fieldDelimiter &&
        this.payloadContainsDelimiter(payload, pattern.fieldDelimiter)
      ) {
        matches += 1;
      }

      for (const field of pattern.fields) {
        if (this.matchesField(payload, field, pattern.byteOrder ?? 'be')) {
          matches += 1;
        }
      }

      const confidence = Number((matches / totalChecks).toFixed(2));
      if (confidence <= 0) {
        continue;
      }

      const candidate: PatternDetectionResult = {
        pattern,
        confidence,
        matches,
        total: totalChecks,
      };

      if (
        !bestMatch ||
        candidate.confidence > bestMatch.confidence ||
        (candidate.confidence === bestMatch.confidence && candidate.matches > bestMatch.matches)
      ) {
        bestMatch = candidate;
      }
    }

    return bestMatch;
  }

  autoDetect(hexPayloads: string[]): PatternSpec | null {
    const buffers = this.parsePayloads(hexPayloads);
    if (buffers.length === 0) {
      return null;
    }

    const delimiter = this.inferDelimiter(buffers);
    const fields = this.inferFields(hexPayloads);

    return {
      name: 'auto-detected-pattern',
      fieldDelimiter: delimiter,
      byteOrder: this.inferByteOrder(buffers),
      fields,
    };
  }

  inferFields(hexPayloads: string[]): FieldSpec[] {
    const buffers = this.parsePayloads(hexPayloads);
    if (buffers.length === 0) {
      return [];
    }

    const delimiter = this.inferDelimiter(buffers);
    if (delimiter) {
      const delimiterBuffer = this.parseDelimiter(delimiter);
      const fields = this.buildDelimitedFields(buffers, delimiterBuffer);
      if (fields.length > 0) {
        return this.labelMagicFields(fields, buffers);
      }
    }

    return this.labelMagicFields(this.buildFixedWidthFields(buffers), buffers);
  }

  autoDetectPattern(payloads: Buffer[], options?: { name?: string }): ProtocolPattern {
    const hexPayloads = payloads.map((payload) => payload.toString('hex'));
    const detected = this.autoDetect(hexPayloads);
    const name = options?.name ?? detected?.name ?? 'auto_detected';

    if (!detected) {
      const emptyPattern = this.createLegacyPattern(name, []);
      this.patterns.set(name, this.createSpecFromLegacyPattern(emptyPattern));
      this.legacyPatterns.set(name, emptyPattern);
      return emptyPattern;
    }

    const namedPattern: PatternSpec = { ...detected, name };
    this.definePattern(name, namedPattern);
    return this.getPattern(name) ?? this.createLegacyPatternFromSpec(name, namedPattern);
  }

  getPattern(name: string): ProtocolPattern | undefined {
    return this.legacyPatterns.get(name);
  }

  listPatterns(): string[] {
    return [...this.patterns.keys()];
  }

  exportProto(pattern: PatternSpec | ProtocolPattern): string {
    const legacyPattern = this.isLegacyPattern(pattern)
      ? pattern
      : this.createLegacyPatternFromSpec(pattern.name, pattern);
    const lines: string[] = [
      `// Protocol: ${legacyPattern.name}`,
      `// Byte order: ${legacyPattern.byteOrder}`,
      '',
    ];

    if (legacyPattern.encryption) {
      lines.push(`// Encryption: ${legacyPattern.encryption.type}`);
      if (legacyPattern.encryption.notes) {
        lines.push(`// Notes: ${legacyPattern.encryption.notes}`);
      }
      lines.push('');
    }

    lines.push(`message ${this.toPascalCase(legacyPattern.name)} {`);
    for (let index = 0; index < legacyPattern.fields.length; index += 1) {
      const field = legacyPattern.fields[index];
      if (!field) {
        continue;
      }

      const comment = field.description ? ` // ${field.description}` : '';
      lines.push(`  ${this.toProtoType(field.type)} ${field.name} = ${index + 1};${comment}`);
    }

    lines.push('}');
    lines.push('');
    return lines.join('\n');
  }

  private parsePayloads(hexPayloads: string[]): Buffer[] {
    const buffers: Buffer[] = [];
    for (const hexPayload of hexPayloads) {
      const payload = parseHexPayload(hexPayload);
      if (payload) {
        buffers.push(payload);
      }
    }

    return buffers;
  }

  private labelMagicFields(fields: FieldSpec[], buffers: Buffer[]): FieldSpec[] {
    if (fields.length === 0 || buffers.length < 2) {
      return fields;
    }

    // Find the leading common-byte prefix length across all buffers
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

    // Label first field as "magic" when it starts at offset 0 and overlaps the common prefix
    let magicLabelApplied = false;
    return fields.map((field) => {
      if (!magicLabelApplied && field.offset === 0 && commonPrefixLen >= 2) {
        magicLabelApplied = true;
        return { ...field, name: 'magic' };
      }

      // The field right after the common prefix that looks like a version (small int, 1-2 bytes)
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

  private createLegacyPattern(
    name: string,
    fields: ProtocolField[],
    options?: { byteOrder?: 'big' | 'little'; encryption?: EncryptionInfo },
  ): ProtocolPattern {
    return {
      name,
      fields: fields
        .map((field) => ({
          name: field.name,
          offset: field.offset,
          length: field.length,
          type: field.type,
          ...(field.description ? { description: field.description } : {}),
        }))
        .toSorted((left, right) => left.offset - right.offset),
      byteOrder: options?.byteOrder ?? 'big',
      ...(options?.encryption ? { encryption: options.encryption } : {}),
    };
  }

  private createLegacyPatternFromSpec(name: string, spec: PatternSpec): ProtocolPattern {
    return {
      name,
      fieldDelimiter: spec.fieldDelimiter,
      byteOrder: spec.byteOrder === 'le' ? 'little' : 'big',
      fields: spec.fields.map((field) => ({
        name: field.name,
        offset: field.offset,
        length: field.length,
        type: this.toLegacyFieldType(field),
        ...(field.description ? { description: field.description } : {}),
      })),
    };
  }

  private createSpecFromLegacyPattern(pattern: ProtocolPattern): PatternSpec {
    return {
      name: pattern.name,
      fieldDelimiter: pattern.fieldDelimiter,
      byteOrder: pattern.byteOrder === 'little' ? 'le' : 'be',
      fields: pattern.fields.map((field) => ({
        name: field.name,
        offset: field.offset,
        length: field.length,
        type: this.toSpecFieldType(field.type),
        ...(field.description ? { description: field.description } : {}),
      })),
    };
  }

  private isLegacyPattern(pattern: PatternSpec | ProtocolPattern): pattern is ProtocolPattern {
    return pattern.byteOrder === 'big' || pattern.byteOrder === 'little';
  }

  private toLegacyFieldType(field: FieldSpec): ProtocolField['type'] {
    if (field.type === 'float') {
      return 'float';
    }

    if (field.type === 'string') {
      return 'string';
    }

    if (field.type === 'bytes') {
      return 'bytes';
    }

    if (field.length === 1) {
      return 'uint8';
    }

    if (field.length === 2) {
      return 'uint16';
    }

    if (field.length === 4) {
      return 'uint32';
    }

    return 'int64';
  }

  private toSpecFieldType(fieldType: ProtocolField['type']): FieldSpec['type'] {
    if (fieldType === 'float') {
      return 'float';
    }

    if (fieldType === 'string') {
      return 'string';
    }

    if (fieldType === 'bytes') {
      return 'bytes';
    }

    return 'int';
  }

  private parseDelimiter(delimiter: string): Buffer {
    if (isHexPayload(delimiter)) {
      const parsed = parseHexPayload(delimiter);
      if (parsed) {
        return parsed;
      }
    }

    return Buffer.from(delimiter, 'utf8');
  }

  private payloadContainsDelimiter(payload: Buffer, delimiter: string): boolean {
    const delimiterBuffer = this.parseDelimiter(delimiter);
    if (delimiterBuffer.length === 0) {
      return false;
    }

    return payload.includes(delimiterBuffer);
  }

  private matchesField(payload: Buffer, field: FieldSpec, byteOrder: 'le' | 'be'): boolean {
    if (field.offset < 0 || field.length <= 0 || payload.length < field.offset + field.length) {
      return false;
    }

    const slice = payload.subarray(field.offset, field.offset + field.length);
    switch (field.type) {
      case 'bytes':
        return slice.length === field.length;
      case 'bool':
        return slice.length === 1 && (slice[0] === 0 || slice[0] === 1);
      case 'string':
        return printableRatio(slice) >= 0.6;
      case 'int':
        return this.decodeInteger(slice, byteOrder) !== null;
      case 'float':
        return this.decodeFloat(slice, byteOrder) !== null;
      default:
        return false;
    }
  }

  private decodeInteger(buffer: Buffer, byteOrder: 'le' | 'be'): number | null {
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

  private decodeFloat(buffer: Buffer, byteOrder: 'le' | 'be'): number | null {
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

  private inferDelimiter(buffers: Buffer[]): string | undefined {
    for (const candidate of DELIMITER_CANDIDATES) {
      const counts = buffers.map((buffer) => this.countOccurrences(buffer, candidate));
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

  private countOccurrences(buffer: Buffer, delimiter: Buffer): number {
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

  private buildDelimitedFields(buffers: Buffer[], delimiter: Buffer): FieldSpec[] {
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
        type: this.inferFieldType(samples),
      });
      currentOffset += template.length + delimiter.length;
    }

    return fields;
  }

  private buildFixedWidthFields(buffers: Buffer[]): FieldSpec[] {
    const minLength = Math.min(...buffers.map((buffer) => buffer.length));
    const fields: FieldSpec[] = [];
    let offset = 0;

    while (offset < minLength && fields.length < 24) {
      if (this.isPrintableColumn(buffers, offset)) {
        let end = offset + 1;
        while (end < minLength && this.isPrintableColumn(buffers, end)) {
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

      if (this.isBooleanColumn(buffers, offset)) {
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
        if (this.looksLikeFloatSamples(floatSamples)) {
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
        type: this.inferFieldType(samples),
      });
      offset += segmentLength;
    }

    return fields;
  }

  private inferFieldType(samples: Buffer[]): FieldSpec['type'] {
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

    if (samples.every((sample) => sample.length === 4) && this.looksLikeFloatSamples(samples)) {
      return 'float';
    }

    if (samples.every((sample) => sample.length <= 4)) {
      return 'int';
    }

    return 'bytes';
  }

  private isPrintableColumn(buffers: Buffer[], offset: number): boolean {
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

  private isBooleanColumn(buffers: Buffer[], offset: number): boolean {
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

  private looksLikeFloatSamples(samples: Buffer[]): boolean {
    const decoded: number[] = [];
    for (const sample of samples) {
      const value = this.decodeFloat(sample, 'be');
      if (value === null) {
        return false;
      }

      decoded.push(value);
    }

    return decoded.some((value) => Math.abs(value) > 0.001 && Math.abs(value) < 1_000_000);
  }

  private inferByteOrder(buffers: Buffer[]): 'le' | 'be' {
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

  private toProtoType(type: ProtocolField['type']): string {
    const protoTypes: Record<ProtocolField['type'], string> = {
      uint8: 'uint32',
      uint16: 'uint32',
      uint32: 'uint32',
      int64: 'int64',
      float: 'float',
      string: 'string',
      bytes: 'bytes',
    };

    return protoTypes[type];
  }

  private toPascalCase(name: string): string {
    return (
      name
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('') || 'Message'
    );
  }
}
