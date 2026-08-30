import type { Tool } from '@modelcontextprotocol/server';
import { objectTool, TLS_VERSION_VALUES } from './support';

export const tlsAnalysisTools: Tool[] = [
  objectTool('tls_keylog_enable', 'Enable SSLKEYLOGFILE output for TLS library clients.'),
  objectTool('tls_keylog_parse', 'Parse an SSLKEYLOGFILE and summarize available key material.', {
    path: {
      type: 'string',
      description: 'Path to SSLKEYLOGFILE',
    },
  }),
  objectTool(
    'tls_keylog_disable',
    'Disable SSLKEYLOGFILE capture and unset the environment variable.',
    {
      path: {
        type: 'string',
        description: 'Path to disable',
      },
    },
  ),
  objectTool(
    'tls_keylog_seal',
    'Encrypt the current keylog file in place with a fresh ephemeral key and securely wipe the ' +
      'plaintext source. Mitigates disk-forensics exposure (pagefile/hibernation/TEMP scraping) ' +
      'of captured TLS secrets. The returned keyHex is not persisted anywhere — hold onto it to ' +
      'decrypt the sealed envelope later, or it is unrecoverable once the process exits.',
    {},
  ),
  objectTool(
    'tls_decrypt_payload',
    'Decrypt a TLS payload using a provided key, nonce, and algorithm.',
    {
      encryptedHex: {
        type: 'string',
        description: 'Hex-encoded encrypted payload',
      },
      keyHex: {
        type: 'string',
        description: 'Hex-encoded decryption key',
      },
      nonceHex: {
        type: 'string',
        description: 'Hex-encoded nonce/IV',
      },
      algorithm: {
        type: 'string',
        description: 'Cipher algorithm',
        default: 'aes-256-gcm',
      },
      authTagHex: {
        type: 'string',
        description: 'Hex-encoded authentication tag',
      },
    },
    ['encryptedHex', 'keyHex', 'nonceHex'],
  ),
  objectTool(
    'tls_keylog_summarize',
    'Summarize an SSLKEYLOGFILE: per-label distribution, secret-type classification (TLS 1.2 master-secret vs TLS 1.3 traffic-secret kinds), TLS version inference, and unique session (client_random) count.',
    {
      content: {
        type: 'string',
        description: 'Inline keylog content to summarize',
      },
      path: {
        type: 'string',
        description: 'Path to a keylog file to summarize (used when content is not provided)',
      },
    },
  ),
  objectTool(
    'tls_keylog_lookup_secret',
    'Look up a TLS secret by client random hex from the parsed keylog.',
    {
      clientRandom: {
        type: 'string',
        description: 'Hex-encoded client random',
      },
      label: {
        type: 'string',
        description: 'Optional label filter',
      },
    },
    ['clientRandom'],
  ),
  objectTool(
    'tls_cert_pin_bypass',
    'Return a certificate pinning bypass strategy for the selected platform.',
    {
      target: {
        type: 'string',
        enum: ['android', 'ios', 'desktop'],
        description: 'Target platform for bypass strategy',
      },
    },
    ['target'],
  ),
  objectTool(
    'tls_parse_handshake',
    'Parse TLS handshake metadata from raw hex. For payload decryption, use tls_decrypt_payload with explicit keyHex/nonceHex/authTagHex.',
    {
      rawHex: {
        type: 'string',
        description: 'Hex-encoded TLS handshake record',
      },
    },
    ['rawHex'],
  ),
  objectTool(
    'tls_cipher_suites',
    'List TLS cipher suites with IANA id, protocol, key-exchange / authentication / encryption / MAC split, and AEAD flag (each dimension derived from the suite name).',
    {
      filter: {
        type: 'string',
        description: 'Keyword filter for cipher suite names (substring match)',
      },
      protocol: {
        type: 'string',
        enum: ['all', '1.3', '1.2'],
        default: 'all',
        description: 'Filter by TLS protocol version',
      },
    },
  ),
  objectTool(
    'tls_parse_certificate',
    'Parse a TLS Certificate message from raw hex and extract X.509 details (subject/issuer/SAN/validity/keyUsage), SHA-256 fingerprint, and SPKI pin hash (Android Network Security Config / HPKP format).',
    {
      rawHex: {
        type: 'string',
        description: 'Hex-encoded certificate data',
      },
    },
    ['rawHex'],
  ),
  objectTool(
    'tls_probe_endpoint',
    'Probe a TLS endpoint and report handshake and certificate details.',
    {
      host: {
        type: 'string',
        description: 'Target host name or IP address',
      },
      port: {
        type: 'number',
        default: 443,
        description: 'Target TLS port',
      },
      servername: {
        type: 'string',
        description: 'Optional SNI and hostname validation override',
      },
      alpnProtocols: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional ALPN protocols to offer',
      },
      timeoutMs: {
        type: 'number',
        default: 5000,
        description: 'Probe timeout in milliseconds',
      },
      minVersion: {
        type: 'string',
        enum: [...TLS_VERSION_VALUES],
        description: 'Optional minimum TLS version',
      },
      maxVersion: {
        type: 'string',
        enum: [...TLS_VERSION_VALUES],
        description: 'Optional maximum TLS version',
      },
      caPem: {
        type: 'string',
        description: 'Optional PEM-encoded CA bundle',
      },
      caPath: {
        type: 'string',
        description: 'Optional path to a PEM-encoded CA bundle',
      },
      allowInvalidCertificates: {
        type: 'boolean',
        default: false,
        description: 'Allow untrusted certificate chains while still reporting the failure',
      },
      skipHostnameCheck: {
        type: 'boolean',
        default: false,
        description: 'Skip hostname verification while still reporting the requested target',
      },
    },
    ['host'],
  ),
];
