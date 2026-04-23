import type { PageController } from '@server/domains/shared/modules';
import { StealthScripts } from '@server/domains/shared/modules';
import { argString } from '@server/domains/shared/parse-args';
import { CDPTimingProxy } from '@modules/stealth/CDPTimingProxy';
import type { CDPTimingOptions } from '@modules/stealth/CDPTimingProxy.types';
import { DEFAULT_TIMING_OPTIONS } from '@modules/stealth/CDPTimingProxy.types';
import { logger } from '@utils/logger';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';

interface StealthInjectionHandlersDeps {
  pageController: PageController;
  getActiveDriver: () => 'chrome' | 'camoufox';
}

/** Module-level jitter configuration shared across handler calls. */
const jitterOptions: CDPTimingOptions = { ...DEFAULT_TIMING_OPTIONS };
let fingerprintManagerInstance: FingerprintManagerLike | null = null;

interface FingerprintManagerLike {
  isAvailable(): boolean;
  generateFingerprint(options?: Record<string, unknown>): Promise<unknown>;
  injectFingerprint(page: unknown, profile: unknown): Promise<void>;
  getActiveProfile(): unknown;
}

async function getFingerprintManager(): Promise<FingerprintManagerLike | null> {
  if (fingerprintManagerInstance) return fingerprintManagerInstance;
  try {
    const mod = await import('@modules/stealth/FingerprintManager');
    fingerprintManagerInstance = mod.FingerprintManager.getInstance();
    return fingerprintManagerInstance;
  } catch {
    return null;
  }
}

/** @internal Reset the cached FingerprintManager instance. Exported for testing only. */
export function _resetFingerprintCacheForTesting(): void {
  fingerprintManagerInstance = null;
}

export class StealthInjectionHandlers {
  constructor(private deps: StealthInjectionHandlersDeps) {}

  async handleStealthInject(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      if (this.deps.getActiveDriver() === 'camoufox') {
        return R.ok().build({
          driver: 'camoufox',
          message:
            'Camoufox uses C++ engine-level fingerprint spoofing — JS-layer stealth scripts are not needed and have been skipped.',
        });
      }

      const page = await this.deps.pageController.getPage();

      // Inject fingerprint BEFORE stealth scripts (if available)
      const fm = await getFingerprintManager();
      let fingerprintApplied = false;
      if (fm?.isAvailable()) {
        try {
          let profile = fm.getActiveProfile();
          if (!profile) {
            profile = await fm.generateFingerprint();
          }
          if (profile) {
            await fm.injectFingerprint(page, profile);
            fingerprintApplied = true;
          }
        } catch (err) {
          logger.warn('Fingerprint injection failed, falling back to StealthScripts:', err);
        }
      }

      await StealthScripts.injectAll(page);

      return R.ok().build({
        message: 'Stealth scripts injected successfully',
        fingerprintApplied,
        _nextStepHint:
          'Stealth patches are now active. ' +
          'Next: navigate to your target URL with page_navigate. ' +
          'Do NOT call stealth_inject again — it only needs to run once per page.',
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleStealthSetUserAgent(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const platform = argString(args, 'platform', 'windows') as 'windows' | 'mac' | 'linux';
      const page = await this.deps.pageController.getPage();

      await StealthScripts.setRealisticUserAgent(page, platform);

      return R.ok().build({
        platform,
        message: `User-Agent set for ${platform}`,
        _nextStepHint:
          'User-Agent is now configured. ' +
          'Next: call stealth_inject to apply all anti-detection patches, ' +
          'then page_navigate to your target URL.',
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleStealthConfigureJitter(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      if (args.enabled !== undefined) jitterOptions.enabled = Boolean(args.enabled);
      if (typeof args.minDelayMs === 'number') jitterOptions.minDelayMs = args.minDelayMs;
      if (typeof args.maxDelayMs === 'number') jitterOptions.maxDelayMs = args.maxDelayMs;
      if (args.burstMode !== undefined) jitterOptions.burstMode = Boolean(args.burstMode);

      return R.ok().build({
        jitterOptions,
        message: `CDP timing jitter ${jitterOptions.enabled ? 'enabled' : 'disabled'}: ${jitterOptions.minDelayMs}-${jitterOptions.maxDelayMs}ms${jitterOptions.burstMode ? ' (burst mode)' : ''}`,
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleStealthGenerateFingerprint(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      // Route to camoufox-native fingerprint generation when driver=camoufox
      if (this.deps.getActiveDriver() === 'camoufox') {
        try {
          const fingerprints = await import('camoufox-js/fingerprints');
          const os = argString(args, 'os', 'windows');
          const fp = await fingerprints.generateFingerprint(os);
          return R.ok().build({
            fingerprint: fp,
            driver: 'camoufox',
            message:
              'Fingerprint generated using camoufox native engine. Apply via browser_launch(fingerprint=...) before launching.',
          });
        } catch (err) {
          return R.fail(
            `Camoufox fingerprint generation failed: ${err instanceof Error ? err.message : String(err)}`,
          ).build();
        }
      }

      const fm = await getFingerprintManager();

      if (!fm?.isAvailable()) {
        return R.fail(
          'fingerprint-generator/fingerprint-injector packages are not installed. Install them with: pnpm add fingerprint-generator fingerprint-injector',
        ).build();
      }

      const profile = await fm.generateFingerprint({
        os: args.os,
        browser: args.browser ?? 'chrome',
        locale: args.locale ?? 'en-US',
      });

      return R.ok().build({
        profile,
        message:
          'Fingerprint generated and cached. It will be auto-applied on next stealth_inject.',
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handleStealthVerify(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const page = await this.deps.pageController.getPage();
      const mod = await import('@modules/stealth/StealthVerifier');
      const verifier = new mod.StealthVerifier();
      const result = await verifier.verify(page);

      return R.ok()
        .merge(result as any)
        .build();
    } catch (err) {
      return R.fail(
        `Stealth verification failed: ${err instanceof Error ? err.message : String(err)}`,
      ).build();
    }
  }

  async handleCamoufoxGeolocation(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const locale = argString(args, 'locale');
      if (!locale) {
        return R.fail('locale is required (e.g. "en-US", "zh-CN")').build();
      }

      let geo: { latitude: number; longitude: number; accuracy: number };
      try {
        const localeMod = await import('camoufox-js/locale');
        geo = await localeMod.getGeolocation(locale);
      } catch (err) {
        return R.fail(
          `Camoufox locale module unavailable: ${err instanceof Error ? err.message : String(err)}. Ensure camoufox-js is installed.`,
        ).build();
      }

      let publicIp: string | null = null;
      const proxy = argString(args, 'proxy');
      if (proxy) {
        try {
          const ipMod = await import('camoufox-js/ip');
          publicIp = await ipMod.publicIP(proxy);
        } catch {
          // Optional — IP lookup failure is non-critical
        }
      }

      return R.ok().build({ locale, geolocation: geo, publicIp });
    } catch (e) {
      return R.fail(e).build();
    }
  }
}

/** Get the current jitter options (for use by other modules). */
export function getJitterOptions(): CDPTimingOptions {
  return { ...jitterOptions };
}

/** Create a jitter-wrapped CDP session using current configuration. */
export function createJitteredSession(session: {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  on: (event: string, handler: (params: unknown) => void) => void;
  off: (event: string, handler: (params: unknown) => void) => void;
}): CDPTimingProxy {
  return new CDPTimingProxy(session, jitterOptions);
}
