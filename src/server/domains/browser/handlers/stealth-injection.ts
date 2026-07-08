import type { PageController } from '@server/domains/shared/modules/collector';
import { StealthScripts } from '@server/domains/shared/modules';
import { argString, argBool, argNumber } from '@server/domains/shared/parse-args';
import { FONT_FALLBACK_PROBE_LIST, FONT_LOCAL_ENUMERATE_MAX } from '@src/constants/browser';
import { createStub } from '@server/domains/shared/capabilities';
import { CDPTimingProxy } from '@modules/stealth/CDPTimingProxy';
import type { CDPTimingOptions } from '@modules/stealth/CDPTimingProxy.types';
import { DEFAULT_TIMING_OPTIONS } from '@modules/stealth/CDPTimingProxy.types';
import { SessionProfileManager } from '@modules/stealth/SessionProfileManager';
import type { SessionProfile } from '@internal-types/SessionProfile';
import { logger } from '@utils/logger';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';

const STEALTH_PATCH_MANIFEST = [
  { api: 'navigator.webdriver', method: 'property override (configurable:false)' },
  { api: 'window.chrome', method: 'object injection (runtime, loadTimes, csi)' },
  { api: 'navigator.plugins', method: 'PluginArray override (spoofed length/names)' },
  { api: 'Permissions.query', method: 'result filter (returns granted/prompt)' },
  { api: 'HTMLCanvasElement.toDataURL/toBlob', method: 'pixel noise injection' },
  { api: 'WebGLRenderingContext.getParameter', method: 'vendor/renderer override' },
  { api: 'navigator.languages', method: 'array override (locale-specific)' },
  { api: 'navigator.getBattery', method: 'fake BatteryManager' },
  { api: 'MediaDevices.enumerateDevices', method: 'device list filter' },
  { api: 'Notification.permission', method: 'permission override' },
  { api: 'performance.now / Date.now', method: 'timing offset compensation' },
  { api: 'CDP request timing', method: 'jitter compensation proxy' },
  {
    api: 'document.fonts.check',
    method: 'spoofed local-font availability (browser_font_fingerprint spoof)',
  },
];

interface StealthInjectionHandlersDeps {
  pageController: PageController;
  getActiveDriver: () => 'chrome' | 'camoufox';
}

/** Module-level jitter configuration shared across handler calls. */
const jitterOptions: CDPTimingOptions = { ...DEFAULT_TIMING_OPTIONS };
let fingerprintManagerInstance: FingerprintManagerLike | null = null;
const sessionProfileManager = SessionProfileManager.getInstance();

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
export function resetFingerprintCacheForTesting(): void {
  fingerprintManagerInstance = null;
}

export class StealthInjectionHandlers {
  constructor(private deps: StealthInjectionHandlersDeps) {}

  private getDefaultUserAgent(os: 'windows' | 'mac' | 'linux'): string {
    const userAgents = {
      windows:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      linux:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    return userAgents[os] || userAgents.windows;
  }

  async handleStealthInject(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      if (this.deps.getActiveDriver() === 'camoufox') {
        return R.ok().build({
          driver: 'camoufox',
          message:
            'Camoufox uses C++ engine-level fingerprint spoofing — JS-layer stealth scripts are not needed and ' +
            'have been skipped.',
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

      if (fingerprintApplied && fm) {
        const activeProfile = fm.getActiveProfile() as {
          headers?: Record<string, string>;
          os?: string;
        } | null;
        const cached = sessionProfileManager.getValidProfile();
        const mergedProfile: SessionProfile = {
          cookies: cached?.cookies ?? [],
          userAgent: activeProfile?.headers?.['User-Agent'] ?? cached?.userAgent,
          acceptLanguage: activeProfile?.headers?.['Accept-Language'] ?? cached?.acceptLanguage,
          referer: cached?.referer,
          clientHints: cached?.clientHints,
          platform: activeProfile?.os ?? cached?.platform,
          origin: cached?.origin,
          collectedAt: cached?.collectedAt ?? Date.now(),
          ttlSec: cached?.ttlSec ?? 1800,
        };
        sessionProfileManager.setProfile(mergedProfile);
      }

      return R.ok().build({
        message: 'Stealth scripts injected successfully',
        fingerprintApplied,
        patchManifest: STEALTH_PATCH_MANIFEST,
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
        message:
          `CDP timing jitter ${jitterOptions.enabled ? 'enabled' : 'disabled'}: ${jitterOptions.minDelayMs}-` +
          `${jitterOptions.maxDelayMs}ms${jitterOptions.burstMode ? ' (burst mode)' : ''}`,
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
              'Fingerprint generated using camoufox native engine. Apply via browser_launch(fingerprint=...) ' +
              'before launching.',
          });
        } catch (err) {
          return R.fail(
            `Camoufox fingerprint generation failed: ${err instanceof Error ? err.message : String(err)}`,
          ).build();
        }
      }

      const fm = await getFingerprintManager();

      if (!fm?.isAvailable()) {
        // Fallback: return basic profile without fingerprint-generator
        const locale = argString(args, 'locale', 'en-US');
        const os = argString(args, 'os', 'windows');
        const browser = argString(args, 'browser', 'chrome');

        const basicProfile = {
          userAgent: this.getDefaultUserAgent(os as 'windows' | 'mac' | 'linux'),
          acceptLanguage: locale,
          platform: os,
          browser,
          _note:
            'Basic profile without fingerprint-generator. Install fingerprint-generator for full profile.',
        };

        const stubData = createStub({
          tool: 'stealth_generate_fingerprint',
          stubType: 'partial',
          reason:
            'fingerprint-generator/fingerprint-injector packages not installed, using basic profile',
          fix: 'Install for full fingerprint: pnpm add fingerprint-generator fingerprint-injector',
          data: {
            available: false,
            capability: 'fingerprint_generator',
            status: 'partial',
            profile: basicProfile,
          },
        });
        return R.ok().merge(stubData).merge({ profile: basicProfile }).build();
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

  async handleBrowserFontFingerprint(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const useLocalFontApi = argBool(args, 'useLocalFontApi', true);
      const spoof = argBool(args, 'spoof', false);
      const maxFonts = argNumber(args, 'maxFonts', FONT_LOCAL_ENUMERATE_MAX);

      const code = buildFontFingerprintScript({
        useLocalFontApi,
        spoof,
        maxFonts,
        probeList: FONT_FALLBACK_PROBE_LIST,
      });
      const raw =
        (await this.deps.pageController.evaluate<Record<string, unknown> | null>(code)) ?? null;

      if (!raw || typeof raw !== 'object') {
        return R.fail('Font fingerprint probe returned no result.').build();
      }

      const detected = Array.isArray(raw['detected']) ? (raw['detected'] as unknown[]) : [];
      const detectedFonts = detected.filter((f): f is string => typeof f === 'string');

      return R.ok().build({
        count: detectedFonts.length,
        detected: detectedFonts,
        hash: typeof raw['hash'] === 'string' ? raw['hash'] : null,
        source:
          typeof raw['source'] === 'string'
            ? raw['source']
            : useLocalFontApi
              ? 'unknown'
              : 'probeFallback',
        localFontApiAvailable: raw['localFontApiAvailable'] === true,
        spoofed: raw['spoofed'] === true,
        spoofError: typeof raw['spoofError'] === 'string' ? raw['spoofError'] : undefined,
        _nextStepHint: spoof
          ? 'document.fonts.check is now overridden. Re-run with spoof=false to confirm the real fingerprint, or call stealth_verify to check overall stealth posture.'
          : 'Set spoof=true to override document.fonts.check and collapse the font fingerprint entropy.',
      });
    } catch (err) {
      return R.fail(
        `Font fingerprint failed: ${err instanceof Error ? err.message : String(err)}`,
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
        const stubData = createStub({
          tool: 'camoufox_geolocation',
          stubType: 'unavailable',
          reason: `Camoufox locale module unavailable: ${err instanceof Error ? err.message : String(err)}. Ensure camoufox-js is installed.`,
          fix: 'Install camoufox-js and fetch its browser assets: pnpm add camoufox-js && npx camoufox-js fetch',
          data: {
            available: false,
            capability: 'camoufox_locale',
            status: 'unavailable', // Keep for backward compatibility
          },
        });
        return R.fail(stubData.reason as string)
          .merge(stubData)
          .build();
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
      const stubData = createStub({
        tool: 'camoufox_geolocation',
        stubType: 'unavailable',
        reason: `Camoufox locale module unavailable: ${e instanceof Error ? e.message : String(e)}`,
        fix: 'Install camoufox-js and fetch its browser assets: pnpm add camoufox-js && npx camoufox-js fetch',
        data: {
          available: false,
          capability: 'camoufox_locale',
          status: 'unavailable', // Keep for backward compatibility
        },
      });
      return R.fail(stubData.reason as string)
        .merge(stubData)
        .build();
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

const PROBE_FALLBACK = 'probeFallback';
const PROBE_QUERY = 'queryLocalFonts';
const PROBE_UNAVAILABLE = 'unavailable';

/**
 * Build the in-page font-fingerprint probe script. Primary path is the Local Font
 * Access API (`queryLocalFonts`), which enumerates real installed fonts without a
 * hard-coded list. When the API is missing or the permission is denied, we fall
 * back to probing a small OS-discriminating set via `document.fonts.check`. The
 * `spoof` flag overrides `document.fonts.check` to a fixed result.
 *
 * Exported for unit testing; the runtime path evaluates this string in the page.
 */
export function buildFontFingerprintScript(options: {
  useLocalFontApi: boolean;
  spoof: boolean;
  maxFonts: number;
  probeList: readonly string[];
}): string {
  const { useLocalFontApi, spoof, maxFonts, probeList } = options;
  const probeJson = JSON.stringify(probeList);
  const cap = Math.max(0, Math.floor(maxFonts));
  const lines: string[] = [];
  lines.push('(() => {');
  lines.push('  const probeList = ' + probeJson + ';');
  lines.push('  const maxFonts = ' + String(cap) + ';');
  lines.push('  const wantLocalApi = ' + JSON.stringify(useLocalFontApi) + ';');
  lines.push('  const wantSpoof = ' + JSON.stringify(spoof) + ';');
  lines.push('  const hashNames = (names) => {');
  lines.push('    const sorted = names.slice().sort();');
  lines.push('    let h = 5381;');
  lines.push('    for (const n of sorted) {');
  lines.push(
    '      for (let i = 0; i < n.length; i++) { h = ((h << 5) + h + n.charCodeAt(i)) | 0; }',
  );
  lines.push('    }');
  lines.push("    return (h >>> 0).toString(16).padStart(8, '0');");
  lines.push('  };');
  lines.push(
    "  const fontsApi = typeof document !== 'undefined' && document.fonts && typeof document.fonts.check === 'function';",
  );
  lines.push('  const probeFallback = () => {');
  lines.push('    const detected = [];');
  lines.push('    if (!fontsApi) return detected;');
  lines.push('    for (const name of probeList) {');
  lines.push('      try {');
  lines.push("        if (document.fonts.check('12px \"' + name + '\"')) detected.push(name);");
  lines.push('      } catch (_) {}');
  lines.push('    }');
  lines.push('    return detected;');
  lines.push('  };');
  lines.push('  let localFontApiAvailable = false; let localFontApiError = null;');
  lines.push('  let spoofed = false; let spoofError = null;');
  lines.push('  let detected = []; let source = ' + JSON.stringify(PROBE_FALLBACK) + ';');
  lines.push('  if (wantSpoof && fontsApi) {');
  lines.push('    try { document.fonts.check = () => true; spoofed = true; }');
  lines.push('    catch (e) { spoofError = (e && e.message) ? e.message : String(e); }');
  lines.push('  }');
  lines.push("  if (wantLocalApi && typeof queryLocalFonts === 'function') {");
  lines.push('    localFontApiAvailable = true;');
  lines.push('    source = ' + JSON.stringify(PROBE_QUERY) + ';');
  lines.push('    return (async () => {');
  lines.push('      try {');
  lines.push('        const fonts = await queryLocalFonts();');
  lines.push('        const seen = new Set();');
  lines.push('        for (const f of fonts) {');
  lines.push("          if (f && typeof f.family === 'string') seen.add(f.family);");
  lines.push('          if (seen.size >= maxFonts) break;');
  lines.push('        }');
  lines.push('        detected = Array.from(seen).slice(0, maxFonts);');
  lines.push('      } catch (e) {');
  lines.push('        localFontApiAvailable = false;');
  lines.push('        localFontApiError = (e && e.message) ? e.message : String(e);');
  lines.push('        source = ' + JSON.stringify(PROBE_FALLBACK) + ';');
  lines.push('        detected = probeFallback();');
  lines.push('      }');
  lines.push(
    '      return { detected, count: detected.length, hash: hashNames(detected), source, localFontApiAvailable, localFontApiError, spoofed, spoofError };',
  );
  lines.push('    })();');
  lines.push('  }');
  lines.push(
    '  source = fontsApi ? ' +
      JSON.stringify(PROBE_FALLBACK) +
      ' : ' +
      JSON.stringify(PROBE_UNAVAILABLE) +
      ';',
  );
  lines.push('  detected = probeFallback();');
  lines.push(
    '  return { detected, count: detected.length, hash: hashNames(detected), source, localFontApiAvailable, localFontApiError, spoofed, spoofError };',
  );
  lines.push('})()');
  return lines.join('\n');
}
