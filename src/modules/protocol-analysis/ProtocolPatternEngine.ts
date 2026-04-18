import type {
  EncryptionInfo,
  FieldSpec,
  PatternDetectionResult,
  PatternSpec,
  ProtocolField,
  ProtocolPattern,
} from './types';
import {
  buildDelimitedFields,
  buildFixedWidthFields,
  decodeFloat,
  decodeInteger,
  inferByteOrder,
  inferDelimiter,
  isHexPayload,
  labelMagicFields,
  parseHexPayload,
  parsePayloads,
  printableRatio,
} from './ProtocolPatternUtils';

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
    const buffers = parsePayloads(hexPayloads);
    if (buffers.length === 0) {
      return null;
    }

    const delimiter = inferDelimiter(buffers);
    const fields = this.inferFields(hexPayloads);

    return {
      name: 'auto-detected-pattern',
      fieldDelimiter: delimiter,
      byteOrder: inferByteOrder(buffers),
      fields,
    };
  }

  inferFields(hexPayloads: string[]): FieldSpec[] {
    const buffers = parsePayloads(hexPayloads);
    if (buffers.length === 0) {
      return [];
    }

    const delimiter = inferDelimiter(buffers);
    if (delimiter) {
      const delimiterBuffer = this.parseDelimiter(delimiter);
      const fields = buildDelimitedFields(buffers, delimiterBuffer);
      if (fields.length > 0) {
        return labelMagicFields(fields, buffers);
      }
    }

    return labelMagicFields(buildFixedWidthFields(buffers), buffers);
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
        return decodeInteger(slice, byteOrder) !== null;
      case 'float':
        return decodeFloat(slice, byteOrder) !== null;
      default:
        return false;
    }
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
    if (field.type === 'float') return 'float';
    if (field.type === 'string') return 'string';
    if (field.type === 'bytes') return 'bytes';
    if (field.length === 1) return 'uint8';
    if (field.length === 2) return 'uint16';
    if (field.length === 4) return 'uint32';
    return 'int64';
  }

  private toSpecFieldType(fieldType: ProtocolField['type']): FieldSpec['type'] {
    if (fieldType === 'float') return 'float';
    if (fieldType === 'string') return 'string';
    if (fieldType === 'bytes') return 'bytes';
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
