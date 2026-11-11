/**
 * TLS-inspector full suite — covers the 12 tools the base `tls-inspector` suite leaves out.
 *
 * Ground truth:
 *  - tls_keylog_summarize / lookup_secret: NSS SSLKEYLOGFILE line semantics
 *  - tls_decrypt_payload: node:crypto AES-256-GCM roundtrip (mint → decrypt)
 *  - tls_keylog_seal / disable: envelope lifecycle reported honestly (ok=false when absent)
 *  - tls_cert_pin_bypass / _frida: strategy + instructions per target platform
 *  - net_raw_tcp / net_raw_udp: loopback echo roundtrip through real sockets
 */
import { createServer as createNetServer, createConnection } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import { createSocket as createUdpSocket } from 'node:dgram';
import { execFileSync } from 'node:child_process';
import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TLSKeyLogExtractor } from '@modules/tls-inspector';
import { TlsInspectorHandlers } from '@server/domains/tls-inspector/handlers/handler-class';
import { body, type BenchSuite } from '../harness';

const tmp = mkdtempSync(join(tmpdir(), 'jshook-bench-tlsfull-'));
process.once('exit', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* tmpdir */
  }
});

// Mint ephemeral self-signed key/cert via system OpenSSL for loopback TLS cases
const tlsKeyPath = join(tmp, 'tls-key.pem');
const tlsCertPath = join(tmp, 'tls-cert.pem');
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-keyout',
    tlsKeyPath,
    '-out',
    tlsCertPath,
    '-days',
    '1',
    '-nodes',
    '-subj',
    '/CN=127.0.0.1',
    '-sha256',
  ],
  { stdio: 'ignore' },
);
const TLS_KEY = readFileSync(tlsKeyPath, 'utf8');
const TLS_CERT = readFileSync(tlsCertPath, 'utf8');

const CLIENT_RANDOM = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const SECRET_HEX = '11'.repeat(48);
const CLIENT_RANDOM_2 = 'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1';
const keylogPath = join(tmp, 'sslkeylog.log');
writeFileSync(
  keylogPath,
  `CLIENT_RANDOM ${CLIENT_RANDOM} ${SECRET_HEX}\nCLIENT_RANDOM ${CLIENT_RANDOM_2} ${SECRET_HEX}\n`,
);
const keylogPathUncached = join(tmp, 'sslkeylog-uncached.log');
writeFileSync(
  keylogPathUncached,
  `CLIENT_RANDOM ${CLIENT_RANDOM} ${SECRET_HEX}\nCLIENT_RANDOM ${CLIENT_RANDOM_2} ${SECRET_HEX}\n`,
);

/** Fresh handler bound to a private keylog path so cases cannot leak into each other. */
function handlersFor(path: string): TlsInspectorHandlers {
  return new TlsInspectorHandlers(new TLSKeyLogExtractor(path));
}

/** Pick a free loopback port by listening on port 0 and reading it back. */
async function freeTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function freeUdpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = createUdpSocket('udp4');
    socket.on('error', reject);
    socket.bind(0, '127.0.0.1', () => {
      const addr = socket.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      socket.close(() => resolve(port));
    });
  });
}

/** Mint a real AES-256-GCM ciphertext the handler must decrypt back. */
function aesGcmFixture(plaintext: string) {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    encryptedHex: encrypted.toString('hex'),
    keyHex: key.toString('hex'),
    nonceHex: nonce.toString('hex'),
    authTagHex: cipher.getAuthTag().toString('hex'),
    plaintext,
  };
}

export const tlsInspectorFullSuite: BenchSuite = {
  name: 'tls-inspector-full',
  domain: 'tls-inspector',
  description:
    'Keylog summarize/lookup/seal/disable, AES-GCM payload decrypt, cert-pin bypass playbooks, raw TCP/UDP loopback echo',
  cases: [
    {
      name: 'tls_keylog_summarize/labels-and-unique-clients',
      tool: 'tls_keylog_summarize',
      origin: 'external-vector',
      reference:
        'NSS SSLKEYLOGFILE: two CLIENT_RANDOM lines with distinct client randoms summarize as 2 entries / 2 unique clients',
      run: () => handlersFor(keylogPath).handleTlsKeylogSummarize({ path: keylogPath }),
      validate: (v) => {
        const b = body(v);
        if (Number(b.totalEntries) !== 2) return `expected 2 entries, got ${b.totalEntries}`;
        if (Number(b.uniqueClientRandom) !== 2) {
          return `expected 2 unique clients, got ${b.uniqueClientRandom}`;
        }
        const labels = (b.labels as unknown[]) ?? [];
        if (!labels.some((l) => String(l).includes('CLIENT_RANDOM'))) {
          return `labels must carry CLIENT_RANDOM: ${JSON.stringify(labels)}`;
        }
        return true;
      },
    },
    {
      name: 'tls_decrypt_payload/aes-256-gcm-roundtrip',
      tool: 'tls_decrypt_payload',
      origin: 'external-vector',
      reference:
        'AES-256-GCM per NIST SP 800-38D: ciphertext minted by node:crypto must decrypt back to the exact plaintext',
      run: () => {
        const fx = aesGcmFixture('GET /bench HTTP/1.1\r\n\r\n');
        return handlersFor(keylogPath).handleTlsDecryptPayload(fx);
      },
      validate: (v) => {
        const b = body(v);
        if (b.ok !== true) return `decrypt failed: ${JSON.stringify(b).slice(0, 200)}`;
        if (b.isFailed !== false) return `isFailed must be false, got ${b.isFailed}`;
        return b.decrypted === 'GET /bench HTTP/1.1\r\n\r\n'
          ? true
          : `plaintext mismatch: ${JSON.stringify(b.decrypted)}`;
      },
    },
    {
      name: 'tls_keylog_lookup_secret/known-client-random',
      tool: 'tls_keylog_lookup_secret',
      origin: 'external-vector',
      reference:
        'NSS SSLKEYLOGFILE lookup: a client random present in the file resolves to its 48-byte TLS 1.3 secret',
      run: () =>
        handlersFor(keylogPathUncached).handleTlsKeylogLookupSecret({
          clientRandom: CLIENT_RANDOM,
        }),
      validate: (v) => {
        const b = body(v);
        if (b.ok !== true) return `lookup failed: ${JSON.stringify(b).slice(0, 200)}`;
        const secret = String(b.secret ?? '').toLowerCase();
        return secret === SECRET_HEX
          ? true
          : `secret mismatch: expected ${SECRET_HEX.slice(0, 16)}… got ${secret.slice(0, 16)}…`;
      },
    },
    {
      name: 'tls_keylog_lookup_secret/unknown-client-random',
      tool: 'tls_keylog_lookup_secret',
      origin: 'homemade',
      reference: 'a client random absent from the keylog must report ok=false and a null secret',
      run: () =>
        handlersFor(keylogPathUncached).handleTlsKeylogLookupSecret({
          clientRandom: 'ff'.repeat(32),
        }),
      validate: (v) => {
        const b = body(v);
        if (b.ok !== false) return `absent random must report ok=false, got ${b.ok}`;
        return b.secret === null ? true : `secret must be null, got ${JSON.stringify(b.secret)}`;
      },
    },
    {
      name: 'tls_keylog_seal/seals-existing-file',
      tool: 'tls_keylog_seal',
      origin: 'homemade',
      reference:
        'sealing an existing keylog writes a cipher envelope and reports entryCount matching the parsed lines',
      run: () => handlersFor(keylogPath).handleTlsKeylogSeal({}),
      validate: (v) => {
        const b = body(v);
        if (b.ok !== true) return `seal failed: ${JSON.stringify(b).slice(0, 200)}`;
        if (Number(b.entryCount) !== 2) return `entryCount expected 2, got ${b.entryCount}`;
        if (!String(b.cipherPath ?? '').endsWith('.sealed.json')) {
          return `cipherPath must be a .sealed.json envelope, got ${b.cipherPath}`;
        }
        return typeof b.keyHex === 'string' && b.keyHex.length === 64
          ? true
          : `keyHex must be 32 bytes of hex, got ${String(b.keyHex).length} chars`;
      },
    },
    {
      name: 'tls_keylog_seal/absent-file-is-honest',
      tool: 'tls_keylog_seal',
      origin: 'homemade',
      reference:
        'sealing a non-existent keylog reports ok=false with an error — never a fake envelope',
      run: () => handlersFor(join(tmp, 'does-not-exist.log')).handleTlsKeylogSeal({}),
      validate: (v) => {
        const b = body(v);
        if (b.ok !== false) return `missing file must report ok=false, got ${b.ok}`;
        return typeof b.error === 'string' && b.error.length > 0
          ? true
          : 'missing-file result must carry an error string';
      },
    },
    {
      name: 'tls_keylog_disable/reports-disabled',
      tool: 'tls_keylog_disable',
      origin: 'homemade',
      reference: 'disabling the keylog reports disabled=true and echoes the previous path',
      run: () => handlersFor(keylogPath).handleTlsKeylogDisable({ path: keylogPath }),
      validate: (v) => {
        const b = body(v);
        if (b.disabled !== true) return `expected disabled=true, got ${b.disabled}`;
        return String(b.previousPath ?? '').endsWith('sslkeylog.log')
          ? true
          : `previousPath must echo the bound path, got ${b.previousPath}`;
      },
    },
    {
      name: 'tls_cert_pin_bypass/target-playbooks',
      tool: 'tls_cert_pin_bypass',
      origin: 'homemade',
      reference:
        'bypass returns a per-platform strategy: android → trust-manager hook, ios → SecTrustEvaluate, desktop → verifier patch',
      run: async () => {
        const h = handlersFor(keylogPath);
        const android = body(await h.handleTlsCertPinBypass({ target: 'android' }));
        const ios = body(await h.handleTlsCertPinBypass({ target: 'ios' }));
        const desktop = body(await h.handleTlsCertPinBypass({ target: 'desktop' }));
        const invalid = body(await h.handleTlsCertPinBypass({ target: 'beos' }));
        return { android, ios, desktop, invalid };
      },
      validate: (v) => {
        const b = body(v);
        const android = b.android as Record<string, unknown>;
        const ios = b.ios as Record<string, unknown>;
        const desktop = b.desktop as Record<string, unknown>;
        const invalid = b.invalid as Record<string, unknown>;
        if (!String(android.bypassStrategy ?? '').includes('trust-manager')) {
          return `android strategy must hook the trust manager, got ${android.strategy}`;
        }
        if (!String(ios.bypassStrategy ?? '').includes('sec-trust')) {
          return `ios strategy must replace SecTrust evaluation, got ${ios.strategy}`;
        }
        if (!String(desktop.bypassStrategy ?? '').includes('verifier')) {
          return `desktop strategy must patch the verifier, got ${desktop.strategy}`;
        }
        if (!Array.isArray(android.instructions) || android.instructions.length === 0) {
          return 'android must carry non-empty instructions';
        }
        return typeof invalid.error === 'string'
          ? true
          : 'an unknown target must be rejected with an error';
      },
    },
    {
      name: 'tls_cert_pin_bypass_frida/manual-fallback',
      tool: 'tls_cert_pin_bypass_frida',
      origin: 'homemade',
      reference:
        'with no extension wired, the frida bypass falls back to manual instructions instead of claiming injection',
      run: () => handlersFor(keylogPath).handleBypassCertPinning({ target: 'android' }),
      validate: (v) => {
        const b = body(v);
        if (b.success !== true) return `expected success=true, got ${b.success}`;
        if (b.strategy !== 'manual-bypass') {
          return `expected manual-bypass fallback, got ${b.strategy}`;
        }
        const instructions = b.instructions as Record<string, unknown> | undefined;
        if (
          !instructions ||
          !Array.isArray(instructions.android) ||
          instructions.android.length === 0
        ) {
          return `manual instructions must cover android: ${JSON.stringify(instructions)}`;
        }
        return true;
      },
    },
    {
      name: 'net_raw_tcp_echo/loopback-roundtrip',
      tool: 'net_raw_tcp_send',
      origin: 'homemade',
      reference:
        'net_raw_tcp_send against a loopback echo server returns the echoed bytes as hex and text',
      run: async () => {
        const port = await freeTcpPort();
        const server = createNetServer((socket) => {
          socket.on('data', (chunk) => socket.write(chunk));
        });
        await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()));
        try {
          const h = handlersFor(keylogPath);
          return await h.handleRawTcpSend({
            host: '127.0.0.1',
            port,
            dataText: 'PING',
            timeout: 3000,
          });
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      validate: (v) => {
        const b = body(v);
        if (b.ok !== true) return `send failed: ${JSON.stringify(b).slice(0, 200)}`;
        if (Number(b.sentBytes) !== 4) return `sentBytes expected 4, got ${b.sentBytes}`;
        return b.responseText === 'PING'
          ? true
          : `echo mismatch: ${JSON.stringify(b.responseText)}`;
      },
    },
    {
      name: 'net_raw_tcp_listen/captures-connection',
      tool: 'net_raw_tcp_listen',
      origin: 'homemade',
      reference:
        'net_raw_tcp_listen captures the bytes a loopback client writes and reports receivedBytes + hex',
      run: async () => {
        const port = await freeTcpPort();
        const h = handlersFor(keylogPath);
        const listening = h.handleRawTcpListen({ port, timeout: 5000 });
        // Give the listener a tick to bind before the client dials.
        await new Promise((r) => setTimeout(r, 50));
        await new Promise<void>((resolve, reject) => {
          const client = createConnection({ host: '127.0.0.1', port }, () => {
            client.end(Buffer.from('LISTEN'));
          });
          client.on('close', () => resolve());
          client.on('error', reject);
        });
        return listening;
      },
      validate: (v) => {
        const b = body(v);
        if (b.ok !== true) return `listen failed: ${JSON.stringify(b).slice(0, 200)}`;
        if (Number(b.receivedBytes) !== 6)
          return `receivedBytes expected 6, got ${b.receivedBytes}`;
        return b.dataText === 'LISTEN' ? true : `data mismatch: ${JSON.stringify(b.dataText)}`;
      },
    },
    {
      name: 'net_raw_udp_echo/loopback-roundtrip',
      tool: 'net_raw_udp_send',
      origin: 'homemade',
      reference: 'net_raw_udp_send against a loopback UDP echo returns the echoed datagram',
      run: async () => {
        const port = await freeUdpPort();
        const server = createUdpSocket('udp4');
        server.on('message', (msg, rinfo) => server.send(msg, rinfo.port, rinfo.address));
        await new Promise<void>((resolve) => server.bind(port, '127.0.0.1', () => resolve()));
        try {
          const h = handlersFor(keylogPath);
          return await h.handleRawUdpSend({
            host: '127.0.0.1',
            port,
            dataText: 'UDP',
            timeout: 3000,
          });
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      validate: (v) => {
        const b = body(v);
        if (b.ok !== true) return `udp send failed: ${JSON.stringify(b).slice(0, 200)}`;
        return b.responseText === 'UDP' ? true : `echo mismatch: ${JSON.stringify(b.responseText)}`;
      },
    },
    {
      name: 'net_raw_udp_listen/captures-datagram',
      tool: 'net_raw_udp_listen',
      origin: 'homemade',
      reference:
        'net_raw_udp_listen captures a loopback datagram and reports receivedBytes, hex, and sender',
      run: async () => {
        const port = await freeUdpPort();
        const h = handlersFor(keylogPath);
        const listening = h.handleRawUdpListen({ port, timeout: 5000 });
        await new Promise((r) => setTimeout(r, 50));
        const client = createUdpSocket('udp4');
        await new Promise<void>((resolve, reject) => {
          client.send(Buffer.from('DGRAM'), port, '127.0.0.1', (err) =>
            err ? reject(err) : resolve(),
          );
        });
        client.close();
        return listening;
      },
      validate: (v) => {
        const b = body(v);
        if (b.ok !== true) return `udp listen failed: ${JSON.stringify(b).slice(0, 200)}`;
        if (Number(b.receivedBytes) !== 5)
          return `receivedBytes expected 5, got ${b.receivedBytes}`;
        return b.dataText === 'DGRAM' ? true : `data mismatch: ${JSON.stringify(b.dataText)}`;
      },
    },

    // ── Coverage batch 2026-11-11 (autoresearch): keylog_enable + loopback TCP session lifecycle ──
    {
      name: 'tls_keylog_enable/configures-sslkeylogfile',
      tool: 'tls_keylog_enable',
      origin: 'homemade',
      reference:
        'enables SSLKEYLOGFILE keylog capture and returns env variable and browser launch flag',
      run: async () => {
        const prev = process.env.SSLKEYLOGFILE;
        try {
          const h = handlersFor(join(tmp, 'keylog-enable.log'));
          return await h.handleTlsKeylogEnableTool({});
        } finally {
          if (prev === undefined) delete process.env.SSLKEYLOGFILE;
          else process.env.SSLKEYLOGFILE = prev;
        }
      },
      validate: (v) => {
        const b = body(v);
        if (b.enabled !== true || b.environmentVariable !== 'SSLKEYLOGFILE')
          return `expected enabled=true SSLKEYLOGFILE, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'tcp_open/loopback-echo-connect',
      tool: 'tcp_open',
      origin: 'homemade',
      reference: 'opens a persistent loopback TCP session against a local echo server',
      run: async () => {
        const server = createNetServer((s) => s.on('data', (d) => s.write(d)));
        await new Promise<void>((resolve, reject) => {
          server.on('error', reject);
          server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const h = handlersFor(keylogPath);
        try {
          const openRes = await h.handleTcpOpenTool({ host: '127.0.0.1', port, timeoutMs: 3000 });
          const parsed = body(openRes);
          if (typeof parsed.sessionId === 'string') {
            await h.handleTcpCloseTool({ sessionId: parsed.sessionId });
          }
          return openRes;
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      validate: (v) => {
        const b = body(v);
        if (b.ok !== true || typeof b.sessionId !== 'string' || b.kind !== 'tcp')
          return `expected ok=true sessionId, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'tcp_write/writes-payload-to-session',
      tool: 'tcp_write',
      origin: 'homemade',
      reference: 'writes UTF-8 payload bytes to an open loopback TCP session',
      run: async () => {
        const server = createNetServer((s) => s.on('data', (d) => s.write(d)));
        await new Promise<void>((resolve, reject) => {
          server.on('error', reject);
          server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const h = handlersFor(keylogPath);
        try {
          const open = body(
            await h.handleTcpOpenTool({ host: '127.0.0.1', port, timeoutMs: 3000 }),
          );
          const sessionId = String(open.sessionId ?? '');
          try {
            return await h.handleTcpWriteTool({ sessionId, dataText: 'HELLO\n' });
          } finally {
            if (sessionId) await h.handleTcpCloseTool({ sessionId });
          }
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      validate: (v) => {
        const b = body(v);
        if (b.ok !== true) return `tcp_write failed: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'tcp_read_until/reads-delimited-echo',
      tool: 'tcp_read_until',
      origin: 'homemade',
      reference: 'reads echoed payload up to newline delimiter from loopback TCP session',
      run: async () => {
        const server = createNetServer((s) => s.on('data', (d) => s.write(d)));
        await new Promise<void>((resolve, reject) => {
          server.on('error', reject);
          server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const h = handlersFor(keylogPath);
        try {
          const open = body(
            await h.handleTcpOpenTool({ host: '127.0.0.1', port, timeoutMs: 3000 }),
          );
          const sessionId = String(open.sessionId ?? '');
          try {
            await h.handleTcpWriteTool({ sessionId, dataText: 'ECHO\n' });
            return await h.handleTcpReadUntilTool({
              sessionId,
              delimiterText: '\n',
              timeoutMs: 3000,
            });
          } finally {
            if (sessionId) await h.handleTcpCloseTool({ sessionId });
          }
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      validate: (v) => {
        const b = body(v);
        if (b.ok !== true) return `tcp_read_until failed: ${JSON.stringify(b)}`;
        if (!JSON.stringify(b).includes('ECHO'))
          return `expected echoed ECHO in read result, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'tcp_close/closes-active-session',
      tool: 'tcp_close',
      origin: 'homemade',
      reference: 'closes an open loopback TCP session and removes it from session registry',
      run: async () => {
        const server = createNetServer((s) => s.on('data', (d) => s.write(d)));
        await new Promise<void>((resolve, reject) => {
          server.on('error', reject);
          server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const h = handlersFor(keylogPath);
        try {
          const open = body(
            await h.handleTcpOpenTool({ host: '127.0.0.1', port, timeoutMs: 3000 }),
          );
          return await h.handleTcpCloseTool({ sessionId: String(open.sessionId ?? '') });
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      validate: (v) => {
        const b = body(v);
        if (b.ok !== true) return `tcp_close failed: ${JSON.stringify(b)}`;
        return true;
      },
    },

    // ── Coverage batch 2 (2026-11-11 autoresearch): loopback TLS probe & session lifecycle ──
    {
      name: 'tls_probe_endpoint/loopback-self-signed',
      tool: 'tls_probe_endpoint',
      origin: 'external-vector',
      reference:
        'probes a local OpenSSL-backed TLS server and inspects negotiated TLS version and certificate CN=127.0.0.1',
      run: async () => {
        const server = createTlsServer({ key: TLS_KEY, cert: TLS_CERT }, (s) => s.end());
        await new Promise<void>((resolve, reject) => {
          server.on('error', reject);
          server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const h = handlersFor(keylogPath);
        try {
          return await h.handleTlsProbeEndpointTool({
            host: '127.0.0.1',
            port,
            allowInvalidCertificates: true,
            skipHostnameCheck: true,
            timeoutMs: 3000,
          });
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      validate: (v) => {
        const b = body(v);
        if (b.ok !== true) return `tls_probe_endpoint failed: ${JSON.stringify(b)}`;
        if (!JSON.stringify(b).includes('127.0.0.1'))
          return `missing peer cert subject 127.0.0.1: ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'tls_open/loopback-tls-connect',
      tool: 'tls_open',
      origin: 'homemade',
      reference: 'opens a persistent loopback TLS session with self-signed cert acceptance',
      run: async () => {
        const server = createTlsServer({ key: TLS_KEY, cert: TLS_CERT }, (s) =>
          s.on('data', (d) => s.write(d)),
        );
        await new Promise<void>((resolve, reject) => {
          server.on('error', reject);
          server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const h = handlersFor(keylogPath);
        try {
          const openRes = await h.handleTlsOpenTool({
            host: '127.0.0.1',
            port,
            allowInvalidCertificates: true,
            skipHostnameCheck: true,
            timeoutMs: 3000,
          });
          const parsed = body(openRes);
          if (typeof parsed.sessionId === 'string') {
            await h.handleTlsCloseTool({ sessionId: parsed.sessionId });
          }
          return openRes;
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      validate: (v) => {
        const b = body(v);
        if (b.ok !== true || typeof b.sessionId !== 'string' || b.kind !== 'tls')
          return `expected ok=true kind=tls sessionId, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'tls_write/writes-payload-to-tls-session',
      tool: 'tls_write',
      origin: 'homemade',
      reference: 'writes UTF-8 payload over an encrypted loopback TLS session',
      run: async () => {
        const server = createTlsServer({ key: TLS_KEY, cert: TLS_CERT }, (s) =>
          s.on('data', (d) => s.write(d)),
        );
        await new Promise<void>((resolve, reject) => {
          server.on('error', reject);
          server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const h = handlersFor(keylogPath);
        try {
          const open = body(
            await h.handleTlsOpenTool({
              host: '127.0.0.1',
              port,
              allowInvalidCertificates: true,
              skipHostnameCheck: true,
              timeoutMs: 3000,
            }),
          );
          const sessionId = String(open.sessionId ?? '');
          try {
            return await h.handleTlsWriteTool({ sessionId, dataText: 'TLS_PING\n' });
          } finally {
            if (sessionId) await h.handleTlsCloseTool({ sessionId });
          }
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      validate: (v) => {
        const b = body(v);
        if (b.ok !== true) return `tls_write failed: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'tls_read_until/reads-delimited-tls-echo',
      tool: 'tls_read_until',
      origin: 'homemade',
      reference: 'reads decrypted loopback echo up to newline delimiter from TLS session',
      run: async () => {
        const server = createTlsServer({ key: TLS_KEY, cert: TLS_CERT }, (s) =>
          s.on('data', (d) => s.write(d)),
        );
        await new Promise<void>((resolve, reject) => {
          server.on('error', reject);
          server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const h = handlersFor(keylogPath);
        try {
          const open = body(
            await h.handleTlsOpenTool({
              host: '127.0.0.1',
              port,
              allowInvalidCertificates: true,
              skipHostnameCheck: true,
              timeoutMs: 3000,
            }),
          );
          const sessionId = String(open.sessionId ?? '');
          try {
            await h.handleTlsWriteTool({ sessionId, dataText: 'TLS_ECHO\n' });
            return await h.handleTlsReadUntilTool({
              sessionId,
              delimiterText: '\n',
              timeoutMs: 3000,
            });
          } finally {
            if (sessionId) await h.handleTlsCloseTool({ sessionId });
          }
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      validate: (v) => {
        const b = body(v);
        if (b.ok !== true) return `tls_read_until failed: ${JSON.stringify(b)}`;
        if (!JSON.stringify(b).includes('TLS_ECHO'))
          return `expected echoed TLS_ECHO, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'tls_close/closes-active-tls-session',
      tool: 'tls_close',
      origin: 'homemade',
      reference: 'closes an open loopback TLS session and removes it cleanly',
      run: async () => {
        const server = createTlsServer({ key: TLS_KEY, cert: TLS_CERT }, (s) =>
          s.on('data', (d) => s.write(d)),
        );
        await new Promise<void>((resolve, reject) => {
          server.on('error', reject);
          server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const h = handlersFor(keylogPath);
        try {
          const open = body(
            await h.handleTlsOpenTool({
              host: '127.0.0.1',
              port,
              allowInvalidCertificates: true,
              skipHostnameCheck: true,
              timeoutMs: 3000,
            }),
          );
          return await h.handleTlsCloseTool({ sessionId: String(open.sessionId ?? '') });
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
      validate: (v) => {
        const b = body(v);
        if (b.ok !== true) return `tls_close failed: ${JSON.stringify(b)}`;
        return true;
      },
    },
  ],
};
