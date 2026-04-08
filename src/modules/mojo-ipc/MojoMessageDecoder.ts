export interface KnownMojoInterface {
  name: string;
  description: string;
  methods: string[];
}

export interface DecodedMojoMessage {
  interface: string;
  method: string;
  rawHex: string;
  parameters: Record<string, unknown>;
}

const KNOWN_INTERFACES: KnownMojoInterface[] = [
  {
    name: 'network.mojom.NetworkService',
    description: 'Network service factory operations.',
    methods: ['CreateLoaderAndStart', 'ClearCache'],
  },
  {
    name: 'network.mojom.URLLoaderFactory',
    description: 'Creates URL loaders and factories.',
    methods: ['CreateLoaderAndStart', 'Clone'],
  },
  {
    name: 'network.mojom.URLLoader',
    description: 'Active URL loader request lifecycle.',
    methods: ['FollowRedirect', 'SetPriority'],
  },
  {
    name: 'network.mojom.NetworkContext',
    description: 'Network context and factory provisioning.',
    methods: ['CreateURLLoaderFactory', 'CreateProxyResolvingSocketFactory'],
  },
  {
    name: 'url.mojom.Url',
    description: 'URL operations and initialization helpers.',
    methods: ['Init', 'Resolve'],
  },
  {
    name: 'content.mojom.FrameHost',
    description: 'Frame host coordination.',
    methods: ['Navigate', 'CommitNavigation'],
  },
  {
    name: 'blink.mojom.WidgetHost',
    description: 'Widget host and compositor bridge.',
    methods: ['CreateFrameSink', 'SetFocus'],
  },
  {
    name: 'storage.mojom.CacheStorage',
    description: 'Cache storage backend.',
    methods: ['Open', 'Delete', 'ClearCache'],
  },
];

function normalizeQuery(query: string | undefined): string {
  return (query ?? '').trim().toLowerCase();
}

function cleanHex(hex: string): string {
  return hex.replace(/\s+/g, '').toLowerCase();
}

function readOrdinal(cleanedHex: string): number {
  if (cleanedHex.length < 8) {
    return 0;
  }

  const ordinalHex = cleanedHex.slice(4, 8);
  const parsed = Number.parseInt(ordinalHex, 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolveInterface(query: string): KnownMojoInterface | undefined {
  const normalized = normalizeQuery(query);
  const exactMatch = KNOWN_INTERFACES.find((iface) => iface.name.toLowerCase() === normalized);
  if (exactMatch) {
    return exactMatch;
  }

  return KNOWN_INTERFACES.find((iface) => iface.name.toLowerCase().includes(normalized));
}

export function listKnownInterfaces(filter?: string): KnownMojoInterface[] {
  const normalized = normalizeQuery(filter);
  if (!normalized) {
    return [...KNOWN_INTERFACES];
  }

  return KNOWN_INTERFACES.filter((iface) => {
    return (
      iface.name.toLowerCase().includes(normalized) ||
      iface.description.toLowerCase().includes(normalized) ||
      iface.methods.some((method) => method.toLowerCase().includes(normalized))
    );
  });
}

export function decodeMojoPayload(
  hex: string,
  context: string,
): {
  header: {
    version: number;
    flags: number;
    messageType: number;
    numFields: number;
    error?: string;
  };
  fields: Record<string, unknown>;
  handles: number;
  raw: string;
} {
  const cleaned = cleanHex(hex);
  const bytes = Buffer.from(cleaned, 'hex');

  if (cleaned.length < 12) {
    return {
      header: {
        version: 0,
        flags: 0,
        messageType: 0,
        numFields: 0,
        error: 'payload too short for header',
      },
      fields: {},
      handles: 0,
      raw: cleaned,
    };
  }
  const fields: Record<string, unknown> = {};
  const version = bytes.readUInt16BE(0);
  const flags = bytes.readUInt8(2);
  const messageType = bytes.readUInt8(3);
  const numFields = bytes.readUInt32BE(4);
  let cursor = 12;

  for (let index = 0; index < numFields; index += 1) {
    if (cursor >= bytes.length) {
      break;
    }

    const typeCode = bytes.readUInt8(cursor);
    cursor += 1;
    const fieldName = `field_${index}`;

    if (typeCode === 0x01) {
      if (cursor >= bytes.length) break;
      fields[fieldName] = bytes.readUInt8(cursor) !== 0;
      cursor += 1;
      continue;
    }

    if (typeCode === 0x06 || typeCode === 0x08 || typeCode === 0x10) {
      if (cursor + 4 > bytes.length) break;
      const value = bytes.readUInt32BE(cursor);
      cursor += 4;
      fields[fieldName] = typeCode === 0x10 ? `{handle:${value}}` : value;
      continue;
    }

    if (typeCode === 0x0c) {
      if (cursor + 4 > bytes.length) break;
      const length = bytes.readUInt32BE(cursor);
      cursor += 4;
      if (cursor + length > bytes.length) break;
      fields[fieldName] = bytes.subarray(cursor, cursor + length).toString('utf8');
      cursor += length;
      continue;
    }
  }

  if (Object.keys(fields).length === 0) {
    fields._raw_summary = `${context}: no decodable fields`;
  }

  return {
    header: {
      version,
      flags,
      messageType,
      numFields,
    },
    fields,
    handles: bytes.length >= 12 ? bytes.readUInt32BE(8) : 0,
    raw: cleaned,
  };
}

export class MojoMessageDecoder {
  async decodeMessage(hex: string, interfaceName: string): Promise<DecodedMojoMessage> {
    const cleaned = cleanHex(hex);
    const resolvedInterface = resolveInterface(interfaceName);
    const ordinal = readOrdinal(cleaned);
    const method =
      resolvedInterface?.methods[ordinal] ?? (resolvedInterface ? `ordinal_${ordinal}` : 'unknown');
    const payload = decodeMojoPayload(cleaned, interfaceName);

    return {
      interface: interfaceName,
      method,
      rawHex: cleaned,
      parameters: {
        _mojo_header: payload.header,
        _mojo_handles: payload.handles,
        ...payload.fields,
      },
    };
  }

  async listInterfaces(filter?: string): Promise<KnownMojoInterface[]> {
    return listKnownInterfaces(filter);
  }
}
