export interface CryptoKeywordRule {
  category: 'symmetric' | 'asymmetric' | 'hash' | 'encoding' | 'mode' | 'padding' | 'other';
  keywords: string[];
  confidence: number;
  description?: string;
}

export interface CryptoLibraryRule {
  name: string;
  patterns: string[];
  versionPattern?: RegExp;
  confidence: number;
  features?: string[];
}

export interface CryptoConstantRule {
  name: string;
  type: 'symmetric' | 'asymmetric' | 'hash' | 'other';
  values: number[];
  confidence: number;
  description?: string;
}

export interface CryptoPatternRule {
  name: string;
  type: 'symmetric' | 'asymmetric' | 'hash' | 'encoding' | 'other';
  pattern: {
    type: 'ast' | 'regex' | 'custom';
    matcher: string | RegExp | ((code: string) => boolean);
  };
  confidence: number;
  description?: string;
}

export interface SecurityRule {
  name: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  check: (context: SecurityRuleContext) => boolean;
  message: string;
  recommendation?: string;
}

export interface SecurityRuleContext {
  algorithm?: string;
  mode?: string;
  padding?: string;
  keySize?: number;
  [key: string]: unknown;
}

export class CryptoRulesManager {
  private keywordRules: Map<string, CryptoKeywordRule> = new Map();
  private libraryRules: Map<string, CryptoLibraryRule> = new Map();
  private constantRules: Map<string, CryptoConstantRule> = new Map();
  private patternRules: Map<string, CryptoPatternRule> = new Map();
  private securityRules: Map<string, SecurityRule> = new Map();

  constructor() {
    this.loadDefaultRules();
  }

  private loadDefaultRules(): void {
    this.addKeywordRule({
      category: 'symmetric',
      keywords: [
        'AES',
        'DES',
        '3DES',
        'TripleDES',
        'RC4',
        'RC2',
        'Blowfish',
        'Twofish',
        'ChaCha20',
        'Camellia',
        'SEED',
        'ARIA',
        'SM4',
      ],
      confidence: 0.6,
      description: 'Symmetric encryption algorithms',
    });

    this.addKeywordRule({
      category: 'asymmetric',
      keywords: [
        'RSA',
        'ECC',
        'ECDSA',
        'ECDH',
        'DSA',
        'ElGamal',
        'Ed25519',
        'X25519',
        'Curve25519',
        'secp256k1',
        'SM2',
      ],
      confidence: 0.6,
      description: 'Asymmetric encryption algorithms',
    });

    this.addKeywordRule({
      category: 'hash',
      keywords: [
        'MD5',
        'SHA1',
        'SHA-1',
        'SHA256',
        'SHA-256',
        'SHA512',
        'SHA-512',
        'SHA3',
        'BLAKE2',
        'BLAKE3',
        'RIPEMD',
        'Whirlpool',
        'SM3',
        'Keccak',
      ],
      confidence: 0.6,
      description: 'Hash algorithms',
    });

    this.addKeywordRule({
      category: 'encoding',
      keywords: ['Base64', 'Base32', 'Base58', 'Hex', 'UTF8', 'UTF-8', 'Latin1', 'ASCII'],
      confidence: 0.5,
      description: 'Encoding methods',
    });

    this.addKeywordRule({
      category: 'mode',
      keywords: ['CBC', 'ECB', 'CTR', 'GCM', 'CFB', 'OFB', 'XTS', 'CCM'],
      confidence: 0.7,
      description: 'Block cipher modes',
    });

    this.addKeywordRule({
      category: 'padding',
      keywords: ['PKCS7', 'PKCS5', 'PKCS1', 'ISO10126', 'ZeroPadding', 'NoPadding', 'OAEP', 'PSS'],
      confidence: 0.7,
      description: 'Padding schemes',
    });

    this.addLibraryRule({
      name: 'CryptoJS',
      patterns: ['CryptoJS', 'crypto-js'],
      versionPattern: /CryptoJS\.version\s*=\s*['"]([^'"]+)['"]/,
      confidence: 0.9,
      features: [
        'AES',
        'DES',
        'TripleDES',
        'RC4',
        'Rabbit',
        'MD5',
        'SHA1',
        'SHA256',
        'SHA512',
        'HMAC',
        'PBKDF2',
      ],
    });

    this.addLibraryRule({
      name: 'JSEncrypt',
      patterns: ['JSEncrypt', 'jsencrypt'],
      versionPattern: /version:\s*['"]([^'"]+)['"]/,
      confidence: 0.9,
      features: ['RSA'],
    });

    this.addLibraryRule({
      name: 'forge',
      patterns: ['forge.', 'node-forge'],
      versionPattern: /forge\.version\s*=\s*['"]([^'"]+)['"]/,
      confidence: 0.9,
      features: ['RSA', 'AES', 'DES', '3DES', 'MD5', 'SHA1', 'SHA256', 'SHA512', 'HMAC', 'PBKDF2'],
    });

    this.addLibraryRule({
      name: 'sjcl',
      patterns: ['sjcl.'],
      versionPattern: /sjcl\.version\s*=\s*['"]([^'"]+)['"]/,
      confidence: 0.9,
      features: ['AES', 'SHA256', 'HMAC', 'PBKDF2', 'CCM', 'GCM'],
    });

    this.addLibraryRule({
      name: 'Web Crypto API',
      patterns: ['crypto.subtle', 'window.crypto.subtle', 'self.crypto.subtle'],
      confidence: 0.95,
      features: [
        'AES-CBC',
        'AES-CTR',
        'AES-GCM',
        'RSA-OAEP',
        'RSA-PSS',
        'ECDSA',
        'ECDH',
        'SHA-1',
        'SHA-256',
        'SHA-384',
        'SHA-512',
        'HMAC',
        'PBKDF2',
      ],
    });

    this.addLibraryRule({
      name: 'asmCrypto',
      patterns: ['asmCrypto'],
      confidence: 0.9,
      features: ['AES', 'RSA', 'SHA256', 'HMAC', 'PBKDF2'],
    });

    this.addLibraryRule({
      name: 'TweetNaCl',
      patterns: ['nacl.', 'tweetnacl'],
      confidence: 0.9,
      features: ['Curve25519', 'Ed25519', 'Salsa20', 'Poly1305'],
    });

    this.addLibraryRule({
      name: 'elliptic',
      patterns: ['elliptic', 'ec.keyFromPrivate', 'ec.keyFromPublic'],
      confidence: 0.9,
      features: ['ECDSA', 'ECDH', 'secp256k1'],
    });

    this.addConstantRule({
      name: 'MD5',
      type: 'hash',
      values: [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476],
      confidence: 0.95,
      description: 'MD5 initialization vector',
    });

    this.addConstantRule({
      name: 'SHA1',
      type: 'hash',
      values: [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0],
      confidence: 0.95,
      description: 'SHA-1 initialization vector',
    });

    this.addConstantRule({
      name: 'SHA256',
      type: 'hash',
      values: [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
      ],
      confidence: 0.95,
      description: 'SHA-256 initialization vector',
    });

    this.addConstantRule({
      name: 'AES S-box',
      type: 'symmetric',
      values: [0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5],
      confidence: 0.9,
      description: 'AES S-box first 8 values',
    });

    this.addSecurityRule({
      name: 'weak-md5',
      severity: 'high',
      check: (ctx) => ctx.algorithm === 'MD5',
      message: 'MD5 is cryptographically broken and should not be used',
      recommendation: 'Use SHA-256 or SHA-3 instead',
    });

    this.addSecurityRule({
      name: 'weak-sha1',
      severity: 'high',
      check: (ctx) => ctx.algorithm === 'SHA1' || ctx.algorithm === 'SHA-1',
      message: 'SHA-1 is deprecated and vulnerable to collision attacks',
      recommendation: 'Use SHA-256 or SHA-3 instead',
    });

    this.addSecurityRule({
      name: 'weak-des',
      severity: 'critical',
      check: (ctx) => ctx.algorithm === 'DES',
      message: 'DES has a very small key size (56 bits) and is easily broken',
      recommendation: 'Use AES-256 instead',
    });

    this.addSecurityRule({
      name: 'weak-rc4',
      severity: 'critical',
      check: (ctx) => ctx.algorithm === 'RC4',
      message: 'RC4 has known vulnerabilities and should not be used',
      recommendation: 'Use AES-GCM or ChaCha20-Poly1305 instead',
    });

    this.addSecurityRule({
      name: 'ecb-mode',
      severity: 'high',
      check: (ctx) => ctx.mode === 'ECB',
      message: 'ECB mode is insecure as it does not provide semantic security',
      recommendation: 'Use CBC, CTR, or GCM mode instead',
    });

    this.addSecurityRule({
      name: 'no-padding',
      severity: 'medium',
      check: (ctx) => ctx.padding === 'NoPadding' && ctx.mode !== 'CTR' && ctx.mode !== 'GCM',
      message: 'Using no padding with non-streaming modes can be insecure',
      recommendation: 'Use PKCS7 padding or switch to CTR/GCM mode',
    });

    this.addSecurityRule({
      name: 'short-key',
      severity: 'high',
      check: (ctx) => Boolean(ctx.keySize && ctx.keySize < 128),
      message: 'Key size is too short and vulnerable to brute force attacks',
      recommendation: 'Use at least 128-bit keys, preferably 256-bit',
    });
  }

  addKeywordRule(rule: CryptoKeywordRule): void {
    this.keywordRules.set(rule.category, rule);
  }

  addLibraryRule(rule: CryptoLibraryRule): void {
    this.libraryRules.set(rule.name, rule);
  }

  addConstantRule(rule: CryptoConstantRule): void {
    this.constantRules.set(rule.name, rule);
  }

  addPatternRule(rule: CryptoPatternRule): void {
    this.patternRules.set(rule.name, rule);
  }

  addSecurityRule(rule: SecurityRule): void {
    this.securityRules.set(rule.name, rule);
  }

  getKeywordRules(): CryptoKeywordRule[] {
    return Array.from(this.keywordRules.values());
  }

  getLibraryRules(): CryptoLibraryRule[] {
    return Array.from(this.libraryRules.values());
  }

  getConstantRules(): CryptoConstantRule[] {
    return Array.from(this.constantRules.values());
  }

  getPatternRules(): CryptoPatternRule[] {
    return Array.from(this.patternRules.values());
  }

  getSecurityRules(): SecurityRule[] {
    return Array.from(this.securityRules.values());
  }

  loadFromJSON(json: string): void {
    try {
      const rules = JSON.parse(json);

      if (rules.keywords) {
        rules.keywords.forEach((rule: CryptoKeywordRule) => this.addKeywordRule(rule));
      }

      if (rules.libraries) {
        rules.libraries.forEach((rule: CryptoLibraryRule) => this.addLibraryRule(rule));
      }

      if (rules.constants) {
        rules.constants.forEach((rule: CryptoConstantRule) => this.addConstantRule(rule));
      }
    } catch (error) {
      throw new Error(`Failed to load rules from JSON: ${error}`);
    }
  }

  exportToJSON(): string {
    return JSON.stringify(
      {
        keywords: this.getKeywordRules(),
        libraries: this.getLibraryRules(),
        constants: this.getConstantRules(),
        patterns: this.getPatternRules(),
        security: this.getSecurityRules(),
      },
      null,
      2
    );
  }
}
