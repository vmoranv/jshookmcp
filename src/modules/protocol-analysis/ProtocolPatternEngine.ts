import { type ProtocolPattern, type ProtocolField, type EncryptionInfo } from './types';

/**
 * Protocol pattern engine: manual definition, auto-detect from payloads,
 * and export to .proto-like schema.
 *
 * Pure Node.js — no external dependencies.
 */
export class ProtocolPatternEngine {
  private patterns: Map<string, ProtocolPattern> = new Map();

  /**
   * Manually define a protocol pattern.
   */
  definePattern(
    name: string,
    fields: ProtocolField[],
    options?: { byteOrder?: 'big' | 'little'; encryption?: EncryptionInfo },
  ): ProtocolPattern {
    const pattern: ProtocolPattern = {
      name,
      fields,
      byteOrder: options?.byteOrder ?? 'big',
      encryption: options?.encryption,
    };
    this.patterns.set(name, pattern);
    return pattern;
  }

  /**
   * Auto-detect protocol pattern from multiple payload samples.
   *
   * Algorithm:
   * 1. Find common prefix/suffix (magic bytes, version, terminator)
   * 2. Identify fixed-offset fields (constant across samples)
   * 3. Detect variable-length sections (string/bytes fields)
   * 4. Find repeating structures (array-like fields)
   * 5. Entropy analysis for encrypted sections
   */
  autoDetectPattern(payloads: Buffer[], options?: { name?: string }): ProtocolPattern {
    if (payloads.length === 0) {
      return this.definePattern(options?.name ?? 'auto_detected', []);
    }

    const fields: ProtocolField[] = [];
    const maxLen = Math.max(...payloads.map((p) => p.length));

    // Step 1: Detect common prefix (magic bytes)
    const prefixLen = this.findCommonPrefixLength(payloads);
    if (prefixLen > 0) {
      const sample = payloads[0] as Buffer;
      const magicBytes = this.extractMagicName(sample.subarray(0, prefixLen));
      if (prefixLen === 1) {
        fields.push({ name: magicBytes ?? 'magic', type: 'uint8', offset: 0, length: 1 });
      } else if (prefixLen === 2) {
        fields.push({ name: magicBytes ?? 'magic', type: 'uint16', offset: 0, length: 2 });
      } else if (prefixLen <= 4) {
        fields.push({ name: magicBytes ?? 'magic', type: 'uint32', offset: 0, length: prefixLen });
      } else {
        fields.push({ name: magicBytes ?? 'magic', type: 'bytes', offset: 0, length: prefixLen });
      }
    }

    // Step 2: Scan for version field (common 1-byte field after magic)
    const afterPrefix = prefixLen;
    if (afterPrefix < maxLen) {
      const versionBytes = payloads.every((p) => {
        const b = p[afterPrefix];
        return b !== undefined && b <= 10;
      });
      if (versionBytes) {
        fields.push({ name: 'version', type: 'uint8', offset: afterPrefix, length: 1 });
      }
    }

    // Step 3: Find fixed-offset fields by analyzing byte variance
    const varianceMap = this.computeByteVariance(payloads, afterPrefix);
    let currentOffset = afterPrefix;
    if (fields.length > 0) {
      currentOffset =
        (fields[fields.length - 1] as ProtocolField).offset +
        (fields[fields.length - 1] as ProtocolField).length;
    }

    for (let offset = currentOffset; offset < maxLen - 1; offset += 1) {
      const entry = varianceMap[offset];
      if (!entry) continue;

      if (entry.variance === 0 && entry.present) {
        // Constant field — likely a flag or constant
        const sample = payloads[0] as Buffer;
        const value = sample[offset] as number;
        const isHighEntropy = this.isLikelyEncryptedByte(value);

        fields.push({
          name: isHighEntropy
            ? `constant_0x${value.toString(16).padStart(2, '0')}`
            : `flags_${offset}`,
          type: 'uint8',
          offset,
          length: 1,
          description: `Constant value 0x${value.toString(16).padStart(2, '0')}`,
        });
      } else if (entry.variance > 0 && entry.variance < 1000 && entry.present) {
        // Variable but bounded — likely uint16/uint32
        const minVal = entry.min;
        const maxVal = entry.max;
        if (maxVal !== undefined && minVal !== undefined) {
          if (maxVal <= 0xff) {
            fields.push({ name: `field_${offset}`, type: 'uint8', offset, length: 1 });
          } else if (maxVal <= 0xffff) {
            fields.push({ name: `field_${offset}`, type: 'uint16', offset, length: 2 });
          } else {
            fields.push({ name: `field_${offset}`, type: 'uint32', offset, length: 4 });
          }
        }
        break; // Found first variable field, stop to avoid over-segmentation
      } else {
        break; // High variance — likely variable-length data starts here
      }
    }

    // Step 4: Check for string/variable-length section
    const stringStart =
      fields.length > 0
        ? (fields[fields.length - 1] as ProtocolField).offset +
          (fields[fields.length - 1] as ProtocolField).length
        : 0;

    if (stringStart < maxLen) {
      const hasStringLike = payloads.some((p) => {
        for (let i = stringStart; i < p.length; i += 1) {
          const b = p[i] as number;
          if (b >= 0x20 && b <= 0x7e) return true;
          if (b === 0x00) return true; // null terminator
        }
        return false;
      });

      if (hasStringLike) {
        const remainingLen = maxLen - stringStart;
        fields.push({
          name: 'data',
          type: 'string',
          offset: stringStart,
          length: remainingLen,
        });
      } else {
        // Check entropy to detect encrypted sections
        const avgEntropy = this.averageEntropy(payloads, stringStart);
        const encryptionDetected = avgEntropy > 7.5;

        if (encryptionDetected) {
          fields.push({
            name: 'encrypted_data',
            type: 'bytes',
            offset: stringStart,
            length: maxLen - stringStart,
            description: `High entropy (${avgEntropy.toFixed(2)}) — likely encrypted`,
          });
        } else {
          fields.push({
            name: 'payload',
            type: 'bytes',
            offset: stringStart,
            length: maxLen - stringStart,
          });
        }
      }
    }

    const name = options?.name ?? 'auto_detected';
    return this.definePattern(name, fields);
  }

  /**
   * Export a pattern to .proto-like schema definition.
   */
  exportProto(pattern: ProtocolPattern): string {
    const lines: string[] = [
      `// Protocol: ${pattern.name}`,
      `// Byte order: ${pattern.byteOrder}`,
      '',
    ];

    if (pattern.encryption) {
      lines.push(`// Encryption: ${pattern.encryption.type}`);
      if (pattern.encryption.notes) {
        lines.push(`// Notes: ${pattern.encryption.notes}`);
      }
      lines.push('');
    }

    lines.push(`message ${this.toPascalCase(pattern.name)} {`);

    for (let i = 0; i < pattern.fields.length; i += 1) {
      const field = pattern.fields[i] as ProtocolField;
      const protoType = this.toProtoType(field.type);
      const comment = field.description ? ` // ${field.description}` : '';
      lines.push(`  ${protoType} ${field.name} = ${i + 1};${comment}`);
    }

    lines.push('}');
    lines.push('');
    return lines.join('\n');
  }

  /**
   * Get a registered pattern by name.
   */
  getPattern(name: string): ProtocolPattern | undefined {
    return this.patterns.get(name);
  }

  /**
   * List all registered pattern names.
   */
  listPatterns(): string[] {
    return Array.from(this.patterns.keys());
  }

  // --- Private helpers ---

  private findCommonPrefixLength(payloads: Buffer[]): number {
    if (payloads.length < 2) return 0;

    const first = payloads[0] as Buffer;
    let len = 0;
    const maxLen = Math.min(...payloads.map((p) => p.length));

    for (let i = 0; i < maxLen; i += 1) {
      const byte = first[i] as number;
      if (payloads.every((p) => (p[i] as number) === byte)) {
        len += 1;
      } else {
        break;
      }
    }
    return len;
  }

  private extractMagicName(bytes: Buffer): string | null {
    // Check for common magic byte sequences
    const hex = bytes.toString('hex');

    const knownMagic: Record<string, string> = {
      '89504e47': 'png_header',
      '47494638': 'gif_header',
      ffd8ff: 'jpeg_header',
      '504b0304': 'zip_header',
      '25504446': 'pdf_header',
      '7f454c46': 'elf_header',
      '4d5a': 'mz_header',
      'cafe babe': 'java_class',
      deadbeef: 'deadbeef',
    };

    for (const [magic, name] of Object.entries(knownMagic)) {
      if (hex.startsWith(magic)) {
        return name;
      }
    }

    return null;
  }

  private computeByteVariance(
    payloads: Buffer[],
    fromOffset: number,
  ): Record<number, { variance: number; min: number; max: number; present: boolean }> {
    const result: Record<number, { variance: number; min: number; max: number; present: boolean }> =
      {};

    const maxLen = Math.min(...payloads.map((p) => p.length));
    for (let offset = fromOffset; offset < maxLen; offset += 1) {
      const values: number[] = [];
      for (const p of payloads) {
        const b = p[offset];
        if (b !== undefined) {
          values.push(b);
        }
      }
      if (values.length === 0) {
        result[offset] = { variance: 0, min: 0, max: 0, present: false };
        continue;
      }

      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      result[offset] = { variance, min, max, present: true };
    }
    return result;
  }

  private isLikelyEncryptedByte(value: number): boolean {
    // Bytes in high-entropy range that don't look like text or common flags
    return value > 0x7e || (value < 0x20 && value !== 0x00 && value !== 0x0a && value !== 0x0d);
  }

  private averageEntropy(payloads: Buffer[], fromOffset: number): number {
    if (payloads.length === 0) return 0;

    let totalEntropy = 0;
    let count = 0;

    for (const p of payloads) {
      if (p.length <= fromOffset) continue;
      const chunk = p.subarray(fromOffset);
      const entropy = this.calculateEntropy(chunk);
      totalEntropy += entropy;
      count += 1;
    }

    return count > 0 ? totalEntropy / count : 0;
  }

  private calculateEntropy(buffer: Buffer): number {
    if (buffer.length === 0) return 0;

    const freq: number[] = Array.from({ length: 256 }, () => 0);
    for (const value of buffer.values()) {
      const idx = value as number;
      freq[idx] = (freq[idx] ?? 0) + 1;
    }

    let entropy = 0;
    for (const count of freq) {
      if (count === 0) continue;
      const prob = count / buffer.length;
      entropy -= prob * Math.log2(prob);
    }

    return entropy;
  }

  private toProtoType(type: ProtocolField['type']): string {
    const map: Record<ProtocolField['type'], string> = {
      uint8: 'uint32',
      uint16: 'uint32',
      uint32: 'uint32',
      int64: 'int64',
      float: 'float',
      string: 'string',
      bytes: 'bytes',
    };
    return map[type] ?? 'bytes';
  }

  private toPascalCase(name: string): string {
    return (
      name
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .split('_')
        .filter(Boolean)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join('') || 'Message'
    );
  }
}
