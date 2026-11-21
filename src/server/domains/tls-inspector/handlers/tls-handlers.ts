/**
 * TlsInspectorTlsHandlers — keylog and TLS parsing helpers.
 */

import {
  classifyKeyLogSecrets,
  decryptPayload as decryptPayloadFunc,
  describeCipherSuite,
  disableKeyLog,
  enableKeyLog,
  getKeyLogFilePath,
  listCipherSuites,
  lookupSecret as lookupSecretEntry,
  parseKeyLog as parseKeyLogEntries,
  summarizeKeyLog as summarizeKeyLogEntries,
} from '@modules/tls-inspector';
import type { KeyLogEntry } from '@modules/tls-inspector';
import { argEnum, argString } from '@server/domains/shared/parse-args';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolResponse } from '@server/types';
import {
  contentTypeName,
  normalizeHex,
  parseCertificateChain,
  parseClientHello,
  tlsVersionName,
} from './shared';
import { TLS_KEYLOG_PATH } from '@src/constants';
import { TlsInspectorBaseHandlers } from './base';

const CIPHER_PROTOCOL_FILTERS = new Set(['all', '1.3', '1.2'] as const);

export class TlsInspectorTlsHandlers extends TlsInspectorBaseHandlers {
  async handleTlsKeylogEnable(_args: Record<string, unknown>): Promise<unknown> {
    const keyLogPath = await this.keyLogExtractor.enableKeyLog();
    return {
      enabled: true,
      keyLogPath,
      environmentVariable: 'SSLKEYLOGFILE',
      // Honesty: SSLKEYLOGFILE env only covers Node-spawned processes. A CDP-driven
      // browser ignores it unless launched with --ssl-key-log (browser_launch
      // sslKeyLogFile). Surface the exact flag so callers wire the browser side.
      scope: 'node-process',
      browserLaunch: {
        flag: `--ssl-key-log=${keyLogPath}`,
        hint: 'Env var covers Node-side TLS only. To keylog a CDP-driven browser, relaunch via browser_launch with sslKeyLogFile set (or pass this flag in args) so the browser emits TLS secrets to the same path.',
      },
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

  async handleTlsKeylogSeal(_args: Record<string, unknown>): Promise<unknown> {
    const sealed = await this.keyLogExtractor.sealKeyLog();
    if (!sealed) {
      return {
        ok: false,
        error: `No keylog file found at ${this.keyLogExtractor.getKeyLogFilePath()} to seal`,
      };
    }
    return {
      ok: true,
      cipherPath: sealed.cipherPath,
      keyHex: sealed.keyHex,
      entryCount: sealed.entryCount,
      warning:
        'keyHex is not persisted anywhere by this tool. Store it yourself if you need to decrypt the sealed envelope later.',
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
    const path = argString(args, 'path') ?? null;

    let entries: KeyLogEntry[];
    let firstSeen: string | undefined;
    let lastSeen: string | undefined;
    // When neither content nor path is supplied the extractor falls back to
    // the keylog opened by the last tls_keylog_enable. Report the path actually
    // read so the caller can tell implicit state apart from an explicit file.
    let resolvedPath: string | undefined;

    if (content) {
      entries = parseKeyLogEntries(content);
    } else {
      resolvedPath = path ?? this.keyLogExtractor.getKeyLogFilePath();
      // File path: parse fresh, then borrow the class summarize for firstSeen/
      // lastSeen (the temporal window is the only datum the standalone helper
      // does not compute). cachedEntries is now populated for later lookup.
      entries = this.keyLogExtractor.parseKeyLog(path ?? undefined);
      const temporal = this.keyLogExtractor.summarizeKeyLog(path ?? undefined);
      firstSeen = temporal.firstSeen;
      lastSeen = temporal.lastSeen;
    }

    const summary = summarizeKeyLogEntries(entries);
    const classification = classifyKeyLogSecrets(entries);

    return {
      ...(resolvedPath ? { path: resolvedPath } : {}),
      totalEntries: summary.totalEntries,
      labels: summary.labels,
      uniqueClientRandom: summary.uniqueClients,
      ...(firstSeen || lastSeen ? { firstSeen, lastSeen } : {}),
      classification,
    };
  }

  async handleTlsKeylogLookupSecret(args: Record<string, unknown>): Promise<unknown> {
    const clientRandom = argString(args, 'clientRandom') ?? null;
    const label = argString(args, 'label') ?? undefined;

    if (!clientRandom) {
      return { ok: false, error: 'clientRandom is required' };
    }

    const cached = this.keyLogExtractor.lookupSecret(clientRandom);
    if (cached) {
      return { ok: true, clientRandom: normalizeHex(clientRandom), secret: cached };
    }

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
        ok: false,
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

  async handleParseHandshake(args: Record<string, unknown>): Promise<ToolResponse> {
    const rawHex = argString(args, 'rawHex') ?? null;
    if (!rawHex) {
      return asJsonResponse({
        success: false,
        error: 'rawHex is required',
      });
    }

    const normalizedHex = normalizeHex(rawHex);
    if (!/^(?:[0-9a-f]{2})+$/i.test(normalizedHex)) {
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

    const contentType = record[0]!;
    const versionMajor = record[1]!;
    const versionMinor = record[2]!;
    const declaredLength = record.readUInt16BE(3);
    const payload = record.subarray(5);

    const clientHello =
      contentType === 0x16 && payload.length > 0 && payload[0] === 1
        ? parseClientHello(payload)
        : undefined;

    // Note: this tool no longer attempts in-line decryption. The previous
    // `decrypt:true` path called a no-op stub that returned the ciphertext
    // unchanged (silently misleading). For payload decryption, use the
    // `tls_decrypt_payload` tool with explicit keyHex + nonceHex + authTagHex.
    return asJsonResponse({
      success: true,
      record: {
        contentType,
        contentTypeName: contentTypeName(contentType),
        version: tlsVersionName(versionMajor, versionMinor),
        declaredLength,
        actualLength: payload.length,
      },
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

  async handleKeyLogEnable(args: Record<string, unknown>): Promise<ToolResponse> {
    const filePath = argString(args, 'filePath') ?? TLS_KEYLOG_PATH;
    enableKeyLog(filePath);
    void this.eventBus?.emit('tls:keylog_started', {
      filePath,
      timestamp: new Date().toISOString(),
    });
    return asJsonResponse({
      success: true,
      filePath,
      currentFilePath: getKeyLogFilePath(),
    });
  }

  async handleCipherSuites(args: Record<string, unknown>): Promise<ToolResponse> {
    const filter = argString(args, 'filter') ?? null;
    const protocol = argEnum(args, 'protocol', CIPHER_PROTOCOL_FILTERS, 'all');

    // Source the registry from the module-layer TLSPacketParser (single source of
    // truth for {id, name}) and enrich each entry with structural metadata
    // (protocol / key-exchange / authentication / encryption / MAC / AEAD)
    // derived purely from the IANA name. No hand-picked shortlist.
    let described = listCipherSuites().map((suite) => describeCipherSuite(suite));

    if (protocol === '1.3' || protocol === '1.2') {
      const want = protocol === '1.3' ? 'TLS1.3' : 'TLS1.2';
      described = described.filter((descriptor) => descriptor.protocol === want);
    }

    if (filter) {
      const lowerFilter = filter.toLowerCase();
      described = described.filter((descriptor) =>
        descriptor.name.toLowerCase().includes(lowerFilter),
      );
    }

    return asJsonResponse({
      success: true,
      filter,
      protocol,
      total: described.length,
      suites: described,
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

    const certificates = parseCertificateChain(rawHex);
    return asJsonResponse({
      success: true,
      certificateCount: certificates.length,
      // Each entry carries the full X.509 fields parseDerCertificate recovered
      // (subject/issuer/SAN/validity/keyUsage/basicConstraints) plus the SPKI
      // pin hash (publicKeySpkiSha256 / publicKeyPinBase64) used by Android
      // Network Security Config. Fields are undefined when the input bytes are
      // not a parseable DER certificate (only sha256/length are then returned).
      certificates,
      fingerprints: certificates.map((cert) => ({
        sha256: cert.sha256,
        length: cert.length,
        publicKeySpkiSha256: cert.publicKeySpkiSha256,
      })),
    });
  }
}
