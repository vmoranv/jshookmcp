const TLS_VERSION_NAMES: Record<string, string> = {
  '3:1': 'TLS 1.0',
  '3:2': 'TLS 1.1',
  '3:3': 'TLS 1.2',
  '3:4': 'TLS 1.3',
};

const CONTENT_TYPE_NAMES: Record<number, string> = {
  20: 'change_cipher_spec',
  21: 'alert',
  22: 'handshake',
  23: 'application_data',
  24: 'heartbeat',
};

const CIPHER_SUITES_BY_ID: Record<number, string> = {
  0x009c: 'TLS_RSA_WITH_AES_128_GCM_SHA256',
  0x009d: 'TLS_RSA_WITH_AES_256_GCM_SHA384',
  0xcca8: 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
  0xcca9: 'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
  0x1301: 'TLS_AES_128_GCM_SHA256',
  0x1302: 'TLS_AES_256_GCM_SHA384',
  0x1303: 'TLS_CHACHA20_POLY1305_SHA256',
  0x1304: 'TLS_AES_128_CCM_SHA256',
  0x1305: 'TLS_AES_128_CCM_8_SHA256',
  0xc02b: 'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
  0xc02c: 'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
  0xc02f: 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
  0xc030: 'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
};

const EXTENSION_NAMES: Record<number, string> = {
  0: 'server_name',
  1: 'max_fragment_length',
  5: 'status_request',
  10: 'supported_groups',
  13: 'signature_algorithms',
  16: 'application_layer_protocol_negotiation',
  18: 'signed_certificate_timestamp',
  23: 'record_size_limit',
  27: 'compress_certificate',
  35: 'session_ticket',
  43: 'supported_versions',
  44: 'cookie',
  45: 'psk_key_exchange_modes',
  49: 'post_handshake_auth',
  51: 'key_share',
};

export function tlsVersionName(major: number, minor: number): string {
  return (
    TLS_VERSION_NAMES[`${major}:${minor}`] ??
    `0x${major.toString(16).padStart(2, '0')}${minor.toString(16).padStart(2, '0')}`
  );
}

export function contentTypeName(contentType: number): string {
  return CONTENT_TYPE_NAMES[contentType] ?? 'unknown';
}

export function parseClientHello(payload: Buffer): {
  serverName?: string;
  cipherSuites: string[];
  extensions: Array<{ type: number; name: string; length: number }>;
} {
  const result: {
    serverName?: string;
    cipherSuites: string[];
    extensions: Array<{ type: number; name: string; length: number }>;
  } = {
    cipherSuites: [],
    extensions: [],
  };

  const startsWithHandshakeHeader = payload[0] !== undefined && payload[0]! < 25;
  const bodyOffset = startsWithHandshakeHeader ? 4 : 0;

  if (payload.length < bodyOffset + 38) {
    return result;
  }

  const sessionIdOffset = bodyOffset + 34;
  const sessionIdLength = payload[sessionIdOffset] ?? 0;
  let cursor = sessionIdOffset + 1 + sessionIdLength;

  if (cursor + 2 > payload.length) {
    return result;
  }
  const cipherSuitesLength = payload.readUInt16BE(cursor);
  cursor += 2;

  const cipherSuitesEnd = cursor + cipherSuitesLength;
  while (cursor + 2 <= cipherSuitesEnd) {
    const suiteId = payload.readUInt16BE(cursor);
    result.cipherSuites.push(
      CIPHER_SUITES_BY_ID[suiteId] ?? `0x${suiteId.toString(16).padStart(4, '0')}`,
    );
    cursor += 2;
  }

  cursor = cipherSuitesEnd + 1;
  if (cursor < payload.length) {
    const compLength = payload[cursor];
    if (compLength !== undefined) {
      cursor += 1 + compLength;
    }
  }

  if (cursor + 2 <= payload.length) {
    const extensionsLength = payload.readUInt16BE(cursor);
    cursor += 2;
    const extensionsEnd = cursor + extensionsLength;

    while (cursor + 4 <= extensionsEnd) {
      const extType = payload.readUInt16BE(cursor);
      const extLength = payload.readUInt16BE(cursor + 2);
      cursor += 4;

      const extName = EXTENSION_NAMES[extType] ?? `unknown(0x${extType.toString(16)})`;
      result.extensions.push({ type: extType, name: extName, length: extLength });

      if (extType === 0 && cursor + 2 <= extensionsEnd) {
        const sniCursor = cursor + 2;
        if (sniCursor + 3 <= extensionsEnd) {
          const sniType = payload[sniCursor];
          if (sniType === 0) {
            const sniLength = payload.readUInt16BE(sniCursor + 1);
            const sniStart = sniCursor + 3;
            if (sniStart + sniLength <= extensionsEnd) {
              result.serverName = payload.subarray(sniStart, sniStart + sniLength).toString('utf8');
            }
          }
        }
      }

      cursor += extLength;
    }
  }

  return result;
}
