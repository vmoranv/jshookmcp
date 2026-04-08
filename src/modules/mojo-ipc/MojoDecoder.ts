export interface DecodedPayload {
  header: {
    version: number;
    flags: number;
    messageType: number;
    numFields: number;
    handles: number;
  };
  fields: Record<string, unknown>;
  handles: number;
  raw: string;
  _raw_summary?: string;
}

interface HandleField {
  handle: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const FIELD_TYPE_BOOL = 0x01;
const FIELD_TYPE_INT32 = 0x06;
const FIELD_TYPE_UINT32 = 0x08;
const FIELD_TYPE_STRING = 0x0c;
const FIELD_TYPE_HANDLE = 0x10;

function isHandleField(value: unknown): value is HandleField {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value['handle'] === 'number';
}

function normalizeHexInput(hex: string): string {
  const cleaned = hex.replace(/\s+/g, '');
  if (cleaned.length % 2 === 0) {
    return cleaned.toLowerCase();
  }

  return `0${cleaned.toLowerCase()}`;
}

export class MojoDecoder {
  decodePayload(hex: string, context?: string): DecodedPayload {
    const raw = this.cleanHex(hex);
    const bytes = Buffer.from(raw, 'hex');

    const version = this.readUInt8(bytes, 0);
    const flags = this.readUInt8(bytes, 1);
    const messageType = this.readUInt8(bytes, 2);
    const numFields = this.readUInt8(bytes, 3);
    const declaredHandles = this.readUInt16LE(bytes, 4);

    const fields: Record<string, unknown> = {};
    const summaryParts: string[] = [];
    let cursor = 6;
    let actualHandles = 0;

    for (let index = 0; index < numFields; index += 1) {
      if (cursor >= bytes.length) {
        summaryParts.push('payload ended before all fields were decoded');
        break;
      }

      const typeCode = this.readUInt8(bytes, cursor);
      cursor += 1;

      const fieldName = `field${index}`;

      if (typeCode === FIELD_TYPE_BOOL) {
        if (!this.hasBytes(bytes, cursor, 1)) {
          summaryParts.push(`${fieldName} truncated`);
          break;
        }

        fields[fieldName] = this.readUInt8(bytes, cursor) !== 0;
        cursor += 1;
        continue;
      }

      if (typeCode === FIELD_TYPE_INT32) {
        if (!this.hasBytes(bytes, cursor, 4)) {
          summaryParts.push(`${fieldName} truncated`);
          break;
        }

        fields[fieldName] = bytes.readInt32LE(cursor);
        cursor += 4;
        continue;
      }

      if (typeCode === FIELD_TYPE_UINT32) {
        if (!this.hasBytes(bytes, cursor, 4)) {
          summaryParts.push(`${fieldName} truncated`);
          break;
        }

        fields[fieldName] = bytes.readUInt32LE(cursor);
        cursor += 4;
        continue;
      }

      if (typeCode === FIELD_TYPE_STRING) {
        if (!this.hasBytes(bytes, cursor, 2)) {
          summaryParts.push(`${fieldName} length prefix truncated`);
          break;
        }

        const length = this.readUInt16LE(bytes, cursor);
        cursor += 2;

        if (!this.hasBytes(bytes, cursor, length)) {
          summaryParts.push(`${fieldName} string data truncated`);
          break;
        }

        fields[fieldName] = bytes.subarray(cursor, cursor + length).toString('utf8');
        cursor += length;
        continue;
      }

      if (typeCode === FIELD_TYPE_HANDLE) {
        if (!this.hasBytes(bytes, cursor, 4)) {
          summaryParts.push(`${fieldName} handle truncated`);
          break;
        }

        const handleId = bytes.readUInt32LE(cursor);
        fields[fieldName] = { handle: handleId };
        actualHandles += 1;
        cursor += 4;
        continue;
      }

      summaryParts.push(`unknown field type 0x${typeCode.toString(16).padStart(2, '0')}`);
      break;
    }

    const summary =
      summaryParts.length > 0
        ? summaryParts.join('; ')
        : this.buildSummary(context, Object.keys(fields).length, numFields, actualHandles);

    return {
      header: {
        version,
        flags,
        messageType,
        numFields,
        handles: declaredHandles,
      },
      fields,
      handles: actualHandles,
      raw,
      _raw_summary: summary,
    };
  }

  encodeMessage(interfaceName: string, messageType: string, fields: unknown[]): string {
    const encodedParts: Buffer[] = [];
    let handles = 0;

    for (const field of fields) {
      if (typeof field === 'boolean') {
        encodedParts.push(Buffer.from([FIELD_TYPE_BOOL, field ? 1 : 0]));
        continue;
      }

      if (typeof field === 'number' && Number.isInteger(field) && field >= 0) {
        const chunk = Buffer.alloc(5);
        chunk.writeUInt8(FIELD_TYPE_UINT32, 0);
        chunk.writeUInt32LE(field, 1);
        encodedParts.push(chunk);
        continue;
      }

      if (typeof field === 'number' && Number.isInteger(field)) {
        const chunk = Buffer.alloc(5);
        chunk.writeUInt8(FIELD_TYPE_INT32, 0);
        chunk.writeInt32LE(field, 1);
        encodedParts.push(chunk);
        continue;
      }

      if (isHandleField(field)) {
        const chunk = Buffer.alloc(5);
        chunk.writeUInt8(FIELD_TYPE_HANDLE, 0);
        chunk.writeUInt32LE(field.handle, 1);
        encodedParts.push(chunk);
        handles += 1;
        continue;
      }

      const text = typeof field === 'string' ? field : JSON.stringify(field);
      const textBuffer = Buffer.from(text, 'utf8');
      const header = Buffer.alloc(3);
      header.writeUInt8(FIELD_TYPE_STRING, 0);
      header.writeUInt16LE(textBuffer.length, 1);
      encodedParts.push(header, textBuffer);
    }

    const messageTypeCode = this.resolveMessageType(interfaceName, messageType);
    const fieldCount = Math.min(fields.length, 255);
    const header = Buffer.alloc(6);
    header.writeUInt8(1, 0);
    header.writeUInt8(0, 1);
    header.writeUInt8(messageTypeCode, 2);
    header.writeUInt8(fieldCount, 3);
    header.writeUInt16LE(handles, 4);

    return Buffer.concat([header, ...encodedParts]).toString('hex');
  }

  cleanHex(hex: string): string {
    return normalizeHexInput(hex);
  }

  private resolveMessageType(interfaceName: string, messageType: string): number {
    const decimalMatch = /^[0-9]+$/.test(messageType);
    if (decimalMatch) {
      return Number.parseInt(messageType, 10) & 0xff;
    }

    const hexMatch = /^0x[0-9a-f]+$/i.test(messageType);
    if (hexMatch) {
      return Number.parseInt(messageType.slice(2), 16) & 0xff;
    }

    let hash = 0;
    const seed = `${interfaceName}:${messageType}`;
    for (const char of seed) {
      hash = (hash * 31 + char.charCodeAt(0)) & 0xff;
    }

    return hash;
  }

  private buildSummary(
    context: string | undefined,
    decodedFields: number,
    declaredFields: number,
    handles: number,
  ): string {
    const prefix = context ? `${context}: ` : '';
    return `${prefix}decoded ${decodedFields}/${declaredFields} fields, ${handles} handle(s)`;
  }

  private readUInt8(bytes: Buffer, offset: number): number {
    if (!this.hasBytes(bytes, offset, 1)) {
      return 0;
    }

    return bytes.readUInt8(offset);
  }

  private readUInt16LE(bytes: Buffer, offset: number): number {
    if (!this.hasBytes(bytes, offset, 2)) {
      return 0;
    }

    return bytes.readUInt16LE(offset);
  }

  private hasBytes(bytes: Buffer, offset: number, length: number): boolean {
    return offset >= 0 && length >= 0 && offset + length <= bytes.length;
  }
}
