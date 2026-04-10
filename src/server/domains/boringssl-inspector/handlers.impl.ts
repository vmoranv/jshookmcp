import { createServer as createNetServer, Socket as NetSocket } from 'node:net';
import { createSocket as createUdpSocket } from 'node:dgram';
import { createHash, X509Certificate } from 'node:crypto';
import {
  TLSKeyLogExtractor,
  enableKeyLog,
  disableKeyLog,
  getKeyLogFilePath,
  parseKeyLog as parseKeyLogEntries,
  summarizeKeyLog as summarizeKeyLogEntries,
  lookupSecret as lookupSecretEntry,
  decryptPayload as decryptPayloadFunc,
} from '@modules/boringssl-inspector';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolResponse } from '@server/types';
import { argString, argNumber } from '@server/domains/shared/parse-args';

/**
 * SECURITY: Validate that a target host is not a private/loopback address.
 * Prevents SSRF attacks against internal services.
 */
function isPrivateAddress(host: string): boolean {
  // Loopback
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false; // loopback is OK for this tool
  // Block RFC 1918, link-local, and other private ranges
  const PRIVATE_PATTERNS = [
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^fc00:/i,
    /^fd/i,
    /^fe80:/i,
    /^0\./,
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // CGN
  ];
  return PRIVATE_PATTERNS.some((p) => p.test(host));
}

function validateNetworkTarget(host: string): { ok: false; error: string } | null {
  if (isPrivateAddress(host)) {
    return {
      ok: false,
      error: `Blocked: target host "${host}" resolves to a private/internal address. SSRF protection applies.`,
    };
  }
  return null;
}

function normalizeHex(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

function isHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9A-F]+$/i.test(value);
}

function tlsVersionName(major: number, minor: number): string {
  if (major === 3 && minor === 1) {
    return 'TLS 1.0';
  }
  if (major === 3 && minor === 2) {
    return 'TLS 1.1';
  }
  if (major === 3 && minor === 3) {
    return 'TLS 1.2';
  }
  if (major === 3 && minor === 4) {
    return 'TLS 1.3';
  }

  return `0x${major.toString(16).padStart(2, '0')}${minor.toString(16).padStart(2, '0')}`;
}

function contentTypeName(contentType: number): string {
  if (contentType === 20) {
    return 'change_cipher_spec';
  }
  if (contentType === 21) {
    return 'alert';
  }
  if (contentType === 22) {
    return 'handshake';
  }
  if (contentType === 23) {
    return 'application_data';
  }
  if (contentType === 24) {
    return 'heartbeat';
  }

  return 'unknown';
}

function handshakeTypeName(handshakeType: number): string {
  if (handshakeType === 1) {
    return 'client_hello';
  }
  if (handshakeType === 2) {
    return 'server_hello';
  }
  if (handshakeType === 4) {
    return 'new_session_ticket';
  }
  if (handshakeType === 8) {
    return 'encrypted_extensions';
  }
  if (handshakeType === 11) {
    return 'certificate';
  }
  if (handshakeType === 13) {
    return 'certificate_request';
  }
  if (handshakeType === 15) {
    return 'certificate_verify';
  }
  if (handshakeType === 20) {
    return 'finished';
  }

  return 'unknown';
}

/**
 * Parse TLS ClientHello to extract SNI, cipher suites, and extensions.
 * Handles two input layouts:
 * - With handshake header: [type(1) + length(3) + version(2) + random(32) + ...]
 * - Without handshake header: [version(2) + random(32) + ...]
 */
function parseClientHello(payload: Buffer): {
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

  // Determine whether payload starts with handshake header or ClientHello body
  // Handshake header: first byte is handshake type (0..24), next 3 bytes are length
  // ClientHello body: first 2 bytes are version (0x03xx range)
  const startsWithHandshakeHeader = payload[0] !== undefined && payload[0]! < 25;
  const bodyOffset = startsWithHandshakeHeader ? 4 : 0;

  if (payload.length < bodyOffset + 38) {
    return result;
  }

  // Session ID length is 2 bytes after version + 32 bytes of random = offset 34
  const sessionIdOffset = bodyOffset + 34;
  const sessionIdLength = payload[sessionIdOffset] ?? 0;
  let cursor = sessionIdOffset + 1 + sessionIdLength;

  // Cipher suites length + suites
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

  // Skip to extensions (after compression methods)
  cursor = cipherSuitesEnd + 1; // compression methods length
  if (cursor < payload.length) {
    const compLength = payload[cursor];
    if (compLength !== undefined) {
      cursor += 1 + compLength;
    }
  }

  // Parse extensions
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

      // SNI extension (type 0)
      if (extType === 0 && cursor + 2 <= extensionsEnd) {
        const sniCursor = cursor + 2;
        if (sniCursor + 3 <= extensionsEnd) {
          const sniType = payload[sniCursor]; // 0 = host_name
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

// IANA TLS cipher suite IDs
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

/**
 * Parse a DER-encoded certificate to extract basic info.
 */
function parseDerCertificate(der: Buffer): {
  subject?: string;
  issuer?: string;
  serialNumber?: string;
  validFrom?: string;
  validTo?: string;
  sha256: string;
  length: number;
} {
  const sha256 = createHash('sha256').update(der).digest('hex').toUpperCase();

  // Try to parse as X509 certificate using node:crypto
  try {
    const cert = new X509Certificate(der);
    return {
      subject: cert.subject || undefined,
      issuer: cert.issuer || undefined,
      serialNumber: cert.serialNumber || undefined,
      validFrom: cert.validFrom || undefined,
      validTo: cert.validTo || undefined,
      sha256,
      length: der.length,
    };
  } catch {
    // Not a valid X509 certificate, fall back to minimal info
    return { sha256, length: der.length };
  }
}

/**
 * Parse a chain of DER certificates from hex.
 */
function parseCertificateChain(hexPayload: string): Array<{
  sha256: string;
  length: number;
}> {
  const buffer = Buffer.from(normalizeHex(hexPayload), 'hex');
  const certs: Array<{ sha256: string; length: number }> = [];

  // Try to find certificate boundaries (0x30 SEQUENCE tag)
  let cursor = 0;
  while (cursor < buffer.length - 4) {
    if (buffer[cursor] === 0x30) {
      // Found potential certificate start
      const certData = buffer.subarray(cursor);
      const info = parseDerCertificate(certData);
      certs.push({ sha256: info.sha256, length: info.length });
      cursor += info.length;
    } else {
      cursor += 1;
    }
  }

  // If no certs found but we have data, treat as single blob
  if (certs.length === 0 && buffer.length > 0) {
    certs.push({
      sha256: createHash('sha256').update(buffer).digest('hex').toUpperCase(),
      length: buffer.length,
    });
  }

  return certs;
}

export class BoringsslInspectorHandlers {
  private extensionInvoke?: (...args: unknown[]) => Promise<unknown>;

  constructor(private keyLogExtractor: TLSKeyLogExtractor = new TLSKeyLogExtractor()) {}

  setExtensionInvoke(invoke: (...args: unknown[]) => Promise<unknown>): void {
    this.extensionInvoke = invoke;
  }

  async handleTlsKeylogEnable(_args: Record<string, unknown>): Promise<unknown> {
    const keyLogPath = await this.keyLogExtractor.enableKeyLog();
    return {
      enabled: true,
      keyLogPath,
      environmentVariable: 'SSLKEYLOGFILE',
    };
  }

  async handleTlsKeylogDisable(args: Record<string, unknown>): Promise<unknown> {
    const path = argString(args, 'path') ?? null;
    if (path) {
      await this.keyLogExtractor.disableKeyLog();
    } else {
      disableKeyLog();
    }
    return {
      disabled: true,
      previousPath: path ?? getKeyLogFilePath(),
    };
  }

  async handleTlsKeylogParse(args: Record<string, unknown>): Promise<unknown> {
    const path = argString(args, 'path') ?? null;
    const entries = this.keyLogExtractor.parseKeyLog(path ?? undefined);
    const summary = this.keyLogExtractor.summarizeKeyLog(path ?? undefined);

    return {
      path: path ?? this.keyLogExtractor.getKeyLogFilePath(),
      entries,
      summary,
    };
  }

  async handleTlsDecryptPayload(args: Record<string, unknown>): Promise<unknown> {
    const encryptedHex = argString(args, 'encryptedHex') ?? null;
    const keyHex = argString(args, 'keyHex') ?? null;
    const nonceHex = argString(args, 'nonceHex') ?? null;
    const algorithm = argString(args, 'algorithm') ?? 'aes-256-gcm';
    const authTagHex = argString(args, 'authTagHex') ?? null;

    if (!encryptedHex || !keyHex || !nonceHex) {
      return { ok: false, error: 'encryptedHex, keyHex, and nonceHex are required' };
    }

    const decrypted = decryptPayloadFunc(
      encryptedHex,
      keyHex,
      nonceHex,
      algorithm,
      authTagHex ?? undefined,
    );
    return {
      ok: true,
      algorithm,
      decrypted,
      isFailed: decrypted.startsWith('DECRYPTION_FAILED:'),
    };
  }

  async handleTlsKeylogSummarize(args: Record<string, unknown>): Promise<unknown> {
    const content = argString(args, 'content') ?? null;
    if (content) {
      const entries = parseKeyLogEntries(content);
      return summarizeKeyLogEntries(entries);
    }

    this.keyLogExtractor.parseKeyLog();
    return this.keyLogExtractor.summarizeKeyLog();
  }

  async handleTlsKeylogLookupSecret(args: Record<string, unknown>): Promise<unknown> {
    const clientRandom = argString(args, 'clientRandom') ?? null;
    const label = argString(args, 'label') ?? undefined;

    if (!clientRandom) {
      return { ok: false, error: 'clientRandom is required' };
    }

    // Try the instance-level cache first
    const cached = this.keyLogExtractor.lookupSecret(clientRandom);
    if (cached) {
      return { ok: true, clientRandom: normalizeHex(clientRandom), secret: cached };
    }

    // Fall back to parsing the current keylog file
    const secret = lookupSecretEntry(this.keyLogExtractor.parseKeyLog(), clientRandom, label);
    return {
      ok: secret !== null,
      clientRandom: normalizeHex(clientRandom),
      secret: secret ?? null,
    };
  }

  async handleTlsCertPinBypass(args: Record<string, unknown>): Promise<unknown> {
    const target = argString(args, 'target') ?? null;
    if (target !== 'android' && target !== 'ios' && target !== 'desktop') {
      return {
        error: 'target must be one of android, ios, or desktop',
      };
    }

    const strategyByTarget: Record<'android' | 'ios' | 'desktop', string> = {
      android: 'hook-trust-manager',
      ios: 'replace-sec-trust-evaluation',
      desktop: 'patch-custom-verifier',
    };

    const instructionsByTarget: Record<'android' | 'ios' | 'desktop', string[]> = {
      android: [
        'Inject a Frida script that overrides X509TrustManager checks.',
        'Re-run the target flow after SSLKEYLOGFILE capture is enabled.',
      ],
      ios: [
        'Hook SecTrustEvaluateWithError and return success for the target session.',
        'Collect TLS keys after the app resumes the failing request.',
      ],
      desktop: [
        'Patch the custom verifier callback or disable pin comparison in the client.',
        'Capture a fresh handshake after the patched build starts.',
      ],
    };

    return {
      bypassStrategy: strategyByTarget[target],
      affectedDomains: ['*'],
      instructions: instructionsByTarget[target],
    };
  }

  async handleTlsHandshakeParse(args: Record<string, unknown>): Promise<unknown> {
    const hexPayload = argString(args, 'hexPayload') ?? null;
    if (!hexPayload) {
      return { error: 'hexPayload is required' };
    }

    const normalizedPayload = normalizeHex(hexPayload);
    if (!isHex(normalizedPayload)) {
      return { error: 'hexPayload must be a valid hex string' };
    }

    const record = Buffer.from(normalizedPayload, 'hex');
    if (record.length < 5) {
      return {
        error: 'TLS record is too short',
        length: record.length,
      };
    }

    const contentType = record[0] ?? 0;
    const versionMajor = record[1] ?? 0;
    const versionMinor = record[2] ?? 0;
    const declaredLength = record.readUInt16BE(3);
    const payload = record.subarray(5);
    const decrypted = this.keyLogExtractor.decryptPayload(
      normalizedPayload,
      this.keyLogExtractor.parseKeyLog(),
    );
    const handshakeType = contentType === 22 && payload.length > 0 ? payload[0] : undefined;

    // Parse ClientHello if handshake type is client_hello
    const clientHello = handshakeType === 1 ? parseClientHello(payload) : undefined;

    return {
      record: {
        contentType,
        contentTypeName: contentTypeName(contentType),
        version: tlsVersionName(versionMajor, versionMinor),
        declaredLength,
        actualLength: payload.length,
      },
      handshake:
        handshakeType === undefined
          ? undefined
          : {
              type: handshakeType,
              typeName: handshakeTypeName(handshakeType),
              ...(clientHello
                ? {
                    serverName: clientHello.serverName,
                    cipherSuites: clientHello.cipherSuites,
                    extensionCount: clientHello.extensions.length,
                    extensions: clientHello.extensions,
                  }
                : {}),
            },
      decryptedPreviewHex: decrypted
        ? decrypted.subarray(0, 16).toString('hex').toUpperCase()
        : null,
    };
  }

  async handleKeyLogEnable(args: Record<string, unknown>): Promise<ToolResponse> {
    const filePath = argString(args, 'filePath') ?? '/tmp/sslkeylog.log';
    enableKeyLog(filePath);
    return asJsonResponse({
      success: true,
      filePath,
      currentFilePath: getKeyLogFilePath(),
    });
  }

  async handleParseHandshake(args: Record<string, unknown>): Promise<ToolResponse> {
    const rawHex = argString(args, 'rawHex') ?? null;
    if (!rawHex) {
      return asJsonResponse({
        success: false,
        error: 'rawHex is required',
      });
    }

    const normalizedHex = normalizeHex(rawHex);
    if (!isHex(normalizedHex)) {
      return asJsonResponse({
        success: false,
        error: 'Invalid hex payload',
      });
    }

    const record = Buffer.from(normalizedHex, 'hex');
    if (record.length < 5) {
      return asJsonResponse({
        success: false,
        error: 'TLS record is too short',
      });
    }

    const contentType = record[0] ?? 0;
    const versionMajor = record[1] ?? 0;
    const versionMinor = record[2] ?? 0;
    const payload = record.subarray(5);

    const clientHello =
      contentType === 0x16 && payload.length > 0 && payload[0] === 1
        ? parseClientHello(payload)
        : undefined;

    return asJsonResponse({
      success: true,
      handshake: {
        version: tlsVersionName(versionMajor, versionMinor),
        contentType: contentTypeName(contentType),
        ...(clientHello
          ? {
              type: 'client_hello',
              serverName: clientHello.serverName,
              cipherSuites: clientHello.cipherSuites,
              extensions: clientHello.extensions,
            }
          : {
              cipherSuite: [],
              extensions: [],
            }),
      },
      sni: clientHello?.serverName ? { serverName: clientHello.serverName } : undefined,
    });
  }

  async handleCipherSuites(args: Record<string, unknown>): Promise<ToolResponse> {
    const filter = argString(args, 'filter') ?? null;
    const allSuites = [
      'TLS_AES_128_GCM_SHA256',
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
      'TLS_AES_128_CCM_SHA256',
      'TLS_AES_128_CCM_8_SHA256',
      'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
      'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
      'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
      'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
      'TLS_RSA_WITH_AES_128_GCM_SHA256',
      'TLS_RSA_WITH_AES_256_GCM_SHA384',
    ];
    const filteredSuites = filter ? allSuites.filter((suite) => suite.includes(filter)) : allSuites;
    return asJsonResponse({
      success: true,
      filter,
      total: filteredSuites.length,
      suites: filteredSuites,
    });
  }

  async handleParseCertificate(args: Record<string, unknown>): Promise<ToolResponse> {
    const rawHex = argString(args, 'rawHex') ?? null;
    if (!rawHex) {
      return asJsonResponse({
        success: false,
        error: 'rawHex is required',
      });
    }

    const certs = parseCertificateChain(rawHex);
    return asJsonResponse({
      success: true,
      certificateCount: certs.length,
      fingerprints: certs.map((c) => ({
        sha256: c.sha256,
        length: c.length,
      })),
    });
  }

  async handleBypassCertPinning(args: Record<string, unknown>): Promise<ToolResponse> {
    if (this.extensionInvoke) {
      try {
        const result = await this.extensionInvoke(args);
        if (result) {
          return asJsonResponse({
            success: true,
            strategy: 'frida-injection',
            result,
          });
        }
      } catch {
        // Extension invoke failed, fall through to instructions
      }
    }

    return asJsonResponse({
      success: true,
      strategy: 'manual-bypass',
      instructions: {
        android: [
          'Use Frida to hook X509TrustManager.checkServerTrusted and return without throwing.',
          'Alternatively, use OkHttp CertificatePinner.Builder().add() with the target cert.',
        ],
        ios: [
          'Hook SecTrustEvaluateWithError to always return true.',
          'Or use SSLSetSessionOption to disable certificate validation.',
        ],
        desktop: [
          'Set NODE_TLS_REJECT_UNAUTHORIZED=0 for Node.js targets.',
          'Or patch the certificate comparison function in the HTTP client.',
        ],
      },
      args,
    });
  }

  // Raw TCP/UDP Socket Handlers

  async handleRawTcpSend(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host') ?? '127.0.0.1';
    const port = argNumber(args, 'port');
    if (port === undefined || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be a number between 1 and 65535' };
    }

    // SECURITY: SSRF protection
    const ssrfCheck = validateNetworkTarget(host);
    if (ssrfCheck) return ssrfCheck;

    const dataHex = argString(args, 'dataHex');
    const dataText = argString(args, 'dataText');
    if (!dataHex && !dataText) {
      return { ok: false, error: 'dataHex or dataText is required' };
    }

    const data = dataHex
      ? Buffer.from(normalizeHex(dataHex), 'hex')
      : Buffer.from(dataText ?? '', 'utf8');
    const timeout = argNumber(args, 'timeout') ?? 5000;

    return new Promise<unknown>((resolve) => {
      const socket = new NetSocket();
      const timer = setTimeout(() => {
        socket.destroy();
        resolve({ ok: false, error: 'Connection timed out' });
      }, timeout);

      socket.on('connect', () => {
        socket.write(data, () => {
          socket.end();
        });
      });

      socket.on('data', (chunk: Buffer) => {
        clearTimeout(timer);
        resolve({
          ok: true,
          host,
          port,
          sentBytes: data.length,
          responseHex: chunk.toString('hex').toUpperCase(),
          responseText: chunk.toString('utf8'),
        });
        socket.destroy();
      });

      socket.on('error', (error: Error) => {
        clearTimeout(timer);
        resolve({ ok: false, error: error.message });
      });

      socket.connect(port, host);
    });
  }

  async handleRawTcpListen(args: Record<string, unknown>): Promise<unknown> {
    const port = argNumber(args, 'port');
    if (port === undefined || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be a number between 1 and 65535' };
    }

    const timeout = argNumber(args, 'timeout') ?? 10000;

    return new Promise<unknown>((resolve) => {
      const server = createNetServer();
      const timer = setTimeout(() => {
        server.close();
        resolve({ ok: false, error: 'Listen timed out — no connection received' });
      }, timeout);

      server.on('connection', (socket: NetSocket) => {
        clearTimeout(timer);
        const chunks: Buffer[] = [];

        socket.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        socket.on('end', () => {
          const data = Buffer.concat(chunks);
          server.close();
          resolve({
            ok: true,
            port,
            receivedBytes: data.length,
            dataHex: data.toString('hex').toUpperCase(),
            dataText: data.toString('utf8'),
          });
        });

        socket.on('error', (error: Error) => {
          clearTimeout(timer);
          server.close();
          resolve({ ok: false, error: error.message });
        });
      });

      server.on('error', (error: Error) => {
        clearTimeout(timer);
        resolve({ ok: false, error: error.message });
      });

      server.listen(port, '127.0.0.1');
    });
  }

  async handleRawUdpSend(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host') ?? '127.0.0.1';
    const port = argNumber(args, 'port');
    if (port === undefined || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be a number between 1 and 65535' };
    }

    // SECURITY: SSRF protection
    const ssrfCheck = validateNetworkTarget(host);
    if (ssrfCheck) return ssrfCheck;

    const dataHex = argString(args, 'dataHex');
    const dataText = argString(args, 'dataText');
    if (!dataHex && !dataText) {
      return { ok: false, error: 'dataHex or dataText is required' };
    }

    const data = dataHex
      ? Buffer.from(normalizeHex(dataHex), 'hex')
      : Buffer.from(dataText ?? '', 'utf8');
    const timeout = argNumber(args, 'timeout') ?? 5000;

    return new Promise<unknown>((resolve) => {
      const socket = createUdpSocket('udp4');
      const timer = setTimeout(() => {
        socket.close();
        resolve({ ok: false, error: 'UDP response timed out' });
      }, timeout);

      socket.on('message', (msg: Buffer) => {
        clearTimeout(timer);
        socket.close();
        resolve({
          ok: true,
          host,
          port,
          sentBytes: data.length,
          responseHex: msg.toString('hex').toUpperCase(),
          responseText: msg.toString('utf8'),
        });
      });

      socket.on('error', (error: Error) => {
        clearTimeout(timer);
        socket.close();
        resolve({ ok: false, error: error.message });
      });

      socket.send(data, 0, data.length, port, host);
    });
  }

  async handleRawUdpListen(args: Record<string, unknown>): Promise<unknown> {
    const port = argNumber(args, 'port');
    if (port === undefined || port < 1 || port > 65535) {
      return { ok: false, error: 'port must be a number between 1 and 65535' };
    }

    const timeout = argNumber(args, 'timeout') ?? 10000;

    return new Promise<unknown>((resolve) => {
      const socket = createUdpSocket('udp4');
      const timer = setTimeout(() => {
        socket.close();
        resolve({ ok: false, error: 'UDP listen timed out' });
      }, timeout);

      socket.on('message', (msg: Buffer, rinfo: { address: string; port: number }) => {
        clearTimeout(timer);
        socket.close();
        resolve({
          ok: true,
          localPort: port,
          receivedBytes: msg.length,
          from: rinfo,
          dataHex: msg.toString('hex').toUpperCase(),
          dataText: msg.toString('utf8'),
        });
      });

      socket.on('error', (error: Error) => {
        clearTimeout(timer);
        socket.close();
        resolve({ ok: false, error: error.message });
      });

      socket.bind(port, '127.0.0.1');
    });
  }

  async handleRawTcpScan(args: Record<string, unknown>): Promise<unknown> {
    const host = argString(args, 'host') ?? '127.0.0.1';
    const startPort = argNumber(args, 'startPort') ?? 1;
    const endPort = argNumber(args, 'endPort') ?? 1024;

    if (startPort < 1 || endPort > 65535 || startPort > endPort) {
      return { ok: false, error: 'Invalid port range' };
    }

    if (endPort - startPort > 1000) {
      return { ok: false, error: 'Port range too large (max 1000 ports)' };
    }

    const timeout = argNumber(args, 'timeout') ?? 1000;
    const openPorts: number[] = [];
    const scanPromises: Promise<void>[] = [];

    for (let p = startPort; p <= endPort; p++) {
      scanPromises.push(
        new Promise<void>((resolve) => {
          const socket = new NetSocket();
          const timer = setTimeout(() => {
            socket.destroy();
            resolve();
          }, timeout);

          socket.on('connect', () => {
            clearTimeout(timer);
            openPorts.push(p);
            socket.destroy();
            resolve();
          });

          socket.on('error', () => {
            clearTimeout(timer);
            resolve();
          });

          socket.connect(p, host);
        }),
      );
    }

    await Promise.all(scanPromises);

    return {
      ok: true,
      host,
      portRange: { start: startPort, end: endPort },
      openPorts: openPorts.toSorted((a, b) => a - b),
      openCount: openPorts.length,
      scannedCount: endPort - startPort + 1,
    };
  }
}
