/**
 * Android Binary XML (AXML) Parser
 * Decodes binary AndroidManifest.xml from APK files without JADX dependency.
 *
 * Format spec reference:
 * - https://github.com/rednaga/axmlprinter
 * - Android source: frameworks/base/libs/androidfw/ResourceTypes.cpp
 *
 * AXML Structure:
 * - Header (magic 0x00080003 for XML)
 * - String Pool Chunk (0x001C0001)
 * - Resource Map Chunk (0x00080180) [optional]
 * - XML Chunks (START_TAG 0x00100102, END_TAG 0x00100103, TEXT 0x00100104)
 */

interface AxmlHeader {
  chunkType: number;
  chunkSize: number;
  fileSize: number;
}

interface StringPool {
  strings: string[];
  styleOffsets: number[];
}

interface XmlAttribute {
  namespace: string;
  name: string;
  rawValue: string;
  typedValue: { type: number; data: number };
}

interface XmlEvent {
  type: 'start' | 'end' | 'text';
  namespace?: string;
  name?: string;
  text?: string;
  attributes?: XmlAttribute[];
  _lineNumber?: number;
}

const CHUNK_TYPE = {
  XML: 0x00080003,
  STRING_POOL: 0x001c0001,
  RESOURCE_MAP: 0x00080180,
  XML_START_NAMESPACE: 0x00100100,
  XML_END_NAMESPACE: 0x00100101,
  XML_START_TAG: 0x00100102,
  XML_END_TAG: 0x00100103,
  XML_TEXT: 0x00100104,
} as const;

const VALUE_TYPE = {
  NULL: 0x00,
  REFERENCE: 0x01,
  ATTRIBUTE: 0x02,
  STRING: 0x03,
  FLOAT: 0x04,
  DIMENSION: 0x05,
  FRACTION: 0x06,
  INT_DEC: 0x10,
  INT_HEX: 0x11,
  INT_BOOLEAN: 0x12,
} as const;

export class AxmlParser {
  private buffer: Buffer;
  private offset = 0;
  private stringPool: StringPool = { strings: [], styleOffsets: [] };
  private namespaceMap = new Map<number, string>();

  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  /**
   * Parse binary AXML and return XML string.
   * @throws {Error} if buffer is not valid AXML format
   */
  parse(): string {
    const header = this.readHeader();
    if (header.chunkType !== CHUNK_TYPE.XML) {
      throw new Error(
        `Invalid AXML header: expected 0x${CHUNK_TYPE.XML.toString(16)}, got 0x${header.chunkType.toString(16)}`,
      );
    }

    // Read string pool (required)
    const poolChunkType = this.readUInt32();
    if (poolChunkType !== CHUNK_TYPE.STRING_POOL) {
      throw new Error(
        `Expected STRING_POOL chunk (0x${CHUNK_TYPE.STRING_POOL.toString(16)}), got 0x${poolChunkType.toString(16)}`,
      );
    }
    this.offset -= 4; // rewind for full chunk read
    this.stringPool = this.readStringPool();

    // Read optional resource map
    if (this.offset < this.buffer.length) {
      const nextChunk = this.peekUInt32();
      if (nextChunk === CHUNK_TYPE.RESOURCE_MAP) {
        this.readUInt32(); // consume chunk type
        this.readResourceMap(); // consume but not used in output
      }
    }

    // Parse XML events
    const events: XmlEvent[] = [];
    while (this.offset < this.buffer.length) {
      const chunkStart = this.offset;
      const chunkType = this.readUInt32();
      const event = this.readXmlChunk(chunkType);
      if (event) events.push(event);
      // Corrupt chunk headers (e.g. chunkSize 0) would otherwise leave the
      // offset unchanged and spin forever on the same bytes.
      if (this.offset <= chunkStart) break;
    }

    return this.eventsToXml(events);
  }

  private readHeader(): AxmlHeader {
    if (this.buffer.length < 8) {
      throw new Error(`Buffer too small: ${this.buffer.length} bytes (minimum 8 required)`);
    }
    const chunkType = this.readUInt32();
    const chunkSize = this.readUInt32();
    return {
      chunkType,
      chunkSize,
      fileSize: this.buffer.length,
    };
  }

  private readStringPool(): StringPool {
    this.readUInt32(); // chunkType (validated by parse(); offset is rewound to chunk start)
    const chunkSize = this.readUInt32();
    const stringCount = this.readUInt32();
    const styleCount = this.readUInt32();
    const flags = this.readUInt32();
    const stringsOffset = this.readUInt32();
    this.readUInt32(); // stylesOffset (unused)

    const isUtf8 = (flags & 0x00000100) !== 0;

    // Read string offsets
    const stringOffsets: number[] = [];
    for (let i = 0; i < stringCount; i++) {
      stringOffsets.push(this.readUInt32());
    }

    // Read style offsets
    const styleOffsets: number[] = [];
    for (let i = 0; i < styleCount; i++) {
      styleOffsets.push(this.readUInt32());
    }

    // Calculate absolute start of string data
    const poolStart = this.offset - 28 - stringCount * 4 - styleCount * 4;
    const stringsStart = poolStart + stringsOffset;

    // Read strings
    const strings: string[] = [];
    for (const strOffset of stringOffsets) {
      const absoluteOffset = stringsStart + strOffset;
      strings.push(this.readStringAt(absoluteOffset, isUtf8));
    }

    // Skip to end of chunk
    this.offset = poolStart + chunkSize;

    return { strings, styleOffsets };
  }

  private readStringAt(offset: number, isUtf8: boolean): string {
    if (offset >= this.buffer.length) {
      return '';
    }

    const savedOffset = this.offset;
    this.offset = offset;

    try {
      if (isUtf8) {
        // UTF-8 format: two length bytes (char count, byte count), then data, then null terminator
        this.readUInt8(); // charCount (unused)
        const byteCount = this.readUInt8();

        if (byteCount === 0) {
          this.offset = savedOffset;
          return '';
        }

        const bytes: number[] = [];
        for (let i = 0; i < byteCount && this.offset < this.buffer.length; i++) {
          const byte = this.readUInt8();
          if (byte === 0) break; // null terminator
          bytes.push(byte);
        }

        this.offset = savedOffset;
        return Buffer.from(bytes).toString('utf8');
      } else {
        // UTF-16: length prefix (character count), then UTF-16LE data
        let charCount = this.readUInt16();
        if ((charCount & 0x8000) !== 0) {
          // High bit set means extended length
          const charCount2 = this.readUInt16();
          charCount = ((charCount & 0x7fff) << 16) | charCount2;
        }

        if (charCount === 0) {
          this.offset = savedOffset;
          return '';
        }

        const chars: number[] = [];
        for (let i = 0; i < charCount && this.offset < this.buffer.length; i++) {
          const char = this.readUInt16();
          if (char === 0) break;
          chars.push(char);
        }

        this.offset = savedOffset;
        return String.fromCharCode(...chars);
      }
    } catch {
      this.offset = savedOffset;
      return '';
    }
  }

  private readResourceMap(): number[] {
    const chunkSize = this.readUInt32();
    const count = (chunkSize - 8) / 4;
    const resources: number[] = [];
    for (let i = 0; i < count; i++) {
      resources.push(this.readUInt32());
    }
    return resources;
  }

  private readXmlChunk(chunkType: number): XmlEvent | null {
    const chunkSize = this.readUInt32();
    const chunkStart = this.offset - 8;

    switch (chunkType) {
      case CHUNK_TYPE.XML_START_NAMESPACE:
        return this.readStartNamespace();
      case CHUNK_TYPE.XML_END_NAMESPACE:
        return this.readEndNamespace();
      case CHUNK_TYPE.XML_START_TAG:
        return this.readStartTag();
      case CHUNK_TYPE.XML_END_TAG:
        return this.readEndTag();
      case CHUNK_TYPE.XML_TEXT:
        return this.readText();
      default:
        // Skip unknown chunk (always advance past the 8-byte header).
        this.offset = chunkStart + Math.max(chunkSize, 8);
        return null;
    }
  }

  private readStartNamespace(): XmlEvent | null {
    this.readUInt32(); // lineNumber (unused)
    this.readUInt32(); // comment (unused)
    const prefixIdx = this.readUInt32();
    const uriIdx = this.readUInt32();

    if (prefixIdx !== 0xffffffff && uriIdx !== 0xffffffff) {
      const uri = this.getString(uriIdx);
      this.namespaceMap.set(prefixIdx, uri);
    }

    return null; // namespace declarations don't generate events
  }

  private readEndNamespace(): XmlEvent | null {
    this.readUInt32(); // _lineNumber
    this.readUInt32(); // comment
    this.readUInt32(); // _prefix
    this.readUInt32(); // uri
    return null;
  }

  private readStartTag(): XmlEvent {
    const lineNumber = this.readUInt32();
    this.readUInt32(); // comment (unused)
    const namespaceIdx = this.readUInt32();
    const nameIdx = this.readUInt32();
    this.readUInt16(); // attributeStart (always 0x14)
    this.readUInt16(); // attributeSize (always 0x14)
    const attributeCount = this.readUInt16();
    this.readUInt16(); // idIndex
    this.readUInt16(); // classIndex
    this.readUInt16(); // styleIndex

    const namespace = namespaceIdx === 0xffffffff ? '' : this.getString(namespaceIdx);
    const name = this.getString(nameIdx);

    const attributes: XmlAttribute[] = [];
    for (let i = 0; i < attributeCount; i++) {
      attributes.push(this.readAttribute());
    }

    return {
      type: 'start',
      namespace,
      name,
      attributes,
      _lineNumber: lineNumber,
    };
  }

  private readEndTag(): XmlEvent {
    const lineNumber = this.readUInt32();
    this.readUInt32(); // comment
    const namespaceIdx = this.readUInt32();
    const nameIdx = this.readUInt32();

    const namespace = namespaceIdx === 0xffffffff ? '' : this.getString(namespaceIdx);
    const name = this.getString(nameIdx);

    return {
      type: 'end',
      namespace,
      name,
      _lineNumber: lineNumber,
    };
  }

  private readText(): XmlEvent {
    const lineNumber = this.readUInt32();
    this.readUInt32(); // comment
    const nameIdx = this.readUInt32();
    this.readUInt32(); // unknown1
    this.readUInt32(); // unknown2

    const text = nameIdx === 0xffffffff ? '' : this.getString(nameIdx);

    return {
      type: 'text',
      text,
      _lineNumber: lineNumber,
    };
  }

  private readAttribute(): XmlAttribute {
    const namespaceIdx = this.readUInt32();
    const nameIdx = this.readUInt32();
    const rawValueIdx = this.readUInt32();
    this.readUInt16(); // typedValueSize (unused)
    this.readUInt8(); // reserved (always 0)
    const typedValueType = this.readUInt8();
    const typedValueData = this.readUInt32();

    const namespace = namespaceIdx === 0xffffffff ? '' : this.getString(namespaceIdx);
    const name = this.getString(nameIdx);
    const rawValue = rawValueIdx === 0xffffffff ? '' : this.getString(rawValueIdx);

    return {
      namespace,
      name,
      rawValue,
      typedValue: { type: typedValueType, data: typedValueData },
    };
  }

  private eventsToXml(events: XmlEvent[]): string {
    const lines: string[] = ['<?xml version="1.0" encoding="utf-8"?>'];
    const stack: string[] = [];
    let indent = 0;

    for (const event of events) {
      if (event.type === 'start') {
        const tag = this.formatStartTag(event, indent);
        lines.push(tag);
        stack.push(event.name ?? '');
        indent++;
      } else if (event.type === 'end') {
        indent--;
        const expected = stack.pop();
        const eventName = event.name ?? '';
        if (expected !== eventName) {
          throw new Error(
            `Mismatched XML tags: expected close of "${expected ?? 'undefined'}", got "${eventName ?? 'undefined'}"`,
          );
        }
        lines.push(`${'  '.repeat(indent)}</${eventName}>`);
      } else if (event.type === 'text' && event.text) {
        lines.push(`${'  '.repeat(indent)}${this.escapeXml(event.text)}`);
      }
    }

    if (stack.length > 0) {
      throw new Error(`Unclosed XML tags: ${stack.join(', ')}`);
    }

    return lines.join('\n');
  }

  private formatStartTag(event: XmlEvent, indent: number): string {
    const prefix = '  '.repeat(indent);
    const attrs = event.attributes ?? [];

    if (attrs.length === 0) {
      return `${prefix}<${event.name}>`;
    }

    const attrStrings = attrs.map((attr) => this.formatAttribute(attr));
    return `${prefix}<${event.name} ${attrStrings.join(' ')}>`;
  }

  private formatAttribute(attr: XmlAttribute): string {
    const name = attr.namespace ? `${attr.namespace}:${attr.name}` : attr.name;
    const value = this.formatAttributeValue(attr);
    return `${name}="${this.escapeXml(value)}"`;
  }

  private formatAttributeValue(attr: XmlAttribute): string {
    const { type, data } = attr.typedValue;

    switch (type) {
      case VALUE_TYPE.STRING:
        return attr.rawValue;
      case VALUE_TYPE.INT_DEC:
        return data.toString();
      case VALUE_TYPE.INT_HEX:
        return `0x${data.toString(16)}`;
      case VALUE_TYPE.INT_BOOLEAN:
        return data === 0 ? 'false' : 'true';
      case VALUE_TYPE.REFERENCE:
        return `@0x${data.toString(16)}`;
      case VALUE_TYPE.NULL:
        return '';
      default:
        // For unknown types, prefer raw value if available
        return attr.rawValue || `0x${data.toString(16)}`;
    }
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private getString(index: number): string {
    if (index < 0 || index >= this.stringPool.strings.length) {
      return '';
    }
    return this.stringPool.strings[index] ?? '';
  }

  private readUInt8(): number {
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  private readUInt16(): number {
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  private readUInt32(): number {
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  private peekUInt32(): number {
    return this.buffer.readUInt32LE(this.offset);
  }
}

/**
 * Parse binary AXML buffer to XML string.
 * @param buffer Binary AXML buffer
 * @returns XML string or null if parsing fails
 */
export function parseAxml(buffer: Buffer): string | null {
  try {
    const parser = new AxmlParser(buffer);
    return parser.parse();
  } catch {
    return null;
  }
}
