/**
 * FingerprintManager — generates and injects real-world browser fingerprints.
 *
 * Uses fingerprint-generator and fingerprint-injector packages (optional dependencies).
 * Falls back gracefully when packages are not installed.
 *
 * Singleton pattern — one fingerprint profile per MCP server session.
 */

import type { Page } from 'rebrowser-puppeteer-core';
import type { FingerprintProfile, FingerprintOptions } from './FingerprintManager.types';
import { logger } from '@utils/logger';

export class FingerprintManager {
  private static instance: FingerprintManager | null = null;
  private activeProfile: FingerprintProfile | null = null;
  private available: boolean | null = null;

  private constructor() {}

  static getInstance(): FingerprintManager {
    if (!FingerprintManager.instance) {
      FingerprintManager.instance = new FingerprintManager();
    }
    return FingerprintManager.instance;
  }

  /**
   * Check if fingerprint-generator and fingerprint-injector packages are installed.
   */
  isAvailable(): boolean {
    if (this.available !== null) return this.available;

    try {
      require.resolve('fingerprint-generator');
      require.resolve('fingerprint-injector');
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  /**
   * Generate a fingerprint profile using real-world datasets.
   * Returns null if packages are not installed.
   */
  async generateFingerprint(options?: FingerprintOptions): Promise<FingerprintProfile | null> {
    if (!this.isAvailable()) {
      logger.warn(
        'fingerprint-generator not installed. Run: pnpm add fingerprint-generator fingerprint-injector'
      );
      return null;
    }

    try {
      const { FingerprintGenerator } = await import('fingerprint-generator' as string);
      const generator = new FingerprintGenerator() as {
        getFingerprint(opts: Record<string, unknown>): {
          fingerprint: Record<string, unknown>;
          headers: Record<string, string>;
        };
      };

      const fpOptions: Record<string, unknown> = {};
      if (options?.os) {
        const osMap: Record<string, string> = {
          windows: 'windows',
          macos: 'macos',
          linux: 'linux',
        };
        fpOptions.operatingSystems = [osMap[options.os] ?? 'windows'];
      }
      if (options?.browser) {
        fpOptions.browsers = [options.browser];
      }
      if (options?.locale) {
        fpOptions.locales = [options.locale];
      }
      if (options?.screen) {
        fpOptions.screen = options.screen;
      }

      const result = generator.getFingerprint(fpOptions);

      this.activeProfile = {
        fingerprint: result.fingerprint,
        headers: result.headers ?? {},
        generatedAt: Date.now(),
        os: options?.os ?? 'windows',
        browser: (options?.browser ?? 'chrome') as FingerprintProfile['browser'],
      };

      logger.info(
        `Fingerprint generated for ${this.activeProfile.os}/${this.activeProfile.browser}`
      );
      return this.activeProfile;
    } catch (err) {
      logger.error('Failed to generate fingerprint:', err);
      return null;
    }
  }

  /**
   * Inject the given fingerprint profile into a page.
   * Must be called BEFORE StealthScripts.injectAll().
   */
  async injectFingerprint(
    page: Page,
    profile: FingerprintProfile | Record<string, unknown>
  ): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('fingerprint-injector not installed');
    }

    try {
      const { newInjectedPage } = await import('fingerprint-injector' as string) as {
        newInjectedPage: (
          page: Page,
          opts: { fingerprint: Record<string, unknown> }
        ) => Promise<void>;
      };

      const fp = 'fingerprint' in profile ? (profile as FingerprintProfile).fingerprint : profile;
      await newInjectedPage(page, { fingerprint: fp });

      logger.info('Fingerprint injected into page');
    } catch (err) {
      logger.error('Failed to inject fingerprint:', err);
      throw err;
    }
  }

  /**
   * Get the currently cached fingerprint profile.
   */
  getActiveProfile(): FingerprintProfile | null {
    return this.activeProfile;
  }

  /**
   * Clear the cached fingerprint profile.
   */
  clearProfile(): void {
    this.activeProfile = null;
  }

  /** Reset singleton for testing purposes. */
  static resetInstance(): void {
    FingerprintManager.instance = null;
  }
}
