import type { PageController } from '@server/domains/shared/modules';
import { StealthScripts } from '@server/domains/shared/modules';
import { argString } from '@server/domains/shared/parse-args';
import { CDPTimingProxy } from '@modules/stealth/CDPTimingProxy';
import type { CDPTimingOptions } from '@modules/stealth/CDPTimingProxy.types';
import { DEFAULT_TIMING_OPTIONS } from '@modules/stealth/CDPTimingProxy.types';
import { logger } from '@utils/logger';

interface StealthInjectionHandlersDeps {
  pageController: PageController;
  getActiveDriver: () => 'chrome' | 'camoufox';
}

/** Module-level jitter configuration shared across handler calls. */
const jitterOptions: CDPTimingOptions = { ...DEFAULT_TIMING_OPTIONS };
let fingerprintManagerInstance: FingerprintManagerLike | null = null;

interface FingerprintManagerLike {
  isAvailable(): boolean;
  generateFingerprint(options?: Record<string, unknown>): Promise<any>;
  injectFingerprint(page: any, profile: any): Promise<void>;
  getActiveProfile(): any;
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

export class StealthInjectionHandlers {
  constructor(private deps: StealthInjectionHandlersDeps) {}

  async handleStealthInject(_args: Record<string, unknown>) {
    if (this.deps.getActiveDriver() === 'camoufox') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                driver: 'camoufox',
                message:
                  'Camoufox uses C++ engine-level fingerprint spoofing — JS-layer stealth scripts are not needed and have been skipped.',
              },
              null,
              2,
            ),
          },
        ],
      };
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

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Stealth scripts injected successfully',
              fingerprintApplied,
              _nextStepHint:
                'Stealth patches are now active. ' +
                'Next: navigate to your target URL with page_navigate. ' +
                'Do NOT call stealth_inject again — it only needs to run once per page.',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleStealthSetUserAgent(args: Record<string, unknown>) {
    const platform = argString(args, 'platform', 'windows') as 'windows' | 'mac' | 'linux';
    const page = await this.deps.pageController.getPage();

    await StealthScripts.setRealisticUserAgent(page, platform);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              platform,
              message: `User-Agent set for ${platform}`,
              _nextStepHint:
                'User-Agent is now configured. ' +
                'Next: call stealth_inject to apply all anti-detection patches, ' +
                'then page_navigate to your target URL.',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleStealthConfigureJitter(args: Record<string, unknown>) {
    if (args.enabled !== undefined) jitterOptions.enabled = Boolean(args.enabled);
    if (typeof args.minDelayMs === 'number') jitterOptions.minDelayMs = args.minDelayMs;
    if (typeof args.maxDelayMs === 'number') jitterOptions.maxDelayMs = args.maxDelayMs;
    if (args.burstMode !== undefined) jitterOptions.burstMode = Boolean(args.burstMode);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              jitterOptions,
              message: `CDP timing jitter ${jitterOptions.enabled ? 'enabled' : 'disabled'}: ${jitterOptions.minDelayMs}-${jitterOptions.maxDelayMs}ms${jitterOptions.burstMode ? ' (burst mode)' : ''}`,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleStealthGenerateFingerprint(args: Record<string, unknown>) {
    const fm = await getFingerprintManager();

    if (!fm?.isAvailable()) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message:
                  'fingerprint-generator/fingerprint-injector packages are not installed. Install them with: pnpm add fingerprint-generator fingerprint-injector',
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const profile = await fm.generateFingerprint({
      os: args.os,
      browser: args.browser ?? 'chrome',
      locale: args.locale ?? 'en-US',
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              profile,
              message:
                'Fingerprint generated and cached. It will be auto-applied on next stealth_inject.',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleStealthVerify(_args: Record<string, unknown>) {
    const page = await this.deps.pageController.getPage();

    try {
      const mod = await import('@modules/stealth/StealthVerifier');
      const verifier = new mod.StealthVerifier();
      const result = await verifier.verify(page);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: `Stealth verification failed: ${err instanceof Error ? err.message : String(err)}`,
              },
              null,
              2,
            ),
          },
        ],
      };
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
