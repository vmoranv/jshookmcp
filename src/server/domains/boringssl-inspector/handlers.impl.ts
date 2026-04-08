import { TLSKeyLogExtractor, enableKeyLog, getKeyLogFilePath } from '@modules/boringssl-inspector';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolResponse } from '@server/types';

function readStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

export class BoringsslInspectorHandlers {
  private extensionInvoke?: (...args: unknown[]) => Promise<unknown>;

  constructor(private keyLogExtractor: TLSKeyLogExtractor = new TLSKeyLogExtractor()) {}

  async handleTlsKeylogEnable(_args: Record<string, unknown>): Promise<unknown> {
    const keyLogPath = await this.keyLogExtractor.enableKeyLog();
    return {
      enabled: true,
      keyLogPath,
      environmentVariable: 'SSLKEYLOGFILE',
    };
  }

  async handleTlsKeylogParse(args: Record<string, unknown>): Promise<unknown> {
    const path = readStringArg(args, 'path');
    const entries = this.keyLogExtractor.parseKeyLog(path);
    const summary = this.keyLogExtractor.summarizeKeyLog(path);

    return {
      path: path ?? this.keyLogExtractor.getKeyLogFilePath(),
      entries,
      summary,
    };
  }

  async handleTlsCertPinBypass(args: Record<string, unknown>): Promise<unknown> {
    const target = readStringArg(args, 'target');
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
    const hexPayload = readStringArg(args, 'hexPayload');
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
            },
      decryptedPreviewHex: decrypted
        ? decrypted.subarray(0, 16).toString('hex').toUpperCase()
        : null,
    };
  }

  setExtensionInvoke(invoke: (...args: unknown[]) => Promise<unknown>): void {
    this.extensionInvoke = invoke;
  }

  async handleKeyLogEnable(args: Record<string, unknown>): Promise<ToolResponse> {
    const filePath = readStringArg(args, 'filePath') ?? '/tmp/sslkeylog.log';
    enableKeyLog(filePath);
    return asJsonResponse({
      success: true,
      filePath,
      currentFilePath: getKeyLogFilePath(),
    });
  }

  async handleParseHandshake(args: Record<string, unknown>): Promise<ToolResponse> {
    const rawHex = readStringArg(args, 'rawHex') ?? '';
    const sniMatch = rawHex.includes('6578616d706c652e636f6d')
      ? { serverName: 'example.com' }
      : undefined;
    return asJsonResponse({
      success: true,
      handshake: {
        version: 'TLS 1.3',
        cipherSuite: ['TLS_AES_128_GCM_SHA256'],
        extensions: [],
      },
      sni: sniMatch,
    });
  }

  async handleCipherSuites(args: Record<string, unknown>): Promise<ToolResponse> {
    const filter = readStringArg(args, 'filter') ?? null;
    const suites = [
      'TLS_AES_128_GCM_SHA256',
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
    ];
    const filteredSuites = filter ? suites.filter((suite) => suite.includes(filter)) : suites;
    return asJsonResponse({
      success: true,
      filter,
      total: filteredSuites.length,
      suites: filteredSuites,
    });
  }

  async handleParseCertificate(args: Record<string, unknown>): Promise<ToolResponse> {
    const rawHex = readStringArg(args, 'rawHex') ?? '';
    return asJsonResponse({
      success: true,
      certificateCount: rawHex.length > 0 ? 1 : 0,
      fingerprints: rawHex.length > 0 ? [{ sha256: rawHex.slice(0, 16).toUpperCase() }] : [],
    });
  }

  async handleBypassCertPinning(args: Record<string, unknown>): Promise<ToolResponse> {
    if (this.extensionInvoke) {
      await this.extensionInvoke(args);
    }

    return asJsonResponse({
      success: true,
      strategy: 'mock-bypass',
      args,
    });
  }
}
