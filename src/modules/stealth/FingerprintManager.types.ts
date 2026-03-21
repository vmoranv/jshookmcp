/**
 * FingerprintManager types — browser fingerprint generation and injection.
 */

export interface FingerprintProfile {
  /** Raw fingerprint data from fingerprint-generator */
  fingerprint: Record<string, unknown>;
  /** HTTP headers to set (User-Agent, Accept-Language, etc.) */
  headers: Record<string, string>;
  /** Generation timestamp */
  generatedAt: number;
  /** Target OS */
  os: 'windows' | 'macos' | 'linux';
  /** Target browser */
  browser: 'chrome' | 'firefox' | 'safari' | 'edge';
}

export interface FingerprintOptions {
  /** Target OS for fingerprint generation */
  os?: 'windows' | 'macos' | 'linux';
  /** Target browser */
  browser?: 'chrome' | 'firefox';
  /** Locale string (e.g., 'en-US') */
  locale?: string;
  /** Screen dimensions */
  screen?: { width: number; height: number };
}
